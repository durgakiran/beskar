import type { Vec2 } from '@durgakiran/glideline';
import type { GlideboardUser } from '../types';

const MAX_AWARENESS_PEERS = 100;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 80;
const MAX_COORDINATE = 10_000_000;
const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

export function parseAwarenessUser(value: unknown): GlideboardUser | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > MAX_ID_LENGTH ||
    typeof candidate.name !== 'string' || !candidate.name || candidate.name.length > MAX_NAME_LENGTH ||
    typeof candidate.color !== 'string' || !SAFE_COLOR.test(candidate.color)
  ) return null;
  return Object.freeze({ id: candidate.id, name: candidate.name, color: candidate.color });
}

export function parseAwarenessCursor(value: unknown): Vec2 | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.x !== 'number' || !Number.isFinite(candidate.x) || Math.abs(candidate.x) > MAX_COORDINATE ||
    typeof candidate.y !== 'number' || !Number.isFinite(candidate.y) || Math.abs(candidate.y) > MAX_COORDINATE
  ) return null;
  return Object.freeze({ x: candidate.x, y: candidate.y });
}

export function safeAwarenessEntries(
  states: Map<number, unknown>,
): Array<{ clientId: number; user: GlideboardUser; cursor: Vec2 | null }> {
  const result: Array<{ clientId: number; user: GlideboardUser; cursor: Vec2 | null }> = [];
  for (const [clientId, state] of states) {
    if (!Number.isSafeInteger(clientId) || !state || typeof state !== 'object') continue;
    const candidate = state as Record<string, unknown>;
    const user = parseAwarenessUser(candidate.user);
    if (!user) continue;
    result.push({ clientId, user, cursor: parseAwarenessCursor(candidate.cursor) });
    if (result.length >= MAX_AWARENESS_PEERS) break;
  }
  return result;
}
