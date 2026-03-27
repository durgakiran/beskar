'use client';

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { EditorProps } from '../types';
import { getExtensions } from '../extensions';
import { useDebounce } from '../utils/debounce';

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
  collaboration,
  onUpdate,
  onReady,
  extensions: customExtensions = [],
  className = '',
  autoFocus = false,
  imageHandler,
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

  // Orphan callback — call commentHandler.orphanThread when a mark is removed
  const onCommentOrphaned = useCallback(
    (commentId: string) => {
      if (!commentHandler) return;
      commentHandler.orphanThread(commentId).catch((err) => {
        console.error('[Editor] orphanThread failed', err);
      });
    },
    [commentHandler],
  );

  // Get all extensions - memoize to prevent recreation
  const extensions = useMemo(
    () =>
      getExtensions({
        placeholder,
        collaboration,
        additionalExtensions: customExtensions,
        imageHandler,
        onCommentOrphaned: commentHandler ? onCommentOrphaned : undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placeholder, collaboration, customExtensions, imageHandler, commentHandler],
  );

  // Initialize editor
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editable,
    autofocus: autoFocus,
    content: editable && collaboration ? undefined : initialContent,
    onCreate: ({ editor: currentEditor }) => {
      console.log('[Editor] onCreate called, adding blockIds...');
      setHasInitialized(true);

      // Add blockIds to all block nodes right after creation
      const { state, view } = currentEditor;
      const tr = state.tr;
      let modified = false;

      state.doc.descendants((node, pos) => {
        // Only process block-level nodes
        const blockTypes = ['heading', 'paragraph', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'horizontalRule'];
        if (blockTypes.includes(node.type.name) && !node.attrs.blockId) {
          const blockId = `block-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            blockId,
          });
          modified = true;
        }
      });

      if (modified) {
        view.dispatch(tr);
      }

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
    <div ref={containerRef} className={`beskar-editor ${className}`}>
      {editor && <EditorContent editor={editor} className="editor-content" />}
    </div>
  );
}
