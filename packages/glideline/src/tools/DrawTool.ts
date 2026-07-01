/**
 * DrawTool — freehand pencil strokes (Phase B)
 *
 * FSM: Idle → Drawing
 *
 * Idle:
 *   pointerDown → create freehand shape with first point, transition to Drawing
 *
 * Drawing:
 *   pointerMove  → append new sample point (live preview, history: ignore)
 *   pointerUp    → finalize stroke; if < 3 points, delete it; else commit
 *   Escape       → cancel, remove preview shape
 *
 * Points are stored in page space (already converted by Canvas.tsx before dispatch).
 * Pressure is taken from PointerEvent.pressure (0.5 for mouse / keyboard).
 */

import { StateNode } from '../state-node';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node';
import type { ShapeId, Vec2 } from '../types';
import { sid } from '../types';
import type { FreehandPoint } from '../shapes/FreehandUtil';

const PREVIEW_ID = sid('__draw-preview__');
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

  private _points: FreehandPoint[] = [];
  private _lastPt: Vec2 = { x: 0, y: 0 };

  override onEnter(info: PointerDownEvent): void {
    const firstPt: FreehandPoint = {
      x:        info.point.x,
      y:        info.point.y,
      pressure: (info as any).pressure ?? 0.5,
    };
    this._points    = [firstPt];
    this._lastPt    = info.point;

    this.editor.history.batch('Draw Preview', () => {
      this.editor.createShape({
        id:       PREVIEW_ID,
        type:     'freehand',
        x:        info.point.x,
        y:        info.point.y,
        index:    'a1',
        rotation: 0,
        meta:     {},
        props: {
          points:     [firstPt],
          strokeWidth: this.editor.activeStyles.value.strokeWidth ?? 'medium',
          strokeStyle: this.editor.activeStyles.value.strokeStyle ?? 'solid',
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
      pressure: (e as any).pressure ?? 0.5,
    };
    this._points = [...this._points, newPt];

    this.editor.history.batch('Draw Preview Update', () => {
      this.editor.updateShape(PREVIEW_ID, {
        props: {
          points:     this._points,
          strokeWidth: this.editor.activeStyles.value.strokeWidth ?? 'medium',
          strokeStyle: this.editor.activeStyles.value.strokeStyle ?? 'solid',
          opacity:    1,
          isClosed:   false,
          isComplete: false,
        },
      });
    }, { history: 'ignore' });
  }

  override onPointerUp(_e: PointerUpEvent): void {
    // Remove preview always
    this.editor.history.batch('Draw Preview Cleanup', () => {
      this.editor.deleteShapes([PREVIEW_ID]);
    }, { history: 'ignore' });

    // Commit only if stroke has enough points to be meaningful
    if (this._points.length >= 2) {
      const finalId = sid(`draw-${Date.now()}`);
      const pts = this._points;

      // Compute AABB origin for shape.x/y
      let minX = Infinity, minY = Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
      }

      this.editor.history.batch('Draw Stroke', () => {
        this.editor.createShape({
          id:       finalId,
          type:     'freehand',
          x:        minX,
          y:        minY,
          index:    'a1',
          rotation: 0,
          meta:     {},
          props: {
            points:     pts,
            strokeWidth: this.editor.activeStyles.value.strokeWidth ?? 'medium',
            strokeStyle: this.editor.activeStyles.value.strokeStyle ?? 'solid',
            opacity:    1,
            isClosed:   false,
            isComplete: true,
          },
        });
      });

    }

    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.history.batch('Draw Preview Cleanup', () => {
        this.editor.deleteShapes([PREVIEW_ID]);
      }, { history: 'ignore' });
      this.parent!.transition('idle');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// DrawTool (root)
// ─────────────────────────────────────────────────────────────

export class DrawTool extends StateNode {
  static override readonly id = 'draw';
  static override children = () => [Idle, Drawing];
}
