import { describe, expect, it } from 'vitest';
import { createEditor, getMutableStoreForTesting } from '../editor';
import { ArrowPlugin, ArrowUtil, type ArrowShape } from '../shapes/ArrowUtil';
import { BoxUtil } from '../shapes/BoxUtil';
import { bid, sid, type AnyRecord } from '../types';
import { SelectTool } from './SelectTool';

const BoxPlugin = { id: 'select-tool-handles-box', shapes: [BoxUtil as any] };

function makeEditor() {
  return createEditor({ plugins: [BoxPlugin, ArrowPlugin], tools: [SelectTool] });
}

function box(id: string, x: number, y: number, w: number, h: number) {
  return {
    id: sid(id), type: 'box', x, y, index: 'a1', rotation: 0, meta: {},
    props: { ...new BoxUtil().getDefaultProps(), w, h, cornerRadius: 0, color: '#6366f1', label: '' },
  };
}

function arrow(id: string, start = { x: 0, y: 0 }, end = { x: 100, y: 0 }) {
  return {
    id: sid(id), type: 'arrow', x: start.x, y: start.y, index: 'a1', rotation: 0, meta: {},
    props: {
      ...new ArrowUtil().getDefaultProps(),
      start: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 0, y: 0 } },
      end: {
        boundShapeId: null,
        normalizedAnchor: { x: 0.5, y: 0.5 },
        point: { x: end.x - start.x, y: end.y - start.y },
      },
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

describe('SelectTool arrow handle state machine', () => {
  it('ignores arrow-only handles unless exactly one arrow is selected', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([
      box('handleBox', 0, 0, 100, 100),
      arrow('handleArrowA'),
      arrow('handleArrowB', { x: 0, y: 100 }, { x: 100, y: 100 }),
    ]);
    editor.setCurrentTool('select');

    editor.setSelectedShapeIds([sid('handleBox')]);
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 0, y: 0 }, shiftKey: false, target: 'handle', handleId: 'start' });
    expect((editor.getCurrentTool().current.constructor as any).id).not.toBe('draggingHandle');
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 0, y: 0 } });

    editor.setSelectedShapeIds([sid('handleArrowA'), sid('handleArrowB')]);
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 0, y: 0 }, shiftKey: false, target: 'handle', handleId: 'end' });
    expect((editor.getCurrentTool().current.constructor as any).id).not.toBe('draggingHandle');
  });

  it.each([
    ['right', 'left', 20, 15, 20],
    ['left', 'right', 20, 15, 20],
    ['top', 'bottom', 20, 15, 15],
    ['bottom', 'top', 20, 15, 15],
    ['right', 'right', 20, 15, 20],
    ['left', 'left', 20, 15, -20],
    ['top', 'top', 20, 15, -15],
    ['bottom', 'bottom', 20, 15, 15],
    ['left', 'top', 20, 15, -20],
    ['top', 'right', 20, 15, -15],
    ['bottom', 'right', 20, 15, 15],
  ] as const)('adjusts an ortho %s-to-%s route along its routing axis', (fromEdge, toEdge, dx, dy, expected) => {
    const editor = makeEditor();
    const from = box(`orthoFrom-${fromEdge}-${toEdge}`, 0, 0, 100, 100);
    const to = box(`orthoTo-${fromEdge}-${toEdge}`, 300, 0, 100, 100);
    const connector = arrow(`orthoArrow-${fromEdge}-${toEdge}`, { x: 100, y: 50 }, { x: 300, y: 50 });
    connector.props.routeStyle = 'ortho';
    connector.props.start.boundShapeId = from.id;
    connector.props.end.boundShapeId = to.id;
    getMutableStoreForTesting(editor).put([from, to, connector]);
    editor.createBinding({
      ...binding(`orthoStart-${fromEdge}-${toEdge}`, connector.id, from.id, 'start'),
      props: { terminal: 'start', normalizedAnchor: { x: 0.5, y: 0.5 }, fromEdge },
    } as unknown as AnyRecord);
    editor.createBinding({
      ...binding(`orthoEnd-${fromEdge}-${toEdge}`, connector.id, to.id, 'end'),
      props: { terminal: 'end', normalizedAnchor: { x: 0.5, y: 0.5 }, fromEdge: toEdge },
    } as unknown as AnyRecord);
    editor.setSelectedShapeIds([connector.id]);
    editor.setCurrentTool('select');

    editor.dispatchEvent({ type: 'pointerDown', point: { x: 200, y: 50 }, shiftKey: false, target: 'handle', handleId: 'bend' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 200 + dx, y: 50 + dy } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 200 + dx, y: 50 + dy } });

    expect(editor.getShape<ArrowShape>(connector.id)?.props.bend).toBe(expected);
  });

  it('normalizes a zero-length curve bend instead of producing invalid geometry', () => {
    const editor = makeEditor();
    const connector = arrow('zeroCurve', { x: 20, y: 20 }, { x: 20, y: 20 });
    connector.props.bend = 3;
    getMutableStoreForTesting(editor).put([connector]);
    editor.setSelectedShapeIds([connector.id]);
    editor.setCurrentTool('select');

    editor.dispatchEvent({ type: 'pointerDown', point: { x: 20, y: 20 }, shiftKey: false, target: 'handle', handleId: 'bend' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 30, y: 30 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 30, y: 30 } });

    expect(editor.getShape<ArrowShape>(connector.id)?.props.bend).toBe(0);
  });

  it('moves and binds a start terminal while preserving the end world point', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([
      box('startTarget', 200, 200, 100, 100),
      arrow('startArrow', { x: 0, y: 0 }, { x: 100, y: 0 }),
    ]);
    editor.setSelectedShapeIds([sid('startArrow')]);
    editor.setCurrentTool('select');

    editor.dispatchEvent({ type: 'pointerDown', point: { x: 0, y: 0 }, shiftKey: false, target: 'handle', handleId: 'start' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 250, y: 250 } });
    expect(editor.bindingPreview.peek()).toMatchObject({ terminal: 'start', targetId: sid('startTarget') });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 250, y: 250 } });

    const updated = editor.getShape<ArrowShape>(sid('startArrow'))!;
    expect(updated.props.start.boundShapeId).toBe(sid('startTarget'));
    expect({ x: updated.x + updated.props.end.point.x, y: updated.y + updated.props.end.point.y }).toEqual({ x: 100, y: 0 });
    expect(editor.getBindingsFromShape(sid('startArrow'))).toHaveLength(1);
  });

  it('cancels a detached start terminal without duplicating its initial binding', () => {
    const editor = makeEditor();
    const target = box('cancelStartTarget', 0, 0, 100, 100);
    const connector = arrow('cancelStartArrow', { x: 50, y: 50 }, { x: 200, y: 50 });
    connector.props.start.boundShapeId = target.id;
    getMutableStoreForTesting(editor).put([target, connector]);
    editor.createBinding(binding('cancelStartBinding', connector.id, target.id, 'start') as unknown as AnyRecord);
    editor.setSelectedShapeIds([connector.id]);
    editor.setCurrentTool('select');

    editor.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 50 }, shiftKey: false, target: 'handle', handleId: 'start' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 400, y: 400 } });
    editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });

    expect(editor.getShape<ArrowShape>(connector.id)).toMatchObject({ x: 50, y: 50, props: { start: { boundShapeId: target.id } } });
    expect(editor.getBindingsFromShape(connector.id)).toHaveLength(1);
  });

  it('returns to idle if an arrow is deleted during a handle drag', () => {
    const editor = makeEditor();
    const connector = arrow('deletedHandleArrow');
    getMutableStoreForTesting(editor).put([connector]);
    editor.setSelectedShapeIds([connector.id]);
    editor.setCurrentTool('select');
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 0 }, shiftKey: false, target: 'handle', handleId: 'end' });
    editor.deleteShapes([connector.id]);
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 140, y: 30 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 140, y: 30 } });
    expect((editor.getCurrentTool().current.constructor as any).id).toBe('idle');
  });

  it.each(['start', 'end'] as const)('leaves an ortho bend unchanged when its %s terminal is unbound', missing => {
    const editor = makeEditor();
    const from = box(`partialFrom-${missing}`, 0, 0, 100, 100);
    const to = box(`partialTo-${missing}`, 300, 0, 100, 100);
    const connector = arrow(`partialArrow-${missing}`, { x: 100, y: 50 }, { x: 300, y: 50 });
    connector.props.routeStyle = 'ortho';
    connector.props.start.boundShapeId = missing === 'start' ? null : from.id;
    connector.props.end.boundShapeId = missing === 'end' ? null : to.id;
    getMutableStoreForTesting(editor).put([from, to, connector]);
    editor.setSelectedShapeIds([connector.id]);
    editor.setCurrentTool('select');
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 200, y: 50 }, shiftKey: false, target: 'handle', handleId: 'bend' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 230, y: 80 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 230, y: 80 } });
    expect(editor.getShape<ArrowShape>(connector.id)?.props.bend).toBe(0);
  });

  it('uses right-to-left defaults when bound ortho terminals have no binding records', () => {
    const editor = makeEditor();
    const from = box('defaultEdgeFrom', 0, 0, 100, 100);
    const to = box('defaultEdgeTo', 300, 0, 100, 100);
    const connector = arrow('defaultEdgeArrow', { x: 100, y: 50 }, { x: 300, y: 50 });
    connector.props.routeStyle = 'ortho';
    connector.props.start.boundShapeId = from.id;
    connector.props.end.boundShapeId = to.id;
    getMutableStoreForTesting(editor).put([from, to, connector]);
    editor.setSelectedShapeIds([connector.id]);
    editor.setCurrentTool('select');
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 200, y: 50 }, shiftKey: false, target: 'handle', handleId: 'bend' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 225, y: 70 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 225, y: 70 } });
    expect(editor.getShape<ArrowShape>(connector.id)?.props.bend).toBe(25);
  });

  it('computes a final anchor when pointer-up has no active preview', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([box('directUpTarget', 200, 200, 100, 100), arrow('directUpArrow')]);
    editor.setSelectedShapeIds([sid('directUpArrow')]);
    editor.setCurrentTool('select');
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 0 }, shiftKey: false, target: 'handle', handleId: 'end' });
    editor.dispatchEvent({ type: 'keyDown', key: 'Shift' });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 250, y: 250 } });
    expect(editor.getShape<ArrowShape>(sid('directUpArrow'))?.props.end.boundShapeId).toBe(sid('directUpTarget'));
  });

  it('rejects a stale preview when pointer-up finishes over another target', () => {
    const editor = makeEditor();
    getMutableStoreForTesting(editor).put([
      box('previewTargetA', 200, 200, 100, 100),
      box('previewTargetB', 400, 200, 100, 100),
      arrow('previewSwitchArrow'),
    ]);
    editor.setSelectedShapeIds([sid('previewSwitchArrow')]);
    editor.setCurrentTool('select');
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 0 }, shiftKey: false, target: 'handle', handleId: 'end' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 250, y: 250 } });
    editor.dispatchEvent({ type: 'pointerUp', point: { x: 450, y: 250 } });
    expect(editor.getShape<ArrowShape>(sid('previewSwitchArrow'))?.props.end.boundShapeId).toBe(sid('previewTargetB'));
  });
});
