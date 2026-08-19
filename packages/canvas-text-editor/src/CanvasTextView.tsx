import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Fragment, useEffect, useState } from 'react';
import type { XmlFragment } from 'yjs';
import type { CanvasTextFragment } from './extensions.js';
import {
  normalizeCanvasRichTextOrFallback,
  type CanvasRichTextMark,
  type CanvasRichTextNode,
  type CanvasTextValue,
} from './model.js';

export interface CanvasTextViewProps {
  value: CanvasTextValue | unknown;
  className?: string;
  style?: CSSProperties;
  fallbackText?: string;
  /** Optional live Yjs source. The serialized value remains the durable fallback. */
  fragment?: CanvasTextFragment;
  readOnly?: boolean;
  linkActivation?: 'none' | 'modified-click' | 'click';
}

function renderMarks(content: ReactNode, marks: CanvasRichTextMark[] = [], key: string): ReactNode {
  return marks.reduce<ReactNode>((child, mark, index) => {
    const markKey = `${key}-mark-${index}`;
    if (mark.type === 'bold') return <strong key={markKey}>{child}</strong>;
    if (mark.type === 'italic') return <em key={markKey}>{child}</em>;
    if (mark.type === 'code') return <code key={markKey}>{child}</code>;
    if (mark.type === 'highlight') {
      return <mark key={markKey} style={{ backgroundColor: mark.attrs?.color }}>{child}</mark>;
    }
    if (mark.type === 'link') {
      return <a key={markKey} href={mark.attrs?.href} target="_blank" rel="noopener noreferrer nofollow">{child}</a>;
    }
    return child;
  }, content);
}

function renderNode(node: CanvasRichTextNode, key: string): ReactNode {
  if (node.type === 'text') return renderMarks(node.text ?? '', node.marks, key);
  if (node.type === 'hardBreak') return <br key={key} />;
  const children = (node.content ?? []).map((child, index) => renderNode(child, `${key}-${index}`));
  if (node.type === 'doc') return <Fragment key={key}>{children}</Fragment>;
  if (node.type === 'paragraph') return <p key={key}>{children.length ? children : <br />}</p>;
  if (node.type === 'bulletList') return <ul key={key}>{children}</ul>;
  if (node.type === 'orderedList') return <ol key={key} start={node.attrs?.start as number | undefined}>{children}</ol>;
  if (node.type === 'listItem') return <li key={key}>{children}</li>;
  return null;
}

export function CanvasTextView({
  value,
  className,
  style,
  fallbackText = '',
  fragment,
  readOnly = true,
  linkActivation = 'none',
}: CanvasTextViewProps) {
  const [, setFragmentVersion] = useState(0);
  useEffect(() => {
    if (!fragment?.observeDeep || !fragment.unobserveDeep) return;
    const onChange = () => setFragmentVersion(version => version + 1);
    fragment.observeDeep(onChange);
    return () => fragment.unobserveDeep?.(onChange);
  }, [fragment]);
  const liveValue = fragment && fragment.length > 0
    ? yXmlFragmentToProsemirrorJSON(fragment as XmlFragment)
    : value;
  const document = normalizeCanvasRichTextOrFallback(liveValue, fallbackText);
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest('a');
    if (!anchor) return;
    if (linkActivation === 'none' || (linkActivation === 'modified-click' && !event.metaKey && !event.ctrlKey)) {
      event.preventDefault();
    }
  };
  return (
    <div
      className={['canvas-text-view', className].filter(Boolean).join(' ')}
      style={style}
      dir="auto"
      aria-readonly={readOnly || undefined}
      data-link-activation={linkActivation}
      onClick={handleClick}
    >
      {renderNode(document.doc, 'root')}
    </div>
  );
}
