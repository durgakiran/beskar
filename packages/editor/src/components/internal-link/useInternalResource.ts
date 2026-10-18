import { useEffect, useState } from 'react';
import type { InternalResourceHandler, InternalResourceMetadata, InternalResourceType } from '../../types';
import { getBrowserAppBaseUrl, parseInternalResourceUrl } from '../../nodes/internalDocumentUrl';

export interface ResourceReference {
  resourceId: string;
  resourceType: InternalResourceType;
  spaceId?: string;
  href?: string;
  resourceTitle?: string;
  resourceIcon?: string;
}

/** Validate persisted URLs too: node JSON/HTML may originate outside this editor. */
export function resourceContext(ref: ResourceReference, handler?: InternalResourceHandler) {
  const base = handler?.appBaseUrl || getBrowserAppBaseUrl();
  const parsed = ref.href && base ? parseInternalResourceUrl(ref.href, base) : null;
  const matches = parsed?.resourceId === ref.resourceId;
  return { spaceId: (matches ? parsed?.spaceId : undefined) || ref.spaceId || undefined, href: matches ? parsed?.href : undefined };
}

export function resourceHref(ref: ResourceReference, handler?: InternalResourceHandler) {
  const context = resourceContext(ref, handler);
  const candidate = context.href || handler?.getResourceUrl?.(ref.resourceId, ref.resourceType, context);
  const base = handler?.appBaseUrl || getBrowserAppBaseUrl();
  if (!candidate || !base) return undefined;
  const parsed = parseInternalResourceUrl(candidate, base);
  return parsed?.resourceId === ref.resourceId ? parsed.href : undefined;
}

export function useInternalResource(ref: ResourceReference, handler?: InternalResourceHandler) {
  const { spaceId, href } = resourceContext(ref, handler);
  const key = JSON.stringify([ref.resourceId, ref.resourceType, spaceId, href]);
  const [revision, refresh] = useState(0);
  const [result, setResult] = useState<{ key: string; state: 'loading' | 'ready' | 'unavailable' | 'error'; metadata?: InternalResourceMetadata }>({ key, state: 'loading' });
  useEffect(() => {
    const reload = () => { if (document.visibilityState !== 'hidden') refresh(n => n + 1); };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    return () => { window.removeEventListener('focus', reload); document.removeEventListener('visibilitychange', reload); };
  }, []);
  useEffect(() => {
    if (!handler || !ref.resourceId) return;
    let cancelled = false;
    setResult({ key, state: 'loading' });
    Promise.resolve().then(() => handler.getResourceMetadata(ref.resourceId, ref.resourceType, { spaceId, href })).then(metadata => {
      if (!cancelled) setResult(metadata ? { key, state: 'ready', metadata } : { key, state: 'unavailable' });
    }).catch((error: unknown) => {
      const status = (error as { status?: number })?.status;
      if (!cancelled) setResult({ key, state: status === 403 || status === 404 ? 'unavailable' : 'error' });
    });
    return () => { cancelled = true; };
  }, [key, handler, revision, ref.resourceId, ref.resourceType, spaceId, href]);
  // Never show metadata belonging to a previous target while its replacement loads.
  return { ...(result.key === key ? result : { state: 'loading' as const, metadata: undefined }), refresh: () => refresh(n => n + 1) };
}
