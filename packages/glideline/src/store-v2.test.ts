import { describe, expect, it, vi } from 'vitest';
import { CURRENT_STORE_VERSION, DocumentValidationError, GlideSchema } from './schema';
import { GlideStore } from './store';
import type { AnyRecord, GlideDocument } from './types';

function createSchema(): GlideSchema {
  const schema = new GlideSchema();
  schema.registerShapeUtil({ type: 'box' });
  schema.registerShapeUtil({
    type: 'arrow',
    references: [
      { path: '/props/start/boundShapeId', targetKind: 'shape', onDetach: 'null' },
      { path: '/props/end/boundShapeId', targetKind: 'shape', onDetach: 'null' },
    ],
  });
  schema.registerBindingUtil({
    type: 'arrow',
    props: {
      terminal: {
        validate(value: unknown) {
          if (value !== 'start' && value !== 'end') throw new Error('invalid terminal');
          return value;
        },
      },
    },
  });
  return schema;
}

function shape(id: string, type = 'box', overrides: AnyRecord = {}): AnyRecord {
  return {
    id, kind: 'shape', type, schemaVersion: 0,
    x: 0, y: 0, rotation: 0, index: id, props: {}, meta: {},
    ...overrides,
  };
}

function binding(id: string, fromId: string, toId: string, terminal = 'start'): AnyRecord {
  return {
    id, kind: 'binding', type: 'arrow', schemaVersion: 0,
    fromId, toId, props: { terminal }, meta: {},
  };
}

function document(records: AnyRecord[]): GlideDocument {
  return {
    schema: { storeVersion: 2, shapes: { box: 0, arrow: 0 }, bindings: { arrow: 0 } },
    records,
  };
}

describe('store-v2 loading and record capabilities', () => {
  it('rejects a v2 record that omits its explicit record envelope', () => {
    const schema = createSchema();
    expect(() => schema.loadDocument({
      schema: { storeVersion: 2, shapes: { box: 0 }, bindings: {} },
      records: [{ id: 'legacy-looking', type: 'box', x: 0, y: 0, rotation: 0, index: 'a1', props: {}, meta: {} }],
    })).toThrow('store-v2 record is missing kind');
  });

  it('reports the legacy envelope migration when loading store v1', () => {
    const schema = createSchema();
    const loaded = schema.loadDocument({
      schema: { storeVersion: 1, shapes: { box: 0 }, bindings: {} },
      records: [{ id: 'legacy', type: 'box', x: 0, y: 0, rotation: 0, index: 'a1', props: {}, meta: {} }],
    });
    expect(loaded.records[0]).toMatchObject({ kind: 'shape', schemaVersion: 0 });
    expect(loaded.report.migrations).toContain(`store:1->${CURRENT_STORE_VERSION}`);
    expect(loaded.report.migrations).toContain('store:normalize-canonical-order');
  });

  it('adds a default page and deterministic unique order keys during v1 migration', () => {
    const loaded = createSchema().loadDocument({
      schema: { storeVersion: 1, shapes: { box: 0 }, bindings: {} },
      records: [
        { id: 'second', type: 'box', x: 0, y: 0, rotation: 0, index: 'same', props: {}, meta: {} },
        { id: 'first', type: 'box', x: 0, y: 0, rotation: 0, index: 'same', props: {}, meta: {} },
      ],
    });
    const shapes = loaded.records.filter(record => record['kind'] === 'shape');
    const page = loaded.records.find(record => record['kind'] === 'page');
    expect(page).toMatchObject({ id: 'page:default', name: 'Page 1' });
    expect(new Set(shapes.map(record => record['parentId']))).toEqual(new Set(['page:default']));
    expect(shapes.every(record => record['isLocked'] === false && record['isHidden'] === false)).toBe(true);
    expect(new Set(shapes.map(record => record['index'])).size).toBe(2);
  });

  it('migrates v2 sibling indices to canonical keys without changing their order', () => {
    const loaded = createSchema().loadDocument(document([
      shape('top', 'box', { index: 'z9' }),
      shape('bottom', 'box', { index: 'a1' }),
    ]));
    const shapes = loaded.records.filter(record => record['kind'] === 'shape');

    expect(shapes.map(record => record['id'])).toEqual(['top', 'bottom']);
    expect(shapes.every(record => /^o[0-9a-z]{24}$/.test(String(record['index'])))).toBe(true);
    expect(String(shapes[1]?.['index']) < String(shapes[0]?.['index'])).toBe(true);
    expect(loaded.report.migrations).toContain('store:normalize-canonical-order');
  });

  it('quarantines an ambiguous unknown legacy relationship as opaque', () => {
    const loaded = createSchema().loadDocument({
      schema: { storeVersion: 1, shapes: {}, bindings: {} },
      records: [{ id: 'future:relation', type: 'future-link', fromId: 'a', toId: 'b', meta: {} }],
    });
    expect(loaded.records[0]?.['kind']).toBe('opaque');
    expect(loaded.report.opaqueRecordIds).toContain('future:relation');
  });

  it('keeps shape and binding util namespaces separate even when their type matches', () => {
    const store = new GlideStore(createSchema());
    store.put([
      shape('arrow:shape', 'arrow'),
      shape('target'),
      binding('arrow:binding', 'arrow:shape', 'target'),
    ]);

    expect(store.getShapeIds()).toContain('arrow:shape');
    expect(store.getBindingsFromShape('arrow:shape' as any).map(item => item.id))
      .toEqual(['arrow:binding']);
  });

  it('preserves future records without rendering or invoking geometry hooks', () => {
    const store = new GlideStore(createSchema());
    const geometry = vi.fn();
    store.getGeometry = geometry;
    const future = {
      id: 'future:1', kind: 'future-widget', type: 'cloud', schemaVersion: 7,
      meta: { source: 'plugin' }, payload: { x: 10 },
    };

    store.replaceDocument(document([future]));

    expect(store.get('future:1')).toMatchObject(future);
    expect(store.getShapeIds()).toEqual([]);
    expect(geometry).not.toHaveBeenCalled();
    expect(store.serialize().records[0]).toMatchObject(future);
  });
});

describe('atomic document replacement', () => {
  it('removes records absent from the replacement and returns a load report', () => {
    const store = new GlideStore(createSchema());
    store.put([shape('old')]);

    const report = store.replaceDocument(document([shape('new')]));

    expect(store.get('old')).toBeUndefined();
    expect(store.get('new')).toBeDefined();
    expect(report.recordCount).toBe(2);
    expect(report.targetStoreVersion).toBe(CURRENT_STORE_VERSION);
  });

  it('leaves the previous document untouched when graph validation fails', () => {
    const store = new GlideStore(createSchema());
    store.put([shape('safe')]);
    const revision = store.revision;

    expect(() => store.replaceDocument(document([
      shape('orphan-arrow', 'arrow'),
      binding('bad-binding', 'orphan-arrow', 'missing'),
    ]))).toThrow(DocumentValidationError);

    expect(store.revision).toBe(revision);
    expect(store.get('safe')).toBeDefined();
    expect(store.get('orphan-arrow')).toBeUndefined();
  });
});

describe('graph-aware import', () => {
  it('remaps record IDs and every internal binding endpoint in one history change', () => {
    const store = new GlideStore(createSchema());
    store.put([shape('existing')]);
    const changes: string[] = [];
    store.listen(change => changes.push(`${change.label}:${change.deltas.length}`));

    const report = store.importRecords([
      shape('source', 'arrow', {
        props: {
          start: { boundShapeId: 'target' },
          end: { boundShapeId: null },
        },
      }),
      shape('target'),
      binding('connector', 'source', 'target'),
    ]);

    const importedSource = store.get(report.idMap.source!)!;
    const importedBinding = store.get(report.idMap.connector!)!;
    expect(((importedSource['props'] as AnyRecord)['start'] as AnyRecord)['boundShapeId'])
      .toBe(report.idMap.target);
    expect(importedBinding['fromId']).toBe(report.idMap.source);
    expect(importedBinding['toId']).toBe(report.idMap.target);
    expect(report.importedRecordCount).toBe(3);
    expect(changes).toEqual(['Import Records:3']);
  });

  it('rejects an external binding endpoint without publishing a partial import', () => {
    const store = new GlideStore(createSchema());
    store.put([shape('existing')]);
    const revision = store.revision;

    expect(() => store.importRecords([
      shape('source', 'arrow'),
      binding('connector', 'source', 'outside'),
    ])).toThrow('cannot detach external binding toId');

    expect(store.revision).toBe(revision);
    expect(store.serialize().records.map(record => record.id)).toEqual(['existing', 'page:default']);
  });
});
