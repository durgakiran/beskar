/**
 * Glideline — ArrowTool (Phase 4, Story 4.4)
 *
 * Drawing tool for creating shape-to-shape arrows.
 * FSM: Idle → Drawing
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
 *   - pointerCancel → browser/OS-initiated abort; finish the arrow exactly
 *     where it was last staged (including whatever end binding the last
 *     pointerMove had already resolved) rather than losing it
 *   - Escape → user-initiated abort; discard the arrow
 *
 * Local-coordinate model (Phase 1):
 *   shape.x/y = world position of the start terminal
 *   start.point = { x: 0, y: 0 }  (always local origin)
 *   end.point   = { x: dx, y: dy } (local offset from start)
 *
 * The in-progress arrow is staged under its real, final shape id via
 * beginHistoryPreview()/recordHistoryPreview() — the same InteractionManager
 * preview lifecycle SelectTool uses for drag/resize/rotate — so there's no
 * delete-then-recreate step between the live preview and the committed arrow.
 * The shape update and both binding creations commit together in a single
 * atomic transaction.
 */

import { StateNode } from '../state-node.js';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node.js';
import type { AnyRecord, ShapeId, Vec2 } from '../types.js';
import { makeBox } from '../types.js';
import type { ArrowShape } from '../shapes/ArrowUtil.js';
import type { BindingPreview, BindingPreviewCandidate } from '../editor.js';
import { buildArrowBindingRecord, buildArrowShapeRecord } from '../arrow-records.js';

const BINDING_SNAP_RADIUS = 12;

function buildBindingPreviewCandidate(editor: StateNode['editor'], targetShape: { id: ShapeId; type: string; x: number; y: number }, point: Vec2): BindingPreviewCandidate {
  const snapped = editor.transforms.getClosestConnectionAnchor(targetShape.id, point);

  return {
    targetId: targetShape.id,
    targetType: targetShape.type,
    normalizedAnchor: snapped.normalizedAnchor,
    point: snapped.point,
    candidateAnchors: editor.transforms.getConnectionAnchors(targetShape.id),
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
  const directShape = editor.getTopShapeAtPoint(
    point,
    shape => shape.type !== 'arrow' && !excluded.has(shape.id as ShapeId),
  );
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

  for (const shape of [...nearby].reverse()) {
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

  private _id!: ShapeId;
  private _origin!: Vec2;
  private _fromShapeId!: ShapeId | null;
  private _sourcePreview: BindingPreviewCandidate | null = null;

  override onEnter(info: { origin: Vec2; fromShapeId: ShapeId | null }): void {
    this._origin      = info.origin;
    this._fromShapeId = info.fromShapeId;
    this._sourcePreview = null;
    this._id = this.editor.createShapeId('arrow');
    this.editor.clearBindingPreview();

    const routeStyle = (this.editor as any).arrowRouteStyle ?? 'ortho';
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

    this.editor.beginHistoryPreview();
    this.editor.batch('Arrow Preview', () => {
      this.editor.createShape(buildArrowShapeRecord({
        id: this._id,
        startWorld: startPt,
        endWorld: startPt,
        parentId: this.editor.getActivePageId(),
        routeStyle,
        arrowheadStart,
        arrowheadEnd,
      }) as unknown as AnyRecord);
    }, { history: 'ignore' });
  }

  override onPointerMove(e: PointerMoveEvent): void {
    const existing = this.editor.getShape<ArrowShape>(this._id);
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

    this.editor.batch('Arrow Preview Update', () => {
      this.editor.updateShape<ArrowShape>(this._id, {
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
    const activePreview = this.editor.bindingPreview.peek();
    this.editor.clearBindingPreview();
    const hovered = findBindableShapeCandidate(this.editor, e.point, this._fromShapeId ? [this._fromShapeId] : []);
    const toShapeId: ShapeId | null = hovered ? (hovered.shape.id as ShapeId) : null;

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
          const snapped = this.editor.transforms.getClosestConnectionAnchor(toShapeId, e.point);
          endAnchor = snapped.normalizedAnchor;
          endPt = snapped.point;
        }
      }
    }

    this._finalizeArrow(endPt, endAnchor, toShapeId);
  }

  override onPointerCancel(): void {
    // No reliable drop point on a browser/OS-initiated cancel (e.g. trackpad
    // gesture disambiguation). Finish the arrow using whatever end binding
    // the last pointerMove had already resolved, instead of losing it.
    this.editor.clearBindingPreview();
    const existing = this.editor.getShape<ArrowShape>(this._id);
    if (!existing) {
      this.editor.cancelHistoryPreview();
      this.parent!.transition('idle');
      return;
    }

    const endWorldPt: Vec2 = {
      x: existing.x + existing.props.end.point.x,
      y: existing.y + existing.props.end.point.y,
    };
    this._finalizeArrow(endWorldPt, existing.props.end.normalizedAnchor, existing.props.end.boundShapeId as ShapeId | null);
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.clearBindingPreview();
      this.editor.cancelHistoryPreview();
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.editor.clearBindingPreview();
    // Safety net: if the tool is switched away mid-drag without a
    // pointerUp/pointerCancel/Escape, make sure no staged preview lingers.
    this.editor.cancelHistoryPreview();
  }

  /** Compute the start terminal, finalize props on the staged arrow, create bindings, and commit. */
  private _finalizeArrow(endWorldPt: Vec2, endAnchor: { x: number; y: number }, toShapeId: ShapeId | null): void {
    const routeStyle = (this.editor as any).arrowRouteStyle ?? 'ortho';
    const arrowheadStart = (this.editor as any).arrowheadStart ?? 'none';
    const arrowheadEnd = (this.editor as any).arrowheadEnd ?? 'arrow';

    // Compute start world point
    let startAnchor = { x: 0.5, y: 0.5 };
    let startPt = this._origin;
    if (this._sourcePreview && this._fromShapeId) {
      startAnchor = this._sourcePreview.normalizedAnchor;
      startPt = this._sourcePreview.point;
    } else if (this._fromShapeId) {
      const fromShape = this.editor.getShape(this._fromShapeId);
      if (fromShape) {
        const snapped = this.editor.transforms.getClosestConnectionAnchor(this._fromShapeId, this._origin);
        startAnchor = snapped.normalizedAnchor;
        startPt = snapped.point;
      }
    }

    this.editor.batch('Arrow Preview Update', () => {
      // Local model: shape.x/y = startPt; start.point = {0,0}; end.point = local offset
      const arrow = buildArrowShapeRecord({
        id: this._id,
        startWorld: startPt,
        endWorld: endWorldPt,
        parentId: this.editor.getActivePageId(),
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
          point: { x: endWorldPt.x - startPt.x, y: endWorldPt.y - startPt.y },
        };
      }

      this.editor.updateShape<ArrowShape>(this._id, {
        x: arrow.x,
        y: arrow.y,
        rotation: arrow.rotation,
        props: arrow.props,
      });

      // Create binding: start → fromShape
      if (this._fromShapeId) {
        this.editor.createBinding(buildArrowBindingRecord({
          id: this.editor.createBindingId('arrow'),
          fromId: this._id,
          toId: this._fromShapeId,
          terminal: 'start',
          normalizedAnchor: startAnchor,
          fromEdge: this.editor.transforms.getAnchorPageEdge(this._fromShapeId, startAnchor),
        }));
      }

      // Create binding: end → toShape
      if (toShapeId) {
        this.editor.createBinding(buildArrowBindingRecord({
          id: this.editor.createBindingId('arrow'),
          fromId: this._id,
          toId: toShapeId,
          terminal: 'end',
          normalizedAnchor: endAnchor,
          fromEdge: this.editor.transforms.getAnchorPageEdge(toShapeId, endAnchor),
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
    }, { history: 'ignore' });

    // Promote the staged arrow + its bindings into the real store as one
    // atomic, history-recorded transaction under the arrow's original id.
    this.editor.recordHistoryPreview('Create Arrow', new Map([[this._id, null]]));

    // Switch to select and highlight the newly created arrow
    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([this._id]);
  }
}

// ─────────────────────────────────────────────────────────────
// ArrowTool (root)
// ─────────────────────────────────────────────────────────────

export class ArrowTool extends StateNode {
  static override readonly id = 'arrow';
  static override children = () => [ArrowIdle, Drawing];
}
