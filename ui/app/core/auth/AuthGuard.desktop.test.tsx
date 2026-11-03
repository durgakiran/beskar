import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AuthGuard from './AuthGuard.desktop';

const native = vi.hoisted(() => ({
  login: vi.fn(), status: vi.fn(), diagnostic: vi.fn(), events: new Map<string, () => void>(),
}));
vi.mock('../../../wailsjs/beskar/desktop/auth/uiauthservice', () => ({
  Login: native.login, IsAuthenticated: native.status, GetStatus: native.diagnostic,
}));
vi.mock('@wailsio/runtime', () => ({ Events: { On: (name: string, callback: () => void) => {
  native.events.set(name, callback);
  return () => native.events.delete(name);
} } }));

function pendingRequest() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  const cancel = vi.fn(() => reject(new Error('cancelled')));
  return { promise: Object.assign(promise, { cancel }), resolve, reject, cancel };
}

async function setup() {
  const view = render(<MemoryRouter><AuthGuard><p>Workspace</p></AuthGuard></MemoryRouter>);
  await screen.findByRole('button', { name: 'Sign In' });
  return view;
}

beforeEach(() => {
  native.login.mockReset(); native.status.mockReset(); native.status.mockResolvedValue(false);
  native.diagnostic.mockReset(); native.diagnostic.mockResolvedValue({ code: '', message: '', requiresSignIn: false, localSignedOut: false, revocation: 'not_requested' });
 native.events.clear();
});
afterEach(cleanup);

it('cancels the native call and allows retry without stale errors', async () => {
  const first = pendingRequest(); const second = pendingRequest();
  native.login.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  expect(screen.getByRole('button', { name: /Waiting for browser/ }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  await act(async () => {});
  expect(first.cancel).toHaveBeenCalledOnce();
  expect(screen.queryByText(/Sign-in failed/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeTruthy();
});

it.each(['login timed out; please retry', 'login was denied or cancelled in the browser'])(
  'shows %s and restores the sign-in button', async (message) => {
    const request = pendingRequest(); native.login.mockReturnValue(request.promise);
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await act(async () => request.reject(new Error(message)));
    expect(screen.getByText(`Sign-in failed: Error: ${message}`)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign In' }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Cancel sign-in' })).toBeNull();
  }
);

it('cancels a pending login on unmount', async () => {
  const request = pendingRequest(); native.login.mockReturnValue(request.promise);
  const view = await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  view.unmount();
  await act(async () => {});
  expect(request.cancel).toHaveBeenCalledOnce();
});

it('shows the workspace after the native authentication event', async () => {
  const request = pendingRequest(); native.login.mockReturnValue(request.promise);
  await setup();
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  native.status.mockResolvedValue(true);
 await act(async () => { native.events.get('auth:ready')?.(); request.resolve(); });
  expect(screen.getByText('Workspace')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Cancel sign-in' })).toBeNull();
});


it('shows a credential loading failure that happened before the UI subscribed', async () => {
  native.diagnostic.mockResolvedValue({ code: 'credential_load_failed', message: 'Unable to load saved credentials. Check your operating system credential store and sign in again.', requiresSignIn: true });
  await setup();
  expect(screen.getByRole('alert').textContent).toContain('Unable to load saved credentials');
});

it('shows an ambiguous renewal failure and returns to sign-in', async () => {
  native.status.mockResolvedValue(true);
  render(<MemoryRouter><AuthGuard><p>Workspace</p></AuthGuard></MemoryRouter>);
  await screen.findByText('Workspace');
  native.status.mockResolvedValue(false);
  native.diagnostic.mockResolvedValue({ code: 'refresh_uncertain', message: 'Token renewal could not be confirmed. Sign in again; the previous refresh token will not be retried.', requiresSignIn: true });
  await act(async () => { native.events.get('auth:status')?.(); });
  expect(screen.getByRole('alert').textContent).toContain('previous refresh token will not be retried');
  expect(screen.queryByText('Workspace')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
});

it('keeps the workspace usable during an explicitly rejected temporary renewal', async () => {
  native.status.mockResolvedValue(true);
  native.diagnostic.mockResolvedValue({ code: 'provider_unavailable', message: 'The identity provider is temporarily unavailable. Renewal will retry shortly.', requiresSignIn: false });
  render(<MemoryRouter><AuthGuard><p>Workspace</p></AuthGuard></MemoryRouter>);
  await screen.findByText('Workspace');
  expect(screen.getByRole('alert').textContent).toContain('Renewal will retry shortly');
});

it('shows local sign-out separately from unconfirmed provider revocation', async () => {
  native.diagnostic.mockResolvedValue({ code: 'revocation_unconfirmed', message: 'Signed out locally. The identity provider could not confirm token revocation; those tokens may remain valid until they expire.', requiresSignIn: true, localSignedOut: true, revocation: 'unconfirmed' });
  await setup();
  expect(screen.getByRole('alert').textContent).toContain('Signed out locally');
  expect(screen.getByRole('alert').textContent).toContain('could not confirm token revocation');
});

it('does not overwrite a new status with a stale status response', async () => {
  let oldStatus!: (value: unknown) => void;
  native.diagnostic.mockImplementationOnce(() => new Promise(resolve => { oldStatus = resolve; }));
  render(<MemoryRouter><AuthGuard><p>Workspace</p></AuthGuard></MemoryRouter>);
  native.diagnostic.mockResolvedValue({ message: 'New failure', requiresSignIn: true });
  await act(async () => { native.events.get('auth:status')?.(); });
  await act(async () => { oldStatus({ message: 'Old failure', requiresSignIn: true }); });
  expect(screen.getByRole('alert').textContent).toBe('New failure');
});

it.each([
  ['credential_migration_required', 'Credential storage has been upgraded. Sign in again; the previous shared credentials were removed.'],
  ['credential_context_mismatch', 'Saved credentials do not match this app, server or account. Sign in again.'],
])('shows the %s notice without restoring the old workspace', async (code, message) => {
  native.diagnostic.mockResolvedValue({ code, message, requiresSignIn: true });
  await setup();
  expect(screen.getByRole('alert').textContent).toBe(message);
  expect(screen.queryByText('Workspace')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
});
