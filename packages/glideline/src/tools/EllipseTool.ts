/**
 * EllipseTool — draw ellipses by drag (Phase B)
 *
 * FSM: Idle → Pointing → Drawing
 *
 * Mirrors BoxTool exactly, but creates ellipse shapes.
 * Shift+drag constrains to a circle (equal w/h).
 * On pointerUp: commits shape, switches to select tool, selects the new shape.
 */

import { StateNode } from '../state-node';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node';
import type { ShapeId, Vec2 } from '../types';
import { sid } from '../types';

const DRAG_THRESHOLD = 4;
const PREVIEW_ID = sid('__ellipse-preview__');

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function makeEllipseShape(id: ShapeId, x: number, y: number, w: number, h: number) {
  return {
    id,
    type:     'ellipse',
    x:        Math.min(x, x + w),
    y:        Math.min(y, y + h),
    index:    'a1',
    rotation: 0,
    meta:     {},
    props: {
      w:           Math.max(1, Math.abs(w)),
      h:           Math.max(1, Math.abs(h)),
      color:       'violet',
      opacity:     1,
      fillStyle:   'solid',
      strokeStyle: 'solid',
      strokeWidth: 'medium',
      label:       '',
      labelColor:  'black',
      font:        'sans',
      fontSize:    'md',
      textAlign:   'center',
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

  private _origin!: Vec2;
  private _shiftKey = false;

  override onEnter(info: { origin: Vec2; current: Vec2 }): void {
    this._origin = info.origin;

    const w = info.current.x - info.origin.x;
    const h = info.current.y - info.origin.y;
    this.editor.history.batch('Ellipse Preview', () => {
      this.editor.createShape(makeEllipseShape(PREVIEW_ID, info.origin.x, info.origin.y, w, h));
    }, { history: 'ignore' });
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this._shiftKey = (e as any).shiftKey ?? false;
    let w = e.point.x - this._origin.x;
    let h = e.point.y - this._origin.y;

    // Shift: constrain to circle by taking the larger dimension
    if (this._shiftKey) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = w < 0 ? -s : s;
      h = h < 0 ? -s : s;
    }

    this.editor.history.batch('Ellipse Preview Update', () => {
      this.editor.updateShape(PREVIEW_ID, {
        x:    Math.min(this._origin.x, this._origin.x + w),
        y:    Math.min(this._origin.y, this._origin.y + h),
        props: {
          w:           Math.max(1, Math.abs(w)),
          h:           Math.max(1, Math.abs(h)),
          color:       'violet',
          opacity:     1,
          fillStyle:   'solid',
          strokeStyle: 'solid',
          strokeWidth: 'medium',
          label:       '',
          labelColor:  'black',
          font:        'sans',
          fontSize:    'md',
          textAlign:   'center',
        },
      });
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    let w = e.point.x - this._origin.x;
    let h = e.point.y - this._origin.y;
    if (this._shiftKey) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = w < 0 ? -s : s;
      h = h < 0 ? -s : s;
    }

    // Remove preview
    this.editor.history.batch('Ellipse Preview Cleanup', () => {
      this.editor.deleteShapes([PREVIEW_ID]);
    }, { history: 'ignore' });

    // Commit final shape
    const finalId = sid(`ellipse-${Date.now()}`);
    this.editor.history.batch('Create Ellipse', () => {
      this.editor.createShape(makeEllipseShape(finalId, this._origin.x, this._origin.y, w, h));
    });

    // Switch to select and select the new shape
    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([finalId]);

    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.history.batch('Ellipse Preview Cleanup', () => {
        this.editor.deleteShapes([PREVIEW_ID]);
      }, { history: 'ignore' });
      this.parent!.transition('idle');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// EllipseTool (root)
// ─────────────────────────────────────────────────────────────

export class EllipseTool extends StateNode {
  static override readonly id = 'ellipse';
  static override children = () => [Idle, Pointing, Drawing];
}
