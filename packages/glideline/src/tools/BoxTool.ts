/**
 * Glideline — BoxTool (Phase 3, Story 3.3)
 *
 * Drawing tool. FSM: Idle → Pointing → Drawing
 *
 * Preview shape created with { history: 'ignore' } during drag.
 * Final shape committed as a single undo entry on pointerUp.
 * Drag threshold: 4px.
 */

import { StateNode } from '../state-node';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node';
import type { ShapeId, Vec2 } from '../types';
import { sid } from '../types';

const DRAG_THRESHOLD = 4;
const PREVIEW_ID = sid('__box-preview__');

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function makeBoxShape(id: ShapeId, x: number, y: number, w: number, h: number) {
  return {
    id,
    type: 'box',
    x: Math.min(x, x + w),
    y: Math.min(y, y + h),
    index: 'a1',
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

  private _origin!: Vec2;

  override onEnter(info: { origin: Vec2; current: Vec2 }): void {
    this._origin = info.origin;

    // Create preview shape (not recorded in history)
    const { x, y } = info.origin;
    const w = info.current.x - x;
    const h = info.current.y - y;
    this.editor.batch('Preview', () => {
      this.editor.createShape(makeBoxShape(PREVIEW_ID, x, y, w, h));
    }, { history: 'ignore', scope: 'ephemeral' });
  }

  override onPointerMove(e: PointerMoveEvent): void {
    const x = this._origin.x;
    const y = this._origin.y;
    const w = e.point.x - x;
    const h = e.point.y - y;

    this.editor.batch('Preview Update', () => {
      this.editor.updateShape(PREVIEW_ID, {
        x: Math.min(x, x + w),
        y: Math.min(y, y + h),
        props: {
          w: Math.abs(w),
          h: Math.abs(h),
        },
      });
    }, { history: 'ignore', scope: 'ephemeral' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    const x = this._origin.x;
    const y = this._origin.y;
    const w = e.point.x - x;
    const h = e.point.y - y;

    // Remove preview without history
    this.editor.batch('Preview Cleanup', () => {
      this.editor.deleteShapes([PREVIEW_ID]);
    }, { history: 'ignore', scope: 'ephemeral' });

    // Commit final shape as a single undo entry
    const finalId = this.editor.createShapeId('box');
    this.editor.batch('Create Box', () => {
      this.editor.createShape(makeBoxShape(finalId, x, y, w, h));
    });

    // Switch to select and highlight the newly created shape
    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([finalId]);
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      // Delete preview without history
      this.editor.batch('Preview Cleanup', () => {
        this.editor.deleteShapes([PREVIEW_ID]);
    }, { history: 'ignore', scope: 'ephemeral' });

      this.parent!.transition('idle');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// BoxTool (root)
// ─────────────────────────────────────────────────────────────

export class BoxTool extends StateNode {
  static override readonly id = 'box';
  static override children = () => [Idle, Pointing, Drawing];
}
