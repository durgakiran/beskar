import { Editor, findParentNode, posToDOMRect } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CommentThread } from '../types';
import { resolveAnchor } from './anchorResolution';

export const COMMENT_ANCHOR_GAP_PX = 10;
export const COMMENT_ANCHOR_MARGIN_PX = 8;

export function resolveBlockWrapperElement(
  dom: Node | null,
  codeBlockTypeName?: string,
): HTMLElement | null {
  if (!dom) return null;

  const useCodeWrapper =
    codeBlockTypeName === 'codeBlock' || codeBlockTypeName === 'codeBlockLowlight';

  if (dom instanceof HTMLElement) {
    if (useCodeWrapper) {
      return dom.classList?.contains('code-block-wrapper')
        ? dom
        : dom.closest?.('.code-block-wrapper') || dom;
    }
    return dom;
  }

  if (dom instanceof Node) {
    const htmlDom = dom as unknown as {
      classList?: { contains?: (c: string) => boolean };
      closest?: (s: string) => HTMLElement | null;
      parentElement?: HTMLElement | null;
    };
    if (htmlDom?.classList?.contains?.('code-block-wrapper')) {
      return htmlDom as HTMLElement;
    }
    if (htmlDom?.closest) {
      return htmlDom.closest('.code-block-wrapper');
    }
    if (htmlDom?.parentElement) {
      return htmlDom.parentElement.closest?.('.code-block-wrapper') ?? null;
    }
  }

  return (dom as Node).parentElement;
}

export function getBlockDomForSelection(editor: Editor, selection: TextSelection): HTMLElement | null {
  const { view } = editor;
  const block = findParentNode((node) => node.isBlock && node.type.name !== 'doc')(selection);
  if (!block) return null;
  const dom = view.nodeDOM(block.pos);
  return resolveBlockWrapperElement(dom, block.node.type.name);
}

export function getAnchorRectForRange(editor: Editor, from: number, to: number): DOMRect | null {
  try {
    const sel = TextSelection.create(editor.state.doc, from, to);
    const wrapper = getBlockDomForSelection(editor, sel);
    if (wrapper) return wrapper.getBoundingClientRect();
    return posToDOMRect(editor.view, from, to);
  } catch {
    return null;
  }
}

/** Min/max text positions covered by a comment mark with the given id. */
export function findCommentDocRange(doc: PMNode, commentId: string): { from: number; to: number } | null {
  let from: number | null = null;
  let to: number | null = null;
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === 'comment' && m.attrs.commentId === commentId);
    if (mark) {
      const a = pos;
      const b = pos + node.nodeSize;
      if (from === null || a < from) from = a;
      if (to === null || b > to) to = b;
    }
  });
  if (from === null || to === null) return null;
  return { from, to };
}

export function getAnchorRectForCommentId(editor: Editor, thread: CommentThread): DOMRect | null {
  const range = resolveAnchor(editor.state.doc, thread.anchor);
  if (!range) return null;
  return getAnchorRectForRange(editor, range.from, range.to);
}

/** Innermost ancestor that scrolls; otherwise the editor root for window scroll. */
export function findPositioningParent(pmRoot: HTMLElement): HTMLElement {
  let current: HTMLElement | null = pmRoot.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    const style = getComputedStyle(current);
    const oy = style.overflowY;
    const ox = style.overflowX;
    const scrollableY = /(auto|scroll|overlay)/.test(oy) && current.scrollHeight > current.clientHeight;
    const scrollableX = /(auto|scroll|overlay)/.test(ox) && current.scrollWidth > current.clientWidth;
    if (scrollableY || scrollableX) {
      return current;
    }
    current = current.parentElement;
  }
  const editorRoot = pmRoot.closest('.beskar-editor') as HTMLElement | null;
  return editorRoot ?? pmRoot.parentElement ?? document.body;
}

export interface PlacementInParentOptions {
  elementWidth: number;
  elementHeight: number;
}

export function computePlacementInParent(
  parent: HTMLElement,
  nodeRect: DOMRect,
  { elementWidth, elementHeight }: PlacementInParentOptions,
): { left: number; top: number } {
  const pRect = parent.getBoundingClientRect();
  const desiredLeft = nodeRect.right - pRect.left + parent.scrollLeft + COMMENT_ANCHOR_GAP_PX;
  let top = nodeRect.top + nodeRect.height / 2 - pRect.top + parent.scrollTop;

  const minLeft = parent.scrollLeft + COMMENT_ANCHOR_MARGIN_PX;
  const maxLeft = Math.max(
    minLeft,
    parent.scrollLeft + parent.clientWidth - elementWidth - COMMENT_ANCHOR_MARGIN_PX,
  );
  const left = Math.min(Math.max(desiredLeft, minLeft), maxLeft);

  const halfH = elementHeight / 2;
  const minTop = parent.scrollTop + halfH + COMMENT_ANCHOR_MARGIN_PX;
  const maxTop = Math.max(
    minTop,
    parent.scrollTop + parent.clientHeight - halfH - COMMENT_ANCHOR_MARGIN_PX,
  );
  top = Math.min(Math.max(top, minTop), maxTop);

  return { left, top };
}
