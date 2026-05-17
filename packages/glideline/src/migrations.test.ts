/**
 * Unit tests: Migration system
 * Covers spec test IDs: T1.3-01 through T1.3-07 (pure migration logic)
 */

import { describe, it, expect } from 'vitest';
import { defineMigrations, migrateRecord, migrateRecordDown } from './migrations';
import type { GlideMigrations } from './types';

// ─────────────────────────────────────────────────────────────
// Test fixture: BoxShape migrations v0 → v3
//   v1 up: add opacity
//   v2 up: add cornerRadius
//   v3 up: add locked
// ─────────────────────────────────────────────────────────────

const boxMigrations: GlideMigrations = defineMigrations({
  currentVersion: 3,
  migrators: {
    1: {
      up:   (r) => ({ ...r, props: { ...(r['props'] as object), opacity: 1 } }),
      down: (r) => { const p = { ...(r['props'] as Record<string, unknown>) }; delete p['opacity']; return { ...r, props: p }; },
    },
    2: {
      up:   (r) => ({ ...r, props: { ...(r['props'] as object), cornerRadius: 0 } }),
      down: (r) => { const p = { ...(r['props'] as Record<string, unknown>) }; delete p['cornerRadius']; return { ...r, props: p }; },
    },
    3: {
      up:   (r) => ({ ...r, props: { ...(r['props'] as object), locked: false } }),
      down: (r) => { const p = { ...(r['props'] as Record<string, unknown>) }; delete p['locked']; return { ...r, props: p }; },
    },
  },
});

const v0Record = { id: 'shape:1', type: 'box', props: { w: 100 } };

describe('migrateRecord', () => {
  it('T1.3-01 v0→v3: applies all three up()s', () => {
    const result = migrateRecord(v0Record, boxMigrations, 0);
    const props = result['props'] as Record<string, unknown>;
    expect(props['opacity']).toBe(1);
    expect(props['cornerRadius']).toBe(0);
    expect(props['locked']).toBe(false);
  });

  it('T1.3-02 v2→v3: applies only the missing migrator', () => {
    const v2Record = { id: 'shape:1', type: 'box', props: { w: 100, opacity: 1, cornerRadius: 0 } };
    const result = migrateRecord(v2Record, boxMigrations, 2);
    const props = result['props'] as Record<string, unknown>;
    // locked added
    expect(props['locked']).toBe(false);
    // Already present fields untouched
    expect(props['opacity']).toBe(1);
    expect(props['cornerRadius']).toBe(0);
  });

  it('T1.3-03 already at current version: no-op', () => {
    const v3Record = { id: 'shape:1', type: 'box', props: { w: 100, opacity: 1, cornerRadius: 0, locked: false } };
    const result = migrateRecord(v3Record, boxMigrations, 3);
    expect(result['props']).toEqual(v3Record.props);
  });

  it('forward compat: fromVersion > currentVersion → no-op', () => {
    const result = migrateRecord(v0Record, boxMigrations, 99);
    expect(result).toEqual(v0Record);
  });

  it('does not mutate the input record', () => {
    const original = { id: 'shape:1', type: 'box', props: { w: 100 } };
    migrateRecord(original, boxMigrations, 0);
    expect((original.props as Record<string, unknown>)['opacity']).toBeUndefined();
  });
});

describe('defineMigrations', () => {
  it('T1.3-04 non-contiguous sequence throws at definition time', () => {
    expect(() => defineMigrations({
      currentVersion: 2,
      migrators: {
        2: { up: r => r, down: r => r }, // missing 1
      },
    })).toThrow(/contiguous/);
  });

  it('throws if last key ≠ currentVersion', () => {
    expect(() => defineMigrations({
      currentVersion: 3,
      migrators: {
        1: { up: r => r, down: r => r },
        2: { up: r => r, down: r => r }, // last key is 2, currentVersion is 3
      },
    })).toThrow(/must equal currentVersion/);
  });

  it('accepts a single-version definition', () => {
    expect(() => defineMigrations({
      currentVersion: 1,
      migrators: { 1: { up: r => r, down: r => r } },
    })).not.toThrow();
  });

  it('accepts an empty migrators object (currentVersion can be 0)', () => {
    expect(() => defineMigrations({
      currentVersion: 0,
      migrators: {},
    })).not.toThrow();
  });
});

describe('migrateRecordDown', () => {
  it('T1.3-07 reverses two migrators in order (v3→v1)', () => {
    const v3Record = {
      id: 'shape:1', type: 'box',
      props: { w: 100, opacity: 1, cornerRadius: 0, locked: false },
    };
    const result = migrateRecordDown(v3Record, boxMigrations, 3, 1);
    const props = result['props'] as Record<string, unknown>;
    // locked and cornerRadius should be gone
    expect(props['locked']).toBeUndefined();
    expect(props['cornerRadius']).toBeUndefined();
    // opacity still present (only went down to v1)
    expect(props['opacity']).toBe(1);
  });

  it('v3→v0: removes all three props', () => {
    const v3Record = {
      id: 'shape:1', type: 'box',
      props: { w: 100, opacity: 1, cornerRadius: 0, locked: false },
    };
    const result = migrateRecordDown(v3Record, boxMigrations, 3, 0);
    const props = result['props'] as Record<string, unknown>;
    expect(props['opacity']).toBeUndefined();
    expect(props['cornerRadius']).toBeUndefined();
    expect(props['locked']).toBeUndefined();
    expect(props['w']).toBe(100);
  });
});
