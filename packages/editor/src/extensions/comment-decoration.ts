import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { resolveAnchor } from '../utils/anchorResolution';
import type { CommentThread } from '../types';

export const commentDecorationKey = new PluginKey('commentDecoration');

export interface CommentDecorationState {
  threads: CommentThread[];
  decorations: DecorationSet;
  activeThreadId: string | null;
}

export function commentDecorationPlugin(editable: boolean) {
  return new Plugin<CommentDecorationState>({
    key: commentDecorationKey,
    state: {
      init() {
        return {
          threads: [],
          decorations: DecorationSet.empty,
          activeThreadId: null,
        };
      },
      apply(tr, value, oldState, newState) {
        // Handle meta updates (setting threads / changing active thread)
        const meta = tr.getMeta(commentDecorationKey);
        if (meta) {
          const nextThreads = meta.threads ?? value.threads;
          const nextActiveId = meta.activeThreadId ?? value.activeThreadId;

          // CRITICAL: Preserve mapped positions for existing threads.
          //
          // resolveAnchor matches the ORIGINAL quotedText. If the user edited text
          // inside a highlight since the decoration was first placed, quotedText no
          // longer matches the current document content. Re-resolving from anchor would
          // fail → existing comments disappear when a new comment is added.
          //
          // Instead we read the current (position-mapped) DecorationSet and build a
          // threadId → {from, to} map. Existing threads reuse those positions;
          // brand-new threads (not yet in the set) are resolved via resolveAnchor.
          const existingPositions = new Map<string, { from: number; to: number }>();
          value.decorations.find(0, newState.doc.content.size).forEach((deco: any) => {
            const id: string | undefined = deco.spec?.['data-comment-id'];
            if (id && !existingPositions.has(id)) {
              existingPositions.set(id, { from: deco.from, to: deco.to });
            }
          });

          return {
            threads: nextThreads,
            activeThreadId: nextActiveId,
            decorations: createDecorationSet(
              newState.doc, nextThreads, nextActiveId, editable, existingPositions,
            ),
          };
        }

        // Handle document changes: map decoration positions through this transaction.
        //
        // We deliberately use DecorationSet.map() here instead of calling
        // createDecorationSet(). The old approach re-ran resolveAnchor on every
        // keystroke and failed as soon as a single character was deleted from the
        // highlighted text (quotedText no longer matches → resolveAnchor returns null
        // → highlight disappears).
        //
        // DecorationSet.map() uses ProseMirror's StepMap to slide decoration
        // boundaries as the document changes, so:
        //   • Typing inside a highlight extends the highlighted span.
        //   • Deleting inside a highlight shrinks it.
        //   • Deleting ALL highlighted text collapses from === to (zero-width)
        //     and ProseMirror automatically removes the decoration from the set.
        //     The orphan detection in App.tsx picks this up on the next transaction.
        if (tr.docChanged) {
          return {
            ...value,
            decorations: value.decorations.map(tr.mapping, tr.doc),
          };
        }

        return value;
      },
    },
    props: {
      decorations(state) {
        return commentDecorationKey.getState(state)?.decorations;
      },
      handleDOMEvents: {
        click(view, event) {
          const target = event.target as HTMLElement;
          const targetCommentId = target.closest?.('[data-comment-id]')?.getAttribute('data-comment-id');
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          const pluginState = commentDecorationKey.getState(view.state);
          if (!pluginState) return false;

          const commentIds = new Set<string>();

          if (targetCommentId) {
            commentIds.add(targetCommentId);
          }

          if (pos) {
            // Use a small range around the click so inline decorations are found reliably.
            const decos = pluginState.decorations.find(Math.max(0, pos.pos - 1), pos.pos + 1);
            decos
              .map((d: any) => d.spec['data-comment-id'])
              .filter((id: any): id is string => !!id)
              .forEach((id: string) => commentIds.add(id));
          }

          if (commentIds.size === 0) return false;

          const selection = window.getSelection();
          if (selection && selection.type === 'Range') return false;

          const resolvedIds = Array.from(commentIds);
          
          if (resolvedIds.length > 1) {
            // Multiple comments: trigger disambiguation
            target.dispatchEvent(new CustomEvent('COMMENT_AMBIGUITY_DETECTED', {
              bubbles: true,
              detail: { 
                commentIds: resolvedIds, 
                // We use the clicked target's rect as a hint for popover positioning
                rect: target.getBoundingClientRect() 
              },
            }));
          } else {
            // Single comment: trigger normal open
            target.dispatchEvent(new CustomEvent('COMMENT_CLICKED', {
              bubbles: true,
              detail: { commentId: resolvedIds[0] },
            }));
          }

          return true;
        },
      },
    },
  });
}


function createDecorationSet(
  doc: any,
  threads: CommentThread[],
  activeThreadId: string | null,
  editable: boolean,
  // Mapped positions from the current DecorationSet — preferred over resolveAnchor
  // for existing threads so edits inside highlights don't break the decoration.
  existingPositions: Map<string, { from: number; to: number }> = new Map(),
): DecorationSet {
  const decorations: { from: number; to: number; id: string; deco: Decoration }[] = [];

  // Limit processing to prevent runaway recursion if document state is pathological
  const maxDecoratedThreads = 500;
  const threadsToProcess = threads.slice(0, maxDecoratedThreads);

  threadsToProcess.forEach((thread) => {
    // Hidden threads or resolved threads that are not active should not be rendered
    if (!editable && thread.publishedVisible !== true) return;
    if (thread.orphaned || (thread.resolvedAt && thread.id !== activeThreadId)) return;

    const isActive = thread.id === activeThreadId;
    const existing = existingPositions.get(thread.id);

    let from: number;
    let to: number;

    if (existing && existing.from < existing.to) {
      // Reuse the position already tracked by DecorationSet.map().
      // This is accurate even after the user edits text inside the highlight —
      // the anchor's quotedText may no longer match but the mapped position is correct.
      from = existing.from;
      to = existing.to;
    } else {
      // Brand-new thread (or collapsed decoration) — resolve from anchor text.
      const range = resolveAnchor(doc, thread.anchor);
      if (!range || range.from >= range.to) return;
      from = range.from;
      to = range.to;
    }

    decorations.push({
      from,
      to,
      id: thread.id,
      deco: Decoration.inline(
        from,
        to,
        {
          // attrs — rendered as DOM attributes on the highlight span
          class: `comment-highlight ${isActive ? 'is-active' : ''}`,
          'data-comment-id': thread.id,
        },
        {
          // spec — metadata that travels through DecorationSet.map() and is
          // accessible via deco.spec in DecorationSet.find() predicates.
          'data-comment-id': thread.id,
        },
      ),
    });
  });

  // CRITICAL: Stable sort by document order.
  // 1. Primary: 'from' position
  // 2. Secondary: 'to' position (helps nested decorations stability)
  // 3. Tertiary: ID (guarantees deterministic order even if positions match)
  decorations.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    if (a.to !== b.to) return b.to - a.to; // Longer spans first for easier nesting
    return a.id.localeCompare(b.id);
  });

  return DecorationSet.create(
    doc,
    decorations.map(d => d.deco)
  );
}
