import React, { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';

interface Props {
  caption: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSave: (caption: string) => void;
  children: React.ReactNode;
}

/** Preview never steals focus; explicit editing owns a draft until Save. */
export function InlineImageCaption({ caption, editing, onEditingChange, onSave, children }: Props) {
  const [preview, setPreview] = useState(false);
  const [draft, setDraft] = useState(caption);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const open = editing || (!!caption && preview);
  const clear = () => clearTimeout(timer.current);
  const enter = () => { clear(); timer.current = setTimeout(() => setPreview(true), 300); };
  const leave = () => { clear(); timer.current = setTimeout(() => {
    if (!anchor.current?.contains(document.activeElement) && !content.current?.contains(document.activeElement)) setPreview(false);
  }, 200); };
  const close = () => {
    clear(); setPreview(false);
    if (editing) onEditingChange(false);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (editing) { setDraft(caption); clearTimeout(timer.current); }
  }, [editing, caption]);
  useEffect(() => { if (editing && open) input.current?.focus(); }, [editing, open]);

  return <Popover.Root open={open} onOpenChange={next => { if (!next) close(); }}>
    <Popover.Anchor asChild>
      <span ref={anchor} className="inline-image-caption-anchor" contentEditable={false}
        onMouseEnter={enter} onMouseLeave={leave}
        onFocus={() => { clear(); setPreview(true); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) leave(); }}>
        {children}

      </span>
    </Popover.Anchor>
    <Popover.Portal>
      <Popover.Content ref={content} className={`inline-image-caption-popover ${editing ? 'is-editing' : 'is-preview'}`} side="bottom" sideOffset={6} collisionPadding={12}
        aria-label={editing ? 'Edit image caption' : 'Image caption'}
        onMouseEnter={() => { clear(); setPreview(true); }} onMouseLeave={leave}
        onFocus={() => { clear(); setPreview(true); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) leave(); }}
        onOpenAutoFocus={event => { event.preventDefault(); if (editing) input.current?.focus(); }}
        onCloseAutoFocus={event => event.preventDefault()}
        onInteractOutside={event => { if (anchor.current?.contains(event.target as Node)) event.preventDefault(); }}
        onEscapeKeyDown={event => { event.stopPropagation(); close(); }}>
        {editing ? <>
          <label>Caption<textarea ref={input} aria-label="Image caption text" value={draft} placeholder="Add a caption…" rows={3}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); return; } if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { onSave(draft); close(); } }} /></label>
          <span className="inline-image-caption-actions">
            <button type="button" onClick={close}>Cancel</button>
            <button type="button" className="inline-image-caption-save" onClick={() => { onSave(draft); close(); }}>Save</button>
          </span>
        </> : <>
          <span className="inline-image-caption-text">{caption}</span>
        </>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
