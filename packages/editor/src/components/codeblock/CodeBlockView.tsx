import React, { useEffect, useId, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import * as Popover from '@radix-ui/react-popover';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { FiChevronDown, FiCopy, FiMoreHorizontal } from 'react-icons/fi';
import { copyCodeText, filterLanguages, htmlPreview, languageLabel, normalizeLanguage } from './codeBlockUtils';

const RECENTS_KEY = 'beskar:code-languages';
function recentLanguages(): string[] {
  try { const value = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); return Array.isArray(value) ? value.filter(x => typeof x === 'string').slice(0, 5) : []; }
  catch { return []; }
}

export function CodeBlockView({ editor, node, getPos, updateAttributes, deleteNode }: NodeViewProps) {
  const [editable, setEditable] = useState(editor.isEditable);
  const root = useRef<HTMLDivElement>(null);
  const languageButton = useRef<HTMLButtonElement>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState(recentLanguages);
  const [status, setStatus] = useState('');
  const [captionOpen, setCaptionOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [preview, setPreview] = useState(false);
  const [readerOptions, setReaderOptions] = useState<Record<string, boolean>>({});
  const listId = useId();
  const captionId = useId();
  const language = normalizeLanguage(node.attrs.language);
  const matches = filterLanguages(query, recent);
  const option = (key: string) => !editable && key in readerOptions ? readerOptions[key] : !!node.attrs[key];
  const wrap = option('wrap');
  const lineNumbers = option('lineNumbers');
  const collapsed = option('collapsed');
  const canPreview = language === 'xml';
  const showPreview = canPreview && preview;
  const setOption = (key: string, value: boolean) => editor.isEditable ? updateAttributes({ [key]: value }) : setReaderOptions(old => ({ ...old, [key]: value }));

  useEffect(() => {
    // setEditable emits update without a transaction; watch both event types.
    const sync = () => setEditable(editor.isEditable);
    editor.on('update', sync);
    editor.on('transaction', sync);
    sync();
    return () => { editor.off('update', sync); editor.off('transaction', sync); };
  }, [editor]);

  useEffect(() => { if (!status) return; const timer = setTimeout(() => setStatus(''), 3000); return () => clearTimeout(timer); }, [status]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    root.current?.querySelector(`#${CSS.escape(listId)} [aria-selected="true"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);
  useEffect(() => {
    if (!editable) { setLanguageOpen(false); setCaptionOpen(false); }
  }, [editable]);
  useEffect(() => {
    const reveal = () => {
      const pos = getPos();
      if (editable && editor.isFocused && typeof pos === 'number' && editor.state.selection.from > pos && editor.state.selection.to < pos + node.nodeSize) {
        if (node.attrs.collapsed) updateAttributes({ collapsed: false });
        setPreview(false);
      }
    };
    editor.on('selectionUpdate', reveal);
    return () => { editor.off('selectionUpdate', reveal); };
  }, [editor, editable, getPos, node.nodeSize, node.attrs.collapsed, updateAttributes]);

  const chooseLanguage = (value: string) => {
    if (!editor.isEditable) return;
    updateAttributes({ language: value });
    const next = [value, ...recent.filter(l => l !== value)].slice(0, 5);
    setRecent(next);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* Storage is optional. */ }
    setLanguageOpen(false);
  };
  const copy = async () => {
    try { await copyCodeText(node.textContent); setStatus('Copied'); }
    catch { setStatus('Copy failed. Select the code and copy manually.'); }
  };
  const duplicate = () => {
    const pos = getPos();
    if (!editor.isEditable || typeof pos !== 'number') return;
    editor.chain().insertContentAt(pos + node.nodeSize, { ...node.toJSON(), attrs: { ...node.attrs, blockId: null } }).focus().run();
  };

  return <NodeViewWrapper ref={root} className={`code-block-wrapper code-block-view block-node${collapsed ? ' is-collapsed' : ''}${wrap ? ' is-wrapped' : ''}${lineNumbers ? ' has-line-numbers' : ''}`} data-block-id={node.attrs.blockId}>
    <div className="code-block-header" contentEditable={false} aria-label="Code block controls">
      <Popover.Root open={languageOpen && editable} onOpenChange={open => { setLanguageOpen(open); setQuery(''); setActive(0); setRecent(recentLanguages()); }}>
        <Popover.Trigger asChild><button ref={languageButton} type="button" className="code-block-control code-block-language" disabled={!editable} aria-label={`Code language: ${languageLabel(language)}`}>
          {languageLabel(language)}{editable && <FiChevronDown aria-hidden="true" />}
        </button></Popover.Trigger>
        <Popover.Portal container={root.current}><Popover.Content contentEditable={false} className="code-block-popover" sideOffset={6} collisionPadding={12} aria-label="Choose code language">
          <input className="code-block-input" role="combobox" aria-label="Search languages" aria-expanded="true" aria-controls={listId} aria-autocomplete="list" aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined} placeholder="Search languages…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(i => matches.length ? (i + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : 0); }
            if (event.key === 'Enter' && matches[active]) { event.preventDefault(); chooseLanguage(matches[active]); }
          }} />
          <div id={listId} role="listbox" aria-label="Languages" className="code-block-languages">
            {matches.map((value, i) => <button type="button" key={value} id={`${listId}-${i}`} role="option" aria-selected={i === active} tabIndex={-1} className="code-block-language-item" onMouseDown={e => e.preventDefault()} onClick={() => chooseLanguage(value)}>{languageLabel(value)}{value === language ? ' ✓' : recent.includes(value) ? ' · Recent' : ''}</button>)}
            {!matches.length && <div className="code-block-empty">No languages found</div>}
          </div>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
      <div className="code-block-actions">
        {canPreview && <button type="button" className="code-block-control" aria-pressed={showPreview} onClick={() => setPreview(!preview)}>{showPreview ? 'Code' : 'Preview'}</button>}
        <button type="button" className="code-block-control" onClick={copy} aria-label="Copy code"><FiCopy aria-hidden="true" />{status === 'Copied' ? 'Copied' : 'Copy'}</button>
        <button type="button" className="code-block-control" aria-expanded={!collapsed} onClick={() => setOption('collapsed', !collapsed)}>{collapsed ? 'Expand' : 'Collapse'}</button>
        <Menu.Root modal={false}><Menu.Trigger asChild><button type="button" className="code-block-control" aria-label="Code block options"><FiMoreHorizontal aria-hidden="true" /></button></Menu.Trigger>
          <Menu.Portal container={root.current}><Menu.Content contentEditable={false} className="code-block-popover code-block-options" sideOffset={6} collisionPadding={12}>
            <Menu.CheckboxItem checked={wrap} onCheckedChange={value => setOption('wrap', value)} className="code-block-menu-item">Wrap lines <Menu.ItemIndicator>✓</Menu.ItemIndicator></Menu.CheckboxItem>
            <Menu.CheckboxItem checked={lineNumbers} onCheckedChange={value => setOption('lineNumbers', value)} className="code-block-menu-item">Line numbers <Menu.ItemIndicator>✓</Menu.ItemIndicator></Menu.CheckboxItem>
            {editable && <><Menu.Separator className="code-block-menu-separator" />
              <Menu.Item className="code-block-menu-item" onSelect={() => { setCaption(node.attrs.caption || ''); setCaptionOpen(true); }}>Edit caption</Menu.Item>
              <Menu.Item className="code-block-menu-item" onSelect={duplicate}>Duplicate</Menu.Item>
              <Menu.Item className="code-block-menu-item code-block-delete" onSelect={() => { if (editor.isEditable) { deleteNode(); editor.commands.focus(); } }}>Delete</Menu.Item>
              <div className="code-block-empty">Tab / Shift+Tab to indent<br />Esc for controls · Ctrl/⌘+Enter to exit</div>
            </>}
          </Menu.Content></Menu.Portal>
        </Menu.Root>
      </div>
      <Popover.Root open={captionOpen && editable} onOpenChange={setCaptionOpen}>
        <Popover.Anchor className="code-block-caption-anchor" />
        <Popover.Portal container={root.current}><Popover.Content contentEditable={false} className="code-block-popover" sideOffset={6} collisionPadding={12} onCloseAutoFocus={e => { e.preventDefault(); root.current?.querySelector<HTMLButtonElement>('[aria-label="Code block options"]')?.focus(); }}>
          <form onSubmit={e => { e.preventDefault(); if (editor.isEditable) updateAttributes({ caption: caption.trim() }); setCaptionOpen(false); }}>
            <label htmlFor={captionId}>Caption</label><input id={captionId} className="code-block-input" value={caption} maxLength={500} onChange={e => setCaption(e.target.value)} placeholder="Filename or description" />
            <div className="code-block-actions"><button type="button" className="code-block-control" onClick={() => setCaptionOpen(false)}>Cancel</button><button type="submit" className="code-block-control">Save</button></div>
          </form>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    </div>
    <div className="code-block-source" hidden={showPreview}>
      <pre spellCheck={false}><NodeViewContent<'code'> as="code" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }} /></pre>
    </div>
    {showPreview && <div contentEditable={false} className="code-block-preview"><iframe title="HTML code preview" sandbox="" referrerPolicy="no-referrer" srcDoc={htmlPreview(node.textContent)} /><span>Static HTML preview · scripts and external resources are disabled</span></div>}
    {collapsed && !showPreview && <button type="button" contentEditable={false} className="code-block-expand" onClick={() => setOption('collapsed', false)}>Show all {node.textContent.split('\n').length} lines</button>}
    {node.attrs.caption && <div contentEditable={false} className="code-block-caption">{node.attrs.caption}</div>}
    <span contentEditable={false} role="status" className={status && status !== 'Copied' ? 'code-block-status' : 'code-block-sr-only'}>{status}</span>
  </NodeViewWrapper>;
}
