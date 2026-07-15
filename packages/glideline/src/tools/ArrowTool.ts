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
import type { AnyRecord, ShapeId, Vec2 } from '../types';
import { makeBox, sid } from '../types';
import type { ArrowShape } from '../shapes/ArrowUtil';
import { getClosestConnectionPoint, getConnectionPoints } from '../shapes/ArrowUtil';
import type { BindingPreview, BindingPreviewCandidate } from '../editor';
import { buildArrowBindingRecord, buildArrowShapeRecord } from '../arrow-records';

const PREVIEW_ID = sid('__arrow-preview__');
const BINDING_SNAP_RADIUS = 12;

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

function buildBindingPreviewCandidate(editor: StateNode['editor'], targetShape: { id: ShapeId; type: string; x: number; y: number }, point: Vec2): BindingPreviewCandidate {
  const util = editor.getShapeUtil(targetShape.type);
  const localBounds = util.getGeometry(targetShape as any).getBounds();
  const worldBounds = toWorldBounds(localBounds, targetShape);
  const snapped = getClosestConnectionPoint(point, worldBounds);

  return {
    targetId: targetShape.id,
    targetType: targetShape.type,
    normalizedAnchor: snapped.normalizedAnchor,
    point: snapped.point,
    candidateAnchors: getConnectionPoints(worldBounds),
  };
}

function matchingPreview(
  preview: BindingPreview | null,
  terminal: 'start' | 'end',
  targetId: ShapeId | null
): BindingPreviewCandidate | null {
  if (!preview || !targetId) return null;
  if (preview.terminal === terminal && preview.targetId === targetId) return preview;
  return null;
}

function findBindableShapeCandidate(
  editor: StateNode['editor'],
  point: Vec2,
  excludeIds: ShapeId[] = [],
): { shape: { id: ShapeId; type: string; x: number; y: number }; preview: BindingPreviewCandidate } | null {
  const excluded = new Set(excludeIds.filter(Boolean));
  const directHits = editor.getShapesAtPoint(point)
    .filter(s => s.type !== 'arrow' && !excluded.has(s.id as ShapeId));
  const directShape = directHits.length > 0 ? directHits[directHits.length - 1] : null;
  if (directShape) {
    return {
      shape: directShape as any,
      preview: buildBindingPreviewCandidate(editor, directShape as any, point),
    };
  }

  const nearby = editor.getShapesInBox(makeBox(
    point.x - BINDING_SNAP_RADIUS,
    point.y - BINDING_SNAP_RADIUS,
    BINDING_SNAP_RADIUS * 2,
    BINDING_SNAP_RADIUS * 2,
  )).filter(s => s.type !== 'arrow' && !excluded.has(s.id as ShapeId));

  let best: { shape: { id: ShapeId; type: string; x: number; y: number }; preview: BindingPreviewCandidate } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const shape of nearby) {
    const preview = buildBindingPreviewCandidate(editor, shape as any, point);
    const distance = Math.hypot(preview.point.x - point.x, preview.point.y - point.y);
    if (distance <= BINDING_SNAP_RADIUS && distance < bestDistance) {
      best = { shape: shape as any, preview };
      bestDistance = distance;
    }
  }

  return best;
}

// ─────────────────────────────────────────────────────────────
// Idle
// ─────────────────────────────────────────────────────────────

export class ArrowIdle extends StateNode {
  static override readonly id = 'idle';

  /** ID of shape currently under cursor (for connection point highlight). */
  hoverShapeId: ShapeId | null = null;

  override onPointerMove(e: PointerMoveEvent): void {
    this.hoverShapeId = findBindableShapeCandidate(this.editor, e.point)?.shape.id ?? null;
  }

  override onPointerDown(e: PointerDownEvent): void {
    const source = findBindableShapeCandidate(this.editor, e.point);
    this.parent!.transition('drawing', {
      origin: e.point,
      fromShapeId: source ? (source.shape.id as ShapeId) : null,
    });
  }
}

// ─────────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────────

class Drawing extends StateNode {
  static override readonly id = 'drawing';

  private _origin!: Vec2;
  private _fromShapeId!: ShapeId | null;
  private _sourcePreview: BindingPreviewCandidate | null = null;

  override onEnter(info: { origin: Vec2; fromShapeId: ShapeId | null }): void {
    this._origin      = info.origin;
    this._fromShapeId = info.fromShapeId;
    this._sourcePreview = null;
    this.editor.clearBindingPreview();

    const routeStyle = (this.editor as any).arrowRouteStyle ?? 'curve';
    const arrowheadStart = (this.editor as any).arrowheadStart ?? 'none';
    const arrowheadEnd = (this.editor as any).arrowheadEnd ?? 'arrow';
    let startPt = info.origin;

    if (this._fromShapeId) {
      const fromShape = this.editor.getShape(this._fromShapeId);
      if (fromShape) {
        this._sourcePreview = buildBindingPreviewCandidate(this.editor, fromShape as any, info.origin);
        startPt = this._sourcePreview.point;
        this._origin = this._sourcePreview.point;
        this.editor.setBindingPreview({
          terminal: 'start',
          ...this._sourcePreview,
          sourceCandidate: null,
        });
      }
    }

    // Create preview arrow (not recorded in history)
    this.editor.history.batch('Arrow Preview', () => {
      this.editor.createShape(buildArrowShapeRecord({
        id: PREVIEW_ID,
        startWorld: startPt,
        endWorld: startPt,
        routeStyle,
        arrowheadStart,
        arrowheadEnd,
      }) as unknown as AnyRecord);
    }, { history: 'ignore', scope: 'ephemeral' });
  }

  override onPointerMove(e: PointerMoveEvent): void {
    const existing = this.editor.getShape<ArrowShape>(PREVIEW_ID);
    if (!existing) return;

    // Check if hovered on a shape (exclude the from-shape and arrows)
    let endWorldPt = e.point;
    let boundShapeId: ShapeId | null = null;
    let normalizedAnchor = { x: 0.5, y: 0.5 };
    const hovered = findBindableShapeCandidate(this.editor, e.point, this._fromShapeId ? [this._fromShapeId] : []);

    if (hovered) {
      const preview = hovered.preview;
      const snapped = { normalizedAnchor: preview.normalizedAnchor, point: preview.point };
      endWorldPt = snapped.point;
      boundShapeId = hovered.shape.id as ShapeId;
      normalizedAnchor = snapped.normalizedAnchor;
      this.editor.setBindingPreview({
        terminal: 'end',
        ...preview,
        sourceCandidate: this._sourcePreview,
      });
    } else if (this._sourcePreview) {
      this.editor.setBindingPreview({
        terminal: 'start',
        ...this._sourcePreview,
        sourceCandidate: null,
      });
    } else {
      this.editor.clearBindingPreview();
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
    }, { history: 'ignore', scope: 'ephemeral' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    const activePreview = this.editor.bindingPreview.peek();
    this.editor.clearBindingPreview();
    const hovered = findBindableShapeCandidate(this.editor, e.point, this._fromShapeId ? [this._fromShapeId] : []);
    const toShapeId: ShapeId | null = hovered ? (hovered.shape.id as ShapeId) : null;

    // Remove preview
    this.editor.history.batch('Arrow Preview Cleanup', () => {
      this.editor.deleteShapes([PREVIEW_ID]);
    }, { history: 'ignore', scope: 'ephemeral' });

    const routeStyle = (this.editor as any).arrowRouteStyle ?? 'curve';
    const arrowheadStart = (this.editor as any).arrowheadStart ?? 'none';
    const arrowheadEnd = (this.editor as any).arrowheadEnd ?? 'arrow';

    // Commit final arrow + bindings
    const finalId = sid(`arrow-${Date.now()}`);
    this.editor.history.batch('Create Arrow', () => {
      // Compute start world point
      let startAnchor = { x: 0.5, y: 0.5 };
      let startPt = this._origin;
      if (this._sourcePreview && this._fromShapeId) {
        startAnchor = this._sourcePreview.normalizedAnchor;
        startPt = this._sourcePreview.point;
      } else if (this._fromShapeId) {
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
        const previewCandidate = matchingPreview(activePreview, 'end', toShapeId);
        if (previewCandidate) {
          endAnchor = previewCandidate.normalizedAnchor;
          endPt = previewCandidate.point;
        } else {
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
      }

      // Local model: shape.x/y = startPt; start.point = {0,0}; end.point = local offset
      const arrow = buildArrowShapeRecord({
        id: finalId,
        startWorld: startPt,
        endWorld: endPt,
        routeStyle,
        arrowheadStart,
        arrowheadEnd,
      });
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

      this.editor.createShape(arrow as unknown as AnyRecord);

      // Create binding: start → fromShape
      if (this._fromShapeId) {
        this.editor.createBinding(buildArrowBindingRecord({
          id: `bind-start-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fromId: finalId,
          toId: this._fromShapeId,
          terminal: 'start',
          normalizedAnchor: startAnchor,
        }));
      }

      // Create binding: end → toShape
      if (toShapeId) {
        this.editor.createBinding(buildArrowBindingRecord({
          id: `bind-end-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          fromId: finalId,
          toId: toShapeId,
          terminal: 'end',
          normalizedAnchor: endAnchor,
        }));
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
      this.editor.clearBindingPreview();
      this.editor.history.batch('Arrow Preview Cleanup', () => {
        this.editor.deleteShapes([PREVIEW_ID]);
    }, { history: 'ignore', scope: 'ephemeral' });
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.editor.clearBindingPreview();
  }
}

// ─────────────────────────────────────────────────────────────
// ArrowTool (root)
// ─────────────────────────────────────────────────────────────

export class ArrowTool extends StateNode {
  static override readonly id = 'arrow';
  static override children = () => [ArrowIdle, Drawing];
}
