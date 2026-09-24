import type { Editor } from '@tiptap/core';
import { Bold, Code2, ExternalLink, Highlighter, Italic, Link, List, ListOrdered, Trash2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { normalizeExternalUrl } from './model.js';

export interface CanvasTextToolbarProps {
  editor: Editor;
}

interface ToolButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: React.ReactNode;
}

interface LinkBubbleAnchor {
  left: number;
  top: number;
}

function ToolButton({ label, active, disabled, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      className="canvas-text-toolbar__button"
      data-active={active || undefined}
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={event => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function normalizeLinkInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return normalizeExternalUrl(trimmed) ?? (!trimmed.includes(':') ? normalizeExternalUrl(`https://${trimmed}`) : null);
}

function displayLink(href: string | null): string {
  return href?.replace(/^https?:\/\//, '') ?? '';
}

export function CanvasTextToolbar({ editor }: CanvasTextToolbarProps) {
  const [linkBubbleOpen, setLinkBubbleOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkAnchor, setLinkAnchor] = useState<LinkBubbleAnchor | null>(null);
  const linkBubbleRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const linkInputId = useId();

  const openLinkBubble = () => {
    const currentHref = (editor.getAttributes('link').href as string | undefined) ?? null;
    const selection = editor.view.dom.ownerDocument.getSelection();
    const rangeRect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    const fromCoords = editor.view.coordsAtPos(editor.state.selection.from);
    const toCoords = editor.view.coordsAtPos(editor.state.selection.to);
    const hasRangeRect = rangeRect && (rangeRect.width > 0 || rangeRect.height > 0);

    setLinkAnchor({
      left: hasRangeRect ? rangeRect.left + rangeRect.width / 2 : (fromCoords.left + toCoords.right) / 2,
      top: hasRangeRect ? rangeRect.top : Math.min(fromCoords.top, toCoords.top),
    });
    setLinkHref(displayLink(currentHref));
    setLinkError('');
    setLinkBubbleOpen(true);
  };

  const closeLinkBubble = (focusEditor = true) => {
    setLinkBubbleOpen(false);
    setLinkError('');
    if (focusEditor) editor.commands.focus();
  };

  useLayoutEffect(() => {
    if (!linkBubbleOpen || !linkAnchor || !linkBubbleRef.current) return;
    const bubble = linkBubbleRef.current;
    const halfWidth = bubble.offsetWidth / 2;
    const clampedLeft = Math.min(
      Math.max(linkAnchor.left, halfWidth + 8),
      window.innerWidth - halfWidth - 8,
    );
    bubble.style.left = `${clampedLeft}px`;
    bubble.style.top = `${Math.max(linkAnchor.top - 8, bubble.offsetHeight + 8)}px`;
    linkInputRef.current?.focus();
    linkInputRef.current?.select();
  }, [linkAnchor, linkBubbleOpen, linkError]);

  useEffect(() => {
    if (!linkBubbleOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!linkBubbleRef.current?.contains(event.target as Node)) closeLinkBubble(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
    };
  }, [linkBubbleOpen]);

  const applyLink = () => {
    const safeHref = normalizeLinkInput(linkHref);
    if (!safeHref) {
      setLinkError('Enter an HTTP, HTTPS, or email link.');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: safeHref }).run();
    setLinkHref(displayLink(safeHref));
    setLinkBubbleOpen(false);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkBubbleOpen(false);
  };

  const safeLink = normalizeLinkInput(linkHref);

  return (
    <>
      <div className="canvas-text-toolbar" role="toolbar" aria-label="Text formatting">
        <ToolButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></ToolButton>
        <ToolButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></ToolButton>
        <ToolButton label="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code2 /></ToolButton>
        <ToolButton label="Highlight" active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight({ color: '#fff3a3' }).run()}><Highlighter /></ToolButton>
        <span className="canvas-text-toolbar__separator" aria-hidden="true" />
        <ToolButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></ToolButton>
        <ToolButton label="Ordered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></ToolButton>
        <span className="canvas-text-toolbar__separator" aria-hidden="true" />
        <ToolButton label="Link" active={editor.isActive('link') || linkBubbleOpen} onClick={openLinkBubble}><Link /></ToolButton>
      </div>

      {linkBubbleOpen && linkAnchor ? createPortal(
        <div ref={linkBubbleRef} className="canvas-text-link-bubble">
        <form
          className="canvas-text-link-bubble__form"
          aria-label="Edit link"
          onSubmit={event => { event.preventDefault(); applyLink(); }}
        >
          <label className="canvas-text-link-bubble__label" htmlFor={linkInputId}>Link URL</label>
          <input
            id={linkInputId}
            ref={linkInputRef}
            value={linkHref}
            onChange={event => { setLinkHref(event.target.value); setLinkError(''); }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                closeLinkBubble();
              }
            }}
            placeholder="example.com"
            spellCheck={false}
          />
          <button
            type="button"
            aria-label="Open link"
            title="Open link"
            disabled={!safeLink}
            onClick={() => { if (safeLink) window.open(safeLink, '_blank', 'noopener,noreferrer'); }}
          >
            <ExternalLink />
          </button>
          <button type="button" aria-label="Remove link" title="Remove link" onClick={removeLink}>
            <Trash2 />
          </button>
          {linkError ? <span className="canvas-text-link-bubble__error" role="alert">{linkError}</span> : null}
        </form>
        </div>,
        editor.view.dom.ownerDocument.body,
      ) : null}
    </>
  );
}
