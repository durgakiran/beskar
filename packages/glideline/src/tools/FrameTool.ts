import { StateNode } from '../state-node.js';
import type { KeyDownEvent, PointerDownEvent, PointerMoveEvent, PointerUpEvent } from '../state-node.js';
import { sid, type ShapeId, type Vec2 } from '../types.js';

const PREVIEW_ID = sid('__frame-preview__');
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
  override onEnter(info: { origin: Vec2; current: Vec2 }): void {
    this.origin = info.origin;
    this.editor.batch('Preview Frame', () => this.editor.createShape(frameRecord(PREVIEW_ID, info.origin, info.current)),
      { history: 'ignore', scope: 'ephemeral' });
  }
  override onPointerMove(event: PointerMoveEvent): void {
    const next = frameRecord(PREVIEW_ID, this.origin, event.point);
    this.editor.batch('Preview Frame', () => this.editor.updateShape(PREVIEW_ID, next as any),
      { history: 'ignore', scope: 'ephemeral' });
  }
  override onPointerUp(event: PointerUpEvent): void {
    this.editor.batch('Clear Frame Preview', () => this.editor.deleteShapes([PREVIEW_ID]),
      { history: 'ignore', scope: 'ephemeral' });
    const id = this.editor.createShapeId('frame');
    this.editor.createShape(frameRecord(id, this.origin, event.point));
    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([id]);
  }
  override onKeyDown(event: KeyDownEvent): void {
    if (event.key !== 'Escape') return;
    this.editor.batch('Clear Frame Preview', () => this.editor.deleteShapes([PREVIEW_ID]),
      { history: 'ignore', scope: 'ephemeral' });
    this.parent!.transition('idle');
  }
}

export class FrameTool extends StateNode {
  static override readonly id = 'frame';
  static override children = () => [Idle, Pointing, Drawing];
}
