import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Fragment } from '@tiptap/pm/model';
import { useFloating, flip, shift, offset, autoUpdate } from '@floating-ui/react';
import { Dialog, Button, Flex } from '@radix-ui/themes';
import * as Toolbar from '@radix-ui/react-toolbar';
import { FiEdit2, FiExternalLink, FiLink, FiMaximize2, FiMinimize2, FiRefreshCw, FiTrash2 } from 'react-icons/fi';
import type { InternalResourceHandler, InternalResourceResult } from '../../types';
import { InternalResourcePicker } from './InternalResourcePicker';
import { resourceContext, resourceHref, useInternalResource, type ResourceReference } from './useInternalResource';

export function InternalResourceView({ node, editor, getPos, selected, updateAttributes, inline }: NodeViewProps & { inline: boolean }) {
  const attrs = node.attrs as ResourceReference;
  const handler: InternalResourceHandler | undefined = (editor.storage as any)[inline ? 'internalDocInline' : 'internalLinkBlock']?.resourceHandler;
  // setEditable emits update rather than transaction; observe both so an open
  // authoring surface disappears immediately when the host revokes editability.
  const subscribe = useCallback((notify: () => void) => {
    editor.on('update', notify); editor.on('transaction', notify);
    return () => { editor.off('update', notify); editor.off('transaction', notify); };
  }, [editor]);
  const editable = useSyncExternalStore(subscribe, () => editor.isEditable, () => editor.isEditable);
  const [changing, setChanging] = useState(false);
  useEffect(() => { if (!editable) setChanging(false); }, [editable]);
  const [copyError, setCopyError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const empty = !attrs.resourceId;
  const picking = editable && (empty || changing);
  const { state, metadata, refresh } = useInternalResource(attrs, handler);
  const { refs, floatingStyles } = useFloating({ placement: 'bottom-start', middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })], whileElementsMounted: autoUpdate });
  const href = resourceHref(attrs, handler);
  const unavailable = state === 'unavailable';
  const title = unavailable ? 'Unavailable or you don’t have access' : state === 'error' ? 'Could not load internal link' : state === 'loading' && handler ? 'Loading internal link…' : metadata?.title || attrs.resourceTitle || 'Linked resource';
  const position = () => { const pos = getPos(); return typeof pos === 'number' && pos >= 0 ? pos : undefined; };
  const remove = () => {
    if (!editor.isEditable) return;
    const pos = position();
    if (pos !== undefined) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };
  const select = () => { const pos = position(); if (pos !== undefined && editor.isEditable) editor.chain().focus().setNodeSelection(pos).run(); };
  const cancel = () => { if (empty) remove(); else { setChanging(false); select(); } };
  const pick = (resource: InternalResourceResult) => {
    if (!editor.isEditable) return;
    updateAttributes({ resourceId: resource.resourceId, resourceType: resource.resourceType, spaceId: resource.spaceId || '',
      href: resource.href || handler?.getResourceUrl?.(resource.resourceId, resource.resourceType, resource) || '',
      resourceTitle: resource.title, resourceIcon: resource.icon || '' });
    setChanging(false); setImageFailed(false);
    const pos = position();
    if (pos !== undefined) {
      if (inline) editor.chain().focus().setTextSelection(pos + node.nodeSize).run();
      else {
        const after = pos + node.nodeSize;
        if (editor.state.doc.resolve(after).nodeAfter?.isTextblock) editor.chain().focus().setTextSelection(after + 1).run();
        else editor.chain().focus().setNodeSelection(pos).createParagraphNear().run();
      }
    }
  };
  const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (handler) { event.preventDefault(); handler.navigateToResource(attrs.resourceId, attrs.resourceType, { ...resourceContext(attrs, handler), href }); }
  };
  const activate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (editor.isEditable && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault(); select();
    } else open(event);
  };
  const convert = () => {
    if (!editor.isEditable || empty) return;
    const pos = position();
    if (pos === undefined) return;
    editor.chain().focus().command(({ tr, state: editorState, dispatch }) => {
      const targetType = editorState.schema.nodes[inline ? 'internalLinkBlock' : 'internalDocInline'];
      if (!targetType) return false;
      const target = targetType.create({ ...attrs, spaceId: resourceContext(attrs, handler).spaceId || '', resourceType: metadata?.resourceType || attrs.resourceType, href: href || attrs.href || '', resourceTitle: metadata?.title || attrs.resourceTitle,
        resourceIcon: metadata?.icon || attrs.resourceIcon, blockId: undefined });
      const $pos = editorState.doc.resolve(pos);
      if (inline) {
        const parent = $pos.parent;
        if (!parent.isTextblock || $pos.depth < 1) return false;
        const before = parent.content.cut(0, $pos.parentOffset);
        const after = parent.content.cut($pos.parentOffset + node.nodeSize);
        const nodes = [];
        if (before.size) nodes.push(parent.type.create(parent.attrs, before, parent.marks));
        nodes.push(target);
        if (after.size) nodes.push(parent.type.create({ ...parent.attrs, blockId: undefined }, after, parent.marks));
        const container = $pos.node(-1);
        if (!container.canReplace($pos.index(-1), $pos.index(-1) + 1, Fragment.from(nodes))) return false;
        tr.replaceWith($pos.before(), $pos.after(), nodes);
      } else {
        const paragraph = editorState.schema.nodes.paragraph.create(null, target);
        if (!$pos.parent.canReplace($pos.index(), $pos.index() + 1, Fragment.from(paragraph))) return false;
        tr.replaceWith(pos, pos + node.nodeSize, paragraph);
      }
      dispatch?.(tr.scrollIntoView());
      return true;
    }).run();
  };
  // A list item cannot begin with an atomic card; table cells must remain valid.
  const canConvert = () => {
    const pos = position();
    if (pos === undefined) return false;
    const $pos = editor.state.doc.resolve(pos);
    return !inline || ($pos.parent.isTextblock && $pos.depth > 0 &&
      !['tableCell', 'tableHeader', 'listItem', 'taskItem'].includes($pos.node(-1).type.name));
  };
  const picker = picking && handler ? <InternalResourcePicker handler={handler} onPick={pick} onCancel={cancel} /> : null;
  const toolbar = !empty && selected && editable && !changing ? <div className="image-block-toolbar-floating">
    <Toolbar.Root className="editor-floating-toolbar internal-link-toolbar" aria-label="Internal link actions" onMouseDown={event => event.preventDefault()}>
      {href ? <Toolbar.Button asChild className="editor-floating-toolbar-button">
        <a href={href} onClick={open}><FiExternalLink size={16} aria-hidden="true" /><span>Open</span></a>
      </Toolbar.Button> : <Toolbar.Button className="editor-floating-toolbar-button" onClick={() => handler?.navigateToResource(attrs.resourceId, attrs.resourceType, resourceContext(attrs, handler))}>
        <FiExternalLink size={16} aria-hidden="true" /><span>Open</span>
      </Toolbar.Button>}
      {handler && <Toolbar.Button className="editor-floating-toolbar-button" onClick={() => setChanging(true)}>
        <FiEdit2 size={16} aria-hidden="true" /><span>Change target</span>
      </Toolbar.Button>}
      <Toolbar.Button className="editor-floating-toolbar-button" disabled={!canConvert()} onClick={convert} title={!canConvert() ? 'Conversion is unavailable in this container' : undefined}>
        {inline ? <FiMaximize2 size={16} aria-hidden="true" /> : <FiMinimize2 size={16} aria-hidden="true" />}<span>{inline ? 'Display as card' : 'Display as inline'}</span>
      </Toolbar.Button>
      <Toolbar.Separator className="editor-floating-toolbar-separator" />
      {handler && <Toolbar.Button className="editor-floating-toolbar-button" disabled={state === 'loading'} onClick={refresh}>
        <FiRefreshCw size={16} aria-hidden="true" /><span>{state === 'error' ? 'Retry' : 'Refresh'}</span>
      </Toolbar.Button>}
      {href && <Toolbar.Button className="editor-floating-toolbar-button" onClick={() => { setCopyError(''); void navigator.clipboard.writeText(href).catch(() => setCopyError('Could not copy link')); }}>
        <FiLink size={16} aria-hidden="true" /><span>Copy link</span>
      </Toolbar.Button>}
      <Toolbar.Separator className="editor-floating-toolbar-separator" />
      <Toolbar.Button className="editor-floating-toolbar-button danger" onClick={remove}>
        <FiTrash2 size={16} aria-hidden="true" /><span>Delete</span>
      </Toolbar.Button>
    </Toolbar.Root>
    {copyError && <span role="alert">{copyError}</span>}
  </div> : null;
  const error = !empty && handler && (state === 'error' || unavailable) ? <span className="internal-link-error" role="status">
    {title} <button type="button" onClick={refresh}>Retry</button>
    {editable && <button type="button" onClick={() => { select(); setChanging(true); }}>Change target</button>}
  </span> : null;
  const floating = picker || toolbar;
  return <>
    <NodeViewWrapper as={inline ? 'span' : 'div'} className={inline ? 'internal-doc-inline-wrapper' : 'internal-link-block-wrapper'}
      contentEditable={false} ref={refs.setReference} data-drag-handle={inline ? undefined : true}>
      {empty ? (inline ? <span>Choose internal link</span> : <div className="internal-link-card internal-link-card--muted">{editable && handler ? 'Choose internal link' : 'Unconfigured internal link'}</div>) : inline ? <>
        {error || <a href={href} role={href ? undefined : 'button'} tabIndex={0} className="internal-doc-inline-chip" onClick={activate}
          onKeyDown={event => { if (!href && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (editable) select(); else handler?.navigateToResource(attrs.resourceId, attrs.resourceType, resourceContext(attrs, handler)); } }}>
          <span aria-hidden="true">{metadata?.icon || attrs.resourceIcon || (attrs.resourceType === 'whiteboard' ? '▧' : '📄')}</span>
          <span className="internal-doc-inline-title">{title}</span>
        </a>}
      </> : <div className={`internal-link-card${error ? ' internal-link-card--error' : ''}`} onClick={event => {
        if (editable && !(event.target as HTMLElement).closest('a,button,[role="button"]')) select();
      }}>
        {error || <>
          <a href={href} role={href ? undefined : 'button'} tabIndex={0} onClick={activate} onKeyDown={event => {
            if (!href && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (editable) select(); else handler?.navigateToResource(attrs.resourceId, attrs.resourceType, resourceContext(attrs, handler)); }
          }}>{metadata?.icon || attrs.resourceIcon || '📄'} {title}</a>
          <div><small>{metadata?.resourceType || attrs.resourceType}</small></div>
          {metadata?.thumbnailUrl && !imageFailed ? <Dialog.Root><Dialog.Trigger><button type="button" aria-label="Preview whiteboard" className="internal-link-preview-button">
            <img src={metadata.thumbnailUrl} alt={`Whiteboard: ${title}`} className="internal-link-card__thumbnail" onError={() => setImageFailed(true)} />
          </button></Dialog.Trigger><Dialog.Content style={{ maxWidth: '95vw' }}><Flex justify="between"><Dialog.Title>{title}</Dialog.Title><Dialog.Close><Button>Close</Button></Dialog.Close></Flex>
            <img src={metadata.thumbnailUrl} alt={`Whiteboard: ${title}`} style={{ maxWidth: '100%' }} />
            {href && <a href={href} onClick={open}>Open whiteboard</a>}
          </Dialog.Content></Dialog.Root> : <p className="internal-link-card__excerpt">{metadata?.excerpt || (imageFailed ? 'Could not load preview image' : 'No preview available')}</p>}
          {imageFailed && <button type="button" onClick={() => { setImageFailed(false); refresh(); }}>Retry preview</button>}
          {metadata?.updatedByName && <small>Last edited by {metadata.updatedByName}</small>}
          {metadata?.lastEditedAt && <small> · {new Date(metadata.lastEditedAt).toLocaleString()}</small>}
        </>}
      </div>}
    </NodeViewWrapper>
    {floating && createPortal(<div ref={refs.setFloating} style={{ ...floatingStyles, zIndex: 50 }} contentEditable={false}>{floating}</div>, document.body)}
  </>;
}
