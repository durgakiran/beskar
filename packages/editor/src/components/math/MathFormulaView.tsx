import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import * as Popover from '@radix-ui/react-popover';
import { highlightMath, renderMath } from './mathRendering';
import 'katex/dist/katex.min.css';

/** Shared block/inline source editor. Persist once on close, preview every keystroke. */
export function MathFormulaView({ node, editor, updateAttributes, selected, inline = false }: NodeViewProps & { inline?: boolean }) {
  const saved = String(node.attrs.latex ?? '');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(saved);
  const baseline = useRef(saved);
  const autoOpened = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const highlight = useRef<HTMLPreElement>(null);
  const source = open && editor.isEditable ? draft : saved;
  const rendered = useMemo(() => renderMath(source, !inline && node.attrs.displayMode !== false, !inline), [source, inline, node.attrs.displayMode]);
  const tokens = useMemo(() => highlightMath(draft), [draft]);

  function changeOpen(next: boolean) {
    if (next) {
      if (!editor.isEditable) return;
      baseline.current = saved;
      setDraft(saved);
    } else if (open && editor.isEditable && draft !== baseline.current) {
      updateAttributes({ latex: draft });
    }
    setOpen(next);
  }

  useEffect(() => {
    if (selected && !saved && editor.isEditable && !autoOpened.current) {
      autoOpened.current = true;
      baseline.current = saved;
      setDraft(saved);
      setOpen(true);
    }
  }, [selected, saved, editor]);

  const preview = <span className="math-preview-content">
    {rendered.error ? <span className="math-placeholder math-error" title={rendered.error}>Invalid equation</span>
      : !source.trim() ? <span className="math-placeholder">Equation</span>
      : <span className="math-typeset" dangerouslySetInnerHTML={{ __html: rendered.html }} />}
  </span>;
  const wrapper = inline ? 'inline-math-wrapper' : 'math-block';
  const portalContainer = editor.view.dom.closest<HTMLElement>('.beskar-editor') ?? undefined;

  return <NodeViewWrapper as={inline ? 'span' : 'div'} className={`${wrapper}${selected && editor.isEditable ? ' ProseMirror-selectednode' : ''}`} contentEditable={false}>
    <Popover.Root open={open && editor.isEditable} onOpenChange={changeOpen}>
      <Popover.Anchor asChild>
        <span className={inline ? 'inline-math-display' : 'math-block-content'}>
          <span className="math-scroll" tabIndex={0} role="region" aria-label={inline ? 'Inline equation' : 'Block equation'}>
            <span className="math-preview" role={editor.isEditable ? 'button' : undefined}
              tabIndex={editor.isEditable ? 0 : undefined} aria-label={editor.isEditable ? 'Edit equation' : undefined}
              aria-haspopup={editor.isEditable ? 'dialog' : undefined} aria-expanded={editor.isEditable ? open : undefined}
              onClick={() => changeOpen(true)} onKeyDown={event => {
                if (editor.isEditable && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault(); event.stopPropagation(); changeOpen(true);
                }
              }}>{preview}</span>
          </span>
        </span>
      </Popover.Anchor>
      <Popover.Portal container={portalContainer}>
        <Popover.Content className="math-editor-popover" side="bottom" align="start" sideOffset={8} collisionPadding={12}
          aria-label="Edit LaTeX equation" onOpenAutoFocus={event => {
            event.preventDefault(); textarea.current?.focus();
            textarea.current?.setSelectionRange(draft.length, draft.length);
          }} onCloseAutoFocus={event => { event.preventDefault(); }}
          onKeyDown={event => event.stopPropagation()}>
          <label className="math-editor-label">LaTeX equation
            <span className="math-source-editor">
              <pre className="math-source-highlight" aria-hidden="true" ref={highlight}>{tokens.map((token, index) =>
                <span key={index} className={`math-token-${token.kind}`}>{token.text}</span>)}{'\n'}</pre>
              <textarea ref={textarea} className="math-source-input" value={draft} rows={Math.min(14, Math.max(3, draft.split('\n').length + 1))}
                spellCheck={false} autoCapitalize="off" autoComplete="off" wrap="off"
                onChange={event => setDraft(event.target.value)}
                onScroll={event => { if (highlight.current) { highlight.current.scrollTop = event.currentTarget.scrollTop; highlight.current.scrollLeft = event.currentTarget.scrollLeft; } }}
                onKeyDown={event => {
                  event.stopPropagation();
                  if (event.nativeEvent.isComposing) return;
                  if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape') {
                    event.preventDefault(); changeOpen(false);
                  }
                }} />
            </span>
          </label>
          {rendered.error && <div className="math-editor-error" role="status">{rendered.error}</div>}
          {saved !== baseline.current && <div className="math-editor-hint" role="status">Equation changed elsewhere. Saving your edits will replace that change.</div>}
          <div className="math-editor-footer"><span className="math-editor-hint">Shift+Enter for a new line · Enter or Esc to save</span>
            <button type="button" className="math-editor-done" onClick={() => changeOpen(false)}>Done</button></div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </NodeViewWrapper>;
}
