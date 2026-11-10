import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redirectToLogin } from '../auth/redirectToLogin';
import { setupApiClient } from './setupApiClient';
import { useGet } from './hooks/useGet';
import { usePost } from './hooks/usePost';
import { usePut } from './hooks/usePut';
import { useDelete } from './hooks/useDelete';

vi.mock('../auth/redirectToLogin', () => ({ redirectToLogin: vi.fn() }));
const fetchMock = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    for (const name of ['VITE_API_BASE_URL', 'VITE_API_URL', 'VITE_USER_SERVER_URL', 'VITE_EDITOR_SERVER_URL', 'VITE_IMAGE_SERVER_URL']) {
        vi.stubEnv(name, '');
    }
});

describe('browser CSRF', () => {
    const tokenResponse = () => new Response(JSON.stringify({ csrfToken: 'session-token' }));

    it('caches the token from the session check before the first write', async () => {
        const session = { status: 'success', data: { csrfToken: 'early-token' } };
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(session)))
            .mockResolvedValueOnce(new Response('{}'));
        setupApiClient();
        const response = await fetch('/api/v1/authenticated', { credentials: 'include', cache: 'no-store' });
        expect(await response.json()).toEqual(session);
        await fetch('/api/v1/save', { method: 'POST', credentials: 'include' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/save');
        expect(fetchMock.mock.calls[1][1].headers.get('X-CSRF-Token')).toBe('early-token');
    });

    it('replaces the cached token when the session check supplies a new session token', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { csrfToken: 'first' } })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { csrfToken: 'second' } })))
            .mockResolvedValueOnce(new Response('{}'));
        setupApiClient();
        await fetch('/api/v1/authenticated');
        await fetch('/api/v1/authenticated');
        await fetch('/auth/logout', { method: 'POST' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[2][1].headers.get('X-CSRF-Token')).toBe('second');
    });

    it.each(['{}', '{"data":null}', '{"data":{"csrfToken":""}}', 'invalid-json'])('rejects an incomplete session response: %s', async body => {
        fetchMock.mockResolvedValueOnce(new Response(body));
        setupApiClient();
        await expect(fetch('/api/v1/authenticated')).rejects.toThrow();
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('does not require browser CSRF data in a desktop session response', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: null })));
        setupApiClient(undefined, { csrf: false });
        expect((await fetch('/api/v1/authenticated')).ok).toBe(true);
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('protects %s and preserves multipart bodies, headers and signals', async method => {
        fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response(null, { status: 204 }));
        setupApiClient();
        const body = new FormData(); body.append('file', new Blob(['data']), 'file.txt');
        const signal = new AbortController().signal;
        await fetch('/api/v1/media/upload', { method, body, signal, credentials: 'include', headers: { 'X-Test': 'kept' } });
        expect(fetchMock.mock.calls[0]).toEqual([`${window.location.origin}/auth/csrf`, { credentials: 'include', cache: 'no-store', redirect: 'error' }]);
        const [path, init] = fetchMock.mock.calls[1];
        expect(path).toBe('/api/v1/media/upload');
        expect(init).toMatchObject({ method, body, signal, credentials: 'include', redirect: 'error' });
        expect(init.headers.get('X-Test')).toBe('kept');
        expect(init.headers.get('X-CSRF-Token')).toBe('session-token');
        expect(init.headers.has('Content-Type')).toBe(false);
    });

    it('preserves a Request body and init overrides', async () => {
        fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{}'));
        setupApiClient();
        const request = new Request(new URL('/api/v2/editor/save', window.location.href), { method: 'POST', body: 'data', headers: { 'X-Original': 'discarded' } });
        await fetch(request, { method: 'PUT', headers: { 'X-Override': 'kept' } });
        const [input, init] = fetchMock.mock.calls[1];
        expect(input).toBe(request);
        expect(await request.text()).toBe('data');
        expect(init.method).toBe('PUT');
        expect(init.headers.get('X-Original')).toBeNull();
        expect(init.headers.get('X-Override')).toBe('kept');
        expect(init.headers.get('X-CSRF-Token')).toBe('session-token');
    });

    it('shares bootstrap across concurrent writes', async () => {
        fetchMock.mockResolvedValueOnce(tokenResponse()).mockImplementation(async () => new Response('{}'));
        setupApiClient();
        await Promise.all([fetch('/api/v1/save', { method: 'POST' }), fetch('/api/v2/save', { method: 'PUT' })]);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls.slice(1).every(([, init]) => init.headers.get('X-CSRF-Token') === 'session-token')).toBe(true);
    });

    it.each([401, 403, 503])('does not submit a write when bootstrap returns %s', async status => {
        const response = new Response('{}', { status });
        fetchMock.mockResolvedValueOnce(response);
        setupApiClient();
        expect((await fetch('/api/v1/save', { method: 'POST' })).status).toBe(status);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(redirectToLogin).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    });

    it('does not replay a forbidden write and refreshes the token on explicit retry', async () => {
        fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{}', { status: 403 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'new-session-token' }))).mockResolvedValueOnce(new Response('{}'));
        setupApiClient();
        expect((await fetch('/api/v1/save', { method: 'POST' })).status).toBe(403);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await fetch('/api/v1/save', { method: 'POST' });
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(fetchMock.mock.calls[3][1].headers.get('X-CSRF-Token')).toBe('new-session-token');
        expect(redirectToLogin).not.toHaveBeenCalled();
    });

    it('gives concurrent callers independently readable bootstrap failures', async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'AUTH_UNAVAILABLE' }), { status: 503 }));
        setupApiClient();
        const responses = await Promise.all([fetch('/api/v1/one', { method: 'POST' }), fetch('/api/v1/two', { method: 'PUT' })]);
        expect(await Promise.all(responses.map(response => response.json()))).toEqual([{ code: 'AUTH_UNAVAILABLE' }, { code: 'AUTH_UNAVAILABLE' }]);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('never sends a write aborted during bootstrap', async () => {
        const controller = new AbortController();
        fetchMock.mockImplementationOnce(async () => { controller.abort(); return tokenResponse(); });
        setupApiClient();
        await expect(fetch('/api/v1/save', { method: 'POST', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each([
        ['/api/v1/read', {}],
        ['/api/v1/write', { method: 'POST', credentials: 'omit' }],
        ['/api/v1/write', { method: 'POST', headers: { Authorization: 'Bearer native' } }],
        ['https://outside.example/upload', { method: 'POST' }],
        ['/wails/runtime', { method: 'POST' }],
    ])('does not bootstrap or leak tokens for %s with %j', async (path, init) => {
        fetchMock.mockResolvedValueOnce(new Response('{}'));
        setupApiClient();
        await fetch(path, init as RequestInit);
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(path, init);
    });

    it('protects configured media uploads on an exact backend origin', async () => {
        vi.stubEnv('VITE_IMAGE_SERVER_URL', 'https://media.example.com/api/v1');
        fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response('{}'));
        setupApiClient();
        await fetch('https://media.example.com/api/v1/upload', { method: 'POST', credentials: 'include' });
        expect(fetchMock.mock.calls[0][0]).toBe('https://media.example.com/auth/csrf');
        expect(fetchMock.mock.calls[1][1].headers.get('X-CSRF-Token')).toBe('session-token');
    });

    it('protects POST logout', async () => {
        fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response(JSON.stringify({ redirect: '/' })));
        setupApiClient();
        await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
        expect(fetchMock.mock.calls[1][1].headers.get('X-CSRF-Token')).toBe('session-token');
    });

    it('keeps desktop writes on native authentication without CSRF bootstrap', async () => {
        fetchMock.mockResolvedValueOnce(new Response('{}'));
        setupApiClient(undefined, { csrf: false });
        await fetch('/api/v1/save', { method: 'POST' });
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/v1/save', { method: 'POST' });
    });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('application API authentication', () => {
    it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])('redirects on %s 401 and preserves the response and request options', async method => {
        const response = new Response(null, { status: 401 });
        fetchMock.mockResolvedValue(response);
        setupApiClient(undefined, { csrf: false });
        const init = { method, credentials: 'include' as const, headers: { 'X-Test': 'value' }, signal: new AbortController().signal };
        expect(await fetch('/api/v1/notifications', init)).toBe(response);
        expect(fetchMock).toHaveBeenCalledWith('/api/v1/notifications', init);
        expect(redirectToLogin).toHaveBeenCalledTimes(1);
        await expect(fetch('/api/v1/notifications')).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([200, 400, 403, 404, 409, 429, 500, 503])('preserves HTTP %s without redirecting or blocking requests', async status => {
        const response = new Response('{}', { status });
        fetchMock.mockResolvedValue(response);
        setupApiClient(undefined, { csrf: false });
        expect(await fetch('/api/v1/space')).toBe(response);
        await fetch('/api/v1/profile/details');
        expect(redirectToLogin).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['VITE_API_BASE_URL', 'VITE_API_URL', 'VITE_USER_SERVER_URL', 'VITE_EDITOR_SERVER_URL'])('covers a separate backend configured by %s', async name => {
        vi.stubEnv(name, 'https://backend.example.com/service/');
        fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
        setupApiClient(undefined, { csrf: false });
        await fetch('https://backend.example.com/service/notifications');
        expect(redirectToLogin).toHaveBeenCalledOnce();
    });

    it.each([
        'https://images.example.com/private.png',
        'https://backend.example.com/service-other/data',
        'https://backend.example.com.evil.test/service/data',
        '/wails/runtime',
    ])('does not treat %s as an application API', async path => {
        vi.stubEnv('VITE_API_URL', 'https://backend.example.com/service');
        fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
        setupApiClient(undefined, { csrf: false });
        await fetch(path);
        await fetch(path);
        expect(redirectToLogin).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['url', 'request'])('handles %s inputs', async kind => {
        fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
        setupApiClient(undefined, { csrf: false });
        const url = new URL('/api/v1/notifications', window.location.href);
        const input = kind === 'url' ? url : new Request(url);
        await fetch(input);
        expect(fetchMock).toHaveBeenCalledWith(input, undefined);
        expect(redirectToLogin).toHaveBeenCalledOnce();
    });

    it('redirects only once for concurrent unauthorized responses', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
        setupApiClient(undefined, { csrf: false });
        await Promise.all([fetch('/api/v1/profile/details'), fetch('/api/v1/notifications')]);
        expect(redirectToLogin).toHaveBeenCalledOnce();
    });

    it('preserves network errors and permits retry', async () => {
        const error = new TypeError('offline');
        fetchMock.mockRejectedValueOnce(error).mockResolvedValueOnce(new Response('{}'));
        setupApiClient(undefined, { csrf: false });
        await expect(fetch('/api/v1/notifications')).rejects.toBe(error);
        expect((await fetch('/api/v1/notifications')).ok).toBe(true);
        expect(redirectToLogin).not.toHaveBeenCalled();
    });

    it.each(['init', 'request'])('ignores a late 401 for an aborted %s signal', async kind => {
        const controller = new AbortController();
        fetchMock.mockImplementation(async () => {
            controller.abort();
            return new Response(null, { status: 401 });
        });
        setupApiClient(undefined, { csrf: false });
        if (kind === 'init') {
            await fetch('/api/v1/notifications', { signal: controller.signal });
        } else {
            await fetch(new Request(new URL('/api/v1/notifications', window.location.href), { signal: controller.signal }));
        }
        expect(redirectToLogin).not.toHaveBeenCalled();
    });

    it('allows native IPC during session expiry and resumes API calls after desktop sign-in', async () => {
        const onUnauthorized = vi.fn();
        fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
        const resetAuthentication = setupApiClient(onUnauthorized, { csrf: false });
        await fetch('/api/v1/notifications');
        await expect(fetch('/api/v1/notifications')).rejects.toMatchObject({ name: 'AbortError' });
        await fetch('/wails/runtime', { method: 'POST' });
        expect(onUnauthorized).toHaveBeenCalledOnce();
        expect(redirectToLogin).not.toHaveBeenCalled();
        resetAuthentication();
        fetchMock.mockResolvedValue(new Response('{}'));
        expect((await fetch('/api/v1/notifications')).ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });
});

describe('shared API hooks', () => {
    it.each([
        ['GET', () => useGet<unknown>('notifications')],
        ['POST', () => usePost<unknown, Record<string, unknown>>('notifications')],
        ['PUT', () => usePut<unknown, Record<string, unknown>>('notifications')],
        ['DELETE', () => useDelete<unknown, Record<string, unknown>>('notifications')],
    ] as const)('%s uses the application authentication handler', async (_method, useRequest) => {
        fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
        setupApiClient(undefined, { csrf: false });
        const { result } = renderHook(useRequest);
        await act(async () => { result.current[1]({}); });
        expect(redirectToLogin).toHaveBeenCalledOnce();
    });
});
