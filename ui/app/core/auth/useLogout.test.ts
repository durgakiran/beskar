import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLogout } from './useLogout';
import { setupApiClient } from '../http/setupApiClient';

const location = { href: 'https://app.example.com/space', origin: 'https://app.example.com' };
const request = vi.fn();

beforeEach(() => {
    request.mockReset();
    location.href = 'https://app.example.com/space';
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('window', new Proxy(window, {
        get(target, property) { return property === 'location' ? location : Reflect.get(target, property); },
    }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('posts a CSRF-protected logout before navigating to provider logout', async () => {
    request.mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'token' })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ redirect: 'https://identity.example.com/logout' })));
    setupApiClient();
    const { result } = renderHook(useLogout);
    await act(async () => { await result.current.logout(); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toBe('/auth/logout');
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'include', redirect: 'error' });
    expect(request.mock.calls[1][1].headers.get('X-CSRF-Token')).toBe('token');
    expect(location.href).toBe('https://identity.example.com/logout');
    expect(result.current.error).toBeNull();
});

it('keeps the page on logout failure and allows an explicit retry', async () => {
    request.mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ redirect: '/' })));
    const { result } = renderHook(useLogout);
    await act(async () => { await result.current.logout(); });
    expect(result.current.error).toContain('Please try again');
    expect(location.href).toBe('https://app.example.com/space');
    await act(async () => { await result.current.logout(); });
    expect(result.current.error).toBeNull();
    expect(location.href).toBe('https://app.example.com/');
});

it('rejects an unsafe logout destination', async () => {
    request.mockResolvedValueOnce(new Response(JSON.stringify({ redirect: 'javascript:alert(1)' })));
    const { result } = renderHook(useLogout);
    await act(async () => { await result.current.logout(); });
    expect(result.current.error).toContain('Unable to sign out');
    expect(location.href).toBe('https://app.example.com/space');
});
