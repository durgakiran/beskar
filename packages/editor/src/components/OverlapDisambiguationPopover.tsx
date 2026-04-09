import React, { useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Editor } from '@tiptap/core';
import type { CommentThread } from '../types';
import { findPositioningParent } from '../utils/commentAnchorPositioning';
import './OverlapDisambiguationPopover.css';

function getInitials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function Avatar({ name }: { name: string | null }) {
  return (
    <div className="odp-avatar" title={name ?? 'Deleted user'}>
      {getInitials(name)}
    </div>
  );
}

export interface OverlapDisambiguationPopoverProps {
  editor: Editor;
  threads: CommentThread[];
  onSelect: (thread: CommentThread) => void;
  onClose: () => void;
  anchorRect: DOMRect;
}

export function OverlapDisambiguationPopover({
  editor,
  threads,
  onSelect,
  onClose,
  anchorRect,
}: OverlapDisambiguationPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  const positioningParent = useMemo(
    () => findPositioningParent(editor.view.dom as HTMLElement),
    [editor],
  );

  const placement = useMemo(() => {
    const pRect = positioningParent.getBoundingClientRect();
    return {
      left: anchorRect.left - pRect.left + positioningParent.scrollLeft,
      top: anchorRect.bottom - pRect.top + positioningParent.scrollTop + 5,
    };
  }, [anchorRect, positioningParent]);

  return createPortal(
    <>
      <div className="odp-backdrop" onClick={onClose} />
      <div
        ref={popoverRef}
        className="overlap-disambiguation-popover"
        style={{
          position: 'absolute',
          left: `${placement.left}px`,
          top: `${placement.top}px`,
          zIndex: 1000,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="odp-header">Select a comment</div>
        <div className="odp-list">
          {threads.map((thread) => (
            <button
              key={thread.id}
              className="odp-item"
              onClick={() => {
                onSelect(thread);
                onClose();
              }}
            >
              <Avatar name={thread.createdByName} />
              <div className="odp-item-content">
                <div className="odp-item-author">{thread.createdByName ?? '👤 Deleted User'}</div>
                <div className="odp-item-quote">"{thread.anchor.quotedText}"</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>,
    positioningParent,
  );
}
