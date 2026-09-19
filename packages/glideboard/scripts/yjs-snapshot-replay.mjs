import assert from 'node:assert/strict';
import * as Y from 'yjs';

const RECORDS_KEY = 'glideboard-records-v2';

function recordsMap(doc) {
  return doc.getMap(RECORDS_KEY);
}

function putRecord(doc, id, value) {
  const record = new Y.Map();
  for (const [key, fieldValue] of Object.entries(value)) {
    record.set(key, fieldValue);
  }
  recordsMap(doc).set(id, record);
}

function materialize(doc) {
  return [...recordsMap(doc).entries()]
    .map(([id, record]) => [id, Object.fromEntries(record.entries())])
    .sort(([left], [right]) => left.localeCompare(right));
}

function canonicalState(doc) {
  return JSON.stringify(materialize(doc));
}

function applyAll(doc, updates) {
  for (const update of updates) {
    Y.applyUpdate(doc, update);
  }
}

function describe(label, doc) {
  console.log(`${label}: ${JSON.stringify(materialize(doc))}`);
}

// Build a historical source document. The first state is the persisted snapshot.
const source = new Y.Doc();
putRecord(source, 'shape:one', { type: 'rectangle', x: 10, y: 20 });
putRecord(source, 'shape:two', { type: 'ellipse', x: 100, y: 120 });
const snapshot = Y.encodeStateAsUpdate(source);

// These updates represent edits that happened after the snapshot was created.
const incrementalUpdates = [];
source.on('update', (update) => incrementalUpdates.push(update));

source.transact(() => {
  recordsMap(source).get('shape:one').set('x', 40);
});
source.transact(() => {
  putRecord(source, 'shape:three', { type: 'text', text: 'hello', x: 200, y: 80 });
});

assert.equal(incrementalUpdates.length, 2, 'expected two incremental updates');
const expected = canonicalState(source);
const mergedIncrementalUpdates = Y.mergeUpdates(incrementalUpdates);

// Simulate two new clients joining with no existing Y.Doc state.
const clientA = new Y.Doc();
const clientB = new Y.Doc();

for (const client of [clientA, clientB]) {
  Y.applyUpdate(client, snapshot);
  Y.applyUpdate(client, mergedIncrementalUpdates);
}

assert.equal(canonicalState(clientA), expected, 'client A should reconstruct the source state');
assert.equal(canonicalState(clientB), expected, 'client B should reconstruct the source state');

// Simulate a retry/duplicate delivery of the same update batch.
Y.applyUpdate(clientA, mergedIncrementalUpdates);
Y.applyUpdate(clientB, incrementalUpdates[0]);
Y.applyUpdate(clientB, incrementalUpdates[1]);
assert.equal(canonicalState(clientA), expected, 'duplicate merged update must not duplicate records');
assert.equal(canonicalState(clientB), expected, 'duplicate individual updates must not duplicate records');

// Simulate the live collaboration handshake after both clients loaded the data.
const updatesForB = Y.encodeStateAsUpdate(clientA, Y.encodeStateVector(clientB));
const updatesForA = Y.encodeStateAsUpdate(clientB, Y.encodeStateVector(clientA));
Y.applyUpdate(clientB, updatesForB);
Y.applyUpdate(clientA, updatesForA);

assert.equal(canonicalState(clientA), expected, 'clients must converge after synchronization');
assert.equal(canonicalState(clientB), expected, 'clients must converge after synchronization');
assert.equal(materialize(clientA).length, 3, 'the board must contain three unique records');

console.log('Yjs snapshot + incremental update experiment passed.');
console.log(`snapshot bytes: ${snapshot.length}`);
console.log(`incremental update bytes: ${incrementalUpdates.map((update) => update.length).join(', ')}`);
console.log(`merged incremental bytes: ${mergedIncrementalUpdates.length}`);
describe('final client A state', clientA);
describe('final client B state', clientB);
