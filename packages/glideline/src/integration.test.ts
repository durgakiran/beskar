/**
 * Integration tests: Store + Schema + Migrations end-to-end
 * Covers spec test IDs: T1.3-05, T1.3-06, T1.3-07 and full round-trip
 */

import { describe, it, expect } from 'vitest';
import { GlideStore } from './store';
import { GlideSchema } from './schema';
import { T } from './validators';
import { defineMigrations } from './migrations';
import { sid } from './types';
import type { GlideDocument } from './types';

// ─────────────────────────────────────────────────────────────
// Shared fixture: BoxUtil v1 + v2 + v3 migrations
// ─────────────────────────────────────────────────────────────

function makeBoxUtil(currentVersion: number) {
  const migrators: Record<number, { up: (r: Record<string, unknown>) => Record<string, unknown>; down: (r: Record<string, unknown>) => Record<string, unknown> }> = {};
  if (currentVersion >= 1) {
    migrators[1] = {
      up:   r => ({ ...r, props: { ...(r['props'] as object), opacity: 1 } }),
      down: r => { const p = { ...(r['props'] as Record<string, unknown>) }; delete p['opacity']; return { ...r, props: p }; },
    };
  }
  if (currentVersion >= 2) {
    migrators[2] = {
      up:   r => ({ ...r, props: { ...(r['props'] as object), cornerRadius: 0 } }),
      down: r => { const p = { ...(r['props'] as Record<string, unknown>) }; delete p['cornerRadius']; return { ...r, props: p }; },
    };
  }
  if (currentVersion >= 3) {
    migrators[3] = {
      up:   r => ({ ...r, props: { ...(r['props'] as object), locked: false } }),
      down: r => { const p = { ...(r['props'] as Record<string, unknown>) }; delete p['locked']; return { ...r, props: p }; },
    };
  }

  return {
    type: 'box' as const,
    props: { w: T.number, h: T.number } as Record<string, { validate(v: unknown): unknown }>,
    migrations: defineMigrations({ currentVersion, migrators }),
  };
}

// ─────────────────────────────────────────────────────────────
// T1.3-05 Full round-trip: save v1, load as v3
// ─────────────────────────────────────────────────────────────

describe('T1.3-05: Full round-trip — save v0, add migrators, load as v3', () => {
  it('deserializes v0 doc into v3 records', () => {
    // Step 1: create a v0 document directly (simulating a document saved before any migrations)
    const doc: GlideDocument = {
      schema: {
        storeVersion: 1,
        shapes: { box: 0 }, // savedVersion = 0 → all 3 migrators must run
        bindings: {},
      },
      records: [{
        id: 'shape:1',
        type: 'box',
        x: 10, y: 20, w: 100, h: 200,
        index: 'a1', rotation: 0, meta: {},
        props: { w: 100, h: 200 }, // v0 record — no opacity/cornerRadius/locked yet
      }],
    };

    // Step 2: load into a v3 store (migrators 1, 2, 3 should all run)
    const schemaV3 = new GlideSchema();
    schemaV3.registerShapeUtil(makeBoxUtil(3));
    const storeV3 = new GlideStore(schemaV3);
    storeV3.deserialize(doc);

    const record = storeV3.get('shape:1');
    const props = record?.['props'] as Record<string, unknown>;
    expect(props?.['opacity']).toBe(1);
    expect(props?.['cornerRadius']).toBe(0);
    expect(props?.['locked']).toBe(false);
  });

  it('serialize then deserialize with v1 util stamps correct version', () => {
    // Save with v1 util
    const schemaV1 = new GlideSchema();
    schemaV1.registerShapeUtil(makeBoxUtil(1));
    const storeV1 = new GlideStore(schemaV1);
    storeV1.put([{
      id: sid('shape:1'),
      type: 'box',
      x: 10, y: 20, w: 100, h: 200,
      index: 'a1', rotation: 0, meta: {},
      props: { w: 100, h: 200 },
    } as unknown as Record<string, unknown>]);

    const savedDoc = storeV1.serialize();
    expect(savedDoc.schema.shapes['box']).toBe(1); // header correctly stamped

    // Load into v3 store — only migrators 2 and 3 run (record was already at v1)
    const schemaV3 = new GlideSchema();
    schemaV3.registerShapeUtil(makeBoxUtil(3));
    const storeV3 = new GlideStore(schemaV3);
    storeV3.deserialize(savedDoc);

    const record = storeV3.get('shape:1');
    const props = record?.['props'] as Record<string, unknown>;
    // opacity NOT present (migrator 1 was already applied when saved at v1)
    // cornerRadius + locked added by migrators 2 + 3
    expect(props?.['cornerRadius']).toBe(0);
    expect(props?.['locked']).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// T1.3-06 Unknown type preserved on load
// ─────────────────────────────────────────────────────────────

describe('T1.3-06: Unknown type preserved on load', () => {
  it('store.get(id).type === "my-plugin-shape" after deserialize', () => {
    const schema = new GlideSchema();
    // No util registered for "my-plugin-shape"
    const store = new GlideStore(schema);

    const doc: GlideDocument = {
      schema: { storeVersion: 1, shapes: {}, bindings: {} },
      records: [{ id: 'plugin:1', type: 'my-plugin-shape', props: { foo: 'bar' } }],
    };

    store.deserialize(doc);
    const record = store.get('plugin:1');
    expect(record?.['type']).toBe('my-plugin-shape');
    expect((record?.['props'] as Record<string, unknown>)?.['foo']).toBe('bar');
  });
});

// ─────────────────────────────────────────────────────────────
// deserialize with savedVersion > currentVersion (forward compat)
// ─────────────────────────────────────────────────────────────

describe('Forward compatibility: savedVersion > currentVersion', () => {
  it('record is preserved as-is without crash', () => {
    const schema = new GlideSchema();
    schema.registerShapeUtil(makeBoxUtil(1)); // currentVersion = 1
    const store = new GlideStore(schema);

    const doc: GlideDocument = {
      schema: { storeVersion: 1, shapes: { box: 99 }, bindings: {} }, // savedVersion = 99
      records: [{
        id: 'shape:future',
        type: 'box',
        props: { w: 100, h: 100, futureProp: 'hello' },
      }],
    };

    store.deserialize(doc);
    const record = store.get('shape:future');
    expect(record?.['type']).toBe('box');
    expect((record?.['props'] as Record<string, unknown>)?.['futureProp']).toBe('hello');
  });
});

// ─────────────────────────────────────────────────────────────
// Serialize → JSON → deserialize round-trip
// ─────────────────────────────────────────────────────────────

describe('JSON round-trip', () => {
  it('all records survive JSON stringify + parse', () => {
    const schema = new GlideSchema();
    schema.registerShapeUtil(makeBoxUtil(2));
    const store = new GlideStore(schema);

    store.put([{
      id: sid('shape:a'),
      type: 'box',
      x: 5, y: 10, w: 50, h: 60,
      index: 'a1', rotation: 0, meta: {},
      props: { w: 50, h: 60 },
    } as unknown as Record<string, unknown>]);

    const json = JSON.stringify(store.serialize());
    const parsed: GlideDocument = JSON.parse(json) as GlideDocument;

    const newStore = new GlideStore(new GlideSchema());
    newStore.deserialize(parsed);

    const record = newStore.get('shape:a');
    expect(record?.['x']).toBe(5);
    expect(record?.['y']).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────
// Store + Schema: prop validation blocks invalid shapes
// ─────────────────────────────────────────────────────────────

describe('Store + Schema integration: validation', () => {
  it('invalid shape prop throws before write; subsequent put with valid shape works', () => {
    const schema = new GlideSchema();
    schema.registerShapeUtil(makeBoxUtil(1));
    const store = new GlideStore(schema);

    // bad put
    expect(() => store.put([{
      id: sid('shape:bad'),
      type: 'box',
      x: 0, y: 0, w: 100, h: 100,
      index: 'a1', rotation: 0, meta: {},
      props: { w: 'not-a-number', h: 100 },
    } as unknown as Record<string, unknown>])).toThrow(/prop "w"/);

    expect(store.get('shape:bad')).toBeUndefined();

    // good put after bad
    store.put([{
      id: sid('shape:good'),
      type: 'box',
      x: 0, y: 0, w: 100, h: 100,
      index: 'a1', rotation: 0, meta: {},
      props: { w: 100, h: 200 },
    } as unknown as Record<string, unknown>]);
    expect(store.get('shape:good')).toBeDefined();
  });
});
