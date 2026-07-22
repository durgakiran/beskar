/**
 * Unit tests: GlideSchema
 * Covers spec test IDs: T1.2-04, T1.2-05 and schema load/save
 */

import { describe, it, expect } from 'vitest';
import { CURRENT_STORE_VERSION, GlideSchema } from './schema';
import { GlideStore } from './store';
import { T } from './validators';
import { defineMigrations } from './migrations';
import { sid } from './types';

// ─────────────────────────────────────────────────────────────
// Test fixture: BoxUtil
// ─────────────────────────────────────────────────────────────

interface BoxProps { w: number; h: number; }

const BoxUtil = {
  type: 'box' as const,
  props: { w: T.number, h: T.number } as Record<string, { validate(v: unknown): unknown }>,
};

// ─────────────────────────────────────────────────────────────
// T1.2-04: Schema blocks invalid prop on put
// ─────────────────────────────────────────────────────────────

describe('T1.2-04: Schema blocks invalid prop on put', () => {
  it('rejects shape with invalid prop type — store unchanged', () => {
    const schema = new GlideSchema();
    schema.registerShapeUtil(BoxUtil);
    const store = new GlideStore(schema);

    const invalidShape = {
      id: sid('shape:bad'),
      type: 'box',
      x: 0, y: 0, index: 'a1', rotation: 0, meta: {},
      props: { w: 'bad', h: 100 }, // w should be number
    };

    expect(() => store.put([invalidShape as unknown as Record<string, unknown>])).toThrow(/prop "w"/);
    expect(store.get('shape:bad')).toBeUndefined();
  });

  it('accepts shape with valid props', () => {
    const schema = new GlideSchema();
    schema.registerShapeUtil(BoxUtil);
    const store = new GlideStore(schema);

    const validShape = {
      id: sid('shape:ok'),
      type: 'box',
      x: 0, y: 0, w: 100, h: 100, index: 'a1', rotation: 0, meta: {},
      props: { w: 100, h: 200 },
    };

    store.put([validShape as unknown as Record<string, unknown>]);
    expect(store.get('shape:ok')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// T1.2-05: Unknown type bypasses validation
// ─────────────────────────────────────────────────────────────

describe('T1.2-05: Unknown type bypasses validation', () => {
  it('puts an unknown type without crashing', () => {
    const schema = new GlideSchema();
    schema.registerShapeUtil(BoxUtil); // only 'box' registered
    const store = new GlideStore(schema);

    const alien = { id: 'alien:1', type: 'my-plugin-shape', props: { x: 1 } };
    store.put([alien]);
    expect(store.get('alien:1')).toMatchObject({
      ...alien,
      kind: 'opaque',
      schemaVersion: 0,
      meta: {},
    });
  });
});

// ─────────────────────────────────────────────────────────────
// GlideSchema.load — migration on load
// ─────────────────────────────────────────────────────────────

describe('GlideSchema.load', () => {
  it('runs up() migrators for records below currentVersion', () => {
    const schema = new GlideSchema();
    const VersionedUtil = {
      type: 'box' as const,
      props: { w: T.number } as Record<string, { validate(v: unknown): unknown }>,
      migrations: defineMigrations({
        currentVersion: 2,
        migrators: {
          1: { up: r => ({ ...r, props: { ...(r['props'] as object), color: 'blue' } }), down: r => r },
          2: { up: r => ({ ...r, props: { ...(r['props'] as object), opacity: 1 } }), down: r => r },
        },
      }),
    };
    schema.registerShapeUtil(VersionedUtil);

    const doc = {
      schema: { storeVersion: 1, shapes: { box: 0 }, bindings: {} },
      records: [{
        id: 'shape:1', type: 'box', x: 0, y: 0, rotation: 0, index: 'a1', meta: {},
        props: { w: 100 },
      }],
    };

    const records = schema.load(doc);
    const props = records[0]?.['props'] as Record<string, unknown>;
    expect(props?.['color']).toBe('blue');
    expect(props?.['opacity']).toBe(1);
  });

  it('preserves unknown type records as-is', () => {
    const schema = new GlideSchema();
    const doc = {
      schema: { storeVersion: 1, shapes: {}, bindings: {} },
      records: [{ id: 'alien:1', type: 'unknown-plugin', props: { foo: 'bar' } }],
    };

    const records = schema.load(doc);
    expect(records[0]?.['type']).toBe('unknown-plugin');
    expect((records[0]?.['props'] as Record<string, unknown>)?.['foo']).toBe('bar');
  });

  it('preserves forward-versioned records (savedVersion > currentVersion)', () => {
    const schema = new GlideSchema();
    const util = {
      type: 'box' as const,
      props: {} as Record<string, { validate(v: unknown): unknown }>,
      migrations: defineMigrations({ currentVersion: 1, migrators: { 1: { up: r => r, down: r => r } } }),
    };
    schema.registerShapeUtil(util);

    const doc = {
      schema: { storeVersion: 1, shapes: { box: 99 }, bindings: {} }, // savedVersion=99 > currentVersion=1
      records: [{
        id: 'shape:1', type: 'box', x: 0, y: 0, rotation: 0, index: 'a1', meta: {},
        props: { futureProp: true },
      }],
    };

    const records = schema.load(doc);
    expect((records[0]?.['props'] as Record<string, unknown>)?.['futureProp']).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// GlideSchema.save — stamps schema header
// ─────────────────────────────────────────────────────────────

describe('GlideSchema.save', () => {
  it('stamps per-type version in schema header', () => {
    const schema = new GlideSchema();
    const util = {
      type: 'box' as const,
      props: {} as Record<string, { validate(v: unknown): unknown }>,
      migrations: defineMigrations({ currentVersion: 3, migrators: {
        1: { up: r => r, down: r => r },
        2: { up: r => r, down: r => r },
        3: { up: r => r, down: r => r },
      }}),
    };
    schema.registerShapeUtil(util);

    const doc = schema.save([{
      id: 'shape:1', type: 'box', x: 0, y: 0, rotation: 0, index: 'a1', meta: {}, props: {},
    }]);
    expect(doc.schema.shapes['box']).toBe(3);
    expect(doc.schema.storeVersion).toBe(CURRENT_STORE_VERSION);
  });
});
