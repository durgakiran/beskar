import type { ExternalLinkHandler, ExternalLinkMetadata } from '../types';

type Entry = { promise: Promise<ExternalLinkMetadata>; expires: number; pending: boolean };
const caches = new WeakMap<ExternalLinkHandler, Map<string, Entry>>();
export const LINK_FAILURE_COOLDOWN = 60_000;
const SUCCESS_TTL = 30 * 60_000;

/** Share requests across chips and mounts; manual refresh bypasses settled entries only. */
export function resolveLinkMetadata(handler: ExternalLinkHandler, url: string, force = false): Promise<ExternalLinkMetadata> {
  let cache = caches.get(handler);
  if (!cache) caches.set(handler, cache = new Map());
  const existing = cache.get(url);
  if (existing && (existing.pending || (!force && existing.expires > Date.now()))) return existing.promise;
  for (const [key, entry] of cache) {
    if (!entry.pending && entry.expires <= Date.now()) cache.delete(key);
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Link preview timed out'));
    }, 10_000);
  });
  const entry: Entry = { pending: true, expires: Infinity, promise: undefined! };
  entry.promise = Promise.race([
    Promise.resolve().then(() => handler.getLinkMetadata(url, controller.signal)), timeout,
  ]).then(metadata => {
    if (!metadata) throw new Error('Link preview unavailable');
    entry.expires = Date.now() + SUCCESS_TTL;
    return metadata;
  }).catch(error => {
    entry.expires = Date.now() + LINK_FAILURE_COOLDOWN;
    throw error;
  }).finally(() => {
    clearTimeout(timer);
    entry.pending = false;
  });
  cache.set(url, entry);
  return entry.promise;
}
