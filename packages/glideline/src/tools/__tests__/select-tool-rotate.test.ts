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

describe('SelectTool DraggingRotation', () => {
  let editor: GlideEditor;

  beforeEach(() => {
    editor = createEditor({ plugins: [BoxPlugin], tools: [SelectTool] });
    editor.setCurrentTool('select');
  });

  it('rotates a single shape in place', () => {
    const id = editor.createShape({ type: 'box', x: -50, y: -25, props: { w: 100, h: 50 }, id: 'shape:box1' as any });
    editor.setSelectedShapeIds([id]);

    editor.dispatchEvent({
      type: 'pointerDown',
      point: { x: 0, y: -50 }, // Clicking rotation handle above the shape
      shiftKey: false,
      target: 'handle',
      handleId: 'rotate'
    });

    const tool = editor.getCurrentTool() as any;
    expect(tool.current.constructor.name).toBe('DraggingRotation');

    // Move handle to the right, which is +90 deg (PI/2) from center 0,0
    editor.dispatchEvent({
      type: 'pointerMove',
      point: { x: 50, y: 0 }
    });

    const shape = editor.getShape(id)!;
    // Math.atan2(0 - 0, 50 - 0) = 0
    // startAngle was Math.atan2(-50, 0) = -PI/2
    // delta = 0 - (-PI/2) = PI/2
    expect(shape.rotation).toBeCloseTo(Math.PI / 2);
    // Center should remain same, so x, y should remain same
    expect(shape.x).toBeCloseTo(-50);
    expect(shape.y).toBeCloseTo(-25);
  });

  it('orbits multiple shapes around their common center', () => {
    const id1 = editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 10, h: 10 }, id: 'shape:box1' as any });
    const id2 = editor.createShape({ type: 'box', x: 90, y: 90, props: { w: 10, h: 10 }, id: 'shape:box2' as any });
    
    editor.setSelectedShapeIds([id1, id2]);
    // group bounds: minX:0, minY:0, maxX:100, maxY:100. center: 50,50
    // id1 center: 5,5. id2 center: 95,95

    editor.dispatchEvent({
      type: 'pointerDown',
      point: { x: 50, y: -10 }, // handle above center
      shiftKey: false,
      target: 'handle',
      handleId: 'rotate'
    });

    // rotate 180 degrees
    editor.dispatchEvent({
      type: 'pointerMove',
      point: { x: 50, y: 110 } 
    });

    const s1 = editor.getShape(id1)!;
    const s2 = editor.getShape(id2)!;

    // rotation should be roughly PI
    expect(s1.rotation).toBeCloseTo(Math.PI);
    expect(s2.rotation).toBeCloseTo(Math.PI);

    // Orbit: id1 was top-left (5,5), now bottom-right (95,95), so x=90, y=90
    expect(s1.x).toBeCloseTo(90);
    expect(s1.y).toBeCloseTo(90);

    // Orbit: id2 was bottom-right (95,95), now top-left (5,5), so x=0, y=0
    expect(s2.x).toBeCloseTo(0);
    expect(s2.y).toBeCloseTo(0);
  });
});
