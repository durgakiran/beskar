import { afterEach, expect, it, vi } from 'vitest';
import { makeCommentApiHandler } from './commentApiHandler';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('loads resolved threads so the Resolved tab survives an event-driven reload', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/api/v1');
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{
        id: 'thread', resolvedAt: '2026-11-03T06:00:00Z',
        createdBy: { id: 'user', name: 'Test user' }, resolvedBy: { id: 'user' }, replies: [],
    }] })));
    vi.stubGlobal('fetch', request);
    const threads = await makeCommentApiHandler('141').getThreads('141');
    expect(request).toHaveBeenCalledWith('/api/v1/comment/documents/141/threads?includeResolved=true', expect.any(Object));
    expect(threads[0]).toMatchObject({ id: 'thread', resolvedAt: '2026-11-03T06:00:00Z', resolvedBy: 'user' });
});
