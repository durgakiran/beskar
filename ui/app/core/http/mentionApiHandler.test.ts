import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeMentionApiHandler, MentionApiError } from './mentionApiHandler';

const profile = { id: 'user-1', label: 'Alex Morgan', email: 'alex@example.com', avatarUrl: null, spaceRole: 'editor' };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ status: 'success', data }), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn();

beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_USER_SERVER_URL', '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('space mention API adapter', () => {
    it('searches only the bound space and encodes full names and query punctuation', async () => {
        fetchMock.mockResolvedValue(reply({ users: [profile], hasMore: false }));
        const result = await makeMentionApiHandler('space-a').searchUsers('Alex Morgan & Priya');
        const [url, init] = fetchMock.mock.calls[0];
        const parsed = new URL(url, 'https://example.com');
        expect(parsed.pathname).toBe('/api/v1/space/space-a/mentions/users');
        expect(parsed.searchParams.get('query')).toBe('Alex Morgan & Priya');
        expect(parsed.searchParams.get('limit')).toBe('10');
        expect(init).toMatchObject({ credentials: 'include', redirect: 'error', cache: 'no-store' });
        expect(result).toEqual([{ id: profile.id, label: profile.label }]);
    });
    it('resolves stored mentions separately from hover details and forwards cancellation', async () => {
        fetchMock.mockImplementation(async () => reply(profile));
        const handler = makeMentionApiHandler('space-a');
        expect(await handler.resolveUser(profile.id)).toEqual({ id: profile.id, label: profile.label });
        const controller = new AbortController();
        expect(await handler.getUserDetails!(profile.id, { signal: controller.signal })).toEqual(profile);
        expect(fetchMock.mock.calls[1][1].signal).toBe(controller.signal);
    });
    it('uses configured API base and keeps each handler scoped independently', async () => {
        vi.stubEnv('VITE_USER_SERVER_URL', 'https://app.example.com/api/v1');
        fetchMock.mockImplementation(async () => reply(profile));
        const first = makeMentionApiHandler('space-a');
        const second = makeMentionApiHandler('space-b');
        await first.getUserDetails!(profile.id);
        await second.getUserDetails!(profile.id);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            'https://app.example.com/api/v1/space/space-a/mentions/users/user-1',
            'https://app.example.com/api/v1/space/space-b/mentions/users/user-1',
        ]);
        expect(() => makeMentionApiHandler('')).toThrow();
    });
    it('maps only detail 404 to unavailable, while preserving auth and service failures', async () => {
        const handler = makeMentionApiHandler('space-a');
        fetchMock.mockResolvedValue(reply(null, 404));
        expect(await handler.resolveUser(profile.id)).toBeNull();
        expect(await handler.getUserDetails!(profile.id)).toBeNull();
        await expect(handler.searchUsers('alex')).rejects.toMatchObject({ status: 404 });
        for (const status of [401, 403, 429, 503]) {
            fetchMock.mockResolvedValue(new Response('private provider error', { status }));
            await expect(handler.getUserDetails!(profile.id)).rejects.toMatchObject({ status, message: `Mention request failed (${status})` });
        }
    });
    it('does not cache profiles across membership changes or reuse settled errors', async () => {
        const handler = makeMentionApiHandler('space-a');
        fetchMock.mockResolvedValueOnce(reply(profile)).mockResolvedValueOnce(reply(null, 404)).mockResolvedValueOnce(reply(profile));
        expect(await handler.getUserDetails!(profile.id)).toEqual(profile);
        expect(await handler.getUserDetails!(profile.id)).toBeNull();
        expect(await handler.getUserDetails!(profile.id)).toEqual(profile);
    });
    it('rejects malformed and mismatched profiles instead of leaking another user', async () => {
        const handler = makeMentionApiHandler('space-a');
        for (const data of [null, { ...profile, id: 'someone-else' }, { id: profile.id }, {}, []]) {
            fetchMock.mockResolvedValue(reply(data));
            await expect(handler.getUserDetails!(profile.id)).rejects.toBeInstanceOf(MentionApiError);
        }
        fetchMock.mockResolvedValue(new Response('<html>Login</html>', { status: 200 }));
        await expect(handler.resolveUser(profile.id)).rejects.toThrow();
        fetchMock.mockResolvedValue(reply({ users: [null], hasMore: false }));
        await expect(handler.searchUsers('alex')).rejects.toThrow();
    });
});
