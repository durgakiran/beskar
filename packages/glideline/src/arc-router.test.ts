/**
 * Unit tests — Arc Router (Phase 4, Story 4.2)
 * Test IDs: T4.2-01 through T4.2-06
 *
 * SVG Path2D validity (T4.2-05) is tested manually in Phase4Demo browser runner.
 */

import { describe, it, expect } from 'vitest';
import { computeArcPath, parseArcControlPoint } from './arc-router';

// ─────────────────────────────────────────────────────────────
// T4.2-01: bend=0 produces straight line
// ─────────────────────────────────────────────────────────────

describe('T4.2-01: bend=0 is straight line', () => {
  it('returns M...L path with no Q command', () => {
    const path = computeArcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    expect(path).toMatch(/^M\s+0\s+0\s+L\s+100\s+0$/);
    expect(path).not.toContain('Q');
  });
});

// ─────────────────────────────────────────────────────────────
// T4.2-02: bend=0.5 arcs upward (control point y < midpoint y)
// ─────────────────────────────────────────────────────────────

describe('T4.2-02: bend=0.5 arcs upward', () => {
  it('control point is above the line (y < 0 for horizontal line)', () => {
    const path = computeArcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5);
    const cp = parseArcControlPoint(path);
    expect(cp).toBeDefined();
    // For a horizontal line at y=0, "above" = negative y
    expect(cp!.y).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// T4.2-03: bend=-0.5 arcs downward (control point y > midpoint y)
// ─────────────────────────────────────────────────────────────

describe('T4.2-03: bend=-0.5 arcs downward', () => {
  it('control point is below the line (y > 0 for horizontal line)', () => {
    const path = computeArcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, -0.5);
    const cp = parseArcControlPoint(path);
    expect(cp).toBeDefined();
    expect(cp!.y).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// T4.2-04: Symmetric arcs mirror exactly
// ─────────────────────────────────────────────────────────────

describe('T4.2-04: Symmetric arcs mirror', () => {
  it('bend=0.5 control point is exact mirror of bend=-0.5', () => {
    const pathPos = computeArcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5);
    const pathNeg = computeArcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, -0.5);
    const cpPos = parseArcControlPoint(pathPos)!;
    const cpNeg = parseArcControlPoint(pathNeg)!;

    expect(cpPos.x).toBeCloseTo(cpNeg.x, 5);
    expect(cpPos.y).toBeCloseTo(-cpNeg.y, 5);
  });
});

// ─────────────────────────────────────────────────────────────
// T4.2-05: SVG validity — tested manually in Phase4Demo
// ─────────────────────────────────────────────────────────────

describe('T4.2-05: Path string is non-empty and starts with M (proxy for SVG validity)', () => {
  it('path starts with M and contains no NaN', () => {
    const path = computeArcPath({ x: 10, y: 20 }, { x: 80, y: 60 }, 0.3);
    expect(path).toMatch(/^M/);
    expect(path).not.toContain('NaN');
    // Full Path2D validity tested in browser demo (no Path2D in node env)
  });
});

// ─────────────────────────────────────────────────────────────
// T4.2-06: Diagonal path — control point perpendicular to diagonal
// ─────────────────────────────────────────────────────────────

describe('T4.2-06: Diagonal path control point is perpendicular to chord', () => {
  it('control point lies on the perpendicular bisector of start→end', () => {
    const start = { x: 0,   y: 0   };
    const end   = { x: 100, y: 100 };
    const path  = computeArcPath(start, end, 0.5);
    const cp    = parseArcControlPoint(path)!;

    expect(cp).toBeDefined();
    // Perpendicular bisector check: (cp - mid) · (end - start) ≈ 0
    const midX = 50; const midY = 50;
    const dot = (cp.x - midX) * (end.x - start.x) + (cp.y - midY) * (end.y - start.y);
    expect(Math.abs(dot)).toBeLessThan(1e-6);
  });
});

// ─────────────────────────────────────────────────────────────
// Bezier clipping and subdivision tests
// ─────────────────────────────────────────────────────────────

import { intersectBezierWithBox, getBezierSegment } from './arc-router';

describe('intersectBezierWithBox', () => {
  it('identifies intersections of Bezier with box boundaries', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 50, y: -50 };
    const p2 = { x: 100, y: 0 };
    const box = { x: 10, y: -100, w: 80, h: 200 }; // intersects around t=0.1 and t=0.9
    const ts = intersectBezierWithBox(p0, p1, p2, box);
    expect(ts.length).toBe(2);
    expect(ts[0]).toBeGreaterThan(0.05);
    expect(ts[0]).toBeLessThan(0.15);
    expect(ts[1]).toBeGreaterThan(0.85);
    expect(ts[1]).toBeLessThan(0.95);
  });
});

describe('getBezierSegment', () => {
  it('correctly subdivides Bezier curve using de Casteljau', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 50, y: 100 };
    const p2 = { x: 100, y: 0 };
    const [q0, q1, q2] = getBezierSegment(p0, p1, p2, 0.25, 0.75);
    // At t=0.25: x = 25, y = 2 * 0.75 * 0.25 * 100 + 0.0625 * 0 = 37.5
    expect(q0.x).toBeCloseTo(25, 2);
    expect(q0.y).toBeCloseTo(37.5, 2);
    // At t=0.75: x = 75, y = 2 * 0.25 * 0.75 * 100 = 37.5
    expect(q2.x).toBeCloseTo(75, 2);
    expect(q2.y).toBeCloseTo(37.5, 2);
  });
});

describe('computeArcPath clipping', () => {
  it('clips start and end points at bounding box boundaries', () => {
    const start = { x: 50, y: 50 }; // inside boxA
    const end = { x: 250, y: 50 }; // inside boxB
    const boxA = { x: 0, y: 0, w: 100, h: 100 };
    const boxB = { x: 200, y: 0, w: 100, h: 100 };

    // With bend = 0 (straight line)
    const pathStraight = computeArcPath(start, end, 0, boxA, boxB);
    // Intersection of line (50,50) -> (250,50) with boxA (right edge) is at x=100
    // Intersection with boxB (left edge) is at x=200
    expect(pathStraight).toBe('M 100 50 L 200 50');

    // With bend = 0.5 (curved line)
    const pathCurved = computeArcPath(start, end, 0.5, boxA, boxB);
    expect(pathCurved).toContain('Q');
    expect(pathCurved).not.toContain('NaN');
    // Starts at some x around 100, ends at some x around 200
    const startMatch = pathCurved.match(/^M\s+([\d.]+)\s+([\d.]+)/);
    const endMatch = pathCurved.match(/(?:Q.*?\s+)?([\d.]+)\s+([\d.]+)$/);
    expect(startMatch).toBeDefined();
    expect(endMatch).toBeDefined();
    const sx = parseFloat(startMatch![1]);
    const ex = parseFloat(endMatch![1]);
    expect(sx).toBeGreaterThanOrEqual(100);
    expect(sx).toBeLessThan(120);
    expect(ex).toBeGreaterThan(180);
    expect(ex).toBeLessThanOrEqual(200);
  });
});

