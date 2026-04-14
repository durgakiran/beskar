import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

import {
  Editor,
  TableFloatingMenu,
  TextFormattingMenu,
  CodeBlockFloatingMenu,
  CommentInputPopover,
  CommentGutter,
  CommentThreadCard,
  CommentSidePanel,
  OverlapDisambiguationPopover,
} from '@beskar/editor';
import type { TiptapEditor, ImageAPIHandler, CommentThread } from '@beskar/editor';
import { commentDecorationKey } from '@beskar/editor';
import { mockCommentHandler, resetMockCommentStorage } from './mockCommentHandler';
import { mockAttachmentHandler } from './mockAttachmentHandler';
// Import Radix UI styles first, then editor styles so editor can use Radix variables
import '@beskar/editor/styles.css';
import '@beskar/editor/index.css';
import './App.css';
import { Button } from '@radix-ui/themes';

const initialContent = {
  type: 'doc',
  content: [
    // ── Headings ──────────────────────────────────────────────────────────────
    {
      type: 'heading',
      attrs: { level: 1, blockId: 'init-h1' },
      content: [{ type: 'text', text: 'Drag Handle Test — All Block Types' }],
    },
    {
      type: 'heading',
      attrs: { level: 2, blockId: 'init-h2' },
      content: [{ type: 'text', text: 'Heading Level 2' }],
    },
    {
      type: 'heading',
      attrs: { level: 3, blockId: 'init-h3' },
      content: [{ type: 'text', text: 'Heading Level 3' }],
    },

    // ── Paragraph ─────────────────────────────────────────────────────────────
    {
      type: 'paragraph',
      attrs: { blockId: 'init-para-1' },
      content: [
        { type: 'text', text: 'A plain paragraph with ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
        { type: 'text', text: ', ' },
        { type: 'text', marks: [{ type: 'italic' }], text: 'italic' },
        { type: 'text', text: ', and ' },
        { type: 'text', marks: [{ type: 'underline' }], text: 'underlined' },
        { type: 'text', text: ' text.' },
      ],
    },

    // ── Bullet list ───────────────────────────────────────────────────────────
    {
      type: 'bulletList',
      attrs: { blockId: 'init-bl' },
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', attrs: { blockId: 'init-bl-p1' }, content: [{ type: 'text', text: 'Bullet item one' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', attrs: { blockId: 'init-bl-p2' }, content: [{ type: 'text', text: 'Bullet item two' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', attrs: { blockId: 'init-bl-p3' }, content: [{ type: 'text', text: 'Bullet item three' }] }],
        },
      ],
    },

    // ── Ordered list ──────────────────────────────────────────────────────────
    {
      type: 'orderedList',
      attrs: { blockId: 'init-ol' },
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', attrs: { blockId: 'init-ol-p1' }, content: [{ type: 'text', text: 'Ordered item one' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', attrs: { blockId: 'init-ol-p2' }, content: [{ type: 'text', text: 'Ordered item two' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', attrs: { blockId: 'init-ol-p3' }, content: [{ type: 'text', text: 'Ordered item three' }] }],
        },
      ],
    },

    // ── Task list ─────────────────────────────────────────────────────────────
    {
      type: 'taskList',
      attrs: { blockId: 'init-tl' },
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', attrs: { blockId: 'init-tl-p1' }, content: [{ type: 'text', text: 'Unchecked task item' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', attrs: { blockId: 'init-tl-p2' }, content: [{ type: 'text', text: 'Checked task item' }] }],
        },
      ],
    },

    // ── Blockquote ────────────────────────────────────────────────────────────
    {
      type: 'blockquote',
      attrs: { blockId: 'init-bq' },
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'init-bq-p1' },
          content: [{ type: 'text', text: 'This is a blockquote. The drag handle should align to its first line.' }],
        },
      ],
    },

    // ── Code block ────────────────────────────────────────────────────────────
    {
      type: 'codeBlock',
      attrs: { language: 'typescript', blockId: 'init-cb' },
      content: [{ type: 'text', text: 'const greeting = (name: string) => `Hello, ${name}!`;\nconsole.log(greeting("World"));' }],
    },

    // ── Horizontal rule ───────────────────────────────────────────────────────
    { type: 'horizontalRule', attrs: { blockId: 'init-hr' } },

    // ── Note blocks (all themes) ──────────────────────────────────────────────
    {
      type: 'noteBlock',
      attrs: { icon: 'info', emoji: '📝', backgroundColor: '#dbeafe', theme: 'info', blockId: 'init-nb1' },
      content: [{ type: 'text', text: 'Info note block — drag handle should align to this text line.' }],
    },
    {
      type: 'noteBlock',
      attrs: { icon: 'warning', emoji: '⚠️', backgroundColor: '#fef9c3', theme: 'warning', blockId: 'init-nb2' },
      content: [{ type: 'text', text: 'Warning note block — drag handle alignment test.' }],
    },
    {
      type: 'noteBlock',
      attrs: { icon: 'success', emoji: '✅', backgroundColor: '#dcfce7', theme: 'success', blockId: 'init-nb3' },
      content: [{ type: 'text', text: 'Success note block — drag handle alignment test.' }],
    },
    {
      type: 'noteBlock',
      attrs: { icon: 'error', emoji: '❌', backgroundColor: '#fee2e2', theme: 'error', blockId: 'init-nb4' },
      content: [{ type: 'text', text: 'Error note block — drag handle alignment test.' }],
    },

    // ── Math block ────────────────────────────────────────────────────────────
    {
      type: 'mathBlock',
      attrs: { latex: 'E = mc^2', displayMode: true, blockId: 'init-math' },
    },

    // ── Details (collapsible) ─────────────────────────────────────────────────
    {
      type: 'details',
      attrs: { blockId: 'init-details' },
      content: [
        {
          type: 'detailsSummary',
          content: [{ type: 'text', text: 'Collapsible section — click to expand' }],
        },
        {
          type: 'detailsContent',
          content: [
            {
              type: 'paragraph',
              attrs: { blockId: 'init-det-p1' },
              content: [{ type: 'text', text: 'Hidden content revealed after expanding the details block.' }],
            },
          ],
        },
      ],
    },

    // ── Table ─────────────────────────────────────────────────────────────────
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', attrs: { blockId: 'init-th-a' }, content: [{ type: 'text', text: 'Header A' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', attrs: { blockId: 'init-th-b' }, content: [{ type: 'text', text: 'Header B' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', attrs: { blockId: 'init-th-c' }, content: [{ type: 'text', text: 'Header C' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', attrs: { blockId: 'init-tc-1' }, content: [{ type: 'text', text: 'Row 1, Col 1' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', attrs: { blockId: 'init-tc-2' }, content: [{ type: 'text', text: 'Row 1, Col 2' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', attrs: { blockId: 'init-tc-3' }, content: [{ type: 'text', text: 'Row 1, Col 3' }] }] },
          ],
        },
      ],
    },

    // ── Columns (2-column layout) ─────────────────────────────────────────────
    {
      type: 'columns',
      attrs: { columnCount: 2, blockId: 'init-cols' },
      content: [
        {
          type: 'column',
          attrs: { width: null },
          content: [
            {
              type: 'paragraph',
              attrs: { blockId: 'init-col-left-p1' },
              content: [{ type: 'text', text: 'Left column content. Drag handle test for columns layout.' }],
            },
          ],
        },
        {
          type: 'column',
          attrs: { width: null },
          content: [
            {
              type: 'paragraph',
              attrs: { blockId: 'init-col-right-p1' },
              content: [{ type: 'text', text: 'Right column content. Drag handle test for columns layout.' }],
            },
          ],
        },
      ],
    },

    // ── Trailing paragraph ────────────────────────────────────────────────────
    {
      type: 'paragraph',
      attrs: { blockId: 'init-para-end' },
      content: [{ type: 'text', text: 'End of block-type showcase.' }],
    },
  ],
};

const CONTENT_STORAGE_KEY = 'beskar-editor-demo:content:v1';



function loadInitialContent() {
  if (typeof window === 'undefined') {
    return initialContent;
  }

  const raw = window.localStorage.getItem(CONTENT_STORAGE_KEY);
  if (!raw) {
    return initialContent;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[Demo] Failed to parse stored content, falling back to seed content', error);
    return initialContent;
  }
}

/** Jump cursor to next/prev comment mark in document order (Alt+] / Alt+[) */
function jumpToComment(editor: TiptapEditor, direction: 'next' | 'prev') {
  const { state } = editor;
  const { from } = state.selection;
  const positions: number[] = [];

  state.doc.descendants((node, pos) => {
    node.marks.forEach((mark) => {
      if (mark.type.name === 'comment') positions.push(pos);
    });
  });

  if (positions.length === 0) return;
  const sorted = [...new Set(positions)].sort((a, b) => a - b);
  let target: number;
  if (direction === 'next') {
    target = sorted.find((p) => p > from) ?? sorted[0];
  } else {
    const reversed = [...sorted].reverse();
    target = reversed.find((p) => p < from) ?? sorted[sorted.length - 1];
  }
  editor.commands.setTextSelection(target);
  editor.view.focus();
}

function App() {
  const [content, setContent] = useState(loadInitialContent);
  const [isEditable, setIsEditable] = useState(true);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [editor, setEditor] = useState<TiptapEditor | null>(null);
  // Stable ref so callbacks (handleUpdate etc.) can read the current editor
  // without being recreated every time editor state changes.
  const editorRef = useRef<TiptapEditor | null>(null);
  const [showComments, setShowComments] = useState(true);
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);

  // Comment input popover state
  const [showCommentPopover, setShowCommentPopover] = useState(false);

  // Orphaned thread IDs — recomputed from resolveAnchor on every editor transaction.
  // This replaces the legacy mark-based detection (which was always empty since we no
  // longer write CommentMark marks into the document).
  const [orphanedIds, setOrphanedIds] = useState<ReadonlySet<string>>(new Set());
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [commentCardOpen, setCommentCardOpen] = useState(false);
  const [cardFallbackRect, setCardFallbackRect] = useState<DOMRect | null>(null);
  const [cardActiveIndex, setCardActiveIndex] = useState<number>(0);


  // Overlap disambiguation state
  const [ambiguousThreads, setAmbiguousThreads] = useState<CommentThread[]>([]);
  const [ambiguityRect, setAmbiguityRect] = useState<DOMRect | null>(null);

  const showCard = commentCardOpen;

  // Load threads initially and after changes
  const reloadThreads = useCallback(async () => {
    try {
      const data = await mockCommentHandler.getThreads('demo-document');
      setThreads(data);
      return data;
    } catch (err) {
      console.error('[App] getThreads failed', err);
      return [];
    }
  }, []);

  const handleUpdate = useCallback((updatedContent: any) => {
    setContent(updatedContent);
    window.localStorage.setItem(CONTENT_STORAGE_KEY, JSON.stringify(updatedContent));
    setLastSaved(new Date());

    // ── Anchor sync ────────────────────────────────────────────────────────
    // When text inside a highlight is edited (e.g. "Ordered" → "Orderd"), the
    // decoration's position tracks correctly via DecorationSet.map() during
    // the current session. But the thread's anchor.quotedText still says the
    // OLD text. On the next page reload, resolveAnchor would fail to find
    // "Ordered" (because it no longer exists) and the highlight would vanish.
    //
    // Fix: whenever the document is saved, compare each decoration's current
    // text against its thread's stored anchor.quotedText. If they differ,
    // update the anchor so future resolveAnchor calls use the current text.
    // Read the editor through a stable ref — no closure capture needed.
    const currentEditor = editorRef.current;
    if (currentEditor) {
      const { state } = currentEditor;
      const pluginState = commentDecorationKey.getState(state);
      if (pluginState && pluginState.threads.length > 0) {
        const CONTEXT_CHARS = 32;
        const { doc } = state;

        pluginState.threads.forEach((thread) => {
          if (thread.orphaned || thread.resolvedAt) return;

          // Find the current decoration for this thread
          const decos = pluginState.decorations.find(
            0,
            doc.content.size,
            (spec: any) => spec['data-comment-id'] === thread.id,
          );
          if (!decos || decos.length === 0) return;

          const deco = decos[0] as any;
          if (deco.from >= deco.to) return; // Collapsed / orphaned

          // Current text at the mapped decoration position
          const currentText = doc.textBetween(deco.from, deco.to, ' ');
          if (currentText === thread.anchor.quotedText) return; // Unchanged

          // Compute updated context
          const newPrefixText = doc
            .textBetween(Math.max(0, deco.from - CONTEXT_CHARS), deco.from, ' ')
            .slice(-CONTEXT_CHARS);
          const newSuffixText = doc
            .textBetween(deco.to, Math.min(doc.content.size, deco.to + CONTEXT_CHARS), ' ')
            .slice(0, CONTEXT_CHARS);

          mockCommentHandler.updateThreadAnchor?.(thread.id, {
            ...thread.anchor,
            quotedText: currentText,
            prefixText: newPrefixText,
            suffixText: newSuffixText,
          });
        });
      }
    }
  }, []);



  const handleResetDemoData = useCallback(() => {
    window.localStorage.removeItem(CONTENT_STORAGE_KEY);
    resetMockCommentStorage();
    window.location.reload();
  }, []);

  const handleReady = useCallback((editorInstance: TiptapEditor) => {
    console.log('Editor ready:', editorInstance);
    setEditor(editorInstance);
    editorRef.current = editorInstance;
    (window as any).editor = editorInstance;

    // Pre-load threads once editor is ready
    mockCommentHandler.getThreads('demo-document').then(setThreads);
  }, []);

  // ── Orphan detection ──────────────────────────────────────────────────────
  // A thread is orphaned only when its decoration has been REMOVED from the
  // DecorationSet (i.e., all its text was deleted and the range collapsed to
  // zero-width, which ProseMirror removes automatically).
  //
  // We deliberately do NOT use resolveAnchor here. resolveAnchor does an exact
  // quotedText match, so editing even one character inside a highlight would
  // falsely orphan the thread. DecorationSet.map() keeps the decoration alive
  // while the text exists — its tracked position is the ground truth.
  //
  // Guard: if the plugin hasn't received setMeta yet (threads.length === 0),
  // don't run the check to avoid the bootstrap false-positive window.
  useEffect(() => {
    if (!editor) return;
    const checkOrphans = () => {
      const pluginState = commentDecorationKey.getState(editor.state);
      if (!pluginState || pluginState.threads.length === 0) return; // not initialized yet

      // Collect all thread IDs that currently have a decoration in the set.
      const decoratedIds = new Set<string>();
      pluginState.decorations
        .find(0, editor.state.doc.content.size)
        .forEach((deco: any) => {
          const id: string | undefined = deco.spec?.['data-comment-id'];
          if (id) decoratedIds.add(id);
        });

      // A thread is orphaned iff it has no decoration (collapsed + removed by mapping).
      const newOrphaned = new Set<string>();
      threads.forEach((t) => {
        if (!decoratedIds.has(t.id)) newOrphaned.add(t.id);
      });

      setOrphanedIds((prev) => {
        if (prev.size === newOrphaned.size && [...prev].every((id) => newOrphaned.has(id))) return prev;
        return newOrphaned;
      });
    };
    checkOrphans();
    editor.on('transaction', checkOrphans);
    return () => editor.off('transaction', checkOrphans);
  }, [editor, threads]);

  const derivedThreads = useMemo(() => {
    return threads.map((t) => ({
      ...t,
      orphaned: orphanedIds.has(t.id),
    }));
  }, [threads, orphanedIds]);

  // ── Click on comment highlight → open inline card ──────────────────────────
  useEffect(() => {
    if (!editor || !showComments) return;
    const editorDom = editor.view.dom as HTMLElement;

    const handleCommentClicked = (e: any) => {
      const { commentId } = e.detail;
      const idx = threads.findIndex((t) => t.id === commentId || t.commentId === commentId);
      if (idx >= 0) {
        setCardActiveIndex(idx);
        setCommentCardOpen(true);
        setAmbiguousThreads([]);
      }
    };

    const handleAmbiguityDetected = (e: any) => {
      const { commentIds, rect } = e.detail;
      const matchingThreads = threads.filter(
        (t) => commentIds.includes(t.id) || commentIds.includes(t.commentId),
      );
      setAmbiguousThreads(matchingThreads);
      setAmbiguityRect(rect);
      setCommentCardOpen(false);
    };

    editorDom.addEventListener('COMMENT_CLICKED' as any, handleCommentClicked);
    editorDom.addEventListener('COMMENT_AMBIGUITY_DETECTED' as any, handleAmbiguityDetected);

    return () => {
      editorDom.removeEventListener('COMMENT_CLICKED' as any, handleCommentClicked);
      editorDom.removeEventListener('COMMENT_AMBIGUITY_DETECTED' as any, handleAmbiguityDetected);
    };
  }, [editor, threads, showComments]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editor) return;
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key === 'm') {
        e.preventDefault();
        const { selection } = editor.state;
        if (!selection.empty) {
          const text = editor.state.doc.textBetween(selection.from, selection.to, ' ');
          if (text.trim()) setShowCommentPopover(true);
        }
        return;
      }
      if (e.altKey && e.key === ']') { e.preventDefault(); jumpToComment(editor, 'next'); return; }
      if (e.altKey && e.key === '[') { e.preventDefault(); jumpToComment(editor, 'prev'); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editor]);

  // ── Handlers for thread card ──────────────────────────────────────────────

  const closeCard = useCallback(() => {
    setCommentCardOpen(false);
    setCardFallbackRect(null);
  }, []);

  const handleThreadUpdated = useCallback((updated: CommentThread) => {
    setThreads((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }, []);

  const handleThreadDeleted = useCallback((threadId: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== threadId);
      setCardActiveIndex((idx) => Math.min(idx, Math.max(0, next.length - 1)));
      if (next.length === 0) setCommentCardOpen(false);
      return next;
    });
  }, []);

  // On gutter click — need a rect to position the card near the gutter pill
  const handleGutterThreadClick = useCallback((threadId: string) => {
    if (!editor) return;
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return;

    // Find the comment span in the DOM and use its rect
    const span = editor.view.dom.querySelector(
      `[data-comment-id="${thread.commentId}"]`,
    ) as HTMLElement | null;

    if (span) {
      setCardFallbackRect(null);
    } else {
      const editorRect = (editor.view.dom as HTMLElement).getBoundingClientRect();
      setCardFallbackRect(new DOMRect(editorRect.left, editorRect.top + 100, editorRect.width, 24));
    }
    const idx = threads.findIndex((t) => t.id === threadId);
    setCardActiveIndex(idx >= 0 ? idx : 0);
    setCommentCardOpen(true);
  }, [editor, threads]);

  // Example image upload handler
  const maxAttachmentBytes = 10 * 1024 * 1024;

  const onAttachmentRejected = useCallback((reason: 'too_large', file: File) => {
    console.warn('[Demo] Attachment rejected:', reason, file.name);
    window.alert(`File is too large (max ${(maxAttachmentBytes / (1024 * 1024)).toFixed(0)} MB): ${file.name}`);
  }, [maxAttachmentBytes]);

  const imageHandler: ImageAPIHandler = {
    uploadImage: async (file: File) => {
      console.log('[Demo] Uploading image:', file.name);
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      return { url: dataUrl, alt: file.name };
    },
    getImageUrl: (url: string) => url,
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Beskar Editor Demo</h1>
        <div className="header-controls">
          {lastSaved && (
            <span className="last-saved">Last saved: {lastSaved.toLocaleTimeString()}</span>
          )}
          <Button onClick={handleResetDemoData} className="toggle-button" variant="soft" color="gray">
            Reset Demo Data
          </Button>
          <Button onClick={() => setIsSidePanelOpen(true)} className="toggle-button" variant="soft" color="indigo">
            💬 All Comments
          </Button>
          <Button onClick={() => setShowComments(!showComments)} className="toggle-button" variant="soft" color="cyan">
            {showComments ? '💬 Hide Inline' : '💬 Show Inline'}
          </Button>
          <Button onClick={() => setIsEditable(!isEditable)} className="toggle-button" variant="soft">
            {isEditable ? '👁️ View Mode' : '✏️ Edit Mode'}
          </Button>
        </div>
      </header>

      <main className={`editor-container ${showComments ? '' : 'comments-hidden'}`}>
        <Editor
          initialContent={content}
          editable={isEditable}
          placeholder="Start typing or type '/' for commands..."
          onUpdate={handleUpdate}
          onReady={handleReady}
          className={isEditable ? 'editable' : 'readonly'}
          imageHandler={imageHandler}
          attachmentHandler={mockAttachmentHandler}
          maxAttachmentBytes={maxAttachmentBytes}
          onAttachmentRejected={onAttachmentRejected}
          allowedMimeAccept=".pdf,.zip,.doc,.docx,.txt,.csv,application/*"
          commentHandler={mockCommentHandler}
        />

        {editor && (
          <>
            <TextFormattingMenu
              editor={editor}
              editable={isEditable}
              commentHandler={mockCommentHandler}
              onCommentClick={() => setShowCommentPopover(true)}
            />

            {isEditable && (
              <>
                <TableFloatingMenu editor={editor} />
                <CodeBlockFloatingMenu editor={editor} />
              </>
            )}

            {showComments && (
              <CommentGutter
                editor={editor}
                threads={derivedThreads}
                onThreadClick={handleGutterThreadClick}
              />
            )}

            {showCommentPopover && showComments && (
              <CommentInputPopover
                editor={editor}
                commentHandler={mockCommentHandler}
                documentId="demo-document"
                onClose={() => setShowCommentPopover(false)}
                onThreadCreated={async (threadId: string) => {
                  setShowCommentPopover(false);
                  const latest = await reloadThreads();
                  const idx = latest.findIndex((t) => t.id === threadId);
                  setCardFallbackRect(null);
                  setCardActiveIndex(idx >= 0 ? idx : 0);
                  setCommentCardOpen(true);
                }}
              />
            )}
            {ambiguousThreads.length > 0 && ambiguityRect && (
              <OverlapDisambiguationPopover
                editor={editor}
                threads={ambiguousThreads}
                anchorRect={ambiguityRect}
                onClose={() => setAmbiguousThreads([])}
                onSelect={(thread: CommentThread) => {
                  const idx = threads.findIndex((t) => t.id === thread.id);
                  if (idx >= 0) {
                    setCardActiveIndex(idx);
                    setCommentCardOpen(true);
                  }
                  setAmbiguousThreads([]);
                }}
              />
            )}
          </>
        )}
      </main>

      {/* Inline floating comment thread card */}
      {showCard && showComments && editor && derivedThreads.length > 0 && cardActiveIndex < derivedThreads.length && (
        <CommentThreadCard
          editor={editor}
          threads={derivedThreads}
          activeIndex={cardActiveIndex}
          fallbackAnchorRect={cardFallbackRect}
          commentHandler={mockCommentHandler}
          onClose={closeCard}
          onNavigate={setCardActiveIndex}
          onThreadUpdated={handleThreadUpdated}
          onThreadDeleted={handleThreadDeleted}
        />
      )}

      {/* Side Panel for displaying all comments (including orphaned ones) */}
      {editor && (
        <CommentSidePanel
          editor={editor}
          threads={derivedThreads}
          commentHandler={mockCommentHandler}
          documentId="demo-document"
          isOpen={isSidePanelOpen}
          onClose={() => setIsSidePanelOpen(false)}
          onThreadUpdated={handleThreadUpdated}
          onThreadDeleted={handleThreadDeleted}
        />
      )}

      <footer className="app-footer">
        <details className="json-viewer">
          <summary>📄 View Content JSON</summary>
          <pre>{JSON.stringify(content, null, 2)}</pre>
        </details>
      </footer>
    </div>
  );
}

export default App;
