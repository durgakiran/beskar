import {
  CanvasRichTextValidationError,
  createCanvasRichTextDocument,
  normalizeCanvasRichText,
  normalizeExternalUrl,
  projectCanvasRichTextToPlainText,
  serializeCanvasRichText,
} from './model.js';

describe('canvas rich-text model', () => {
  it('creates a normalized compatibility document', () => {
    const value = createCanvasRichTextDocument('Hello');
    expect(value).toMatchObject({
      format: 'beskar-canvas-rich-text',
      version: 1,
      profile: 'text',
      doc: { type: 'doc' },
    });
    expect(projectCanvasRichTextToPlainText(value)).toBe('Hello');
  });

  it('migrates legacy newlines exactly and serializes marks deterministically', () => {
    const legacy = createCanvasRichTextDocument('one\n\nthree\n');
    expect(projectCanvasRichTextToPlainText(legacy)).toBe('one\n\nthree\n');
    const first = serializeCanvasRichText({
      type: 'doc', content: [{ type: 'paragraph', content: [{
        type: 'text', text: 'ordered', marks: [{ type: 'italic' }, { type: 'bold' }, { type: 'bold' }],
      }] }],
    });
    expect(first).toBe(serializeCanvasRichText(JSON.parse(first)));
    expect(first.indexOf('bold')).toBeLessThan(first.indexOf('italic'));
  });

  it('normalizes supported marks and ordered list projection', () => {
    const value = normalizeCanvasRichText({
      type: 'doc',
      content: [{
        type: 'orderedList',
        attrs: { start: 3, ignored: true },
        content: [{
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Linked', marks: [{ type: 'link', attrs: { href: 'https://example.com/a' } }] }],
          }],
        }],
      }],
    });
    expect(value.doc.content?.[0].attrs).toEqual({ start: 3 });
    expect(value.doc.content?.[0].content?.[0].content?.[0].content?.[0].marks?.[0].attrs).toEqual({
      href: 'https://example.com/a',
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    });
    expect(projectCanvasRichTextToPlainText(value)).toBe('3. Linked');
  });

  it('rejects unsupported nodes, unsafe links, and oversized text', () => {
    expect(() => normalizeCanvasRichText({ type: 'doc', content: [{ type: 'heading' }] }))
      .toThrow(CanvasRichTextValidationError);
    expect(() => normalizeCanvasRichText({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }],
    })).toThrow('unsafe or unsupported URL');
    expect(() => normalizeCanvasRichText(createCanvasRichTextDocument('abcd'), { maxTextLength: 3 }))
      .toThrow('too long');
  });

  it('accepts only external safe URL protocols', () => {
    expect(normalizeExternalUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeExternalUrl('mailto:test@example.com')).toBe('mailto:test@example.com');
    expect(normalizeExternalUrl('/relative')).toBeNull();
    expect(normalizeExternalUrl('data:text/html,bad')).toBeNull();
  });
});
