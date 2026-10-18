import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { DocumentDraftSession, type DocumentDraftRevision } from './DocumentDraftSession';
import { base64ToUint8Array, uint8ArrayToBase64 } from 'app/core/utils/base64';

const sessions: DocumentDraftSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); });
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
function server() {
    const doc = new Y.Doc();
    let revision: DocumentDraftRevision = { docId: 1, generation: 0, draft: true };
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === 'PUT') {
            const body = JSON.parse(init.body as string);
            if (JSON.stringify(body.expectedRevision) !== JSON.stringify(revision)) return json({}, 409);
            Y.applyUpdate(doc, base64ToUint8Array(body.data));
            revision = { ...revision, generation: revision.generation + 1 };
            return json({ revision });
        }
        return json({ docId: revision.docId, draftGeneration: revision.generation, draft: revision.draft, data: { data: uint8ArrayToBase64(Y.encodeStateAsUpdate(doc)) } });
    });
    return { doc, request, publish: () => { revision = { ...revision, draft: false }; } };
}
function session(doc: Y.Doc, request: typeof fetch, recovery?: ConstructorParameters<typeof DocumentDraftSession>[7]) {
    const value = new DocumentDraftSession(doc, '/api', 'edit', () => ({ title: 'Document' }), vi.fn(), request, undefined, recovery);
    sessions.push(value);
    value.initialize({ docId: 1, draftGeneration: 0, draft: true });
    return value;
}

describe('independent document persistence', () => {
    it('calls the default browser fetch with its global receiver for saves and reconciliation', async () => {
        const remote = server();
        const browserFetch = vi.fn(function (this: typeof globalThis, input: RequestInfo | URL, init?: RequestInit) {
            if (this !== globalThis) throw new TypeError('Illegal invocation');
            return remote.request(input, init);
        });
        vi.stubGlobal('fetch', browserFetch);
        const doc = new Y.Doc();
        const value = new DocumentDraftSession(doc, '/api', 'edit', () => ({ title: 'Document' }), vi.fn());
        sessions.push(value);
        value.initialize({ docId: 1, draftGeneration: 0, draft: true });
        doc.getText('body').insert(0, 'saved in browser');
        await value.save();
        await value.reconcile();
        expect(remote.doc.getText('body').toString()).toBe('saved in browser');
        expect(browserFetch).toHaveBeenCalledTimes(2);
        expect(browserFetch.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['PUT', 'GET']);
    });

    it('merges disconnected editors through HTTP without losing either edit', async () => {
        const remote = server();
        const a = new Y.Doc(); const b = new Y.Doc();
        const sa = session(a, remote.request); const sb = session(b, remote.request);
        a.getText('body').insert(0, 'Alice'); b.getText('body').insert(0, 'Bob');
        await Promise.all([sa.save(), sb.save()]);
        expect(remote.doc.getText('body').toString()).toContain('Alice');
        expect(remote.doc.getText('body').toString()).toContain('Bob');
        await sa.reconcile(); await sb.reconcile();
        expect(a.getText('body').toString()).toBe(b.getText('body').toString());
    });

    it('serializes saves and includes edits made while an acknowledgement is pending', async () => {
        const remote = server(); const doc = new Y.Doc();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let first = true;
        const request = vi.fn(async (url, init) => { if (first) { first = false; await gate; } return remote.request(url, init); });
        const value = session(doc, request);
        doc.getText('body').insert(0, 'first');
        const saving = value.save();
        await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
        doc.getText('body').insert(5, ' second');
        const second = value.save();
        expect(request).toHaveBeenCalledTimes(1);
        release(); await Promise.all([saving, second]);
        expect(remote.doc.getText('body').toString()).toBe('first second');
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('retries a failed request even when no further edit is made', async () => {
        vi.useFakeTimers();
        const remote = server(); const doc = new Y.Doc();
        let offline = true;
        const request = vi.fn(async (url, init) => { if (offline) throw new TypeError('Offline'); return remote.request(url, init); });
        const value = session(doc, request); doc.getText('body').insert(0, 'pending');
        await expect(value.save()).rejects.toThrow('Offline');
        offline = false;
        await vi.advanceTimersByTimeAsync(3000);
        expect(remote.doc.getText('body').toString()).toBe('pending');
    });

    it('retains CRDT identities across another participant publishing', async () => {
        const remote = server(); const doc = new Y.Doc(); const value = session(doc, remote.request);
        doc.getText('body').insert(0, 'before'); await value.save(); remote.publish();
        doc.getText('body').insert(6, ' after'); await value.save();
        expect(remote.doc.getText('body').toString()).toBe('before after');
    });

    it('restores pending local recovery and clears it only after acknowledgement', async () => {
        const remote = server(); const doc = new Y.Doc();
        const adapter = { hydrate: vi.fn(async (target: Y.Doc) => { target.getText('body').insert(0, 'recovered'); return {} as any; }),
            persist: vi.fn(async () => {}), clearThrough: vi.fn(async () => {}), advanceDraft: vi.fn(), dispose: vi.fn(async () => {}) };
        const value = session(doc, remote.request, { adapter, sessionKey: 'document:user:space:1', draftId: '1' });
        await value.flush();
        expect(remote.doc.getText('body').toString()).toBe('recovered');
        expect(adapter.persist).toHaveBeenCalled(); expect(adapter.clearThrough).toHaveBeenCalled();
    });

    it('stops network retry and subscriptions when the page closes', async () => {
        vi.useFakeTimers();
        const request = vi.fn(async () => { throw new Error('offline'); });
        const doc = new Y.Doc(); const value = session(doc, request);
        await value.save().catch(() => {}); value.dispose();
        await vi.advanceTimersByTimeAsync(10000);
        expect(request).toHaveBeenCalledTimes(1);
    });
});
