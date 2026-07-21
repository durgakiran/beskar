import { describe, expect, it } from 'vitest';
import { parseAwarenessCursor, parseAwarenessUser, safeAwarenessEntries } from './awareness';

describe('collaboration awareness validation', () => {
  it('accepts only bounded display identity and cursor data', () => {
    expect(parseAwarenessUser({ id: 'user-1', name: '<b>Asha</b>', color: '#12aBef', role: 'owner' }))
      .toEqual({ id: 'user-1', name: '<b>Asha</b>', color: '#12aBef' });
    expect(parseAwarenessUser({ id: 'x', name: 'A'.repeat(81), color: '#123456' })).toBeNull();
    expect(parseAwarenessUser({ id: 'x', name: 'A', color: 'url(javascript:alert(1))' })).toBeNull();
    expect(parseAwarenessCursor({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(parseAwarenessCursor({ x: Number.POSITIVE_INFINITY, y: 0 })).toBeNull();
  });

  it('caps retained peer state and ignores malformed entries', () => {
    const states = new Map<number, unknown>();
    states.set(0, { user: { id: '', name: 'bad', color: '#123456' } });
    for (let index = 1; index <= 150; index += 1) {
      states.set(index, {
        user: { id: `user-${index}`, name: `User ${index}`, color: '#123456' },
        cursor: { x: index, y: index },
      });
    }
    expect(safeAwarenessEntries(states)).toHaveLength(100);
  });
});
