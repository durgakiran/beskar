/**
 * DrawTool — freehand pencil strokes (Phase B)
 *
 * FSM: Idle → Drawing
 *
 * Idle:
 *   pointerDown → create freehand shape with first point, transition to Drawing
 *
 * Drawing:
 *   pointerMove   → append new sample point (live preview, history: ignore)
 *   pointerUp     → finalize stroke; if < 2 points, discard; else commit
 *   pointerCancel → browser/OS-initiated abort (e.g. trackpad gesture
 *                   disambiguation on a fast short drag) — commit whatever
 *                   was drawn so far rather than losing it, same as pointerUp
 *   Escape        → user-initiated abort; discard the stroke
 *
 * Points are stored in page space (already converted by Canvas.tsx before dispatch).
 * Pressure is taken from PointerEvent.pressure (0.5 for mouse / keyboard).
 *
 * The in-progress stroke is staged under its real, final shape id via
 * beginHistoryPreview()/recordHistoryPreview() (the same InteractionManager
 * preview lifecycle SelectTool uses for drag/resize/rotate). The record lives
 * only in the interaction overlay until commit — it never touches the real
 * store or gets a second, different id swapped in, so there's no
 * delete-then-recreate step for the renderer to race against.
 */

import { StateNode } from '../state-node.js';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node.js';
import type { ShapeId, Vec2 } from '../types.js';
import type { FreehandPoint } from '../shapes/FreehandUtil.js';

/** Minimum squared distance between successive points (de-duplicate near-idle). */
const MIN_DIST_SQ = 4;

function distSq(a: Vec2, b: Vec2): number {
  return (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
}

// ─────────────────────────────────────────────────────────────
// Idle
// ─────────────────────────────────────────────────────────────

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(e: PointerDownEvent): void {
    this.parent!.transition('drawing', e);
  }
}

// ─────────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────────

class Drawing extends StateNode {
  static override readonly id = 'drawing';

  private _id!: ShapeId;
  private _points: FreehandPoint[] = [];
  private _lastPt: Vec2 = { x: 0, y: 0 };
  private _pressureSensitive = false;
  private _simulatePressure = false;

  override onEnter(info: PointerDownEvent): void {
    this._pressureSensitive = this.editor.activeStyles.value.pressureSensitive === true;
    this._simulatePressure = this._pressureSensitive && info.pointerType !== 'pen';
    const firstPt: FreehandPoint = {
      x:        info.point.x,
      y:        info.point.y,
      pressure: info.pressure ?? 0.5,
    };
    this._points = [firstPt];
    this._lastPt = info.point;
    this._id     = this.editor.createShapeId('freehand');

    this.editor.beginHistoryPreview();
    this.editor.batch('Draw Preview', () => {
      this.editor.createShape({
        id:       this._id,
        type:     'freehand',
        x:        info.point.x,
        y:        info.point.y,
        rotation: 0,
        meta:     {},
        props: {
          points:     [firstPt],
          strokeWidth: this.editor.activeStyles.value.strokeWidth ?? 'medium',
          strokeStyle: this.editor.activeStyles.value.strokeStyle ?? 'solid',
          pressureSensitive: this._pressureSensitive,
          simulatePressure: this._simulatePressure,
          opacity:    1,
          isClosed:   false,
          isComplete: false,
        },
      });
    }, { history: 'ignore' });
  }

  override onPointerMove(e: PointerMoveEvent): void {
    // Skip if pointer hasn't moved enough (reduces point count)
    if (distSq(this._lastPt, e.point) < MIN_DIST_SQ) return;
    this._lastPt = e.point;

    const newPt: FreehandPoint = {
      x:        e.point.x,
      y:        e.point.y,
      pressure: e.pressure ?? 0.5,
    };
    this._points = [...this._points, newPt];

    this.editor.batch('Draw Preview Update', () => {
      this.editor.updateShape(this._id, {
        props: {
          points:     this._points,
          strokeWidth: this.editor.activeStyles.value.strokeWidth ?? 'medium',
          strokeStyle: this.editor.activeStyles.value.strokeStyle ?? 'solid',
          pressureSensitive: this._pressureSensitive,
          simulatePressure: this._simulatePressure,
          opacity:    1,
          isClosed:   false,
          isComplete: false,
        },
      });
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    // PointerUp can contain a final sample that never arrived as pointerMove.
    // Keep it so the committed stroke ends where the pointer actually ended.
    if (distSq(this._lastPt, e.point) >= MIN_DIST_SQ) {
      this._points = [...this._points, {
        x: e.point.x,
        y: e.point.y,
        pressure: e.pressure ?? 0.5,
      }];
    }
    this._finishStroke();
  }

  override onPointerCancel(): void {
    // The browser/OS can cancel an in-progress pointer sequence for reasons
    // that have nothing to do with user intent — e.g. a trackpad
    // disambiguating a fast, short drag as a scroll/gesture attempt instead
    // of delivering a normal pointerUp. Losing a stroke the user can see on
    // screen is worse than keeping one that ends a sample early, so commit
    // whatever was actually drawn rather than discarding it.
    this._finishStroke();
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.cancelHistoryPreview();
      this.parent!.transition('idle');
    }
  }

  private _finishStroke(): void {
    if (this._points.length < 2) {
      // Too short to count as a stroke — discard the staged preview, nothing
      // was ever written to the real store.
      this.editor.cancelHistoryPreview();
      this.parent!.transition('idle');
      return;
    }

    const pts = this._points;

    // Compute AABB origin for shape.x/y
    let minX = Infinity, minY = Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
    }

    // Final touch-up to the still-staged record (same id throughout).
    this.editor.batch('Draw Preview Update', () => {
      this.editor.updateShape(this._id, {
        x: minX,
        y: minY,
        props: {
          points:     pts,
          strokeWidth: this.editor.activeStyles.value.strokeWidth ?? 'medium',
          strokeStyle: this.editor.activeStyles.value.strokeStyle ?? 'solid',
          pressureSensitive: this._pressureSensitive,
          simulatePressure: this._simulatePressure,
          opacity:    1,
          isClosed:   false,
          isComplete: true,
        },
      });
    }, { history: 'ignore' });

    // Promote the staged record into the real store as a single atomic,
    // history-recorded transaction under its original id.
    this.editor.recordHistoryPreview('Create Freehand Stroke', new Map([[this._id, null]]));

    this.parent!.transition('idle');
  }

  override onExit(): void {
    // Safety net: if the tool is switched away mid-stroke without a
    // pointerUp/Escape, make sure no staged preview is left dangling.
    this.editor.cancelHistoryPreview();
  }
}

// ─────────────────────────────────────────────────────────────
// DrawTool (root)
// ─────────────────────────────────────────────────────────────

export class DrawTool extends StateNode {
  static override readonly id = 'draw';
  static override children = () => [Idle, Drawing];
}
