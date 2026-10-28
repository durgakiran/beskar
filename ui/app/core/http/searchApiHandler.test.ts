import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchDocuments } from './searchApiHandler';
const item = { pageId: 42, spaceId: '11111111-1111-1111-1111-111111111111', title: 'Roadmap', spaceName: 'Product', snippet: 'Overview', updatedAt: '2026-10-28T00:00:00Z' };
afterEach(() => vi.unstubAllGlobals());
describe('searchDocuments', () => {
 it('uses authenticated no-store transport and encodes query text', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'success', data: { results: [item] } }))); vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController(); expect(await searchDocuments('a & b?', controller.signal)).toEqual([item]);
  const [url, options] = fetchMock.mock.calls[0]; expect(new URL(url, 'https://example.com').searchParams.get('q')).toBe('a & b?');
  expect(options).toMatchObject({ credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal });
 });
 it('rejects errors and malformed results without exposing response bodies', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockResolvedValueOnce(new Response('provider-secret', { status: 403 }));
  await expect(searchDocuments('road')).rejects.toThrow('Search is temporarily unavailable');
  for (const result of [{ ...item, spaceId: '//evil.test' }, { ...item, pageId: -1 }, { ...item, snippet: null }]) {
   fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: { results: [result] } })));
   await expect(searchDocuments('road')).rejects.toThrow('Invalid search response');
  }
 });
});
