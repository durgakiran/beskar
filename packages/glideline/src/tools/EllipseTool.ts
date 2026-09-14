/**
 * EllipseTool — draw ellipses by drag (Phase B)
 *
 * FSM: Idle → Pointing → Drawing
 *
 * Mirrors BoxTool exactly, but creates ellipse shapes.
 * Shift+drag constrains to a circle (equal w/h).
 * On pointerUp: commits shape, switches to select tool, selects the new shape.
 *
 * The in-progress ellipse is staged under its real, final shape id via
 * beginHistoryPreview()/recordHistoryPreview() — the same InteractionManager
 * preview lifecycle SelectTool uses for drag/resize/rotate — so there's no
 * delete-then-recreate step between the live preview and the committed shape.
 * pointerCancel (a browser/OS-initiated abort, e.g. trackpad gesture
 * disambiguation on a fast short drag) commits the ellipse exactly as it was
 * last staged rather than losing it; Escape still discards it.
 */

import { StateNode } from '../state-node.js';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node.js';
import type { ShapeId, Vec2 } from '../types.js';

const DRAG_THRESHOLD = 4;

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function makeEllipseShape(id: ShapeId, x: number, y: number, w: number, h: number) {
  return {
    id,
    type:     'ellipse',
    x:        Math.min(x, x + w),
    y:        Math.min(y, y + h),
    rotation: 0,
    meta:     {},
    props: {
      w:           Math.max(1, Math.abs(w)),
      h:           Math.max(1, Math.abs(h)),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Idle
// ─────────────────────────────────────────────────────────────

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(e: PointerDownEvent): void {
    this.parent!.transition('pointing', e);
  }
}

// ─────────────────────────────────────────────────────────────
// Pointing
// ─────────────────────────────────────────────────────────────

class Pointing extends StateNode {
  static override readonly id = 'pointing';

  private _origin!: Vec2;

  override onEnter(info: PointerDownEvent): void {
    this._origin = info.point;
  }

  override onPointerMove(e: PointerMoveEvent): void {
    if (dist(this._origin, e.point) > DRAG_THRESHOLD) {
      this.parent!.transition('drawing', { origin: this._origin, current: e.point });
    }
  }

  override onPointerUp(_e: PointerUpEvent): void {
    // No drag — just return to idle without creating shape
    this.parent!.transition('idle');
  }
}

// ─────────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────────

class Drawing extends StateNode {
  static override readonly id = 'drawing';

  private _id!: ShapeId;
  private _origin!: Vec2;
  private _shiftKey = false;

  override onEnter(info: { origin: Vec2; current: Vec2 }): void {
    this._origin = info.origin;
    this._id = this.editor.createShapeId('ellipse');

    const w = info.current.x - info.origin.x;
    const h = info.current.y - info.origin.y;

    this.editor.beginHistoryPreview();
    this.editor.batch('Ellipse Preview', () => {
      this.editor.createShape(makeEllipseShape(this._id, info.origin.x, info.origin.y, w, h));
    }, { history: 'ignore' });
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this._shiftKey = (e as any).shiftKey ?? false;
    this._updateEllipse(e.point);
  }

  override onPointerUp(e: PointerUpEvent): void {
    this._updateEllipse(e.point);
    this._commit();
  }

  override onPointerCancel(): void {
    // No reliable point on a browser/OS-initiated cancel — commit the
    // ellipse exactly as it was last staged rather than losing it.
    this._commit();
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.cancelHistoryPreview();
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    // Safety net: if the tool is switched away mid-drag without a
    // pointerUp/pointerCancel/Escape, make sure no staged preview lingers.
    this.editor.cancelHistoryPreview();
  }

  private _updateEllipse(point: Vec2): void {
    let w = point.x - this._origin.x;
    let h = point.y - this._origin.y;

    // Shift: constrain to circle by taking the larger dimension
    if (this._shiftKey) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = w < 0 ? -s : s;
      h = h < 0 ? -s : s;
    }

    this.editor.batch('Ellipse Preview Update', () => {
      this.editor.updateShape(this._id, {
        x:    Math.min(this._origin.x, this._origin.x + w),
        y:    Math.min(this._origin.y, this._origin.y + h),
        props: {
          w:           Math.max(1, Math.abs(w)),
          h:           Math.max(1, Math.abs(h)),
        },
      });
    }, { history: 'ignore' });
  }

  private _commit(): void {
    // Promote the staged record into the real store as a single atomic,
    // history-recorded transaction under its original id.
    this.editor.recordHistoryPreview('Create Ellipse', new Map([[this._id, null]]));

    // Switch to select and select the new shape
    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([this._id]);

    this.parent!.transition('idle');
  }
}

// ─────────────────────────────────────────────────────────────
// EllipseTool (root)
// ─────────────────────────────────────────────────────────────

export class EllipseTool extends StateNode {
  static override readonly id = 'ellipse';
  static override children = () => [Idle, Pointing, Drawing];
}
