import { describe, it, expect, beforeEach } from 'vitest';
import { GlideEditor, createEditor } from '../../editor';
import type { GlidePlugin } from '../../editor';
import { SelectTool } from '../SelectTool';
import { ShapeUtil } from '../../shapes/ShapeUtil';
import { Geometry2d, Rectangle2d } from '../../geometry';

class MockBoxUtil extends ShapeUtil<any> {
  static type = 'box';
  getDefaultProps() { return { w: 100, h: 100 }; }
  getGeometry(s: any): Geometry2d {
    return new Rectangle2d(0, 0, s.props.w, s.props.h);
  }
}
const BoxPlugin: GlidePlugin = { id: 'box', shapes: [MockBoxUtil as any] };

describe('SelectTool DraggingResize', () => {
  let editor: GlideEditor;

  beforeEach(() => {
    editor = createEditor({ plugins: [BoxPlugin], tools: [SelectTool] });
    editor.setCurrentTool('select');
  });

  it('resizes a single box', () => {
    const id = editor.createShape({ type: 'box', x: 10, y: 10, props: { w: 100, h: 50 }, id: 'shape:box1' as any });
    editor.setSelectedShapeIds([id]);

    editor.dispatchEvent({
      type: 'pointerDown',
      point: { x: 110, y: 60 },
      shiftKey: false,
      target: 'handle',
      handleId: 'se'
    });

    // We are now in draggingResize
    const tool = editor.getCurrentTool() as any;
    expect(tool.current.constructor.name).toBe('DraggingResize');

    editor.dispatchEvent({
      type: 'pointerMove',
      point: { x: 120, y: 80 } // dx=10, dy=20
    });

    const shape = editor.getShape(id)!;
    expect(shape.x).toBe(10);
    expect(shape.y).toBe(10);
    expect(shape.props.w).toBe(110); // 100 + 10
    expect(shape.props.h).toBe(70);  // 50 + 20
  });

  it('proportionally scales multiple shapes', () => {
    const id1 = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 10, h: 10 }, id: 'shape:box1' as any });
    const id2 = editor.createShape({ type: 'box', x: 20, y: 20, props: { w: 20, h: 20 }, id: 'shape:box2' as any });
    
    editor.setSelectedShapeIds([id1, id2]);
    // group bounds: minX:0, minY:0, maxX:40, maxY:40. w:40, h:40

    editor.dispatchEvent({
      type: 'pointerDown',
      point: { x: 40, y: 40 },
      shiftKey: false,
      target: 'handle',
      handleId: 'se'
    });

    // resize group from 40x40 to 80x80 (scale by 2)
    editor.dispatchEvent({
      type: 'pointerMove',
      point: { x: 80, y: 80 } // dx=40, dy=40
    });

    const s1 = editor.getShape(id1)!;
    const s2 = editor.getShape(id2)!;

    // s1 was at 0,0 10x10. It should scale to 0,0 20x20
    expect(s1.x).toBe(0);
    expect(s1.y).toBe(0);
    expect(s1.props.w).toBe(20);
    expect(s1.props.h).toBe(20);

    // s2 was at 20,20 20x20. It should scale to 40,40 40x40
    expect(s2.x).toBe(40);
    expect(s2.y).toBe(40);
    expect(s2.props.w).toBe(40);
    expect(s2.props.h).toBe(40);
  });
});
