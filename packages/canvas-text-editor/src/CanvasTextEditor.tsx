import { EditorContent, useEditor } from '@tiptap/react';
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTextToolbar } from './CanvasTextToolbar.js';
import { createCanvasTextExtensions, type CanvasTextCollaboration } from './extensions.js';
import {
  createCanvasRichTextDocument,
  normalizeCanvasRichText,
  type CanvasRichTextDocument,
  type CanvasTextValue,
} from './model.js';

export interface CanvasTextEditorProps {
  value?: CanvasTextValue | unknown;
  collaboration?: CanvasTextCollaboration;
  className?: string;
  editable?: boolean;
  autoFocus?: boolean;
  showToolbar?: boolean;
  onChange?: (value: CanvasRichTextDocument) => void;
  onCommit?: (value: CanvasRichTextDocument) => void;
  onCancel?: () => void;
  onBlur?: () => void;
  onSizeChange?: (size: { w: number; h: number }) => void;
  restoreValueOnCancel?: CanvasTextValue | unknown;
  /** Ignore value echoes while a canvas host publishes this editor's live draft. */
  syncExternalValue?: boolean;
}

function stopCanvasEvent(event: Event) {
  event.stopPropagation();
}

export function CanvasTextEditor({
  value,
  collaboration,
  className,
  editable = true,
  autoFocus = true,
  showToolbar = true,
  onChange,
  onCommit,
  onCancel,
  onBlur,
  onSizeChange,
  restoreValueOnCancel,
  syncExternalValue = true,
}: CanvasTextEditorProps) {
  const callbacks = useRef({ onChange, onCommit, onCancel, onBlur, onSizeChange, restoreValueOnCancel });
  const transactionFrame = useRef<number | null>(null);
  callbacks.current = { onChange, onCommit, onCancel, onBlur, onSizeChange, restoreValueOnCancel };
  const initialDocument = useMemo(
    () => value ? normalizeCanvasRichText(value) : createCanvasRichTextDocument(),
    [],
  );
  const stableCollaboration = useMemo(
    () => collaboration ? {
      fragment: collaboration.fragment,
      awareness: collaboration.awareness,
      user: collaboration.user,
    } : undefined,
    [
      collaboration?.fragment,
      collaboration?.awareness,
      collaboration?.user?.id,
      collaboration?.user?.name,
      collaboration?.user?.color,
    ],
  );
  const extensions = useMemo(() => createCanvasTextExtensions(stableCollaboration), [stableCollaboration]);
  const editor = useEditor({
    extensions,
    content: stableCollaboration ? undefined : initialDocument.doc,
    editable,
    autofocus: autoFocus ? 'end' : false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: 'canvas-text-editor__content',
        spellcheck: 'true',
        dir: 'auto',
        role: 'textbox',
        'aria-multiline': 'true',
      },
      handleDOMEvents: {
        pointerdown: (_view, event) => { stopCanvasEvent(event); return false; },
        wheel: (_view, event) => { stopCanvasEvent(event); return false; },
        keydown: (_view, event) => {
          stopCanvasEvent(event);
          if (event.isComposing || event.keyCode === 229) return false;
          if (event.key === 'Escape') {
            event.preventDefault();
            if (callbacks.current.restoreValueOnCancel) {
              const restore = normalizeCanvasRichText(callbacks.current.restoreValueOnCancel);
              const content = _view.state.schema.nodeFromJSON(restore.doc).content;
              _view.dispatch(_view.state.tr.replaceWith(0, _view.state.doc.content.size, content));
            }
            callbacks.current.onCancel?.();
            return true;
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            const current = normalizeCanvasRichText(_view.state.doc.toJSON());
            callbacks.current.onCommit?.(current);
            return true;
          }
          return false;
        },
        paste: (_view, event) => { stopCanvasEvent(event); return false; },
        drop: (_view, event) => { stopCanvasEvent(event); return false; },
      },
    },
    onTransaction: ({ editor: currentEditor, transaction }) => {
      if (!transaction.docChanged || stableCollaboration) return;
      // Capture the canonical document before the browser can blur and unmount
      // the editor. Measurement can wait for layout; document state cannot.
      callbacks.current.onChange?.(normalizeCanvasRichText(currentEditor.getJSON()));
      if (transactionFrame.current !== null) cancelAnimationFrame(transactionFrame.current);
      transactionFrame.current = requestAnimationFrame(() => {
        transactionFrame.current = null;
        if (currentEditor.isDestroyed) return;
        const element = currentEditor.view.dom;
        callbacks.current.onSizeChange?.({
          w: Math.max(1, element.scrollWidth),
          h: Math.max(1, element.scrollHeight),
        });
      });
    },
    onBlur: () => callbacks.current.onBlur?.(),
  }, [extensions]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor || !stableCollaboration?.fragment.observeDeep) return;
    const report = () => {
      // Publish the canonical Yjs document before yielding. A blur can unmount
      // the editor before the next frame, so deferring this snapshot loses the
      // final transaction.
      callbacks.current.onChange?.(normalizeCanvasRichText(
        yXmlFragmentToProsemirrorJSON(stableCollaboration.fragment as any),
      ));
      if (transactionFrame.current !== null) cancelAnimationFrame(transactionFrame.current);
      transactionFrame.current = requestAnimationFrame(() => {
        transactionFrame.current = null;
        if (editor.isDestroyed) return;
        const element = editor.view.dom;
        callbacks.current.onSizeChange?.({
          w: Math.max(1, element.scrollWidth),
          h: Math.max(1, element.scrollHeight),
        });
      });
    };
    stableCollaboration.fragment.observeDeep(report);
    return () => stableCollaboration.fragment.unobserveDeep?.(report);
  }, [editor, stableCollaboration]);

  useEffect(() => () => {
    if (transactionFrame.current !== null) cancelAnimationFrame(transactionFrame.current);
  }, []);

  useEffect(() => {
    if (!editor || value === undefined || !syncExternalValue) return;
    const next = normalizeCanvasRichText(value);
    if (stableCollaboration) {
      if (stableCollaboration.fragment.length === 0) {
        editor.commands.setContent(next.doc, { emitUpdate: false });
      }
      return;
    }
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next.doc)) {
      editor.commands.setContent(next.doc, { emitUpdate: false });
    }
  }, [stableCollaboration, editor, syncExternalValue, value]);

  useEffect(() => {
    if (!editor || !onSizeChange || typeof ResizeObserver === 'undefined') return;
    const element = editor.view.dom;
    const report = () => callbacks.current.onSizeChange?.({
      w: Math.max(1, element.scrollWidth),
      h: Math.max(1, element.scrollHeight),
    });
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [editor]);

  if (!editor) return null;
  return (
    <div
      className={['canvas-text-editor', className].filter(Boolean).join(' ')}
      onPointerDownCapture={event => event.stopPropagation()}
      onWheelCapture={event => event.stopPropagation()}
    >
      {showToolbar && editable ? <CanvasTextToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
