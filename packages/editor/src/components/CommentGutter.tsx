/**
 * CommentGutter
 *
 * Floating pills to the right of the ProseMirror surface, one per active thread.
 * Portaled into the same positioning parent as CommentInputPopover / CommentThreadCard
 * with position:absolute so layout tracks editor scroll without fixed viewport hacks.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/core';
import type { CommentThread } from '../types';
import { findPositioningParent, COMMENT_ANCHOR_GAP_PX } from '../utils/commentAnchorPositioning';
import { commentDecorationKey } from '../extensions/comment-decoration';
import { FiMessageSquare } from 'react-icons/fi';
import './CommentGutter.css';

export interface CommentGutterProps {
  editor: Editor;
  threads: CommentThread[];
  onThreadClick: (threadId: string) => void;
}

interface PillPosition {
  threadId: string;
  y: number;
  count: number;
}

interface GutterFrame {
  left: number;
  top: number;
  height: number;
}

export function CommentGutter({ editor, threads, onThreadClick }: CommentGutterProps) {
  const positioningParent = useMemo(
    () => findPositioningParent(editor.view.dom as HTMLElement),
    [editor],
  );

  const [layout, setLayout] = useState<{ frame: GutterFrame | null; positions: PillPosition[] }>({
    frame: null,
    positions: [],
  });

  const recalculate = useCallback(() => {
    const parent = positioningParent;
    const { state, view } = editor;
    const pm = view.dom as HTMLElement;
    const pmRect = pm.getBoundingClientRect();
    const pRect = parent.getBoundingClientRect();

    const frame: GutterFrame = {
      left: pmRect.right - pRect.left + parent.scrollLeft + COMMENT_ANCHOR_GAP_PX,
      top: pmRect.top - pRect.top + parent.scrollTop,
      height: pmRect.height,
    };

    const newPositions: PillPosition[] = [];
    const activeThreads = threads.filter((t) => !t.resolvedAt && !t.orphaned);

    // Read the current decoration set from the plugin — it holds mapped positions,
    // which are the source of truth after DecorationSet.map() updates.
    // Single scan builds a threadId→from map so we avoid N separate find() calls.
    const pluginState = commentDecorationKey.getState(state);
    const threadFromPos = new Map<string, number>();
    if (pluginState) {
      pluginState.decorations
        .find(0, state.doc.content.size)
        .forEach((deco: any) => {
          const id: string | undefined = deco.spec?.['data-comment-id'];
          if (id && !threadFromPos.has(id)) threadFromPos.set(id, deco.from);
        });
    }

    activeThreads.forEach((thread) => {
      const from = threadFromPos.get(thread.id);
      if (from !== undefined) {
        try {
          const coords = view.coordsAtPos(from);
          const y = coords.top - pmRect.top;
          newPositions.push({
            threadId: thread.id,
            y,
            count: thread.replies.length,
          });
        } catch {
          // pos out of range — decoration may be collapsed (all text deleted)
        }
      }
    });

    // Prevent pills from overlapping by staggering them vertically
    newPositions.sort((a, b) => a.y - b.y);
    const PILL_SPACING = 30; // Approx height + gap
    for (let i = 1; i < newPositions.length; i++) {
      if (newPositions[i].y < newPositions[i - 1].y + PILL_SPACING) {
        newPositions[i].y = newPositions[i - 1].y + PILL_SPACING;
      }
    }

    setLayout({ frame, positions: newPositions });
  }, [editor, threads, positioningParent]);

  useEffect(() => {
    const { state, view } = editor;
    const pluginState = commentDecorationKey.getState(state);
    const currentThreads = pluginState?.threads ?? [];
    const sameThreads =
      currentThreads.length === threads.length &&
      currentThreads.every((thread: CommentThread, index: number) => thread === threads[index]);

    if (sameThreads) {
      return;
    }

    view.dispatch(state.tr.setMeta(commentDecorationKey, { threads }));
  }, [editor, threads]);

  useLayoutEffect(() => {
    const parent = positioningParent;
    const computed = getComputedStyle(parent).position;
    const madeRelative = computed === 'static';
    if (madeRelative) {
      parent.style.position = 'relative';
    }
    return () => {
      if (madeRelative) {
        parent.style.position = '';
      }
    };
  }, [positioningParent]);

  useEffect(() => {
    const parent = positioningParent;
    recalculate();
    editor.on('transaction', recalculate);
    editor.on('update', recalculate);
    window.addEventListener('resize', recalculate);
    parent.addEventListener('scroll', recalculate, { passive: true });
    return () => {
      editor.off('transaction', recalculate);
      editor.off('update', recalculate);
      window.removeEventListener('resize', recalculate);
      parent.removeEventListener('scroll', recalculate);
    };
  }, [editor, recalculate, positioningParent]);

  if (layout.positions.length === 0 || !layout.frame) {
    return null;
  }

  const { frame, positions } = layout;

  return createPortal(
    <div
      className="comment-gutter"
      style={{
        position: 'absolute',
        left: `${frame.left}px`,
        top: `${frame.top}px`,
        height: `${frame.height}px`,
        minWidth: '2.5rem',
        pointerEvents: 'none',
        zIndex: 90,
        overflow: 'visible',
      }}
    >
      {positions.map((p) => (
        <button
          key={p.threadId}
          type="button"
          className="comment-gutter-pill"
          style={{ top: p.y }}
          onClick={() => onThreadClick(p.threadId)}
          title="View comment"
        >
          <span className="comment-gutter-pill-icon" aria-hidden>
            <FiMessageSquare size={14} />
          </span>
          {p.count > 0 ? <span className="comment-gutter-pill-count">{p.count}</span> : null}
        </button>
      ))}
    </div>,
    positioningParent,
  );
}
