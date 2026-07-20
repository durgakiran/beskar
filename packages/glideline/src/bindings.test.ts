/**
 * Unit tests — Store binding lifecycle (Phase 4, Story 4.1)
 * Test IDs: T4.1-01 through T4.1-06
 */

import { describe, it, expect, vi } from 'vitest';
import { createEditor, getMutableStoreForTesting } from './editor';
import { ArrowPlugin, ArrowUtil } from './shapes/ArrowUtil';
import { BoxUtil } from './shapes/BoxUtil';
import { ArrowTool } from './tools/ArrowTool';
import { SelectTool } from './tools/SelectTool';
import { BoxTool } from './tools/BoxTool';
import { sid, bid } from './types';
import type { ShapeId, BindingId, AnyRecord } from './types';

const BoxPlugin = { id: 'box', shapes: [BoxUtil as any] };

function makeEditor() {
  return createEditor({
    plugins: [BoxPlugin, ArrowPlugin],
    tools: [SelectTool, BoxTool, ArrowTool],
  });
}

function boxShape(id: string, x = 0, y = 0, w = 200, h = 100) {
  return {
    id: sid(id),
    type: 'box',
    x, y, index: 'a1', rotation: 0, meta: {},
    props: { ...new BoxUtil().getDefaultProps(), w, h, cornerRadius: 0, color: '#6366f1', label: '' },
  };
}

function arrowShape(id: string, x = 0, y = 0) {
  return {
    id: sid(id),
    type: 'arrow',
    x, y, index: 'a1', rotation: 0, meta: {},
    props: {
      ...new ArrowUtil().getDefaultProps(),
      start: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 0, y: 0 } },
      end:   { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 100, y: 0 } },
      routeStyle: 'curve',
      bend: 0,
    },
  };
}

function makeBinding(id: string, fromId: string, toId: string) {
  return {
    id:     bid(id),
    type:   'arrow',
    fromId: sid(fromId),
    toId:   sid(toId),
    meta:   {},
    props: {
      terminal: 'end',
      normalizedAnchor: { x: 0.5, y: 0.5 },
      fromEdge: 'left',
    },
  };
}

// ─────────────────────────────────────────────────────────────
// T4.1-01: createBinding indexes correctly
// ─────────────────────────────────────────────────────────────

describe('T4.1-01: createBinding indexes correctly', () => {
  it('getBindingsFromShape and getBindingsToShape return the binding', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([boxShape('boxA'), arrowShape('arr1')]);

    ed.createBinding(makeBinding('bind1', 'arr1', 'boxA') as unknown as AnyRecord);

    const fromArr = ed.getBindingsFromShape(sid('arr1'));
    const toBox   = ed.getBindingsToShape(sid('boxA'));

    expect(fromArr).toHaveLength(1);
    expect(fromArr[0]!.id).toBe(bid('bind1'));
    expect(toBox).toHaveLength(1);
    expect(toBox[0]!.id).toBe(bid('bind1'));
  });
});

// ─────────────────────────────────────────────────────────────
// T4.1-02: onAfterChangeToShape fires on move
// ─────────────────────────────────────────────────────────────

describe('T4.1-02: onAfterChangeToShape fires on updateShape', () => {
  it('moving the target shape triggers the hook', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([boxShape('boxB', 0, 0), arrowShape('arr2', 0, 0)]);

    const bindingUtil = (ed as any)._bindingUtils.get('arrow');
    const spy = vi.spyOn(bindingUtil, 'onAfterChangeToShape');

    ed.createBinding(makeBinding('bind2', 'arr2', 'boxB') as unknown as AnyRecord);
    // Reset spy count after createBinding (no hook fires on create)
    spy.mockClear();

    ed.updateShape(sid('boxB'), { x: 100, y: 100 });

    expect(spy).toHaveBeenCalledTimes(1);
    const binding = spy.mock.calls[0]![0] as AnyRecord;
    expect(binding.id).toBe(bid('bind2'));
  });
});

// ─────────────────────────────────────────────────────────────
// T4.1-03: onBeforeDeleteToShape fires before delete
// ─────────────────────────────────────────────────────────────

describe('T4.1-03: onBeforeDeleteToShape fires before delete', () => {
  it('hook is called with binding still in store', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([boxShape('boxC', 0, 0), arrowShape('arr3', 0, 0)]);
    ed.createBinding(makeBinding('bind3', 'arr3', 'boxC') as unknown as AnyRecord);

    const bindingUtil = (ed as any)._bindingUtils.get('arrow');
    let hookCalledWithBinding: AnyRecord | null = null;
    let boxStillExistsOnHook = false;

    vi.spyOn(bindingUtil, 'onBeforeDeleteToShape').mockImplementation((b: unknown) => {
      hookCalledWithBinding = b as AnyRecord;
      boxStillExistsOnHook = !!ed.store.get(sid('boxC'));
    });

    ed.deleteShapes([sid('boxC')]);

    expect(hookCalledWithBinding).not.toBeNull();
    expect(boxStillExistsOnHook).toBe(true); // box still existed when hook ran
  });
});

// ─────────────────────────────────────────────────────────────
// T4.1-04: Detach on target delete
// ─────────────────────────────────────────────────────────────

describe('T4.1-04: Detach on target delete', () => {
  it('arrow end.boundShapeId becomes null after target deleted', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([boxShape('boxD', 100, 100, 200, 100), arrowShape('arr4', 0, 0)]);

    ed.createBinding(makeBinding('bind4', 'arr4', 'boxD') as unknown as AnyRecord);
    // Manually set boundShapeId on the arrow terminal so we can verify detach
    const arrow = ed.getShape(sid('arr4')) as any;
    getMutableStoreForTesting(ed).put([{
      ...arrow,
      props: {
        ...arrow.props,
        end: { ...arrow.props.end, boundShapeId: sid('boxD') },
      },
    }]);

    ed.deleteShapes([sid('boxD')]);

    const updatedArrow = ed.getShape(sid('arr4')) as any;
    expect(updatedArrow.props.end.boundShapeId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// T4.1-05: fromId delete cascades bindings
// ─────────────────────────────────────────────────────────────

describe('T4.1-05: fromId delete cascades bindings', () => {
  it('deleting arrow removes its bindings from the store', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([boxShape('boxE', 0, 0), arrowShape('arr5', 0, 0)]);
    ed.createBinding(makeBinding('bind5', 'arr5', 'boxE') as unknown as AnyRecord);

    ed.deleteShapes([sid('arr5')]);

    expect(ed.getBindingsFromShape(sid('arr5'))).toHaveLength(0);
    expect(ed.store.get(bid('bind5'))).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// T4.1-06: updateBinding merges props
// ─────────────────────────────────────────────────────────────

describe('T4.1-06: updateBinding merges props', () => {
  it('updateBinding(id, {fromEdge:"right"}) merges without losing other props', () => {
    const ed = makeEditor();
    getMutableStoreForTesting(ed).put([boxShape('boxF', 0, 0), arrowShape('arr6', 0, 0)]);
    ed.createBinding(makeBinding('bind6', 'arr6', 'boxF') as unknown as AnyRecord);

    ed.updateBinding(bid('bind6'), { fromEdge: 'right' } as AnyRecord);

    const binding = ed.store.get(bid('bind6')) as AnyRecord;
    const props = binding['props'] as Record<string, unknown>;
    expect(props['fromEdge']).toBe('right');
    // Other props preserved
    expect(props['terminal']).toBe('end');
    expect(props['normalizedAnchor']).toEqual({ x: 0.5, y: 0.5 });
  });
});
