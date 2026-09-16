import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { createHash } from 'node:crypto';
import { inspectMigration } from './inspect-migration.mjs';

const inspect = (doc, extra = {}) => inspectMigration({ state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'), ...extra });
const record = props => ({ id: 'shape:1', kind: 'shape', type: 'box', props, x: 0, y: 0 });
const emptyManifest = { assetIds: [], assets: [], assetExtractorVersion: 'glideboard-assets-v1' };
const hash = char => char.repeat(64);
const raster = (char = 'a', props = {}) => ({
  id: `asset:sha256:${hash(char)}`, kind: 'asset', type: 'raster-image', schemaVersion: 1,
  props: { hash: hash(char), mimeType: 'image/png', byteLength: 100, width: 20, height: 10, ...props }, meta: {},
});
const shape = (asset = raster(), id = 'shape:1') => ({ ...record({ assetId: asset.id, w: 20, h: 10 }), id, type: asset.type });
const put = (doc, value, root = 'glideboard-records-v2') => doc.getMap(root).set(value.id, root.endsWith('-v2') ? new Y.Map(Object.entries(value)) : value);
function vector() {
  const canonical = { viewBox: [0, 0, 10, 20], width: 10, height: 20, paths: [{ d: 'M 0 0 L 10 20', fill: 'none', stroke: '#fff' }] };
  const content = JSON.stringify(canonical), digest = createHash('sha256').update(content).digest('hex');
  return { id: `asset:sha256:${digest}`, kind: 'asset', type: 'sanitized-svg', schemaVersion: 1,
    props: { hash: digest, mimeType: 'image/svg+xml', sanitizerVersion: 1, byteLength: Buffer.byteLength(content), ...canonical }, meta: {} };
}

test('accepts empty documents, legacy flat maps and nested vector records without modifying them', () => {
  const empty = new Y.Doc(); assert.deepEqual(inspect(empty), emptyManifest); empty.destroy();
  for (const root of ['glideboard-records', 'glideboard-records-v2']) {
    const doc = new Y.Doc(); const value = record({ w: 100, h: 80 });
    doc.getMap(root).set(value.id, root.endsWith('-v2') ? new Y.Map(Object.entries(value)) : value);
    const before = Y.encodeStateAsUpdate(doc);
    assert.deepEqual(inspect(doc), emptyManifest);
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before); doc.destroy();
  }
});
test('rejects unknown assets and unresolved or embedded image references in either map', () => {
  for (const root of ['glideboard-records', 'glideboard-records-v2']) {
    for (const value of [
      { id: 'asset:1', kind: 'asset', type: 'future-type' },
      { ...record({}), type: 'raster-image' }, record({ assetId: 'missing' }),
      record({ src: 'https://example.test/image.png' }), record({ payload: 'data:image/png;base64,AA==' }),
      record({ svg: '<svg><image href="x" /></svg>' }),
    ]) {
      const doc = new Y.Doc(); doc.getMap(root).set(value.id, root.endsWith('-v2') ? new Y.Map(Object.entries(value)) : value);
      assert.throws(() => inspect(doc), error => error.code === 'assets'); doc.destroy();
    }
  }
});
test('ignores tombstoned assets but never accepts opaque/unknown records or roots as empty', () => {
  const doc = new Y.Doc(); doc.getMap('glideboard-records-v2').set('asset:1', new Y.Map(Object.entries({ kind: 'asset', $tombstone: true })));
  assert.deepEqual(inspect(doc), emptyManifest); doc.destroy();
  for (const value of [{ id: 'shape:1', kind: 'opaque' }, { id: 'shape:1', type: 'future-shape' }]) {
    const d = new Y.Doc(); d.getMap('glideboard-records').set(value.id, value); assert.throws(() => inspect(d)); d.destroy();
  }
  const old = new Y.Doc(); old.getArray('tl_records').push([record({})]); assert.throws(() => inspect(old)); old.destroy();
  const wrong = new Y.Doc(); wrong.getArray('glideboard-records').push([record({})]); assert.throws(() => inspect(wrong)); wrong.destroy();
});
test('checks target identity, incompatible metadata and incomplete state', () => {
  const doc = new Y.Doc(); doc.getMap('glideboard-meta').set('boardIdentity', 'old');
  assert.throws(() => inspect(doc, { boardIdentity: 'v2:s:42' }));
  doc.getMap('glideboard-meta').set('boardIdentity', 'v2:s:42');
  assert.deepEqual(inspect(doc, { boardIdentity: 'v2:s:42' }), emptyManifest);
  doc.getMap('glideboard-meta').set('schemaVersion', 99); assert.throws(() => inspect(doc)); doc.destroy();
  const gap = new Y.Doc(); const updates = []; gap.on('update', bytes => updates.push(bytes));
  gap.getMap('glideboard-meta').set('title', 'one'); gap.getMap('glideboard-meta').set('title', 'two');
  assert.throws(() => inspectMigration({ state: Buffer.from(updates[1]).toString('base64') })); gap.destroy();
});

test('returns deterministic canonical descriptors and all live asset IDs for flat and nested snapshots', () => {
  for (const root of ['glideboard-records', 'glideboard-records-v2']) {
    const doc = new Y.Doc();
    put(doc, raster('b', { mimeType: 'image/webp' }), root); put(doc, raster(), root);
    put(doc, shape(), root); put(doc, shape(raster(), 'shape:2'), root);
    const before = Y.encodeStateAsUpdate(doc);
    const result = inspect(doc);
    assert.deepEqual(result, {
      assetExtractorVersion: 'glideboard-assets-v1',
      assetIds: [raster().id, raster('b').id],
      assets: ['a', 'b'].map(char => ({ contentHash: hash(char), mimeType: char === 'a' ? 'image/png' : 'image/webp', byteLength: 100, width: 20, height: 10 })),
    });
    assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
    doc.destroy();
  }
});

test('compares source and target manifests without losing unreferenced source raster assets', () => {
  const source = new Y.Doc(), target = new Y.Doc();
  for (const value of [raster(), raster('b'), shape()]) put(source, value, 'glideboard-records');
  for (const value of [raster(), shape()]) put(target, value);
  target.getMap('glideboard-meta').set('boardIdentity', 'v2:s:42');
  const original = inspect(source), stripped = inspect(target, { boardIdentity: 'v2:s:42' });
  assert.equal(original.assets.length, 2); assert.equal(stripped.assets.length, 1);
  assert.notDeepEqual(original.assetIds, stripped.assetIds);
  put(target, raster('b'));
  assert.deepEqual(inspect(target, { boardIdentity: 'v2:s:42' }), original);
  source.destroy(); target.destroy();
});

test('validates self-contained vectors, lists their canonical IDs, and needs no raster blob', () => {
  for (const root of ['glideboard-records', 'glideboard-records-v2']) {
    const doc = new Y.Doc(), asset = vector(); put(doc, asset, root); put(doc, shape(asset), root);
    assert.deepEqual(inspect(doc), { ...emptyManifest, assetIds: [asset.id] });
    const stripped = new Y.Doc();
    assert.notDeepEqual(inspect(doc).assetIds, inspect(stripped).assetIds);
    put(doc, raster(), root);
    assert.deepEqual(inspect(doc).assetIds, [asset.id, raster().id].sort());
    assert.equal(inspect(doc).assets.length, 1);
    doc.destroy(); stripped.destroy();
  }
});

test('rejects invalid vectors, noncanonical raster records and mismatched shape references', () => {
  for (const modify of [
    asset => { asset.props.paths[0].stroke = 'url(https://example.test/image.svg)'; },
    asset => { asset.props.paths[0].href = 'https://example.test/image.svg'; },
    asset => { asset.props.paths[0].d = 'M 0 0 L 9 20'; },
    asset => { asset.props.paths[0].d = 'M 0 0<script>'; },
    asset => { asset.props.byteLength++; },
    asset => { asset.props.width++; },
  ]) {
    const doc = new Y.Doc(), asset = vector(); modify(asset); put(doc, asset);
    assert.throws(() => inspect(doc), error => error.code === 'assets'); doc.destroy();
  }
  for (const value of [
    { ...raster(), id: 'asset:other' }, raster('a', { width: 16385 }), raster('a', { width: 10000, height: 10000 }),
    raster('a', { byteLength: 0 }), raster('a', { src: 'https://example.test/image.png' }),
  ]) {
    const doc = new Y.Doc(); put(doc, value);
    assert.throws(() => inspect(doc), error => error.code === 'assets'); doc.destroy();
  }
  const doc = new Y.Doc(); put(doc, raster()); put(doc, { ...shape(), type: 'sanitized-svg' });
  assert.throws(() => inspect(doc), error => error.code === 'assets'); doc.destroy();
});

test('uses the current authoritative root and ignores inert obsolete legacy payloads', () => {
  const doc = new Y.Doc();
  put(doc, { id: 'legacy:opaque', kind: 'opaque', props: { src: 'data:image/png;base64,AA==' } }, 'glideboard-records');
  assert.throws(() => inspect(doc), error => error.code === 'assets');
  put(doc, raster());
  assert.deepEqual(inspect(doc).assetIds, [raster().id]);
  doc.getMap('glideboard-records-v2').get(raster().id).set('$tombstone', true);
  assert.deepEqual(inspect(doc), emptyManifest);
  doc.getMap('glideboard-meta').set('schemaVersion', 2);
  doc.getMap('glideboard-records-v2').clear();
  assert.throws(() => inspect(doc), error => error.code === 'assets');
  doc.destroy();
});

test('uses nested asset properties and rejects live references to tombstoned assets', () => {
  const doc = new Y.Doc(), asset = raster(); put(doc, asset); put(doc, shape());
  const entry = doc.getMap('glideboard-records-v2').get(asset.id);
  entry.set('props', new Y.Map(Object.entries(asset.props))); entry.set('$generation', 'generation');
  assert.deepEqual(inspect(doc).assetIds, [asset.id]);
  entry.set('$tombstone', true);
  assert.throws(() => inspect(doc), error => error.code === 'assets');
  doc.getMap('glideboard-records-v2').get('shape:1').set('$tombstone', true);
  assert.deepEqual(inspect(doc), emptyManifest); doc.destroy();
});

test('accepts supported store-v1 inferred shapes and bindings without changing their flat records', () => {
  const doc = new Y.Doc();
  const legacy = { ...shape(), x: 0, y: 0, rotation: 0, index: 'a1' }; delete legacy.kind;
  put(doc, legacy, 'glideboard-records'); put(doc, raster(), 'glideboard-records');
  put(doc, { id: 'binding:old', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:1', props: {} }, 'glideboard-records');
  const before = Y.encodeStateAsUpdate(doc);
  assert.deepEqual(inspect(doc).assetIds, [raster().id]);
  assert.deepEqual(Y.encodeStateAsUpdate(doc), before);
  doc.getMap('glideboard-meta').set('documentSchema', { storeVersion: 2 });
  assert.throws(() => inspect(doc), error => error.code === 'assets'); doc.destroy();
});

test('rejects rich-text embedded references and subdocuments', () => {
  const rich = new Y.Doc(); rich.getMap('glideboard-rich-text-fragments-v1').set('fragment', { src: 'https://example.test/image.png' });
  assert.throws(() => inspect(rich), error => error.code === 'assets'); rich.destroy();
  const sub = new Y.Doc(); sub.getMap('glideboard-meta').set('nested', new Y.Doc());
  assert.throws(() => inspect(sub), /Incomplete Yjs state/); sub.destroy();
});
