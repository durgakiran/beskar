import { describe, expect, it } from 'vitest';
import {
  CURRENT_STORE_VERSION,
  DEFAULT_PAGE_ID,
  DocumentValidationError,
  GlideSchema,
} from './schema';

function createSchema(): GlideSchema {
  const schema = new GlideSchema();
  schema.registerShapeUtil({ type: 'box' });
  schema.registerShapeUtil({ type: 'frame', canContainChildren: true });
  return schema;
}

function v4Shape(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'shape',
    type: 'box',
    schemaVersion: 0,
    x: 10,
    y: 20,
    rotation: 0,
    index: 'a1',
    props: {},
    meta: {},
    ...overrides,
  };
}

describe('hierarchy schema', () => {
  it('migrates a diagram with no pageId or parentId onto a default page', () => {
    const loaded = createSchema().loadDocument({
      schema: { storeVersion: 4, shapes: { box: 0 }, bindings: {} },
      records: [v4Shape('shape:one')],
    });

    const page = loaded.records.find(record => record['kind'] === 'page');
    const shape = loaded.records.find(record => record['id'] === 'shape:one')!;
    expect(page).toMatchObject({ id: DEFAULT_PAGE_ID, name: 'Page 1' });
    expect(typeof page?.['index']).toBe('string');
    expect(shape).toMatchObject({
      parentId: DEFAULT_PAGE_ID,
      isLocked: false,
      isHidden: false,
      x: 10,
      y: 20,
    });
    expect(shape).not.toHaveProperty('pageId');
    expect(loaded.report.migrations).toContain('store:add-hierarchy-envelope');
  });

  it('replaces legacy pageId with parentId without creating an extra page', () => {
    const loaded = createSchema().loadDocument({
      schema: { storeVersion: 4, shapes: { box: 0 }, bindings: {} },
      records: [
        { id: 'page:custom', kind: 'page', type: 'page', schemaVersion: 0, name: 'Custom', meta: {} },
        v4Shape('shape:one', { pageId: 'page:custom' }),
      ],
    });

    expect(loaded.records.filter(record => record['kind'] === 'page')).toHaveLength(1);
    expect(loaded.records.find(record => record['id'] === 'shape:one'))
      .toMatchObject({ parentId: 'page:custom' });
  });

  it('requires explicit hierarchy fields in an already-v5 document', () => {
    expect(() => createSchema().loadDocument({
      schema: { storeVersion: CURRENT_STORE_VERSION, shapes: { box: 0 }, bindings: {} },
      records: [v4Shape('shape:invalid')],
    })).toThrow('store-v5 shape is missing parentId');
  });

  it('allows registered containers and rejects ordinary shape parents', () => {
    const page = {
      id: DEFAULT_PAGE_ID,
      kind: 'page',
      type: 'page',
      schemaVersion: 0,
      name: 'Page 1',
      index: 'a1',
      meta: {},
    };
    const parentFields = { parentId: DEFAULT_PAGE_ID, isLocked: false, isHidden: false };
    const childFields = { parentId: 'shape:parent', isLocked: false, isHidden: false };
    const document = (parentType: string) => ({
      schema: {
        storeVersion: CURRENT_STORE_VERSION,
        shapes: { box: 0, frame: 0 },
        bindings: {},
      },
      records: [
        page,
        v4Shape('shape:parent', { type: parentType, ...parentFields }),
        v4Shape('shape:child', childFields),
      ],
    });

    expect(() => createSchema().loadDocument(document('box')))
      .toThrow(DocumentValidationError);
    expect(createSchema().loadDocument(document('frame')).records)
      .toHaveLength(3);
  });
});
