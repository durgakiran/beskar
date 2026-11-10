import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './security-policy';

describe('production content policy', () => {
    it('restricts scripts, objects, forms and frames on both clients', () => {
        for (const desktop of [false, true]) {
            const policy = contentSecurityPolicy(desktop);
            expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
            expect(policy).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
            expect(policy).toContain("object-src 'none'");
            expect(policy).toContain("base-uri 'none'");
            const frames = policy.match(/frame-src ([^;]+)/)![1];
            expect(frames).not.toContain("'self'");
            expect(frames).not.toContain('127.0.0.1');
            expect(frames).toContain('https://www.youtube-nocookie.com');
        }
        expect(contentSecurityPolicy(false)).not.toContain('127.0.0.1');
    });
    it('includes only configured API and signaling origins without paths or credentials', () => {
        const policy = contentSecurityPolicy(false, { VITE_USER_SERVER_URL: 'https://api.example/api/v1' });
        expect(policy).toContain('https://api.example wss://api.example');
        expect(policy).not.toContain('/api/v1');
        expect(() => contentSecurityPolicy(false, { VITE_API_URL: 'https://user:secret@example.com' })).toThrow();
    });
});
