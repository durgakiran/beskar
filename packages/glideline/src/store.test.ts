/**
 * Unit tests: GlideStore
 * Covers spec test IDs: T1.1-01 through T1.1-06
 */

import { describe, it, expect, vi } from 'vitest';
import { effect } from '@preact/signals';
import { GlideStore } from './store';
import { GlideSchema } from './schema';
import { sid, bid } from './types';

function makeStore() {
  return new GlideStore(new GlideSchema());
}

function makeShape(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'box',
    x: 0, y: 0, w: 100, h: 100,
    index: 'a1',
    rotation: 0,
    props: { w: 100, h: 100 },
    meta: {},
    ...overrides,
  };
}

function makeBinding(id: string, fromId: string, toId: string) {
  return {
    id,
    type: 'arrow-binding',
    fromId,
    toId,
    props: { normalizedAnchor: { x: 0.5, y: 0.5 } },
    meta: {},
  };
}

// ─────────────────────────────────────────────────────────────
// T1.1-01 Signal fires exactly once per put()
// ─────────────────────────────────────────────────────────────

describe('T1.1-01: signal fires exactly once per put()', () => {
  it('subscriber is called exactly once when put([shape]) is called', () => {
    const store = makeStore();
    const shape = makeShape('shape:1');
    store.put([shape]);

    const sig = store.getSignal('shape:1')!;
    let callCount = 0;

    // effect() runs immediately once, then again on each change
    const cleanup = effect(() => {
      sig.value; // subscribe
      callCount++;
    });
    callCount = 0; // reset the initial run

    store.put([{ ...shape, x: 50 }]);
    expect(callCount).toBe(1);
    cleanup();
  });
});

// ─────────────────────────────────────────────────────────────
// T1.1-02 Batch groups N puts into 1 signal fire
// ─────────────────────────────────────────────────────────────

describe('T1.1-02: batch coalesces signal notifications', () => {
  it('100 puts inside batch() fires subscriber once total', () => {
    const store = makeStore();

    // Pre-populate so signals exist
    const records = Array.from({ length: 100 }, (_, i) => makeShape(`shape:${i}`));
    store.put(records);

    // Count how many times a computed derived from ALL signals fires
    let callCount = 0;
    const sigs = records.map(r => store.getSignal(r.id)!);
    const cleanup = effect(() => {
      for (const s of sigs) s.value; // subscribe to all
      callCount++;
    });
    callCount = 0; // reset initial run

    // Move all 100 inside one batch
    store.batch(() => {
      store.put(records.map(r => ({ ...r, x: 999 })));
    });

    expect(callCount).toBe(1);
    cleanup();
  });
});

// ─────────────────────────────────────────────────────────────
// T1.1-03 Transaction rolls back on error
// ─────────────────────────────────────────────────────────────

describe('T1.1-03: transaction rolls back on error', () => {
  it('batch(() => { put(r1); throw }) → get(r1.id) === undefined', () => {
    const store = makeStore();
    const r1 = makeShape('shape:r1');

    expect(() => {
      store.batch(() => {
        store.put([r1]);
        throw new Error('boom');
      });
    }).toThrow('boom');

    expect(store.get('shape:r1')).toBeUndefined();
  });

  it('rollback restores prior state when record existed before', () => {
    const store = makeStore();
    const original = makeShape('shape:r1', { x: 10 });
    store.put([original]);

    expect(() => {
      store.batch(() => {
        store.put([{ ...original, x: 999 }]);
        throw new Error('oops');
      });
    }).toThrow('oops');

    expect((store.get('shape:r1') as Record<string, unknown>)?.['x']).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────
// T1.1-04 Secondary index stays consistent
// ─────────────────────────────────────────────────────────────

describe('T1.1-04: secondary index (bindingsByFrom) stays consistent', () => {
  it('getBindingsFromShape returns binding after put without a full scan', () => {
    const store = makeStore();
    const from = sid('shape:arrow1');
    const to   = sid('shape:box1');

    store.put([makeBinding('binding:1', from, to)]);

    const bindings = store.getBindingsFromShape(from);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.['id']).toBe('binding:1');
  });

  it('getBindingsToShape is also populated', () => {
    const store = makeStore();
    const from = sid('shape:arrow1');
    const to   = sid('shape:box1');

    store.put([makeBinding('binding:1', from, to)]);

    const bindings = store.getBindingsToShape(to);
    expect(bindings).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────
// T1.1-05 Signal isolation — unrelated shape not fired
// ─────────────────────────────────────────────────────────────

describe('T1.1-05: signal isolation — updating shape B does not fire shape A subscriber', () => {
  it('shape A subscriber count unchanged after shape B update', () => {
    const store = makeStore();
    const shapeA = makeShape('shape:A');
    const shapeB = makeShape('shape:B');
    store.put([shapeA, shapeB]);

    const sigA = store.getSignal('shape:A')!;
    let aCallCount = 0;
    const cleanup = effect(() => {
      sigA.value; // subscribe to A only
      aCallCount++;
    });
    aCallCount = 0; // reset initial

    store.put([{ ...shapeB, x: 500 }]); // update B
    expect(aCallCount).toBe(0);         // A subscriber untouched
    cleanup();
  });
});

// ─────────────────────────────────────────────────────────────
// T1.1-06 remove() deletes record and signal
// ─────────────────────────────────────────────────────────────

describe('T1.1-06: remove() deletes record and does not fire subscriber', () => {
  it('get(id) returns undefined after remove()', () => {
    const store = makeStore();
    store.put([makeShape('shape:s1')]);
    store.remove(['shape:s1']);
    expect(store.get('shape:s1')).toBeUndefined();
  });

  it('has(id) returns false after remove()', () => {
    const store = makeStore();
    store.put([makeShape('shape:s1')]);
    store.remove(['shape:s1']);
    expect(store.has('shape:s1')).toBe(false);
  });

  it('signal is removed from the store (getSignal returns undefined)', () => {
    const store = makeStore();
    store.put([makeShape('shape:s1')]);
    store.remove(['shape:s1']);
    expect(store.getSignal('shape:s1')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Additional: spatial index
// ─────────────────────────────────────────────────────────────

describe('Spatial index', () => {
  it('getShapesAtPoint returns shapes at the queried point', () => {
    const store = makeStore();
    store.put([makeShape('shape:box1', { x: 0, y: 0, w: 100, h: 100 })]);
    const hits = store.getShapesAtPoint(50, 50);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.['id']).toBe('shape:box1');
  });

  it('getShapesAtPoint returns nothing outside the bounding box', () => {
    const store = makeStore();
    store.put([makeShape('shape:box1', { x: 0, y: 0, w: 100, h: 100 })]);
    const hits = store.getShapesAtPoint(200, 200);
    expect(hits).toHaveLength(0);
  });

  it('bindings are NOT added to the spatial index', () => {
    const store = makeStore();
    store.put([makeBinding('binding:1', sid('shape:a'), sid('shape:b'))]);
    // no x/y/w/h on binding → not in RBush
    const hits = store.getShapesAtPoint(0, 0);
    expect(hits).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Unknown record types stored and retrievable
// ─────────────────────────────────────────────────────────────

describe('Unknown record types', () => {
  it('records of unknown type are preserved unchanged', () => {
    const store = makeStore();
    const alien = { id: 'alien:1', type: 'my-plugin-shape', customField: 42 };
    store.put([alien]);
    const retrieved = store.get('alien:1');
    expect(retrieved?.['customField']).toBe(42);
  });
});
