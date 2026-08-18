import { Editor } from '@tiptap/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { CanvasTextView } from './CanvasTextView.js';
import { createCanvasTextExtensions } from './extensions.js';

describe('CanvasTextView', () => {
  it('renders supported content without mounting an editor', () => {
    const { container } = render(<CanvasTextView value={{
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        ],
      }],
    }} />);

    expect(screen.getByText('Bold').tagName).toBe('STRONG');
    expect(screen.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(container.querySelector('.ProseMirror')).toBeNull();
  });

  it('uses plain-text fallback for an unsupported document', () => {
    render(<CanvasTextView value={{ type: 'doc', content: [{ type: 'image' }] }} fallbackText="Fallback" />);
    expect(screen.getByText('Fallback')).toBeTruthy();
  });

  it('requires a modifier when configured for explicit canvas link activation', () => {
    render(<CanvasTextView linkActivation="modified-click" value={{
      type: 'doc', content: [{ type: 'paragraph', content: [{
        type: 'text', text: 'Link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
      }] }],
    }} />);
    const link = screen.getByRole('link');
    expect(fireEvent.click(link)).toBe(false);
    expect(link.closest('[data-link-activation]')?.getAttribute('data-link-activation')).toBe('modified-click');
  });

  it('renders 1,000 static documents without creating editor instances', () => {
    const value = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Static' }] }] };
    const { container } = render(<>{Array.from({ length: 1_000 }, (_, index) => (
      <CanvasTextView key={index} value={value} />
    ))}</>);

    expect(container.querySelectorAll('.canvas-text-view')).toHaveLength(1_000);
    expect(container.querySelector('.ProseMirror')).toBeNull();
  });

  it('repaints directly from a shared fragment while preserving the static fallback', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('shape:text-1');
    const editor = new Editor({ extensions: createCanvasTextExtensions({ fragment }) });
    const { container } = render(<CanvasTextView
      value={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fallback' }] }] }}
      fragment={fragment}
    />);

    expect(screen.getByText('Fallback')).toBeTruthy();
    act(() => editor.commands.setContent('<p>Live text</p>'));
    expect(screen.getByText('Live text')).toBeTruthy();
    expect(container.querySelector('.ProseMirror')).toBeNull();

    editor.destroy();
    doc.destroy();
  });
});
