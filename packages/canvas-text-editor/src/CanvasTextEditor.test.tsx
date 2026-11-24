import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Doc } from 'yjs';
import { CanvasTextEditor } from './CanvasTextEditor.js';
import { createCanvasRichTextDocument } from './model.js';

describe('CanvasTextEditor', () => {
  it('mounts a compact editor and isolates escape from the canvas', async () => {
    const onCancel = vi.fn();
    const parentKeyDown = vi.fn();
    const { container } = render(
      <div onKeyDown={parentKeyDown}>
        <CanvasTextEditor value={createCanvasRichTextDocument('Edit me')} onCancel={onCancel} />
      </div>,
    );

    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy());
    expect(screen.getByRole('toolbar', { name: 'Text formatting' })).toBeTruthy();
    fireEvent.keyDown(container.querySelector('.ProseMirror') as Element, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('opens the built-in link bubble', async () => {
    render(<CanvasTextEditor value={createCanvasRichTextDocument('Link me')} />);

    await screen.findByRole('toolbar', { name: 'Text formatting' });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByRole('textbox', { name: 'Link URL' })).toBeTruthy();
  });

  it('opens pasted formatted text in a fresh collaboration fragment and reuses it on reopen', async () => {
    const fragment = new Doc().getXmlFragment('pasted-note');
    const value = createCanvasRichTextDocument('One session per teacher.');
    const formatted = {
      ...value,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'One session per teacher.', marks: [{ type: 'bold' }] },
      ] }] },
    };
    const renderNote = (snapshot: unknown) => render(
      <CanvasTextEditor value={snapshot} collaboration={{ fragment }} syncExternalValue={false} />,
    );
    const view = renderNote(formatted);
    await waitFor(() => expect(screen.getByRole('textbox').querySelector('strong')?.textContent)
      .toBe('One session per teacher.'));
    expect(fragment.length).toBe(1);
    view.unmount();

    renderNote(createCanvasRichTextDocument('Stale snapshot'));
    await waitFor(() => expect(screen.getByRole('textbox').textContent).toBe('One session per teacher.'));
  });

  it('does not replay live host value echoes into the active editor', async () => {
    const view = render(
      <CanvasTextEditor value={createCanvasRichTextDocument('Local draft')} syncExternalValue={false} />,
    );
    await waitFor(() => expect(screen.getByRole('textbox').textContent).toContain('Local draft'));

    view.rerender(
      <CanvasTextEditor value={createCanvasRichTextDocument('Published echo')} syncExternalValue={false} />,
    );
    expect(screen.getByRole('textbox').textContent).toContain('Local draft');
    expect(screen.getByRole('textbox').textContent).not.toContain('Published echo');
  });
});
