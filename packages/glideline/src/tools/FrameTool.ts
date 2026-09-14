/**
 * FrameTool — draw a frame container by drag.
 *
 * The in-progress frame is staged under its real, final shape id via
 * beginHistoryPreview()/recordHistoryPreview() — the same InteractionManager
 * preview lifecycle SelectTool uses for drag/resize/rotate — so there's no
 * delete-then-recreate step between the live preview and the committed shape.
 * pointerCancel (a browser/OS-initiated abort, e.g. trackpad gesture
 * disambiguation on a fast short drag) commits the frame exactly as it was
 * last staged rather than losing it; Escape still discards it.
 */

import { StateNode } from '../state-node.js';
import type { KeyDownEvent, PointerDownEvent, PointerMoveEvent, PointerUpEvent } from '../state-node.js';
import type { ShapeId, Vec2 } from '../types.js';

const DRAG_THRESHOLD = 4;

function frameRecord(id: ShapeId, origin: Vec2, point: Vec2) {
  return {
    id, type: 'frame', x: Math.min(origin.x, point.x), y: Math.min(origin.y, point.y), rotation: 0, meta: {},
    props: {
      w: Math.max(1, Math.abs(point.x - origin.x)),
      h: Math.max(1, Math.abs(point.y - origin.y)),
      label: 'Frame',
      color: '#313244',
      clipContent: false,
    },
  };
}

class Idle extends StateNode {
  static override readonly id = 'idle';
  override onPointerDown(event: PointerDownEvent): void { this.parent!.transition('pointing', event); }
}

class Pointing extends StateNode {
  static override readonly id = 'pointing';
  private origin!: Vec2;
  override onEnter(event: PointerDownEvent): void { this.origin = event.point; }
  override onPointerMove(event: PointerMoveEvent): void {
    if (Math.hypot(event.point.x - this.origin.x, event.point.y - this.origin.y) > DRAG_THRESHOLD) {
      this.parent!.transition('drawing', { origin: this.origin, current: event.point });
    }
  }
  override onPointerUp(): void { this.parent!.transition('idle'); }
}

class Drawing extends StateNode {
  static override readonly id = 'drawing';
  private origin!: Vec2;
  private id!: ShapeId;

  override onEnter(info: { origin: Vec2; current: Vec2 }): void {
    this.origin = info.origin;
    this.id = this.editor.createShapeId('frame');

    this.editor.beginHistoryPreview();
    this.editor.batch('Frame Preview', () => this.editor.createShape(frameRecord(this.id, info.origin, info.current)),
      { history: 'ignore' });
  }

  override onPointerMove(event: PointerMoveEvent): void {
    this._updateFrame(event.point);
  }

  override onPointerUp(event: PointerUpEvent): void {
    this._updateFrame(event.point);
    this._commit();
  }

  override onPointerCancel(): void {
    // No reliable point on a browser/OS-initiated cancel — commit the frame
    // exactly as it was last staged rather than losing it.
    this._commit();
  }

  override onKeyDown(event: KeyDownEvent): void {
    if (event.key !== 'Escape') return;
    this.editor.cancelHistoryPreview();
    this.parent!.transition('idle');
  }

  override onExit(): void {
    // Safety net: if the tool is switched away mid-drag without a
    // pointerUp/pointerCancel/Escape, make sure no staged preview lingers.
    this.editor.cancelHistoryPreview();
  }

  private _updateFrame(point: Vec2): void {
    const next = frameRecord(this.id, this.origin, point);
    this.editor.batch('Frame Preview Update', () => this.editor.updateShape(this.id, next as any),
      { history: 'ignore' });
  }

  private _commit(): void {
    // Promote the staged record into the real store as a single atomic,
    // history-recorded transaction under its original id.
    this.editor.recordHistoryPreview('Create Frame', new Map([[this.id, null]]));

    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([this.id]);
  }
}

export class FrameTool extends StateNode {
  static override readonly id = 'frame';
  static override children = () => [Idle, Pointing, Drawing];
}
