import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { digest } from './api';
import { matchesPublishedState, normalizeYjsState } from './publishState';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

it.each(['shape', 'rich text'])('normalizes %s deletion captured before transaction cleanup', async kind => {
    const doc = new Y.Doc();
    let captured: Uint8Array = new Uint8Array();
    if (kind === 'shape') {
        const records = doc.getMap('records');
        records.observeDeep(() => { captured = Y.encodeStateAsUpdate(doc); });
        records.set('shape', new Y.Map([['x', 1]]));
        records.delete('shape');
    } else {
        const fragments = doc.getMap<Y.XmlFragment>('fragments');
        fragments.observeDeep(() => { captured = Y.encodeStateAsUpdate(doc); });
        const fragment = new Y.XmlFragment();
        fragments.set('text', fragment);
        const text = new Y.XmlText(); fragment.insert(0, [text]); text.insert(0, 'hello');
        text.delete(0, 5);
    }
    const settled = Y.encodeStateAsUpdate(doc);
    expect(await digest(captured)).not.toBe(await digest(settled));
    const original = captured.slice();
    expect(await matchesPublishedState(captured, settled)).toBe(true);
    expect(captured).toEqual(original);
    expect(normalizeYjsState(normalizeYjsState(captured))).toEqual(normalizeYjsState(captured));
    // Duplicate replay leaves the normalized state unchanged.
    Y.applyUpdate(doc, captured);
    expect(await matchesPublishedState(captured, Y.encodeStateAsUpdate(doc))).toBe(true);
    doc.destroy();
});

it('detects actual missing edits and deletions even with equal state vectors', async () => {
    const doc = new Y.Doc();
    const empty = Y.encodeStateAsUpdate(doc);
    doc.getMap('records').set('shape', true);
    const inserted = Y.encodeStateAsUpdate(doc);
    const vector = Y.encodeStateVector(doc);
    doc.getMap('records').delete('shape');
    const deleted = Y.encodeStateAsUpdate(doc);
    expect(Y.encodeStateVector(doc)).toEqual(vector);
    expect(await matchesPublishedState(empty, inserted)).toBe(false);
    expect(await matchesPublishedState(inserted, deleted)).toBe(false);
    doc.destroy();
});

it('rejects unresolved structs, unresolved deletions, and malformed updates', () => {
    const doc = new Y.Doc();
    const records = doc.getMap('records');
    records.set('first', 1);
    const vector = Y.encodeStateVector(doc);
    records.set('second', 2);
    expect(() => normalizeYjsState(Y.encodeStateAsUpdate(doc, vector))).toThrow('unresolved');
    const all = Y.encodeStateVector(doc);
    records.delete('first');
    expect(() => normalizeYjsState(Y.encodeStateAsUpdate(doc, all))).toThrow('unresolved');
    expect(() => normalizeYjsState(new Uint8Array([255]))).toThrow();
    doc.destroy();
});
