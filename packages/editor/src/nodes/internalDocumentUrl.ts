import type { InternalResourceType } from '../types';

export function parseInternalResourceUrl(
  rawUrl: string,
  appBaseUrl: string,
): { resourceId: string; href: string; resourceType: InternalResourceType } | null {
  try {
    const text = rawUrl.trim();
    const base = new URL(appBaseUrl);
    const pasted = new URL(text, base);
    if (pasted.origin !== base.origin) return null;

    const path = pasted.pathname;
    const whiteboardMatch = path.match(/\/space\/[^/]+\/whiteboard\/([^/?#]+)/);
    if (whiteboardMatch) {
      return {
        resourceId: decodeURIComponent(whiteboardMatch[1]),
        href: text,
        resourceType: 'whiteboard',
      };
    }

    const routedMatch = path.match(/\/space\/[^/]+\/(view|edit|page|document|doc)\/([^/?#]+)/);
    if (routedMatch) {
      return {
        resourceId: decodeURIComponent(routedMatch[2]),
        href: text,
        resourceType: 'document',
      };
    }

    const shortMatch = path.match(/\/(doc|docs|document|documents|page|pages)\/([^/?#]+)/);
    if (shortMatch) {
      return {
        resourceId: decodeURIComponent(shortMatch[2]),
        href: text,
        resourceType: 'document',
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function parseInternalDocumentUrl(rawUrl: string, appBaseUrl: string): { resourceId: string; href: string } | null {
  const parsed = parseInternalResourceUrl(rawUrl, appBaseUrl);
  if (!parsed) return null;
  return {
    resourceId: parsed.resourceId,
    href: parsed.href,
  };
}

export function getBrowserAppBaseUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.location.origin;
}
