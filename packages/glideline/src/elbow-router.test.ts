/**
 * Unit tests — Elbow Router (Phase 4, Story 4.3)
 * Test IDs: T4.3-01 through T4.3-06
 *
 * SVG Path2D validity (T4.3-06) is tested manually in Phase4Demo.
 */

import { describe, it, expect } from 'vitest';
import { computeElbowPath, parseElbowPoints, countElbowSegments } from './elbow-router';
import { makeBox } from './types';

const from = makeBox(0,   0,   100, 80);
const to   = makeBox(300, 50,  100, 80);

function expectAxisAlignedSegments(pts: ReturnType<typeof parseElbowPoints>): void {
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]!;
    const current = pts[i]!;
    expect(prev.y === current.y || prev.x === current.x).toBe(true);
  }
}

describe('T4.3-01: right→left produces Z-path', () => {
  it('has 3 segments, all axis-aligned', () => {
    const path = computeElbowPath(from, to, 'right', 'left');
    expect(countElbowSegments(path)).toBe(3);
    const pts = parseElbowPoints(path);
    expectAxisAlignedSegments(pts);
  });
});

describe('T4.3-02: right→right U-bend', () => {
  it('has at least 3 segments and is axis-aligned', () => {
    const fromB = makeBox(200, 0, 100, 80);
    const toB   = makeBox(0,  50, 100, 80);
    const path  = computeElbowPath(fromB, toB, 'right', 'right');
    expect(countElbowSegments(path)).toBeGreaterThanOrEqual(3);
    const pts = parseElbowPoints(path);
    expectAxisAlignedSegments(pts);
  });
});

describe('T4.3-03: right→top L-shape', () => {
  it('has exactly 2 segments and is axis-aligned', () => {
    const path = computeElbowPath(from, to, 'right', 'top');
    expect(countElbowSegments(path)).toBe(2);
    const pts = parseElbowPoints(path);
    expectAxisAlignedSegments(pts);
  });
});

describe('T4.3-04: Overlap fallback', () => {
  it('identical bounds returns straight line without crash', () => {
    const b = makeBox(50, 50, 100, 80);
    expect(() => computeElbowPath(b, b, 'right', 'left')).not.toThrow();
    const path = computeElbowPath(b, b, 'right', 'left');
    expect(path).toMatch(/^M/);
    expect(countElbowSegments(path)).toBe(1);
  });
});

describe('T4.3-05: No diagonal segments', () => {
  const edges = ['right', 'left', 'top', 'bottom'] as const;
  for (const fe of edges) {
    for (const te of edges) {
      it(`${fe}→${te} is axis-aligned`, () => {
        const path = computeElbowPath(from, to, fe, te);
        const pts  = parseElbowPoints(path);
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1]!;
          const current = pts[i]!;
          const horiz = Math.abs(prev.y - current.y) < 1e-9;
          const vert  = Math.abs(prev.x - current.x) < 1e-9;
          expect(horiz || vert).toBe(true);
        }
      });
    }
  }
});

describe('T4.3-06: Path starts with M and has no NaN', () => {
  it('proxy for SVG validity (Path2D tested in browser)', () => {
    const path = computeElbowPath(from, to, 'right', 'left');
    expect(path).toMatch(/^M/);
    expect(path).not.toContain('NaN');
  });
});
