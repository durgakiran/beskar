/**
 * InternalLinkBlockView — Beskar document/whiteboard picker and preview card.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, Badge, Box, Button, Flex, Spinner, Text, TextField } from '@radix-ui/themes';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type {
  InternalResourceHandler,
  InternalResourceMetadata,
  InternalResourceResult,
  InternalResourceType,
} from '../../types';

function getHandler(editor: NodeViewProps['editor']): InternalResourceHandler | undefined {
  return editor.storage.internalLinkBlock?.resourceHandler;
}

function getResourceIcon(resourceType: InternalResourceType, icon?: string): string {
  return icon || (resourceType === 'whiteboard' ? '▧' : '📄');
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return 'Recently edited';
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return 'Recently edited';

  const diff = Date.now() - time;
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `Edited ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Edited ${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `Edited ${days} day${days === 1 ? '' : 's'} ago`;
}

export function InternalLinkBlockView({ node, editor, updateAttributes, getPos }: NodeViewProps) {
  const attrs = node.attrs as {
    resourceType: InternalResourceType;
    resourceId: string;
    resourceTitle: string;
    resourceIcon: string;
  };
  const handler = getHandler(editor);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<InternalResourceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [metadata, setMetadata] = useState<InternalResourceMetadata | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'not-found' | 'private' | 'error'>('idle');
  const isPicker = !attrs.resourceId;

  const deleteNode = useCallback(() => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined || pos < 0) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  }, [editor, getPos, node.nodeSize]);

  useEffect(() => {
    if (!isPicker || !handler) return;
    const id = window.setTimeout(async () => {
      setIsSearching(true);
      try {
        const nextResults = await handler.searchResources(query, attrs.resourceType);
        setResults(nextResults);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 160);

    return () => window.clearTimeout(id);
  }, [attrs.resourceType, handler, isPicker, query]);

  useEffect(() => {
    if (isPicker || !handler) return;
    let cancelled = false;

    async function loadMetadata() {
      setState('loading');
      try {
        const nextMetadata = await handler.getResourceMetadata(attrs.resourceId, attrs.resourceType);
        if (cancelled) return;

        if (!nextMetadata) {
          setState('not-found');
          return;
        }

        setMetadata(nextMetadata);
        setState('idle');
        if (
          nextMetadata.title !== attrs.resourceTitle ||
          (nextMetadata.icon || '') !== attrs.resourceIcon
        ) {
          updateAttributes({
            resourceTitle: nextMetadata.title,
            resourceIcon: nextMetadata.icon || '',
          });
        }
      } catch (error: any) {
        if (cancelled) return;
        setState(error?.status === 403 ? 'private' : 'error');
      }
    }

    loadMetadata();
    return () => {
      cancelled = true;
    };
  }, [attrs.resourceIcon, attrs.resourceId, attrs.resourceTitle, attrs.resourceType, handler, isPicker, updateAttributes]);

  const cardTitle = metadata?.title || attrs.resourceTitle || 'Untitled resource';
  const icon = getResourceIcon(attrs.resourceType, metadata?.icon || attrs.resourceIcon);

  const pickResource = useCallback(
    (resource: InternalResourceResult) => {
      updateAttributes({
        resourceId: resource.resourceId,
        resourceType: resource.resourceType,
        resourceTitle: resource.title,
        resourceIcon: resource.icon || '',
      });
    },
    [updateAttributes],
  );

  const openResource = useCallback(() => {
    if (!handler || !attrs.resourceId) return;
    handler.navigateToResource(attrs.resourceId, attrs.resourceType);
  }, [attrs.resourceId, attrs.resourceType, handler]);

  const pickerResults = useMemo(() => results.slice(0, 6), [results]);

  if (!handler) {
    return (
      <NodeViewWrapper className="internal-link-block-wrapper" data-drag-handle>
        <div className="internal-link-card internal-link-card--muted" contentEditable={false}>
          <Text size="2" color="gray">Internal links are unavailable in this editor.</Text>
        </div>
      </NodeViewWrapper>
    );
  }

  if (isPicker) {
    return (
      <NodeViewWrapper className="internal-link-block-wrapper" data-drag-handle>
        <div className="internal-link-picker" contentEditable={false}>
          <Flex direction="column" gap="3">
            <Flex align="center" justify="between" gap="3">
              <Text size="2" weight="medium">
                Link to {attrs.resourceType === 'whiteboard' ? 'whiteboard' : 'document'}
              </Text>
              <Button type="button" size="1" variant="ghost" color="red" onClick={deleteNode}>
                Remove
              </Button>
            </Flex>
            <TextField.Root
              value={query}
              placeholder={`Search ${attrs.resourceType === 'whiteboard' ? 'whiteboards' : 'documents'}...`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  deleteNode();
                }
              }}
              autoFocus
            />
            <div className="internal-link-results">
              {isSearching && (
                <Flex align="center" gap="2" className="internal-link-result internal-link-result--muted">
                  <Spinner size="1" />
                  <Text size="2" color="gray">Searching...</Text>
                </Flex>
              )}
              {!isSearching && pickerResults.length === 0 && (
                <Text size="2" color="gray" className="internal-link-result internal-link-result--muted">
                  No results found
                </Text>
              )}
              {!isSearching && pickerResults.map((resource) => (
                <button
                  key={`${resource.resourceType}-${resource.resourceId}`}
                  type="button"
                  className="internal-link-result"
                  onClick={() => pickResource(resource)}
                >
                  <span className="internal-link-result__icon">{getResourceIcon(resource.resourceType, resource.icon)}</span>
                  <span className="internal-link-result__body">
                    <span className="internal-link-result__title">{resource.title}</span>
                    <span className="internal-link-result__meta">{formatRelativeTime(resource.lastEditedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </Flex>
        </div>
      </NodeViewWrapper>
    );
  }

  const errorText =
    state === 'not-found'
      ? `${attrs.resourceType === 'whiteboard' ? 'Whiteboard' : 'Document'} not found`
      : state === 'private'
        ? 'Private — request access'
        : state === 'error'
          ? 'Could not load preview'
          : '';

  return (
    <NodeViewWrapper className="internal-link-block-wrapper" data-drag-handle>
      <div
        className={`internal-link-card${state === 'idle' || state === 'loading' ? '' : ' internal-link-card--error'}`}
        contentEditable={false}
        role="button"
        tabIndex={0}
        onClick={state === 'idle' ? openResource : undefined}
        onKeyDown={(event) => {
          if (state === 'idle' && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openResource();
          }
        }}
      >
        {state === 'loading' ? (
          <Flex align="center" gap="2">
            <Spinner size="2" />
            <Text size="2" color="gray">Loading preview...</Text>
          </Flex>
        ) : errorText ? (
          <Flex direction="column" gap="2">
            <Flex align="center" gap="2">
              <span className="internal-link-card__icon">{state === 'private' ? '🔒' : '⚠'}</span>
              <Text size="2" weight="medium">{errorText}</Text>
            </Flex>
            <Flex gap="2">
              {state === 'error' && (
                <Button type="button" size="1" variant="soft" onClick={(event) => {
                  event.stopPropagation();
                  setState('loading');
                }}>
                  Retry
                </Button>
              )}
              {editor.isEditable && (
                <Button type="button" size="1" variant="soft" color="red" onClick={(event) => {
                  event.stopPropagation();
                  deleteNode();
                }}>
                  Remove
                </Button>
              )}
            </Flex>
          </Flex>
        ) : (
          <Flex direction="column" gap="3">
            <Flex align="center" gap="3">
              <span className="internal-link-card__icon">{icon}</span>
              <Box>
                <Text as="div" size="3" weight="bold">{cardTitle}</Text>
                <Flex gap="2" align="center" mt="1">
                  <Badge color={attrs.resourceType === 'whiteboard' ? 'cyan' : 'indigo'} variant="soft">
                    {attrs.resourceType}
                  </Badge>
                  <Text size="1" color="gray">{formatRelativeTime(metadata?.lastEditedAt)}</Text>
                </Flex>
              </Box>
            </Flex>
            {attrs.resourceType === 'whiteboard' && metadata?.thumbnailUrl ? (
              <img className="internal-link-card__thumbnail" src={metadata.thumbnailUrl} alt="" />
            ) : (
              <Text size="2" color="gray" className="internal-link-card__excerpt">
                {metadata?.excerpt || 'No preview available'}
              </Text>
            )}
            <Flex align="center" gap="2">
              <Avatar
                size="1"
                fallback={(metadata?.updatedByName || 'B').slice(0, 1).toUpperCase()}
                src={metadata?.updatedByAvatarUrl}
              />
              <Text size="1" color="gray">
                {metadata?.updatedByName ? `Last edited by ${metadata.updatedByName}` : 'Last edited recently'}
              </Text>
            </Flex>
          </Flex>
        )}
      </div>
    </NodeViewWrapper>
  );
}
