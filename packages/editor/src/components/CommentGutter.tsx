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
    const commentIdToThread = new Map<string, CommentThread>();
    activeThreads.forEach((t) => commentIdToThread.set(t.commentId, t));

    const seen = new Set<string>();
    state.doc.descendants((node, pos) => {
      node.marks.forEach((mark) => {
        if (mark.type.name === 'comment' && mark.attrs.commentId) {
          const thread = commentIdToThread.get(mark.attrs.commentId);
          if (thread && !seen.has(thread.id)) {
            seen.add(thread.id);
            try {
              const coords = view.coordsAtPos(pos);
              const y = coords.top - pmRect.top;
              newPositions.push({
                threadId: thread.id,
                y,
                count: thread.replies.length,
              });
            } catch {
              // pos out of range
            }
          }
        }
      });
    });

    setLayout({ frame, positions: newPositions });
  }, [editor, threads, positioningParent]);

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
            💬
          </span>
          {p.count > 0 ? <span className="comment-gutter-pill-count">{p.count}</span> : null}
        </button>
      ))}
    </div>,
    positioningParent,
  );
}
