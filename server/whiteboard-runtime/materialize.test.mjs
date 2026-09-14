import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
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
test('preserves opaque asset records and unresolved references without extracting assets', () => {
 const d = new Y.Doc();
 const records = d.getMap('glideboard-records-v2');
 records.set('asset', new Y.Map(Object.entries({ kind: 'asset', type: 'future-asset-type', props: { hash: 'unvalidated' } })));
 records.set('shape', new Y.Map(Object.entries({ kind: 'shape', props: { assetId: 'missing' } })));
 const result = materialize({ updates: [encode(d)], title: 'Initial' });
 assert.equal(result.title, 'Initial');
 assert.equal(Object.hasOwn(result, 'assetHashes'), false);
 assert.deepEqual(decode(result.state).getMap('glideboard-records-v2').toJSON(), records.toJSON());
});

test('ordered title metadata overrides a conflicting legacy Yjs title', () => {
 const d = new Y.Doc(); d.getMap('glideboard-meta').set('title', 'Stale embedded title');
 assert.equal(materialize({updates:[encode(d)],title:'Current title'}).title, 'Current title');
});
