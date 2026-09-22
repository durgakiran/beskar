import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import AuthGuard from './AuthGuard';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderGuard() {
  render(<MemoryRouter><AuthGuard><div>Protected workspace</div></AuthGuard></MemoryRouter>);
}

it.each([403, 500, 503])('does not authorize or redirect on HTTP %s', async status => {
  const location = { href: '' };
  vi.stubGlobal('window', new Proxy(window, {
    get(target, property) { return property === 'location' ? location : Reflect.get(target, property); },
  }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
  renderGuard();
  await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByText('Protected workspace')).toBeNull();
  expect(location.href).toBe('');
});

it('recovers from a validation outage without forcing a new login', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  renderGuard();
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  await screen.findByText('Protected workspace');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('shows a retry state on a network error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  renderGuard();
  await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByText('Protected workspace')).toBeNull();
});
