import { describe, expect, it, vi } from 'vitest';
vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: vi.fn() } }));
import { externalBrowserURL } from './navigation';

describe('desktop external navigation', () => {
    it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,test',
        'teddox://callback?code=bad', 'https://user:secret@example.com',
        'http://127.0.0.1:1234/capability', 'http://localhost:1234/', 'http://[::1]/'])('blocks %s', url => {
        expect(externalBrowserURL(url)).toBeUndefined();
    });
    it('allows normal public HTTPS document links', () => {
        expect(externalBrowserURL('https://example.com/doc')).toBe('https://example.com/doc');
    });
});
