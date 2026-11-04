import { expect, it } from 'vitest';
import { htmlPreview } from '../../../../packages/editor/src/components/codeblock/codeBlockUtils';

it('sanitizes active markup and navigation while preserving passive HTML previews', () => {
    const result = htmlPreview(`<h1>Hello</h1><p>Preview</p><script>alert(1)</script><img src=x onerror=alert(2)><meta http-equiv=refresh content="0;url=https://evil.example"><iframe src="https://evil.example"></iframe><form action="https://evil.example"><input autofocus></form><svg onload=alert(3)></svg>`);
    const doc = new DOMParser().parseFromString(result, 'text/html');
    expect(doc.querySelector('h1')?.textContent).toBe('Hello');
    expect(doc.querySelectorAll('script,iframe,form,input,svg,[onerror],[onload],meta[http-equiv=refresh]').length).toBe(0);
    expect(doc.querySelector('meta[http-equiv=Content-Security-Policy]')?.getAttribute('content')).toContain("script-src 'none'");
});
