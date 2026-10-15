import type { MentionHandler, MentionUser, MentionUserDetails } from '@durgakiran/editor';
import { getApiV1Base } from './apiBase';

export class MentionApiError extends Error {
    constructor(readonly status: number, message = `Mention request failed (${status})`) {
        super(message);
        this.name = 'MentionApiError';
    }
}

function isMentionUser(value: unknown): value is MentionUser {
    return typeof value === 'object' && value !== null
        && typeof (value as MentionUser).id === 'string' && Boolean((value as MentionUser).id)
        && typeof (value as MentionUser).label === 'string' && Boolean((value as MentionUser).label.trim());
}

function isMentionDetails(value: unknown): value is MentionUserDetails {
    if (!isMentionUser(value)) return false;
    const user = value as MentionUserDetails;
    return typeof user.spaceRole === 'string'
        && (user.email === undefined || typeof user.email === 'string')
        && (user.avatarUrl == null || typeof user.avatarUrl === 'string');
}

/** Bind a new handler to each space. Authentication goes through the app's
 * fetch transport (browser cookies or the desktop bearer interceptor).
 * Profile data is not cached across spaces, sessions or membership changes.
 */
export function makeMentionApiHandler(spaceId: string): MentionHandler {
    if (!spaceId?.trim()) throw new Error('A space is required for mentions');
    const base = getApiV1Base({ fallbackBase: import.meta.env.VITE_USER_SERVER_URL });
    const missing = Symbol('missing mention user');
    const usersURL = `${base}/space/${encodeURIComponent(spaceId)}/mentions/users`;

    async function request(url: string, signal?: AbortSignal, allowMissing = false): Promise<unknown> {
        const response = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
            redirect: 'error',
            headers: { Accept: 'application/json' },
            signal,
        });
        if (allowMissing && response.status === 404) return missing;
        if (!response.ok) throw new MentionApiError(response.status);
        const envelope = await response.json();
        if (envelope?.status !== 'success' || !('data' in envelope)) {
            throw new MentionApiError(response.status, 'Invalid mention response');
        }
        return envelope.data;
    }

    async function getDetails(id: string, signal?: AbortSignal): Promise<MentionUserDetails | null> {
        const data = await request(`${usersURL}/${encodeURIComponent(id)}`, signal, true);
        if (data === missing) return null;
        if (!isMentionDetails(data) || data.id !== id) {
            throw new MentionApiError(200, 'Invalid mention profile');
        }
        return data;
    }

    return {
        async searchUsers(query) {
            const params = new URLSearchParams({ query, limit: '10', offset: '0' });
            const data = await request(`${usersURL}?${params}`) as { users?: unknown; hasMore?: unknown } | null;
            if (!Array.isArray(data?.users) || typeof data.hasMore !== 'boolean' || !data.users.every(isMentionUser)) {
                throw new MentionApiError(200, 'Invalid mention search results');
            }
            return data.users.map(({ id, label }) => ({ id, label }));
        },
        async resolveUser(id) {
            const user = await getDetails(id);
            return user ? { id: user.id, label: user.label } : null;
        },
        getUserDetails(id, options) {
            return getDetails(id, options?.signal);
        },
    };
}
