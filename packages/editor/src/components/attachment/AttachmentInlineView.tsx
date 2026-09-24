import React, { useEffect, useId, useRef, useState } from 'react';
import { NodeViewWrapper, useEditorState } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import * as Toolbar from '@radix-ui/react-toolbar';
import * as Separator from '@radix-ui/react-separator';
import { useFloating, FloatingPortal, autoUpdate, offset, flip, shift } from '@floating-ui/react';
import { FiTrash2, FiDownload, FiEye, FiRepeat, FiUpload, FiRefreshCw } from 'react-icons/fi';
import type { AttachmentRef } from '../../types';
import { attachmentResultAttrs, clearPendingAttachmentFile, getPendingAttachmentFile } from '../../extensions/attachment-upload';
import { getAttachmentPasteStorage } from '../../extensions/attachment-paste-drop';

async function downloadViaFetch(url: string, fileName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'include', mode: 'cors' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const objectUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName || 'download';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export function AttachmentInlineView({ node, editor, updateAttributes, deleteNode, selected, getPos }: NodeViewProps) {
  const editable = useEditorState({ editor, selector: ({ editor }) => editor.isEditable });
  const storage = getAttachmentPasteStorage(editor);
  const handler = storage?.attachmentHandler;
  const { fileUrl, fileName, fileSize, fileType, placeholderId, uploadStatus, errorMessage } = node.attrs;
  const name = fileName || 'file';
  const success = uploadStatus === 'success' && !!fileUrl;
  const pendingFile = getPendingAttachmentFile(placeholderId);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const toolbarId = useId();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { refs, floatingStyles } = useFloating({
    placement: 'top-start', strategy: 'fixed',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const visible = !dismissed && (hovered || focused || selected || !!busy) && (success || editable);
  const enter = () => { clearTimeout(hideTimer.current); setHovered(true); setDismissed(false); };
  const leave = () => { hideTimer.current = setTimeout(() => setHovered(false), 150); };
  const focus = () => { setFocused(true); setDismissed(false); };
  const blur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (!refs.floating.current?.contains(next) && !actionsTrigger.current?.contains(next)) setFocused(false);
  };
  const escape = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    actionsTrigger.current?.focus();
    setDismissed(true);
    setHovered(false);
  };
  const lock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const current = useRef({ node, updateAttributes });
  current.current = { node, updateAttributes };
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); clearTimeout(hideTimer.current); }; }, []);
  useEffect(() => { setError(''); }, [fileUrl, placeholderId, uploadStatus]);

  const attachment: AttachmentRef = { attachmentId: node.attrs.attachmentId, fileUrl, fileName: name, fileSize, fileType };
  const preview = handler?.previewAttachment;
  const canPreview = success && !!preview?.supports(attachment);

  async function read(action: 'download' | 'preview') {
    if (!success || lock.current) return;
    lock.current = true;
    setBusy(action === 'download' ? 'Downloading…' : 'Opening preview…');
    setError('');
    try {
      if (action === 'preview') {
        if (!preview || !preview.supports(attachment)) throw new Error('Preview is unavailable for this file.');
        await preview.open(attachment);
      } else if (handler?.downloadAttachment) {
        await handler.downloadAttachment({ url: fileUrl, fileName: name });
      } else {
        await downloadViaFetch(fileUrl, name);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Could not open the attachment. Please try again.');
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy('');
        if (action === 'preview') {
          requestAnimationFrame(() => actionsTrigger.current?.focus());
        }
      }
    }
  }

  async function upload(file: File) {
    if (!editor.isEditable || !handler || lock.current) return;
    if (storage?.maxAttachmentBytes != null && file.size > storage.maxAttachmentBytes) {
      setError('This file exceeds the attachment size limit. Choose a smaller file.');
      storage.onAttachmentRejected?.('too_large', file);
      return;
    }
    lock.current = true;
    setBusy(success ? 'Replacing attachment…' : 'Uploading…');
    setError('');
    const original = current.current.node.attrs;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await handler.uploadAttachment(file, { signal: abort.signal });
      const attrs = attachmentResultAttrs(result, handler);
      if (!mounted.current || editor.isDestroyed || !editor.isEditable || current.current.node.attrs !== original) return;
      current.current.updateAttributes(attrs);
      clearPendingAttachmentFile(placeholderId);
    } catch (e) {
      if (mounted.current && !abort.signal.aborted) setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy('');
    }
  }

  const recovering = !success && !pendingFile;
  return (
    <NodeViewWrapper as="span" className="attachment-inline-wrapper" contentEditable={false}>
      <span ref={refs.setReference} className={`attachment-inline-chip attachment-inline-${uploadStatus}`}
        onMouseEnter={enter} onMouseLeave={leave} onFocusCapture={focus} onBlurCapture={blur} onKeyDown={escape}
        aria-busy={!!busy || uploadStatus === 'uploading'}>
        <button ref={actionsTrigger} type="button" className="attachment-inline-main"
          aria-label={`Attachment: ${name}`} aria-expanded={visible} aria-controls={visible ? toolbarId : undefined}
          title={`${name} · ${formatFileSize(fileSize)}`}
          onClick={() => {
            setDismissed(false);
            setFocused(true);
            const pos = getPos();
            if (editor.isEditable && pos !== undefined) editor.commands.setNodeSelection(pos);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setDismissed(false);
              setFocused(true);
              requestAnimationFrame(() => refs.floating.current?.querySelector<HTMLButtonElement>('button')?.focus());
            }
          }}>
          <span aria-hidden>{uploadStatus === 'error' ? '⚠' : '📎'}</span>
          <span className="attachment-inline-filename">{name}{success ? ` · ${formatFileSize(fileSize)}` : ''}</span>
        </button>
      </span>
      {visible && <FloatingPortal>
        <div ref={refs.setFloating} style={floatingStyles} className="attachment-inline-toolbar-container"
          contentEditable={false} onMouseEnter={enter} onMouseLeave={leave}
          onFocusCapture={focus} onBlurCapture={blur} onKeyDown={escape}>
          <Toolbar.Root id={toolbarId} className="editor-floating-toolbar attachment-inline-toolbar" aria-label={`Attachment actions for ${name}`}>
            {success && <Toolbar.Button className="editor-floating-toolbar-button" aria-disabled={!!busy} aria-label="Download attachment" title="Download attachment" onClick={() => void read('download')}><FiDownload size={16} aria-hidden="true" /></Toolbar.Button>}
            {canPreview && <Toolbar.Button className="editor-floating-toolbar-button" aria-disabled={!!busy} aria-label="Preview attachment" title="Preview attachment" onClick={() => void read('preview')}><FiEye size={16} aria-hidden="true" /></Toolbar.Button>}
            {editable && <>
              {success && <Separator.Root className="editor-floating-toolbar-separator" orientation="vertical" />}
              {handler && (success || uploadStatus === 'error' || recovering) && (
                <Toolbar.Button className="editor-floating-toolbar-button" disabled={!!busy} aria-label={success ? 'Replace file' : 'Choose file again'} title={success ? 'Replace file' : 'Choose file again'} onClick={() => input.current?.click()}>{success ? <FiRepeat size={16} aria-hidden="true" /> : <FiUpload size={16} aria-hidden="true" />}</Toolbar.Button>
              )}
              {handler && uploadStatus === 'error' && pendingFile && (
                <Toolbar.Button className="editor-floating-toolbar-button" disabled={!!busy} aria-label="Retry upload" title="Retry upload" onClick={() => void upload(pendingFile)}><FiRefreshCw size={16} aria-hidden="true" /></Toolbar.Button>
              )}
              <Toolbar.Button className="editor-floating-toolbar-button" disabled={!!busy} aria-label="Remove attachment" title="Remove attachment" onClick={() => {
                if (!editor.isEditable) return;
                clearPendingAttachmentFile(placeholderId);
                deleteNode();
                editor.commands.focus();
              }}><FiTrash2 size={16} aria-hidden="true" /></Toolbar.Button>
            </>}
          </Toolbar.Root>
        </div>
      </FloatingPortal>}
      {editable && <input ref={input} type="file" hidden accept={storage?.allowedMimeAccept || '*'} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void upload(file);
      }} />}
      <span className="attachment-inline-feedback" role="status" aria-live="polite">
        {busy || error || (uploadStatus === 'error' ? errorMessage || 'Upload failed.' : uploadStatus === 'uploading' ? 'Upload pending…' : '')}
      </span>
    </NodeViewWrapper>
  );
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${Number((bytes / 1024 ** i).toFixed(1))} ${units[i]}`;
}
