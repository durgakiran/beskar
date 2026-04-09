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

export function commentDecorationPlugin() {
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
        // Handle meta updates (setting threads)
        const meta = tr.getMeta(commentDecorationKey);
        if (meta) {
          const nextThreads = meta.threads ?? value.threads;
          const nextActiveId = meta.activeThreadId ?? value.activeThreadId;
          
          return {
            threads: nextThreads,
            activeThreadId: nextActiveId,
            decorations: createDecorationSet(newState.doc, nextThreads, nextActiveId),
          };
        }

        // Handle document changes (map decorations)
        if (tr.docChanged) {
          // Instead of pure mapping, we re-resolve anchors to handle text shifts better
          // than standard decoration mapping, especially with our cascade strategy.
          return {
            ...value,
            decorations: createDecorationSet(newState.doc, value.threads, value.activeThreadId),
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


function createDecorationSet(doc: any, threads: CommentThread[], activeThreadId: string | null): DecorationSet {
  const decorations: { from: number; to: number; id: string; deco: Decoration }[] = [];

  // Limit processing to prevent runaway recursion if document state is pathological
  const maxDecoratedThreads = 500;
  const threadsToProcess = threads.slice(0, maxDecoratedThreads);

  threadsToProcess.forEach((thread) => {
    // Hidden threads or resolved threads that are not active should not be rendered
    if (thread.orphaned || (thread.resolvedAt && thread.id !== activeThreadId)) return;

    const range = resolveAnchor(doc, thread.anchor);
    if (range && range.from < range.to) {
      const isActive = thread.id === activeThreadId;
      decorations.push({
        from: range.from,
        to: range.to,
        id: thread.id,
        deco: Decoration.inline(range.from, range.to, {
          class: `comment-highlight ${isActive ? 'is-active' : ''}`,
          'data-comment-id': thread.id,
          style: 'background-color: rgba(253, 224, 71, 0.4); cursor: pointer; border-bottom: 2px solid #fbbf24;',
        }),
      });
    }
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
