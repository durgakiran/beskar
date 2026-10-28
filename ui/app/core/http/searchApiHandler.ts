import { getApiV1Base } from './apiBase';

export interface DocumentSearchResult {
    pageId: number;
    spaceId: string;
    spaceName: string;
    title: string;
    snippet: string;
    updatedAt: string;
}

export async function searchDocuments(query: string, signal?: AbortSignal): Promise<DocumentSearchResult[]> {
    const base = getApiV1Base({ fallbackBase: import.meta.env.VITE_USER_SERVER_URL });
    const params = new URLSearchParams({ q: query, limit: '8' });
    const response = await fetch(`${base}/search/documents?${params}`, {
        credentials: 'include', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' }, signal,
    });
    if (!response.ok) throw new Error('Search is temporarily unavailable');
    const body = await response.json();
    const results = body?.data?.results;
    if (body?.status !== 'success' || !Array.isArray(results) || results.length > 20 || !results.every((r) =>
        r && Number.isSafeInteger(r.pageId) && r.pageId > 0 &&
        typeof r.spaceId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.spaceId) &&
        typeof r.spaceName === 'string' && typeof r.title === 'string' &&
        typeof r.snippet === 'string' && typeof r.updatedAt === 'string')) {
        throw new Error('Invalid search response');
    }
    return results;
}
