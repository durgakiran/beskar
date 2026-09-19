import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { createHash } from 'node:crypto';
import { materialize } from './materialize.mjs';
const encode = d => Buffer.from(Y.encodeStateAsUpdate(d)).toString('base64');
const decode = state => { const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(state, 'base64')); return doc; };

test('replays only supplied boundary and captures title', () => {
 const d = new Y.Doc(), updates = [encode(d)];
 d.on('update', u => updates.push(Buffer.from(u).toString('base64')));
 d.getMap('glideboard-meta').set('title', 'First');
 const first = materialize({ updates: [...updates], title: 'First' });
 d.getMap('glideboard-meta').set('title', 'Second');
 const second = materialize({ updates, title: 'Second' });
 assert.equal(first.title, 'First');
 assert.equal(second.title, 'Second');
 assert.equal(decode(first.state).getMap('glideboard-meta').get('title'), 'First');
});
test('rejects causal gaps', () => {
 const d = new Y.Doc(), updates = [];
 d.on('update', u => updates.push(Buffer.from(u).toString('base64')));
 d.getMap('glideboard-meta').set('title', 'one');
 d.getMap('glideboard-meta').set('title', 'two');
 assert.throws(() => materialize({ updates: [updates[1]], title: 'Initial' }));
});
test('rejects opaque asset records and unresolved references', () => {
 const d = new Y.Doc();
 const records = d.getMap('glideboard-records-v2');
 records.set('asset', new Y.Map(Object.entries({ kind: 'asset', type: 'future-asset-type', props: { hash: 'unvalidated' } })));
 records.set('shape', new Y.Map(Object.entries({ kind: 'shape', props: { assetId: 'missing' } })));
 assert.throws(() => materialize({ updates: [encode(d)], title: 'Initial' }), error => error.code === 'assets');
});

const hash = char => char.repeat(64);
const raster = (char = 'a', props = {}) => ({
 id: `asset:sha256:${hash(char)}`, kind: 'asset', type: 'raster-image', schemaVersion: 1,
 props: { hash: hash(char), mimeType: 'image/png', byteLength: 100, width: 20, height: 10, ...props }, meta: {},
});
const shape = (asset = raster(), id = 'shape:1') => ({ id, kind: 'shape', type: asset.type, props: { assetId: asset.id, w: 20, h: 10 } });
const inspect = doc => materialize({ updates: [encode(doc)], title: 'Assets' });
const put = (doc, record, root = 'glideboard-records-v2') => doc.getMap(root).set(record.id, root.endsWith('-v2') ? new Y.Map(Object.entries(record)) : record);

test('extracts deterministic unique raster dependencies including unreferenced live records', () => {
 const doc = new Y.Doc();
 put(doc, raster('b')); put(doc, raster()); put(doc, shape()); put(doc, shape(raster(), 'shape:2'));
 const before = encode(doc), result = inspect(doc);
 assert.equal(result.assetExtractorVersion, 'glideboard-assets-v1');
 assert.deepEqual(result.assets, ['a', 'b'].map(char => ({ contentHash: hash(char), mimeType: 'image/png', byteLength: 100, width: 20, height: 10 })));
 assert.equal(result.state, before);
 assert.equal(inspect(new Y.Doc()).assets.length, 0);
});

test('extracts the legacy record root until v2 is adopted and ignores obsolete legacy assets afterwards', () => {
 const doc = new Y.Doc(); put(doc, raster(), 'glideboard-records');
 assert.equal(inspect(doc).assets.length, 1);
 put(doc, raster('b'));
 assert.deepEqual(inspect(doc).assets.map(asset => asset.contentHash), [hash('b')]);
 doc.getMap('glideboard-records-v2').get(raster('b').id).set('$tombstone', true);
 assert.deepEqual(inspect(doc).assets, []);
 doc.getMap('glideboard-records-v2').delete(raster('b').id);
 doc.getMap('glideboard-meta').set('schemaVersion', 2);
 assert.throws(() => inspect(doc), error => error.code === 'assets');
 doc.getMap('glideboard-records').clear();
 assert.deepEqual(inspect(doc).assets, []);
});

test('rejects adopted empty v2 roots that current clients would rehydrate from legacy records', () => {
 for (const [key, value] of [['schemaVersion', 2], ['recordModel', 'nested-map-tombstone-v1']]) {
   const doc = new Y.Doc(); put(doc, raster(), 'glideboard-records');
   doc.getMap('glideboard-meta').set(key, value);
   assert.throws(() => inspect(doc), error => error.code === 'assets');
 }
});

test('classifies supported store-v1 shapes and arrow bindings using client legacy predicates', () => {
 const doc = new Y.Doc();
 const legacyShape = { id: 'shape:old', type: 'box', x: 0, y: 0, rotation: 0, index: 'a1', props: { w: 100, h: 50 } };
 put(doc, legacyShape, 'glideboard-records');
 put(doc, { id: 'binding:old', type: 'arrow', fromId: 'shape:arrow', toId: 'shape:old', props: {} }, 'glideboard-records');
 const before = encode(doc), result = inspect(doc);
 assert.deepEqual(result.assets, []);
 assert.equal(result.state, before);
 for (const modify of [
   shape => { delete shape.rotation; },
   shape => { shape.type = 'future-shape'; },
   shape => { shape.fromId = 'shape:x'; shape.toId = 'shape:y'; },
   shape => { shape.props = { assetId: raster().id }; },
 ]) {
   const d = new Y.Doc(), record = structuredClone(legacyShape); modify(record); put(d, record, 'glideboard-records');
   assert.throws(() => inspect(d), error => error.code === 'assets');
 }
 doc.getMap('glideboard-meta').set('documentSchema', { storeVersion: 2, shapes: {}, bindings: {} });
 assert.throws(() => inspect(doc), error => error.code === 'assets');
});

test('legacy inferred raster shapes still require matching explicit asset records', () => {
 const doc = new Y.Doc(), record = { ...shape(), x: 0, y: 0, rotation: 0, index: 'a1' };
 delete record.kind; put(doc, record, 'glideboard-records');
 assert.throws(() => inspect(doc), error => error.code === 'assets');
 put(doc, raster(), 'glideboard-records');
 assert.equal(inspect(doc).assets.length, 1);
});

test('applies nested-map and tombstone semantics exactly and rejects references to tombstoned assets', () => {
 const doc = new Y.Doc(), asset = raster(); put(doc, asset);
 const entry = doc.getMap('glideboard-records-v2').get(asset.id);
 entry.set('props', new Y.Map(Object.entries(asset.props)));
 entry.set('$generation', 'local'); entry.set('$tombstone', false);
 assert.equal(inspect(doc).assets.length, 1);
 entry.set('$tombstone', true);
 assert.deepEqual(inspect(doc).assets, []);
 put(doc, shape()); assert.throws(() => inspect(doc), error => error.code === 'assets');
 doc.getMap('glideboard-records-v2').get('shape:1').set('$tombstone', true);
 assert.deepEqual(inspect(doc).assets, []);
});

test('extracts only the requested update boundary when later images exist', () => {
 const doc = new Y.Doc(), updates = [encode(doc)]; doc.on('update', bytes => updates.push(Buffer.from(bytes).toString('base64')));
 put(doc, raster()); const first = [...updates]; put(doc, raster('b'));
 assert.deepEqual(materialize({ updates: first, title: 'First' }).assets.map(asset => asset.contentHash), [hash('a')]);
 assert.equal(materialize({ updates, title: 'Second' }).assets.length, 2);
});

test('rejects invalid raster identities, metadata, payload URLs and unsupported asset types', () => {
 const cases = [
   { ...raster(), id: 'asset:other' }, { ...raster(), schemaVersion: 2 }, { ...raster(), type: 'future-image' },
   raster('a', { byteLength: 0 }), raster('a', { byteLength: 21 * 1024 * 1024 }), raster('a', { width: 16385 }),
   raster('a', { width: 10000, height: 10000 }), raster('a', { width: 1.5 }), raster('a', { hash: hash('A') }),
   raster('a', { mimeType: 'image/svg+xml' }), raster('a', { src: 'https://example.test/image.png' }),
 ];
 for (const record of cases) { const doc = new Y.Doc(); put(doc, record); assert.throws(() => inspect(doc), error => error.code === 'assets'); }
});

function vector() {
 const canonical = { viewBox: [0, 0, 10, 20], width: 10, height: 20, paths: [{ d: 'M 0 0 L 10 20', fill: 'none', stroke: '#fff' }] };
 const content = JSON.stringify(canonical), digest = createHash('sha256').update(content).digest('hex');
 return { id: `asset:sha256:${digest}`, kind: 'asset', type: 'sanitized-svg', schemaVersion: 1,
   props: { hash: digest, mimeType: 'image/svg+xml', sanitizerVersion: 1, byteLength: Buffer.byteLength(content), ...canonical }, meta: {} };
}

test('validates self-contained vector content independently of raster catalog dependencies', () => {
 const doc = new Y.Doc(), asset = vector(); put(doc, asset); put(doc, shape(asset));
 assert.deepEqual(inspect(doc).assets, []);
 put(doc, raster()); assert.equal(inspect(doc).assets.length, 1);
 for (const modify of [
   asset => { asset.props.paths[0].stroke = 'url(https://example.test/image.png)'; },
   asset => { asset.props.paths[0].href = 'https://example.test/image.png'; },
   asset => { asset.props.paths[0].d = 'M 0 0<script>'; },
   asset => { asset.props.paths[0].d = 'M 0 0 L 9999999 0'; },
   asset => { asset.props.paths[0].d = 'M 0 0 L 9 20'; },
   asset => { asset.props.byteLength++; },
   asset => { asset.props.width++; },
 ]) { const bad = vector(), d = new Y.Doc(); modify(bad); put(d, bad); assert.throws(() => inspect(d), error => error.code === 'assets'); }
});

test('rejects missing and type-mismatched shape asset references', () => {
 const doc = new Y.Doc(); put(doc, shape()); assert.throws(() => inspect(doc), error => error.code === 'assets');
 put(doc, raster()); assert.equal(inspect(doc).assets.length, 1);
 put(doc, { ...shape(), type: 'sanitized-svg' }); assert.throws(() => inspect(doc), error => error.code === 'assets');
});

test('rejects asset-bearing unsupported records, opaque payloads and unknown roots', () => {
 for (const record of [
   { id: 'shape:1', kind: 'shape', type: 'custom', props: { assetId: raster().id } },
   { id: 'shape:1', kind: 'shape', type: 'box', props: { src: 'https://example.test/image.png' } },
   { id: 'shape:1', kind: 'shape', type: 'box', props: { nested: { value: '<image href="x" />' } } },
   { id: 'shape:1', kind: 'opaque', props: {} },
   { id: 'shape:1', $opaque: { id: 'shape:1', kind: 'shape', type: 'raster-image' } },
 ]) { const doc = new Y.Doc(); put(doc, record); assert.throws(() => inspect(doc), error => error.code === 'assets'); }
 const doc = new Y.Doc(); doc.getMap('other-records').set(raster().id, raster()); assert.throws(() => inspect(doc), error => error.code === 'assets');
 const array = new Y.Doc(); array.getArray('glideboard-records-v2').push([raster()]); assert.throws(() => inspect(array), error => error.code === 'assets');
});

test('does not interpret ordinary text and hyperlinks as image references', () => {
 const doc = new Y.Doc();
 put(doc, { id: 'shape:1', kind: 'shape', type: 'text', props: { text: raster().id, href: 'https://example.test/readme' } });
 assert.deepEqual(inspect(doc).assets, []);
});

test('bounds inspection nesting and asset count', () => {
 const doc = new Y.Doc(); let nested = {};
 for (let index = 0; index < 70; index++) nested = { child: nested };
 put(doc, { id: 'shape:1', kind: 'shape', type: 'box', props: nested });
 assert.throws(() => inspect(doc), error => error.code === 'assets');
 const many = new Y.Doc();
 many.transact(() => { for (let index = 0; index < 10001; index++) {
   const digest = index.toString(16).padStart(64, '0'), asset = raster();
   asset.id = `asset:sha256:${digest}`; asset.props.hash = digest; put(many, asset);
 } });
 assert.throws(() => inspect(many), error => error.code === 'assets');
});

test('ordered title metadata overrides a conflicting legacy Yjs title', () => {
 const d = new Y.Doc(); d.getMap('glideboard-meta').set('title', 'Stale embedded title');
 assert.equal(materialize({updates:[encode(d)],title:'Current title'}).title, 'Current title');
});
