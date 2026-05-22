/**
 * Glideline — ArrowTool (Phase 4, Story 4.4)
 *
 * Drawing tool for creating shape-to-shape arrows.
 * FSM: Idle → Pointing → Drawing
 *
 * Idle:
 *   - hover over a shape → highlights connection points (signalled via hoverShapeId)
 *   - pointerDown on a shape → transition to Drawing
 *   - pointerDown on canvas → no-op (return to idle)
 *
 * Drawing:
 *   - preview ArrowShape tracks the cursor
 *   - pointerUp on a shape → commit ArrowShape + 2 GlideBindings
 *   - pointerUp on canvas → commit unbound arrow (floating end)
 *   - Escape → cancel, remove preview
 *
 * Local-coordinate model (Phase 1):
 *   shape.x/y = world position of the start terminal
 *   start.point = { x: 0, y: 0 }  (always local origin)
 *   end.point   = { x: dx, y: dy } (local offset from start)
 */

import { StateNode } from '../state-node';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node';
import type { ShapeId, Vec2 } from '../types';
import { sid, bid } from '../types';
import type { ArrowShape, ArrowTerminal } from '../shapes/ArrowUtil';
import { getClosestConnectionPoint, anchorToEdge } from '../shapes/ArrowUtil';

const PREVIEW_ID = sid('__arrow-preview__');
const DEFAULT_CURVE_BEND = 0.3; // visible curve for non-zero bend

function makeTerminal(point: Vec2, boundShapeId: ShapeId | null = null): ArrowTerminal {
  return {
    boundShapeId,
    normalizedAnchor: { x: 0.5, y: 0.5 },
    point,
  };
}

/**
 * Build an ArrowShape in the local-coordinate model.
 * shape.x/y = startWorld; start.point = {0,0}; end.point = local offset.
 */
function makeArrowShape(id: ShapeId, startWorld: Vec2, endWorld: Vec2, routeStyle: 'curve' | 'ortho' = 'curve'): ArrowShape {
  return {
    id,
    type: 'arrow',
    x: startWorld.x,
    y: startWorld.y,
    index: 'a1',
    rotation: 0,
    meta: {},
    props: {
      start: makeTerminal({ x: 0, y: 0 }),
      end:   makeTerminal({ x: endWorld.x - startWorld.x, y: endWorld.y - startWorld.y }),
      routeStyle,
      bend: DEFAULT_CURVE_BEND,
    },
  };
}

/** Convert local bounds (from getGeometry) to world bounds by adding shape.x/y. */
function toWorldBounds(
  localBounds: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number; x?: number; y?: number },
  shape: { x: number; y: number }
) {
  return {
    ...localBounds,
    x: localBounds.minX + shape.x,
    y: localBounds.minY + shape.y,
    minX: localBounds.minX + shape.x,
    minY: localBounds.minY + shape.y,
    maxX: localBounds.maxX + shape.x,
    maxY: localBounds.maxY + shape.y,
  };
}

// ─────────────────────────────────────────────────────────────
// Idle
// ─────────────────────────────────────────────────────────────

export class ArrowIdle extends StateNode {
  static override readonly id = 'idle';

  /** ID of shape currently under cursor (for connection point highlight). */
  hoverShapeId: ShapeId | null = null;

  override onPointerMove(e: PointerMoveEvent): void {
    const hits = this.editor.getShapesAtPoint(e.point).filter(s => s.type !== 'arrow');
    this.hoverShapeId = hits.length > 0
      ? (hits[hits.length - 1].id as ShapeId)
      : null;
  }

  override onPointerDown(e: PointerDownEvent): void {
    const hits = this.editor.getShapesAtPoint(e.point).filter(s => s.type !== 'arrow');
    const target = hits.length > 0 ? hits[hits.length - 1] : null;
    this.parent!.transition('drawing', { origin: e.point, fromShapeId: target ? (target.id as ShapeId) : null });
  }
}

// ─────────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────────

class Drawing extends StateNode {
  static override readonly id = 'drawing';

  private _origin!: Vec2;
  private _fromShapeId!: ShapeId | null;

  override onEnter(info: { origin: Vec2; fromShapeId: ShapeId | null }): void {
    this._origin      = info.origin;
    this._fromShapeId = info.fromShapeId;

    const routeStyle = (this.editor as any).arrowRouteStyle ?? 'curve';
    let startPt = info.origin;

    if (this._fromShapeId) {
      const fromShape = this.editor.getShape(this._fromShapeId);
      if (fromShape) {
        const util = this.editor.getShapeUtil(fromShape.type);
        const localBounds = util.getGeometry(fromShape as any).getBounds();
        const worldBounds = toWorldBounds(localBounds, fromShape);
        const snapped = getClosestConnectionPoint(info.origin, worldBounds);
        startPt = snapped.point;
        this._origin = snapped.point;
      }
    }

    // Create preview arrow (not recorded in history)
    this.editor.history.batch('Arrow Preview', () => {
      this.editor.createShape(makeArrowShape(PREVIEW_ID, startPt, startPt, routeStyle));
    }, { history: 'ignore' });
  }

  override onPointerMove(e: PointerMoveEvent): void {
    const existing = this.editor.getShape<ArrowShape>(PREVIEW_ID);
    if (!existing) return;

    // Check if hovered on a shape (exclude the from-shape and arrows)
    const hits = this.editor.getShapesAtPoint(e.point)
      .filter(s => s.type !== 'arrow' && s.id !== this._fromShapeId);
    const hoveredShape = hits.length > 0 ? hits[hits.length - 1] : null;

    let endWorldPt = e.point;
    let boundShapeId: ShapeId | null = null;
    let normalizedAnchor = { x: 0.5, y: 0.5 };

    if (hoveredShape) {
      const util = this.editor.getShapeUtil(hoveredShape.type);
      const localBounds = util.getGeometry(hoveredShape as any).getBounds();
      const worldBounds = toWorldBounds(localBounds, hoveredShape);
      const snapped = getClosestConnectionPoint(e.point, worldBounds);
      endWorldPt = snapped.point;
      boundShapeId = hoveredShape.id as ShapeId;
      normalizedAnchor = snapped.normalizedAnchor;
    }

    // Local model: end.point is relative to arrow.x/y (= start world position)
    const localEndX = endWorldPt.x - existing.x;
    const localEndY = endWorldPt.y - existing.y;

    this.editor.history.batch('Arrow Preview Update', () => {
      this.editor.updateShape<ArrowShape>(PREVIEW_ID, {
        props: {
          ...existing.props,
          end: {
            boundShapeId,
            normalizedAnchor,
            point: { x: localEndX, y: localEndY },
          },
        },
      });
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    // Check if released on a shape (exclude the from-shape and arrows)
    const hits = this.editor.getShapesAtPoint(e.point)
      .filter(s => s.type !== 'arrow' && s.id !== this._fromShapeId);
    const toShapeId: ShapeId | null = hits.length > 0
      ? (hits[hits.length - 1].id as ShapeId)
      : null;

    // Remove preview
    this.editor.history.batch('Arrow Preview Cleanup', () => {
      this.editor.deleteShapes([PREVIEW_ID]);
    }, { history: 'ignore' });

    const routeStyle = (this.editor as any).arrowRouteStyle ?? 'curve';

    // Commit final arrow + bindings
    const finalId = sid(`arrow-${Date.now()}`);
    this.editor.history.batch('Create Arrow', () => {
      // Compute start world point
      let startAnchor = { x: 0.5, y: 0.5 };
      let startPt = this._origin;
      if (this._fromShapeId) {
        const fromShape = this.editor.getShape(this._fromShapeId);
        if (fromShape) {
          const util = this.editor.getShapeUtil(fromShape.type);
          const localBounds = util.getGeometry(fromShape as any).getBounds();
          const worldBounds = toWorldBounds(localBounds, fromShape);
          const snapped = getClosestConnectionPoint(this._origin, worldBounds);
          startAnchor = snapped.normalizedAnchor;
          startPt = snapped.point;
        }
      }

      // Compute end world point
      let endAnchor = { x: 0.5, y: 0.5 };
      let endPt = e.point;
      if (toShapeId) {
        const target = this.editor.getShape(toShapeId);
        if (target) {
          const util = this.editor.getShapeUtil(target.type);
          const localBounds = util.getGeometry(target as any).getBounds();
          const worldBounds = toWorldBounds(localBounds, target);
          const snapped = getClosestConnectionPoint(e.point, worldBounds);
          endAnchor = snapped.normalizedAnchor;
          endPt = snapped.point;
        }
      }

      // Local model: shape.x/y = startPt; start.point = {0,0}; end.point = local offset
      const arrow = makeArrowShape(finalId, startPt, endPt, routeStyle);
      if (this._fromShapeId) {
        arrow.props.start = {
          boundShapeId: this._fromShapeId,
          normalizedAnchor: startAnchor,
          point: { x: 0, y: 0 },
        };
      }
      if (toShapeId) {
        arrow.props.end = {
          boundShapeId: toShapeId,
          normalizedAnchor: endAnchor,
          point: { x: endPt.x - startPt.x, y: endPt.y - startPt.y },
        };
      }

      this.editor.createShape(arrow);

      // Create binding: start → fromShape
      if (this._fromShapeId) {
        this.editor.createBinding({
          id:     bid(`bind-start-${Date.now()}-${Math.random().toString(36).slice(2)}`),
          type:   'arrow',
          fromId: finalId,
          toId:   this._fromShapeId,
          meta:   {},
          props: {
            terminal:         'start',
            normalizedAnchor: startAnchor,
            fromEdge:         anchorToEdge(startAnchor),
          },
        });
      }

      // Create binding: end → toShape
      if (toShapeId) {
        this.editor.createBinding({
          id:     bid(`bind-end-${Date.now()}-${Math.random().toString(36).slice(2)}`),
          type:   'arrow',
          fromId: finalId,
          toId:   toShapeId,
          meta:   {},
          props: {
            terminal:         'end',
            normalizedAnchor: endAnchor,
            fromEdge:         anchorToEdge(endAnchor),
          },
        });
      }

      // After bindings created, fire onAfterChangeToShape to let BindingUtil
      // compute fromEdge from normalizedAnchor. We do a no-op shape update on
      // each target to trigger the hook.
      if (this._fromShapeId) {
        const s = this.editor.getShape(this._fromShapeId);
        if (s) this.editor.updateShape(this._fromShapeId, { x: s.x });
      }
      if (toShapeId) {
        const s = this.editor.getShape(toShapeId);
        if (s) this.editor.updateShape(toShapeId, { x: s.x });
      }
    });

    // Switch to select and highlight the newly created arrow
    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([finalId]);
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.history.batch('Arrow Preview Cleanup', () => {
        this.editor.deleteShapes([PREVIEW_ID]);
      }, { history: 'ignore' });
      this.parent!.transition('idle');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ArrowTool (root)
// ─────────────────────────────────────────────────────────────

export class ArrowTool extends StateNode {
  static override readonly id = 'arrow';
  static override children = () => [ArrowIdle, Drawing];
}
