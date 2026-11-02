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
    for (const name of ['VITE_API_BASE_URL', 'VITE_API_URL', 'VITE_USER_SERVER_URL', 'VITE_EDITOR_SERVER_URL']) {
        vi.stubEnv(name, '');
    }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('application API authentication', () => {
    it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])('redirects on %s 401 and preserves the response and request options', async method => {
        const response = new Response(null, { status: 401 });
        fetchMock.mockResolvedValue(response);
        setupApiClient();
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
        setupApiClient();
        expect(await fetch('/api/v1/space')).toBe(response);
        await fetch('/api/v1/profile/details');
        expect(redirectToLogin).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['VITE_API_BASE_URL', 'VITE_API_URL', 'VITE_USER_SERVER_URL', 'VITE_EDITOR_SERVER_URL'])('covers a separate backend configured by %s', async name => {
        vi.stubEnv(name, 'https://backend.example.com/service/');
        fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
        setupApiClient();
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
        setupApiClient();
        await fetch(path);
        await fetch(path);
        expect(redirectToLogin).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['url', 'request'])('handles %s inputs', async kind => {
        fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
        setupApiClient();
        const url = new URL('/api/v1/notifications', window.location.href);
        const input = kind === 'url' ? url : new Request(url);
        await fetch(input);
        expect(fetchMock).toHaveBeenCalledWith(input, undefined);
        expect(redirectToLogin).toHaveBeenCalledOnce();
    });

    it('redirects only once for concurrent unauthorized responses', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
        setupApiClient();
        await Promise.all([fetch('/api/v1/profile/details'), fetch('/api/v1/notifications')]);
        expect(redirectToLogin).toHaveBeenCalledOnce();
    });

    it('preserves network errors and permits retry', async () => {
        const error = new TypeError('offline');
        fetchMock.mockRejectedValueOnce(error).mockResolvedValueOnce(new Response('{}'));
        setupApiClient();
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
        setupApiClient();
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
        const resetAuthentication = setupApiClient(onUnauthorized);
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
        setupApiClient();
        const { result } = renderHook(useRequest);
        await act(async () => { result.current[1]({}); });
        expect(redirectToLogin).toHaveBeenCalledOnce();
    });
});
