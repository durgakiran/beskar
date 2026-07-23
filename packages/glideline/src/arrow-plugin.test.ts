/**
 * Unit tests — ArrowPlugin (Phase 4, Story 4.4)
 * Test IDs: T4.4-01 through T4.4-06
 */

import { describe, it, expect } from 'vitest';
import { createEditor, getMutableStoreForTesting } from './editor';
import { ArrowPlugin, ArrowUtil } from './shapes/ArrowUtil';
import { BoxUtil } from './shapes/BoxUtil';
import { ArrowTool } from './tools/ArrowTool';
import { SelectTool } from './tools/SelectTool';
import { BoxTool } from './tools/BoxTool';
import { sid, bid } from './types';
import type { AnyRecord } from './types';
import type { ArrowShape } from './shapes/ArrowUtil';

const BoxPlugin = { id: 'box', shapes: [BoxUtil as any] };

function makeEditor() {
  return createEditor({
    plugins: [BoxPlugin, ArrowPlugin],
    tools: [SelectTool, BoxTool, ArrowTool],
  });
}

function box(id: string, x: number, y: number, w: number, h: number) {
  return {
    id: sid(id), type: 'box', x, y, index: 'a1', rotation: 0, meta: {},
    props: { ...new BoxUtil().getDefaultProps(), w, h, cornerRadius: 0, color: '#6366f1', label: '' },
  };
}

function arrow(id: string, startPt = { x: 0, y: 0 }, endPt = { x: 100, y: 0 }) {
  return {
    id: sid(id), type: 'arrow', x: startPt.x, y: startPt.y, index: 'a1', rotation: 0, meta: {},
    props: {
      ...new ArrowUtil().getDefaultProps(),
      start: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 0, y: 0 } },
      end:   { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: endPt.x - startPt.x, y: endPt.y - startPt.y } },
      routeStyle: 'curve', bend: 0,
    },
  };
}

function binding(id: string, fromId: string, toId: string, terminal: 'start' | 'end' = 'end') {
  return {
    id: bid(id), type: 'arrow', fromId: sid(fromId), toId: sid(toId), meta: {},
    props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, fromEdge: 'left' },
  };
}

// T4.4-01: Terminal updates on box move
describe('T4.4-01: terminal point updated when target box moves', () => {
  it('end.point becomes center of box at new position', () => {
    const ed = makeEditor();
    // Box at (100,100) size 200×100 → center = (200,150)
    getMutableStoreForTesting(ed).put([box('boxA', 100, 100, 200, 100), arrow('arrA')]);
    ed.createBinding(binding('bA', 'arrA', 'boxA') as unknown as AnyRecord);

    // Move box to (200,200) → center = (300,250)
    ed.updateShape(sid('boxA'), { x: 200, y: 200 });

    const arr = ed.getShape<ArrowShape>(sid('arrA'))!;
    expect(arr.props.end.point.x).toBeCloseTo(300, 1);
    expect(arr.props.end.point.y).toBeCloseTo(250, 1);
  });
});

// T4.4-02: fromEdge computed from normalizedAnchor
describe('T4.4-02: fromEdge derived from normalizedAnchor after move', () => {
  it('anchor {x:1.0, y:0.5} → fromEdge === "right"', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([box('boxB', 0, 0, 100, 100), arrow('arrB')]);
    const bnd = {
      ...binding('bB', 'arrB', 'boxB'),
      props: { terminal: 'end', normalizedAnchor: { x: 1.0, y: 0.5 }, fromEdge: 'left' },
    };
    ed.createBinding(bnd as unknown as AnyRecord);

    ed.updateShape(sid('boxB'), { x: 50 });

    const updatedBinding = ed.store.get(bid('bB')) as AnyRecord;
    expect((updatedBinding['props'] as Record<string, unknown>)['fromEdge']).toBe('right');
  });
});

// T4.4-03: Detach on target delete
describe('T4.4-03: detach on target delete', () => {
  it('arrow end.boundShapeId becomes null', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([box('boxC', 0, 0, 100, 100), arrow('arrC')]);
    ed.createBinding(binding('bC', 'arrC', 'boxC') as unknown as AnyRecord);
    // Manually mark boundShapeId
    const arr = ed.getShape<ArrowShape>(sid('arrC'))!;
    getMutableStoreForTesting(ed).put([{
      ...arr,
      props: { ...arr.props, end: { ...arr.props.end, boundShapeId: sid('boxC') } },
    }]);

    ed.deleteShapes([sid('boxC')]);

    const updated = ed.getShape<ArrowShape>(sid('arrC'))!;
    expect(updated.props.end.boundShapeId).toBeNull();
  });
});

// T4.4-04: Binding deleted with target
describe('T4.4-04: binding removed when target deleted', () => {
  it('getBindingsToShape returns empty after target delete', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([box('boxD', 0, 0, 100, 100), arrow('arrD')]);
    ed.createBinding(binding('bD', 'arrD', 'boxD') as unknown as AnyRecord);

    ed.deleteShapes([sid('boxD')]);

    expect(ed.getBindingsToShape(sid('boxD'))).toHaveLength(0);
    expect(ed.store.get(bid('bD'))).toBeUndefined();
  });
});

// T4.4-05: ArrowTool creates shape + bindings
describe('T4.4-05: ArrowTool creates ArrowShape + 2 bindings', () => {
  it('click box A → drag → release on box B creates arrow + 2 bindings', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([
      box('bx1', 0, 0, 100, 80),
      box('bx2', 300, 0, 100, 80),
    ]);
    ed.setCurrentTool('arrow');

    // Click on box bx1 center (50, 40)
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 40 }, shiftKey: false, target: 'shape', shapeId: sid('bx1') });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 200, y: 40 } });
    // Release on box bx2 center (350, 40)
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 350, y: 40 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 350, y: 40 } });

    // Count arrows in store
    let arrowCount = 0;
    let bindingCount = 0;
    for (const sig of (ed.store as any)._signals.values()) {
      const rec = sig.peek() as AnyRecord | null;
      if (!rec) continue;
      if (rec['type'] === 'arrow' && !rec['fromId']) arrowCount++;
      if (rec['fromId'] && rec['toId']) bindingCount++;
    }
    expect(arrowCount).toBe(1);
    expect(bindingCount).toBe(2);
  });
});

// T4.4-06: Route style switch changes rendered path key
describe('T4.4-06: routeStyle switch', () => {
  it('updateShape routeStyle:ortho changes the prop', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([arrow('arrF')]);

    ed.updateShape<ArrowShape>(sid('arrF'), {
      props: {
        ...new ArrowUtil().getDefaultProps(),
        start: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 0, y: 0 } },
        end:   { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 100, y: 0 } },
        routeStyle: 'ortho',
        bend: 0,
      },
    });

    const updated = ed.getShape<ArrowShape>(sid('arrF'))!;
    expect(updated.props.routeStyle).toBe('ortho');
  });
});

describe('T4.4-07: curved arrow spatial hit testing', () => {
  it('selects when querying near the visible curve, not just the endpoint chord', () => {
    const ed = makeEditor();
    const curved = arrow('arrCurveHit', { x: 0, y: 0 }, { x: 300, y: 0 });
    curved.props.bend = 0.3;
    getMutableStoreForTesting(ed).put([curved]);

    const hits = ed.getShapesAtPoint({ x: 150, y: -52 });

    expect(hits.map(shape => shape.id)).toContain(sid('arrCurveHit'));
  });
});

describe('T4.4-08: arrow preset defaults', () => {
  it('uses editor arrowhead defaults for newly drawn connectors', () => {
    const ed = makeEditor();
    ed.arrowheadStart = 'arrow';
    ed.arrowheadEnd = 'arrow';
    getMutableStoreForTesting(ed).put([
      box('bxPreset1', 0, 0, 100, 80),
      box('bxPreset2', 300, 0, 100, 80),
    ]);
    ed.setCurrentTool('arrow');

    ed.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 40 }, shiftKey: false, target: 'shape', shapeId: sid('bxPreset1') });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 350, y: 40 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 350, y: 40 } });

    const all = ed.getShapesInBox({ x: -1000, y: -1000, w: 3000, h: 3000, minX: -1000, minY: -1000, maxX: 2000, maxY: 2000 });
    const newArrow = all.find(s => s.type === 'arrow') as ArrowShape;

    expect(newArrow.props.arrowheadStart).toBe('arrow');
    expect(newArrow.props.arrowheadEnd).toBe('arrow');
  });
});

// Dragging handles tests
describe('Arrow handle dragging via SelectTool', () => {
  it('drags bend handle to update bend prop', () => {
    const ed = makeEditor();
    ed.setCurrentTool('select');
    getMutableStoreForTesting(ed).put([arrow('arrG', { x: 0, y: 0 }, { x: 100, y: 0 })]);
    ed.setSelectedShapeIds([sid('arrG')]);

    // Handle is at (50, 0). pointerDown there.
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 0 }, shiftKey: false, target: 'handle', handleId: 'bend' });
    // Move to (50, 50). chord=100, perp = (0, -1). px=0, py=50. dist_perp = -50.
    // bend = 2 * dist_perp / chord = 2 * -50 / 100 = -1.
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 50, y: 50 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 50, y: 50 } });

    const arr = ed.getShape<ArrowShape>(sid('arrG'))!;
    expect(arr.props.bend).toBeCloseTo(-1, 2);
    expect(ed.history.undoStack[ed.history.undoStack.length - 1]?.label).toBe('Adjust Arrow Bend');

    ed.undo();
    expect(ed.getShape<ArrowShape>(sid('arrG'))?.props.bend).toBe(0);
  });

  it('drags end handle to detach bound shape and delete binding', () => {
    const ed = makeEditor();
    ed.setCurrentTool('select');
    getMutableStoreForTesting(ed).put([box('boxEnd', 200, 200, 100, 100), arrow('arrH', { x: 0, y: 0 }, { x: 250, y: 250 })]);
    
    // Set boundShapeId and create binding
    const arrInit = ed.getShape<ArrowShape>(sid('arrH'))!;
    getMutableStoreForTesting(ed).put([{
      ...arrInit,
      props: {
        ...arrInit.props,
        end: { ...arrInit.props.end, boundShapeId: sid('boxEnd') }
      }
    }]);
    ed.createBinding(binding('bndH', 'arrH', 'boxEnd', 'end') as unknown as AnyRecord);
    
    ed.setSelectedShapeIds([sid('arrH')]);

    // End handle is at (250, 250). pointerDown there.
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 250, y: 250 }, shiftKey: false, target: 'handle', handleId: 'end' });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 400, y: 400 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 400, y: 400 } });

    const arr = ed.getShape<ArrowShape>(sid('arrH'))!;
    expect(arr.props.end.boundShapeId).toBeNull();
    expect(arr.props.end.point).toEqual({ x: 400, y: 400 });
    expect(ed.getBindingsFromShape(sid('arrH'))).toHaveLength(0);
    expect(ed.history.undoStack[ed.history.undoStack.length - 1]?.label).toBe('Move Arrow Handle');

    ed.undo();
    expect(ed.getShape<ArrowShape>(sid('arrH'))?.props.end.boundShapeId).toBe(sid('boxEnd'));
    expect(ed.getBindingsFromShape(sid('arrH'))).toHaveLength(1);
  });

  it('drags end handle onto a shape to bind it and create a binding', () => {
    const ed = makeEditor();
    ed.setCurrentTool('select');
    getMutableStoreForTesting(ed).put([box('boxEnd2', 200, 200, 100, 100), arrow('arrH2', { x: 0, y: 0 }, { x: 400, y: 400 })]);
    ed.setSelectedShapeIds([sid('arrH2')]);

    // End handle is at (400, 400). pointerDown there.
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 400, y: 400 }, shiftKey: false, target: 'handle', handleId: 'end' });
    // Move to (250, 250) which is inside boxEnd2
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 250, y: 250 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 250, y: 250 } });

    const arr = ed.getShape<ArrowShape>(sid('arrH2'))!;
    expect(arr.props.end.boundShapeId).toBe(sid('boxEnd2'));
    expect(ed.getBindingsFromShape(sid('arrH2'))).toHaveLength(1);
    const bnd = ed.getBindingsFromShape(sid('arrH2'))[0]!;
    expect(bnd.toId).toBe(sid('boxEnd2'));
    expect(bnd.props.terminal).toBe('end');
  });

  it('rebinds an end handle from the top to the bottom anchor of the same shape', () => {
    const ed = makeEditor();
    ed.setCurrentTool('select');
    getMutableStoreForTesting(ed).put([
      box('sameTarget', 200, 200, 100, 100),
      arrow('sameTargetArrow', { x: 0, y: 250 }, { x: 250, y: 200 }),
    ]);
    ed.createBinding({
      ...binding('sameTargetBinding', 'sameTargetArrow', 'sameTarget', 'end'),
      props: {
        terminal: 'end',
        normalizedAnchor: { x: 0.5, y: 0 },
        fromEdge: 'top',
      },
    } as unknown as AnyRecord);
    ed.setSelectedShapeIds([sid('sameTargetArrow')]);

    ed.dispatchEvent({
      type: 'pointerDown', point: { x: 250, y: 200 },
      shiftKey: false, target: 'handle', handleId: 'end',
    });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 250, y: 300 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 250, y: 300 } });

    const updated = ed.getShape<ArrowShape>(sid('sameTargetArrow'))!;
    expect(updated.props.end.normalizedAnchor).toEqual({ x: 0.5, y: 1 });
    expect({
      x: updated.x + updated.props.end.point.x,
      y: updated.y + updated.props.end.point.y,
    }).toEqual({ x: 250, y: 300 });
    const updatedBinding = ed.getBindingsFromShape(sid('sameTargetArrow'))
      .find(candidate => candidate.props.terminal === 'end')!;
    expect(updatedBinding.props.normalizedAnchor).toEqual({ x: 0.5, y: 1 });
    expect(updatedBinding.props.fromEdge).toBe('bottom');
  });

  it('cancels bend handle drag on Escape', () => {
    const ed = makeEditor();
    ed.setCurrentTool('select');
    getMutableStoreForTesting(ed).put([arrow('arrI', { x: 0, y: 0 }, { x: 100, y: 0 })]);
    ed.setSelectedShapeIds([sid('arrI')]);

    // Handle is at (50, 0). pointerDown.
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 0 }, shiftKey: false, target: 'handle', handleId: 'bend' });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 50, y: 50 } });
    // Cancel
    ed.dispatchEvent({ type: 'keyDown', key: 'Escape' });

    const arr = ed.getShape<ArrowShape>(sid('arrI'))!;
    expect(arr.props.bend).toBe(0);
  });

  it('does not bind to other arrows when drawing or dragging handles', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([
      box('bxA', 0, 0, 100, 100),
      box('bxB', 300, 300, 100, 100),
      arrow('arrExisting', { x: 50, y: 50 }, { x: 350, y: 350 })
    ]);

    ed.setCurrentTool('arrow');
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 50 }, shiftKey: false, target: 'shape', shapeId: sid('arrExisting') });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 150, y: 150 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 150, y: 150 } });

    const all = ed.getShapesInBox({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
    const newArrow = all.find(s => s.type === 'arrow' && s.id !== sid('arrExisting')) as ArrowShape;
    expect(newArrow).toBeDefined();
    expect(newArrow.props.start.boundShapeId).toBe(sid('bxA'));
  });

  it('uses ortho as the default route style for newly drawn arrows', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([
      box('bxX', 0, 0, 100, 100),
    ]);

    ed.setCurrentTool('arrow');
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 50 }, shiftKey: false, target: 'shape', shapeId: sid('bxX') });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 150, y: 150 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 150, y: 150 } });

    const all = ed.getShapesInBox({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
    const newArrow = all.find(s => s.type === 'arrow') as ArrowShape;
    expect(newArrow).toBeDefined();
    expect(newArrow.props.routeStyle).toBe('ortho');
  });

  it('publishes and clears binding preview while drawing over shapes', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([box('bxPreview', 300, 0, 100, 80)]);
    ed.setCurrentTool('arrow');

    ed.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 40 }, shiftKey: false, target: 'canvas' });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 350, y: 40 } });

    expect(ed.bindingPreview.peek()).toMatchObject({
      terminal: 'end',
      targetId: sid('bxPreview'),
      targetType: 'box',
    });
    expect(ed.bindingPreview.peek()?.candidateAnchors).toHaveLength(4);

    ed.dispatchEvent({ type: 'pointerMove', point: { x: 200, y: 200 } });
    expect(ed.bindingPreview.peek()).toBeNull();
  });

  it('shows source binding preview immediately when starting from a shape', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([
      box('bxSource', 0, 0, 100, 80),
      box('bxTarget2', 300, 0, 100, 80),
    ]);
    ed.setCurrentTool('arrow');

    ed.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 40 }, shiftKey: false, target: 'shape', shapeId: sid('bxSource') });

    expect(ed.bindingPreview.peek()).toMatchObject({
      terminal: 'start',
      targetId: sid('bxSource'),
      targetType: 'box',
    });

    ed.dispatchEvent({ type: 'pointerMove', point: { x: 350, y: 40 } });

    expect(ed.bindingPreview.peek()).toMatchObject({
      terminal: 'end',
      targetId: sid('bxTarget2'),
      targetType: 'box',
      sourceCandidate: {
        targetId: sid('bxSource'),
        targetType: 'box',
      },
    });
  });

  it('snaps bound terminals to predefined edge center connection points of target shapes', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([
      box('bxS', 0, 0, 100, 100),
      box('bxT', 300, 300, 100, 100),
    ]);

    ed.setCurrentTool('arrow');
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 90, y: 40 }, shiftKey: false, target: 'shape', shapeId: sid('bxS') });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 340, y: 310 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 340, y: 310 } });

    const all = ed.getShapesInBox({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
    const arr = all.find(s => s.type === 'arrow') as ArrowShape;
    expect(arr).toBeDefined();

    expect(arr.x).toBe(100);
    expect(arr.y).toBe(50);
    expect(arr.props.start.boundShapeId).toBe(sid('bxS'));
    expect(arr.props.start.normalizedAnchor).toEqual({ x: 1, y: 0.5 });
    expect(arr.props.start.point).toEqual({ x: 0, y: 0 });

    expect(arr.props.end.boundShapeId).toBe(sid('bxT'));
    expect(arr.props.end.normalizedAnchor).toEqual({ x: 0.5, y: 0 });
    expect(arr.props.end.point).toEqual({ x: 250, y: 250 });
  });

  it('commits the previewed end anchor even if pointerUp drifts toward another edge', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([
      box('bxSource3', 0, 0, 100, 100),
      box('bxTarget3', 300, 300, 100, 100),
    ]);

    ed.setCurrentTool('arrow');
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 50 }, shiftKey: false, target: 'shape', shapeId: sid('bxSource3') });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 350, y: 300 } });
    expect(ed.bindingPreview.peek()).toMatchObject({
      terminal: 'end',
      targetId: sid('bxTarget3'),
      normalizedAnchor: { x: 0.5, y: 0 },
      point: { x: 350, y: 300 },
    });

    ed.dispatchEvent({ type: 'pointerUp', point: { x: 400, y: 340 } });

    const all = ed.getShapesInBox({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
    const arr = all.find(s => s.type === 'arrow') as ArrowShape;
    expect(arr.props.end.normalizedAnchor).toEqual({ x: 0.5, y: 0 });
    expect(arr.props.end.point).toEqual({ x: 250, y: 250 });
  });

  it('supports selecting and dragging bend handles of orthogonal (ortho) arrows', () => {
    const ed = makeEditor();
    const bxS = box('bxS', 0, 0, 100, 100);
    const bxT = box('bxT', 300, 0, 100, 100);
    const arr = arrow('arr1', { x: 100, y: 50 }, { x: 300, y: 50 });
    arr.props.routeStyle = 'ortho';
    arr.props.start.boundShapeId = sid('bxS') as any;
    arr.props.start.normalizedAnchor = { x: 1.0, y: 0.5 };
    arr.props.end.boundShapeId = sid('bxT') as any;
    arr.props.end.normalizedAnchor = { x: 0.0, y: 0.5 };

    getMutableStoreForTesting(ed).put([
      bxS,
      bxT,
      arr,
      {
        id: bid('b1'),
        type: 'arrow',
        fromId: sid('arr1'),
        toId: sid('bxS'),
        meta: {},
        props: { terminal: 'start', normalizedAnchor: { x: 1.0, y: 0.5 }, fromEdge: 'right' },
      },
      {
        id: bid('b2'),
        type: 'arrow',
        fromId: sid('arr1'),
        toId: sid('bxT'),
        meta: {},
        props: { terminal: 'end', normalizedAnchor: { x: 0.0, y: 0.5 }, fromEdge: 'left' },
      },
    ]);

    ed.setSelectedShapeIds([sid('arr1')]);

    ed.setCurrentTool('select');
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 200, y: 50 }, shiftKey: false, target: 'handle', handleId: 'bend' });

    ed.dispatchEvent({ type: 'pointerMove', point: { x: 230, y: 50 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 230, y: 50 } });

    const updated = ed.getShape<ArrowShape>(sid('arr1'));
    expect(updated?.props.bend).toBe(30);
  });

  it('publishes binding preview while dragging an arrow endpoint over a shape', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([
      box('bxTarget', 200, 200, 100, 100),
      arrow('arrPreviewDrag', { x: 0, y: 0 }, { x: 100, y: 0 }),
    ]);
    ed.setSelectedShapeIds([sid('arrPreviewDrag')]);
    ed.setCurrentTool('select');

    ed.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 0 }, shiftKey: false, target: 'handle', handleId: 'end' });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 250, y: 250 } });

    expect(ed.bindingPreview.peek()).toMatchObject({
      terminal: 'end',
      targetId: sid('bxTarget'),
      targetType: 'box',
    });
  });

  it('commits the previewed handle anchor even if pointerUp drifts toward another edge', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([
      box('bxHandleTarget', 200, 200, 100, 100),
      arrow('arrHandlePreview', { x: 0, y: 0 }, { x: 100, y: 0 }),
    ]);
    ed.setSelectedShapeIds([sid('arrHandlePreview')]);
    ed.setCurrentTool('select');

    ed.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 0 }, shiftKey: false, target: 'handle', handleId: 'end' });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 250, y: 200 } });
    expect(ed.bindingPreview.peek()).toMatchObject({
      terminal: 'end',
      targetId: sid('bxHandleTarget'),
      normalizedAnchor: { x: 0.5, y: 0 },
      point: { x: 250, y: 200 },
    });

    ed.dispatchEvent({ type: 'pointerUp', point: { x: 300, y: 240 } });

    const updated = ed.getShape<ArrowShape>(sid('arrHandlePreview'))!;
    expect(updated.props.end.normalizedAnchor).toEqual({ x: 0.5, y: 0 });
    expect(updated.props.end.point).toEqual({ x: 250, y: 200 });
  });

  it('supports drawing arrows from canvas (no bound shapes)', () => {
    const ed = makeEditor();
    ed.setCurrentTool('arrow');

    ed.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 50 }, shiftKey: false, target: 'canvas' });
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 150, y: 150 } });
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 150, y: 150 } });

    const all = ed.getShapesInBox({ minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 });
    const arr = all.find(s => s.type === 'arrow') as ArrowShape;
    expect(arr).toBeDefined();

    expect(arr.x).toBe(50);
    expect(arr.y).toBe(50);
    expect(arr.props.start.boundShapeId).toBeNull();
    expect(arr.props.start.point).toEqual({ x: 0, y: 0 });
    expect(arr.props.end.boundShapeId).toBeNull();
    expect(arr.props.end.point).toEqual({ x: 100, y: 100 });
  });
});
