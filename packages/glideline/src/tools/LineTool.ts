import { StateNode, type KeyDownEvent, type PointerDownEvent, type PointerMoveEvent, type PointerUpEvent } from '../state-node.js';
import type { LineShape } from '../shapes/LineUtil.js';
import type { ShapeId, Vec2 } from '../types.js';

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(event: PointerDownEvent): void {
    this.parent!.transition('drawing', event.point);
  }
}

class Drawing extends StateNode {
  static override readonly id = 'drawing';

  private id!: ShapeId;
  private origin!: Vec2;

  override onEnter(origin: Vec2): void {
    this.origin = origin;
    this.id = this.editor.createShapeId('line');
    this.editor.beginHistoryPreview();
    this.editor.batch('Preview Line', () => {
      this.editor.createShape({ id: this.id, type: 'line', x: origin.x, y: origin.y,
        props: { end: { x: 0, y: 0 } } });
    }, { history: 'ignore' });
  }

  override onPointerMove(event: PointerMoveEvent | PointerUpEvent): void {
    const line = this.editor.getShape<LineShape>(this.id);
    if (!line) return;
    const { x, y } = event.point;
    this.editor.batch('Preview Line', () => {
      this.editor.updateShape<LineShape>(this.id, {
        props: { ...line.props, end: { x: x - this.origin.x, y: y - this.origin.y } },
      });
    }, { history: 'ignore' });
  }

  override onPointerUp(event: PointerUpEvent): void {
    if (Math.hypot(event.point.x - this.origin.x, event.point.y - this.origin.y) * this.editor.camera.getCamera().z < 2) {
      this.parent!.transition('idle');
      return;
    }
    this.onPointerMove(event);
    this.editor.recordHistoryPreview('Create Line', new Map([[this.id, null]]));
    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([this.id]);
  }

  override onPointerCancel(): void { this.parent!.transition('idle'); }
  override onKeyDown(event: KeyDownEvent): void {
    if (event.key === 'Escape') this.parent!.transition('idle');
  }
  override onExit(): void { this.editor.cancelHistoryPreview(); }
}

export class LineTool extends StateNode {
  static override readonly id = 'line';
  static override children = () => [Idle, Drawing];
}
