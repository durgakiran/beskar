/**
 * Glideline — BoxTool (Phase 3, Story 3.3)
 *
 * Drawing tool. FSM: Idle → Pointing → Drawing
 *
 * The in-progress box is staged under its real, final shape id via
 * beginHistoryPreview()/recordHistoryPreview() — the same InteractionManager
 * preview lifecycle SelectTool uses for drag/resize/rotate — so there's no
 * delete-then-recreate step between the live preview and the committed shape.
 * pointerCancel (a browser/OS-initiated abort, e.g. trackpad gesture
 * disambiguation on a fast short drag) commits the box exactly as it was
 * last staged rather than losing it; Escape still discards it.
 * Drag threshold: 4px.
 */

import { StateNode } from '../state-node.js';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node.js';
import type { ShapeId, Vec2 } from '../types.js';

const DRAG_THRESHOLD = 4;

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function makeBoxShape(id: ShapeId, x: number, y: number, w: number, h: number) {
  return {
    id,
    type: 'box',
    x: Math.min(x, x + w),
    y: Math.min(y, y + h),
    rotation: 0,
    meta: {},
    props: {
      w: Math.abs(w),
      h: Math.abs(h),
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
    // No drag — return to idle without creating shape
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

  override onEnter(info: { origin: Vec2; current: Vec2 }): void {
    this._origin = info.origin;
    this._id = this.editor.createShapeId('box');

    const { x, y } = info.origin;
    const w = info.current.x - x;
    const h = info.current.y - y;

    this.editor.beginHistoryPreview();
    this.editor.batch('Box Preview', () => {
      this.editor.createShape(makeBoxShape(this._id, x, y, w, h));
    }, { history: 'ignore' });
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this._updateBox(e.point);
  }

  override onPointerUp(e: PointerUpEvent): void {
    this._updateBox(e.point);
    this._commit();
  }

  override onPointerCancel(): void {
    // No reliable point on a browser/OS-initiated cancel — commit the box
    // exactly as it was last staged rather than losing it.
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

  private _updateBox(point: Vec2): void {
    const x = this._origin.x;
    const y = this._origin.y;
    const w = point.x - x;
    const h = point.y - y;

    this.editor.batch('Box Preview Update', () => {
      this.editor.updateShape(this._id, {
        x: Math.min(x, x + w),
        y: Math.min(y, y + h),
        props: {
          w: Math.abs(w),
          h: Math.abs(h),
        },
      });
    }, { history: 'ignore' });
  }

  private _commit(): void {
    // Promote the staged record into the real store as a single atomic,
    // history-recorded transaction under its original id.
    this.editor.recordHistoryPreview('Create Box', new Map([[this._id, null]]));

    // Switch to select and highlight the newly created shape
    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([this._id]);
  }
}

// ─────────────────────────────────────────────────────────────
// BoxTool (root)
// ─────────────────────────────────────────────────────────────

export class BoxTool extends StateNode {
  static override readonly id = 'box';
  static override children = () => [Idle, Pointing, Drawing];
}
