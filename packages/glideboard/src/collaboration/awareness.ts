import type { Vec2 } from '@durgakiran/glideline';
import type { GlideboardUser } from '../types.js';

const MAX_AWARENESS_PEERS = 100;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 80;
const MAX_COORDINATE = 10_000_000;
const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

export function parseAwarenessPageId(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('page:') && value.length <= MAX_ID_LENGTH
    ? value
    : null;
}

export interface AwarenessTextEditing {
  shapeId: string;
  pageId: string | null;
}

export function parseAwarenessTextEditing(value: unknown): AwarenessTextEditing | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.shapeId !== 'string' ||
    !candidate.shapeId.startsWith('shape:') ||
    candidate.shapeId.length > MAX_ID_LENGTH
  ) return null;
  const pageId = candidate.pageId == null ? null : parseAwarenessPageId(candidate.pageId);
  if (candidate.pageId != null && pageId === null) return null;
  return Object.freeze({ shapeId: candidate.shapeId, pageId });
}

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
): Array<{
  clientId: number;
  user: GlideboardUser;
  cursor: Vec2 | null;
  pageId: string | null;
  textEditing: AwarenessTextEditing | null;
}> {
  const result: Array<{
    clientId: number;
    user: GlideboardUser;
    cursor: Vec2 | null;
    pageId: string | null;
    textEditing: AwarenessTextEditing | null;
  }> = [];
  for (const [clientId, state] of states) {
    if (!Number.isSafeInteger(clientId) || !state || typeof state !== 'object') continue;
    const candidate = state as Record<string, unknown>;
    const user = parseAwarenessUser(candidate.user);
    if (!user) continue;
    result.push({
      clientId,
      user,
      cursor: parseAwarenessCursor(candidate.canvasCursor ?? candidate.cursor),
      pageId: parseAwarenessPageId(candidate.pageId),
      textEditing: parseAwarenessTextEditing(candidate.canvasTextEditing),
    });
    if (result.length >= MAX_AWARENESS_PEERS) break;
  }
  return result;
}
