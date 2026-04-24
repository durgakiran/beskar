/**
 * ChildPagesListView - renders child pages supplied by the consuming app.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Flex, Spinner, Text } from '@radix-ui/themes';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { ChildPageResult, ChildPagesHandler } from '../../types';

function getHandler(editor: NodeViewProps['editor']): ChildPagesHandler | undefined {
  return (editor.storage as any).childPagesList?.childPagesHandler;
}

function flattenTree(pages: ChildPageResult[]): ChildPageResult[] {
  const flattened: ChildPageResult[] = [];

  const walk = (items: ChildPageResult[]) => {
    items.forEach((item) => {
      flattened.push(item);
      if (item.children?.length) walk(item.children);
    });
  };

  walk(pages);
  return flattened;
}

function flatDepthToTree(pages: ChildPageResult[]): ChildPageResult[] {
  const roots: ChildPageResult[] = [];
  const stack: ChildPageResult[] = [];

  pages.forEach((page) => {
    const depth = Math.max(0, page.depth ?? 0);
    const node: ChildPageResult = { ...page, children: page.children ? [...page.children] : [] };

    if (depth === 0) {
      roots.push(node);
      stack[0] = node;
      stack.length = 1;
      return;
    }

    const parent = stack[depth - 1];
    if (!parent) {
      roots.push(node);
      stack[0] = node;
      stack.length = 1;
      return;
    }

    parent.children = [...(parent.children ?? []), node];
    stack[depth] = node;
    stack.length = depth + 1;
  });

  return roots;
}

export function ChildPagesListView({ node, editor }: NodeViewProps) {
  const attrs = node.attrs as {
    title: string;
  };
  const handler = getHandler(editor);
  const [pages, setPages] = useState<ChildPageResult[]>([]);
  const [state, setState] = useState<'loading' | 'idle' | 'empty' | 'error'>('loading');

  const loadPages = useCallback(async () => {
    if (!handler) {
      setState('error');
      return;
    }

    setState('loading');
    try {
      const nextPages = handler.getPageHierarchy
        ? await handler.getPageHierarchy()
        : await handler.getChildPages?.();
      const normalizedPages = nextPages ?? [];
      setPages(normalizedPages);
      setState(flattenTree(flatDepthToTree(normalizedPages)).length === 0 ? 'empty' : 'idle');
    } catch {
      setPages([]);
      setState('error');
    }
  }, [handler]);

  useEffect(() => {
    void loadPages();
  }, [loadPages]);

  const title = attrs.title?.trim() || 'Child pages';
  const tree = flatDepthToTree(pages);
  const pageCount = flattenTree(tree).length;

  const renderTree = (items: ChildPageResult[], depth = 0): React.ReactNode => (
    <ul className={`child-pages-tree${depth > 0 ? ' child-pages-tree--nested' : ''}`}>
      {items.map((page) => (
        <li key={page.pageId} className="child-pages-tree__item">
          <button
            type="button"
            className="child-pages-tree__link"
            onClick={() => handler?.navigateToChildPage(page.pageId)}
          >
            {page.title || 'Untitled page'}
          </button>
          {page.children?.length ? renderTree(page.children, depth + 1) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <NodeViewWrapper className="child-pages-list-wrapper" data-drag-handle>
      <section className="child-pages-list" contentEditable={false}>
        <Flex align="center" justify="between" gap="3" className="child-pages-list__header">
          <Flex direction="column" gap="1">
            <Text as="div" size="3" weight="bold">{title}</Text>
            <Text size="1" color="gray">
              {state === 'idle' ? `${pageCount} linked page${pageCount === 1 ? '' : 's'}` : 'Descendant pages in this page hierarchy'}
            </Text>
          </Flex>
        </Flex>

        <div className="child-pages-list__body">
          {state === 'loading' && (
            <Flex align="center" gap="2" className="child-pages-list__state">
              <Spinner size="1" />
              <Text size="2" color="gray">Loading child pages...</Text>
            </Flex>
          )}

          {state === 'error' && (
            <Flex align="center" justify="between" gap="3" className="child-pages-list__state child-pages-list__state--error">
              <Text size="2" color="gray">
              {handler ? 'Could not load child pages.' : 'Child pages are unavailable in this editor.'}
              </Text>
              {handler && (
                <Button type="button" size="1" variant="soft" onClick={loadPages}>
                  Retry
                </Button>
              )}
            </Flex>
          )}

          {state === 'empty' && (
            <Flex align="center" gap="3" className="child-pages-list__state">
              <Text size="2" color="gray">No descendant pages.</Text>
            </Flex>
          )}

          {state === 'idle' && (
            renderTree(tree)
          )}
        </div>
      </section>
    </NodeViewWrapper>
  );
}
