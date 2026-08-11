import { describe, expect, it, vi } from 'vitest';
import { effect } from '@preact/signals';
import {
  AsyncTransactionError,
  GlideStore,
  TransactionAbortedError,
  TransactionReentryError,
  type StoreChangeSet,
} from './store';
import { GlideSchema } from './schema';

function shape(id: string, x = 0, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'box',
    x,
    y: 0,
    w: 10,
    h: 10,
    index: 'a1',
    rotation: 0,
    props: { color: 'blue', nested: { value: 1 } },
    meta: {},
    ...overrides,
  };
}

function binding(id: string, fromId: string, toId: string) {
  return { id, type: 'arrow', fromId, toId, props: {}, meta: {} };
}

function makeStore(): GlideStore {
  const schema = new GlideSchema();
  schema.registerShapeUtil({ type: 'box' });
  schema.registerBindingUtil({ type: 'arrow' });
  return new GlideStore(schema);
}

describe('atomic staged publication', () => {
  it('publishes nothing when geometry for the second record throws', () => {
    const store = makeStore();
    store.getGeometry = record => ({
      getBounds: () => {
        if (record.id === 'bad') throw new Error('bad geometry');
        return { minX: 0, minY: 0, maxX: 10, maxY: 10 };
      },
    } as any);
    const versionRuns = vi.fn();
    const idsRuns = vi.fn();
    const stopVersion = effect(() => { store.getVersionSignal().value; versionRuns(); });
    const stopIds = effect(() => { store.getShapeIdsSignal().value; idsRuns(); });
    versionRuns.mockClear();
    idsRuns.mockClear();

    expect(() => store.put([shape('good'), shape('bad')])).toThrow('bad geometry');

    expect(store.revision).toBe(0);
    expect(store.get('good')).toBeUndefined();
    expect(store.get('bad')).toBeUndefined();
    expect(store.getSignal('good')).toBeUndefined();
    expect(store.getShapeIdsSignal().peek()).toEqual([]);
    expect(store.getShapesAtPoint(5, 5)).toEqual([]);
    expect(versionRuns).not.toHaveBeenCalled();
    expect(idsRuns).not.toHaveBeenCalled();
    stopVersion();
    stopIds();
  });

  it('does not expose a temporary update before a failed commit', () => {
    const store = makeStore();
    store.put([shape('existing', 1)]);
    const recordSignal = store.getSignal('existing')!;
    const seen: unknown[] = [];
    const stop = effect(() => { seen.push(recordSignal.value?.x); });
    seen.length = 0;
    store.getGeometry = record => ({
      getBounds: () => {
        if (record.id === 'bad') throw new Error('bad geometry');
        return { minX: 0, minY: 0, maxX: 10, maxY: 10 };
      },
    } as any);

    expect(() => store.transact({ origin: 'user' }, tx => {
      tx.update('existing', record => ({ ...record, x: 99 }));
      tx.insert(shape('bad'));
      expect(tx.get('existing')?.x).toBe(99);
    })).toThrow('bad geometry');

    expect(store.get('existing')?.x).toBe(1);
    expect(store.revision).toBe(1);
    expect(seen).toEqual([]);
    stop();
  });

  it('rejects store mutation from a geometry hook without publishing', () => {
    const store = makeStore();
    store.getGeometry = () => {
      store.put([shape('reentrant')]);
      return undefined;
    };
    expect(() => store.put([shape('outer')])).toThrow(TransactionReentryError);
    expect(store.revision).toBe(0);
    expect(store.get('outer')).toBeUndefined();
    expect(store.get('reentrant')).toBeUndefined();
  });
});

describe('record ownership and read-only API', () => {
  it('detaches and freezes ingress, reads, changes, and serialization', () => {
    const store = makeStore();
    const input = shape('owned');
    let changes: StoreChangeSet | null = null;
    store.listen(next => { changes = next; });
    store.put([input]);

    input.x = 500;
    (input.props.nested as { value: number }).value = 500;
    expect(store.get('owned')?.x).toBe(0);
    expect((store.get('owned')?.props as any).nested.value).toBe(1);
    expect(Object.isFrozen(store.get('owned'))).toBe(true);
    expect(() => { (store.get('owned') as any).x = 12; }).toThrow();
    expect(() => { (changes!.deltas[0]!.after as any).x = 12; }).toThrow();

    const snapshot = store.serialize();
    (snapshot.records[0] as any).x = 777;
    expect(store.get('owned')?.x).toBe(0);
    expect(() => { (store.getSignal('owned') as any).value = null; }).toThrow();
    expect(store.get('owned')).toBeDefined();
  });

  it.each([
    ['undefined', { bad: undefined }],
    ['function', { bad: () => undefined }],
    ['symbol', { bad: Symbol('bad') }],
    ['bigint', { bad: 1n }],
    ['non-finite number', { bad: Infinity }],
    ['class instance', { bad: new Date() }],
  ])('rejects non-JSON %s values', (_label, extra) => {
    const store = makeStore();
    expect(() => store.put([{ ...shape('bad-json'), ...extra }])).toThrow();
    expect(store.revision).toBe(0);
  });

  it('rejects cyclic values', () => {
    const store = makeStore();
    const record = shape('cycle') as Record<string, any>;
    record.self = record;
    expect(() => store.put([record])).toThrow('Cyclic');
  });
});

describe('transaction contract', () => {
  it('coalesces writes, reports paths, and increments once', () => {
    const store = makeStore();
    store.put([shape('one')]);
    const events: StoreChangeSet[] = [];
    store.listen(change => events.push(change));

    const result = store.transact({ origin: 'user', label: 'change one' }, tx => {
      tx.update('one', record => ({ ...record, x: 10 }));
      tx.update('one', record => ({
        ...record,
        x: 20,
        props: { ...(record.props as object), color: 'red' },
      }));
      return 42;
    });

    expect(result.value).toBe(42);
    expect(result.changes?.revision).toBe(2);
    expect(result.changes?.changedIds).toEqual(['one']);
    expect(result.changes?.deltas).toHaveLength(1);
    expect(result.changes?.deltas[0]?.changedPaths).toEqual(['/props/color', '/x']);
    expect(events).toHaveLength(1);
    expect(store.revision).toBe(2);
  });

  it('does not commit or increment for empty and deep-equal writes', () => {
    const store = makeStore();
    const original = shape('same');
    store.put([original]);
    const event = vi.fn();
    store.listen(event);
    store.put([]);
    store.remove([]);
    store.put([{ ...original, props: { ...original.props, nested: { value: 1 } } }]);
    expect(store.revision).toBe(1);
    expect(event).not.toHaveBeenCalled();
  });

  it('enforces insert/update identity rules', () => {
    const store = makeStore();
    store.transact({ origin: 'user' }, tx => tx.insert(shape('strict')));
    expect(() => store.transact({ origin: 'user' }, tx => tx.insert(shape('strict')))).toThrow('already exists');
    expect(() => store.transact({ origin: 'user' }, tx => tx.update('missing', record => ({ ...record })))).toThrow('does not exist');
    expect(() => store.transact({ origin: 'user' }, tx => tx.update('strict', record => ({ ...record, type: 'other' })))).toThrow('change type');
    expect(store.revision).toBe(1);
  });

  it('keeps a caught nested failure poisonous to the root', () => {
    const store = makeStore();
    expect(() => store.transact({ origin: 'user' }, tx => {
      tx.insert(shape('first'));
      try {
        store.transact({ origin: 'system' }, () => { throw new Error('nested'); });
      } catch {
        // Deliberately caught: root must still abort.
      }
      tx.insert(shape('second'));
    })).toThrow(TransactionAbortedError);
    expect(store.revision).toBe(0);
    expect(store.get('first')).toBeUndefined();
    expect(store.get('second')).toBeUndefined();
  });

  it('rejects asynchronous callbacks', () => {
    const store = makeStore();
    expect(() => store.transact({ origin: 'user' }, async () => undefined)).toThrow(AsyncTransactionError);
    expect(store.revision).toBe(0);
  });
});

describe('stable signals and derived indices', () => {
  it('publishes record → null → record through the original signal', () => {
    const store = makeStore();
    store.put([shape('revive', 1)]);
    const originalSignal = store.getSignal('revive')!;
    const seen: Array<number | null> = [];
    const stop = effect(() => {
      seen.push(originalSignal.value ? originalSignal.value.x as number : null);
    });
    store.remove(['revive']);
    store.transact({ origin: 'user' }, tx => tx.insert(shape('revive', 2)));
    expect(store.getSignal('revive')).toBe(originalSignal);
    expect(seen).toEqual([1, null, 2]);
    stop();
  });

  it('atomically updates binding and spatial indices', () => {
    const store = makeStore();
    store.put([shape('a', 0), shape('b', 20), shape('c', 40), binding('bind', 'a', 'b')]);
    store.transact({ origin: 'user' }, tx => {
      tx.update('bind', record => ({ ...record, fromId: 'c', toId: 'a' }));
      tx.update('b', record => ({ ...record, x: 100 }));
    });
    expect(store.getBindingsFromShape('a' as any)).toEqual([]);
    expect(store.getBindingsFromShape('c' as any).map(item => item.id)).toEqual(['bind']);
    expect(store.getBindingsToShape('a' as any).map(item => item.id)).toEqual(['bind']);
    expect(store.getShapesAtPoint(25, 5).map(item => item.id)).not.toContain('b');
    expect(store.getShapesAtPoint(105, 5).map(item => item.id)).toContain('b');
  });

  it('keeps every index equal to a brute-force rebuild across randomized transactions', () => {
    const store = makeStore();
    const shapeIds = Array.from({ length: 8 }, (_, index) => `shape:${index}`);
    const bindingIds = Array.from({ length: 5 }, (_, index) => `binding:${index}`);
    let seed = 0x5eed1234;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;

    store.put([
      ...[0, 1, 2].map(index => ({
        id: `page:${index}`, kind: 'page', type: 'page', schemaVersion: 0,
        name: `Page ${index}`, meta: {},
      })),
      ...shapeIds.map((id, index) => shape(id, index * 20, { parentId: `page:${index % 2}` })),
    ]);

    for (let iteration = 0; iteration < 150; iteration++) {
      try {
        store.transact({ origin: 'user' }, tx => {
          const action = Math.floor(random() * 4);
          if (action <= 1) {
            const id = pick(shapeIds);
            const existing = tx.get(id);
            if (existing) {
              tx.update(id, record => ({
                ...record,
                x: Math.floor(random() * 500),
                parentId: `page:${Math.floor(random() * 3)}`,
              }));
            } else {
              tx.insert(shape(id, Math.floor(random() * 500), {
                parentId: `page:${Math.floor(random() * 3)}`,
              }));
            }
          } else if (action === 2) {
            tx.remove(pick([...shapeIds, ...bindingIds]));
          } else {
            const id = pick(bindingIds);
            tx.upsert(binding(id, pick(shapeIds), pick(shapeIds)));
          }
        });
      } catch {
        // Random graph mutations may be invalid (for example deleting a bound
        // shape). The important invariant is that rejection is fully atomic.
      }

      const records = store.serialize().records as Record<string, any>[];
      const shapes = records.filter(record => record.kind === 'shape');
      const bindings = records.filter(record => record.kind === 'binding');
      expect(new Set(store.getShapeIds())).toEqual(new Set(shapes.map(record => record.id)));
      expect(new Set((store as any)._treeEntries.keys())).toEqual(new Set(shapes.map(record => record.id)));

      for (const id of shapeIds) {
        expect(new Set(store.getBindingsFromShape(id as any).map(item => item.id))).toEqual(
          new Set(bindings.filter(record => record.fromId === id).map(record => record.id)),
        );
        expect(new Set(store.getBindingsToShape(id as any).map(item => item.id))).toEqual(
          new Set(bindings.filter(record => record.toId === id).map(record => record.id)),
        );
      }

      const expectedPages = new Map<string, Set<string>>();
      for (const record of shapes) {
        if (!record.parentId?.startsWith('page:')) continue;
        if (!expectedPages.has(record.parentId)) expectedPages.set(record.parentId, new Set());
        expectedPages.get(record.parentId)!.add(record.id);
      }
      const actualPages = new Map<string, Set<string>>(
        Array.from((store as any)._shapesByPage, ([id, ids]: [string, Set<string>]) => [id, new Set(ids)]),
      );
      expect(actualPages).toEqual(expectedPages);
    }
  });
});
