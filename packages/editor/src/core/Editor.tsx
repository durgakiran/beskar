'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { EditorProps } from '../types';
import { getExtensions } from '../extensions';
import { useDebounce } from '../utils/debounce';
import { getEmbedUrlAndProvider, isSinglePlainUrl } from '../nodes/embed/embed-providers';
import { parseInternalResourceUrl } from '../nodes/internalDocumentUrl';

// Keep node views (and their open controls) alive across content/debounce renders.
const NO_CUSTOM_EXTENSIONS: NonNullable<EditorProps['extensions']> = [];

function replaceSelectionWithEmbedBlock(view: any, node: any): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const { $from, $to } = selection;

  let transaction = state.tr;

  if ($from.sameParent($to) && $from.depth > 0 && $from.parent.isTextblock) {
    const block = $from.parent;
    const beforeContent = block.content.cut(0, $from.parentOffset);
    const afterContent = block.content.cut($to.parentOffset);
    const replacementNodes = [];

    if (beforeContent.size > 0) {
      replacementNodes.push(block.type.create(block.attrs, beforeContent, block.marks));
    }

    replacementNodes.push(node);

    if (afterContent.size > 0) {
      replacementNodes.push(block.type.create(block.attrs, afterContent, block.marks));
    }

    transaction = transaction.replaceWith($from.before(), $to.after(), replacementNodes);
  } else {
    transaction = transaction.replaceSelectionWith(node);
  }

  if (!transaction.docChanged) return false;

  dispatch(transaction.scrollIntoView());
  return true;
}

function replaceSelectionWithInlineNode(view: any, node: any): boolean {
  const { state, dispatch } = view;
  const transaction = state.tr.replaceSelectionWith(node);
  if (!transaction.docChanged) return false;
  dispatch(transaction.scrollIntoView());
  return true;
}

function tryHandleUrlPaste(
  view: any,
  event: ClipboardEvent,
  editable: boolean,
  internalResourceHandler?: EditorProps['internalResourceHandler'],
  externalLinkHandler?: EditorProps['externalLinkHandler'],
): boolean {
  if (!editable) return false;

  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (!isSinglePlainUrl(text)) return false;
  const trimmedText = text.trim();

  const appBaseUrl = internalResourceHandler?.appBaseUrl;
  if (appBaseUrl && view.state.schema.nodes.internalDocInline) {
    const internalResource = parseInternalResourceUrl(trimmedText, appBaseUrl);
    if (internalResource) {
      const node = view.state.schema.nodes.internalDocInline.create({
        resourceType: internalResource.resourceType,
        resourceId: internalResource.resourceId,
        resourceTitle: '',
        resourceIcon: '',
        href: internalResource.href,
      });

      event.preventDefault();
      return replaceSelectionWithInlineNode(view, node);
    }
  }

  const result = getEmbedUrlAndProvider(trimmedText);
  if (result && view.state.schema.nodes.embedBlock) {
    const node = view.state.schema.nodes.embedBlock.create({
      src: trimmedText,
      embedUrl: result.embedUrl,
      provider: result.provider,
      align: 'center',
      height: 480,
      error: '',
    });

    event.preventDefault();
    return replaceSelectionWithEmbedBlock(view, node);
  }

  if (externalLinkHandler && view.state.schema.nodes.externalLinkInline) {
    const node = view.state.schema.nodes.externalLinkInline.create({
      href: trimmedText,
      title: '',
      siteName: '',
      error: '',
    });

    event.preventDefault();
    return replaceSelectionWithInlineNode(view, node);
  }

  return false;
}

/**
 * Main Editor component
 *
 * @example
 * ```tsx
 * <Editor
 *   initialContent={content}
 *   editable={true}
 *   placeholder="Write something..."
 *   onUpdate={(content) => console.log(content)}
 *   onReady={(editor) => console.log('Editor ready', editor)}
 * />
 * ```
 */
export function Editor({
  initialContent,
  editable = true,
  placeholder = 'Write something or type "/" for commands....',
  columnLayoutPlaceholder,
  columnCodeBlockPlaceholder,
  columnMathBlockPlaceholder,
  columnTableOfContentsPlaceholder,
  columnDetailsSummaryPlaceholder,
  collaboration,
  onUpdate,
  onReady,
  extensions: customExtensions = NO_CUSTOM_EXTENSIONS,
  features,
  className = '',
  autoFocus = false,
  imageHandler,
  attachmentHandler,
  maxAttachmentBytes,
  onAttachmentRejected,
  allowedMimeAccept,
  onAttachmentsChange,
  internalResourceHandler,
  externalLinkHandler,
  childPagesHandler,
  commentHandler,
}: EditorProps) {
  const [content, setContent] = useState<any>(null);
  const [hasInitialized, setHasInitialized] = useState(false);
  const debouncedContent = useDebounce(content, 2000);
  const containerRef = useRef<HTMLDivElement>(null);
  const onUpdateRef = useRef(onUpdate);
  const onReadyRef = useRef(onReady);

  // Keep refs up to date
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);



  // Get all extensions - memoize to prevent recreation
  const extensions = useMemo(
    () =>
      getExtensions({
        placeholder,
        columnLayoutPlaceholder,
        columnCodeBlockPlaceholder,
        columnMathBlockPlaceholder,
        columnTableOfContentsPlaceholder,
        columnDetailsSummaryPlaceholder,
        collaboration,
        additionalExtensions: customExtensions,
        features,
        imageHandler,
        attachmentHandler,
        maxAttachmentBytes,
        onAttachmentRejected,
        allowedMimeAccept,
        onAttachmentsChange,
        internalResourceHandler,
        externalLinkHandler,
        childPagesHandler,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      placeholder,
      columnLayoutPlaceholder,
      columnCodeBlockPlaceholder,
      columnMathBlockPlaceholder,
      columnTableOfContentsPlaceholder,
      columnDetailsSummaryPlaceholder,
      collaboration,
      customExtensions,
      features,
      imageHandler,
      attachmentHandler,
      maxAttachmentBytes,
      onAttachmentRejected,
      allowedMimeAccept,
      onAttachmentsChange,
      internalResourceHandler,
      externalLinkHandler,
      childPagesHandler,
      commentHandler,
    ],
  );

  // Initialize editor
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editable,
    autofocus: autoFocus,
    content: editable && collaboration ? undefined : initialContent,
    editorProps: {
      handleDOMEvents: {
        paste: (view, event) =>
          tryHandleUrlPaste(view, event as ClipboardEvent, editable, internalResourceHandler, externalLinkHandler),
      },
      handlePaste: (view, event) => {
        return tryHandleUrlPaste(view, event as ClipboardEvent, editable, internalResourceHandler, externalLinkHandler);
      },
    },
    onCreate: ({ editor: currentEditor }) => {
      // BlockId owns initialization, split/paste repair and the shared type registry.
      setHasInitialized(true);

      if (onReadyRef.current) {
        onReadyRef.current(currentEditor);
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      const json = currentEditor.getJSON();
      setContent(json);
    },
    onDestroy: () => {
      // Cleanup if needed
    },
  });

  // Call onUpdate when content is debounced
  useEffect(() => {
    if (hasInitialized && debouncedContent && onUpdateRef.current) {
      onUpdateRef.current(debouncedContent);
    }
  }, [debouncedContent, hasInitialized]);

  // Update editable state
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  return (
    <div ref={containerRef} className={`beskar-editor ${className}`} data-editor-mode={editable ? 'edit' : 'view'}>
      {editor && <EditorContent editor={editor} className="editor-content" />}
    </div>
  );
}
