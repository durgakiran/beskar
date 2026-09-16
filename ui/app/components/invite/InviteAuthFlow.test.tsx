import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import AuthGuard from '../../core/auth/AuthGuard';
import AuthRedirect from '../../internal/AuthRedirect';
import { rememberInviteReturn } from './inviteReturn';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });

it('preserves the entire invitation URL when a signed-out visitor logs in', async () => {
    const location = { href: '' };
    vi.stubGlobal('window', new Proxy(window, {
        get(target, property) { return property === 'location' ? location : Reflect.get(target, property); },
    }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    render(<MemoryRouter initialEntries={['/invite/action?token=abc&decision=reject']}><AuthGuard><div>Protected invite</div></AuthGuard></MemoryRouter>);
    await waitFor(() => expect(location.href).toBe('/auth/login?returnTo=%2Finvite%2Faction%3Ftoken%3Dabc%26decision%3Dreject'));
    expect(screen.queryByText('Protected invite')).toBeNull();
});

it('returns to the invitation after logout and signing in as another account', async () => {
    rememberInviteReturn('/invite/action?token=abc&decision=accept');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    render(<MemoryRouter initialEntries={['/']}><Routes>
        <Route path="/" element={<AuthGuard><AuthRedirect /></AuthGuard>} />
        <Route path="/invite/action" element={<div>Returned to invitation</div>} />
    </Routes></MemoryRouter>);
    await screen.findByText('Returned to invitation');
    expect(sessionStorage.getItem('teddox.inviteReturn')).toBeNull();
});
