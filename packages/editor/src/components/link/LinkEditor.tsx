import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { normalizeHyperlink } from '../../utils/hyperlink';
import { posToDOMRect, type Editor } from '@tiptap/core';
import { TextSelection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state';
import * as Popover from '@radix-ui/react-popover';
import { FiCheck, FiLink, FiX } from 'react-icons/fi';
import { LuUnlink } from 'react-icons/lu';

const OPEN_LINK_EDITOR = 'beskar:edit-link';

export function openLinkEditor(editor: Editor) {
  editor.view.dom.dispatchEvent(new Event(OPEN_LINK_EDITOR));
}

/** Owned by Editor so keyboard linking also works without a formatting toolbar. */
export function LinkEditor({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const bookmark = useRef<SelectionBookmark | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(true);
  const anchor = useMemo(() => ({ current: {
    getBoundingClientRect: () => {
      if (editor.isDestroyed) return new DOMRect();
      const selection = bookmark.current?.resolve(editor.state.doc) ?? editor.state.selection;
      return posToDOMRect(editor.view, selection.from, selection.to);
    },
  } }), [editor]);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    const show = () => {
      const { selection, schema } = editor.state;
      if (!editor.isEditable || !schema.marks.link || !(selection instanceof TextSelection) ||
          !selection.$from.parent.type.allowsMarkType(schema.marks.link)) return false;
      const currentHref = editor.getAttributes('link').href as string | undefined;
      if (currentHref) editor.commands.extendMarkRange('link');
      bookmark.current = editor.state.selection.getBookmark();
      setHref(currentHref ?? '');
      setEditing(Boolean(currentHref));
      setError('');
      restoreFocus.current = true;
      setOpen(true);
      return true;
    };
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey &&
          event.key.toLowerCase() === 'k' && show()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const request = () => { show(); };
    const mapSelection = ({ transaction }: { transaction: Transaction }) => {
      if (bookmark.current) bookmark.current = bookmark.current.map(transaction.mapping);
      if (!editor.isEditable) setOpen(false);
    };
    const dom = editor.view.dom;
    dom.addEventListener('keydown', keydown, true);
    dom.addEventListener(OPEN_LINK_EDITOR, request);
    editor.on('transaction', mapSelection);
    return () => {
      dom.removeEventListener('keydown', keydown, true);
      dom.removeEventListener(OPEN_LINK_EDITOR, request);
      editor.off('transaction', mapSelection);
    };
  }, [editor]);

  const apply = (remove = false) => {
    if (!editor.isEditable || !bookmark.current) return;
    const normalized = remove ? '' : normalizeHyperlink(href);
    if (normalized === null) {
      setError('Enter a valid web address, email link, or phone link.');
      return;
    }
    const selection = bookmark.current.resolve(editor.state.doc);
    const chain = editor.chain().command(({ tr }) => {
      tr.setSelection(selection);
      return true;
    });
    const success = remove ? chain.unsetLink().run() : selection.empty
      ? chain.insertContent({ type: 'text', text: normalized, marks: [{ type: 'link', attrs: { href: normalized } }] }).run()
      : chain.setLink({ href: normalized }).run();
    if (success) setOpen(false);
    else setError('A link cannot be applied to this selection.');
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal container={editor.view.dom.closest('.beskar-editor')}>
        <Popover.Content className="hyperlink-popover" side="bottom" align="start" sideOffset={8}
          collisionPadding={12} updatePositionStrategy="always"
          aria-label={editing ? 'Edit link' : 'Add link'}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
            inputRef.current?.select();
          }}
          onInteractOutside={() => { restoreFocus.current = false; }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            bookmark.current = null;
            if (restoreFocus.current && !editor.isDestroyed) editor.commands.focus();
          }}>
          <form onSubmit={(event) => { event.preventDefault(); apply(); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
            }}>
            <div className="hyperlink-popover-row">
              <FiLink aria-hidden="true" className="hyperlink-popover-icon" />
              <input ref={inputRef} id={inputId} aria-label="Link URL" type="text"
                value={href} placeholder="Paste or type a link" autoComplete="off" spellCheck={false}
                onChange={(event) => { setHref(event.target.value); setError(''); }}
                aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} />
              <button type="submit" className="hyperlink-popover-confirm" disabled={!href.trim()}
                aria-label={editing ? 'Save link' : 'Add link'} title="Apply link (Enter)"><FiCheck /></button>
              {editing && <button type="button" aria-label="Remove link" title="Remove link"
                onClick={() => apply(true)}><LuUnlink /></button>}
              <button type="button" aria-label="Cancel" title="Cancel (Esc)"
                onClick={() => setOpen(false)}><FiX /></button>
            </div>
            {error && <p id={errorId} role="alert" className="hyperlink-popover-error">{error}</p>}
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
