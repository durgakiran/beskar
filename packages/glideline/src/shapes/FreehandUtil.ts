/**
 * FreehandUtil — pencil / brush strokes (Phase A)
 *
 * Props:
 *   points      — array of { x, y, pressure } (raw pointer samples)
 *   color       — stroke colour key or hex
 *   size        — thin | medium | thick | xl (stroke width multiplier)
 *   opacity     — 0–1
 *   isClosed    — whether the path should be closed (filled) vs open
 *   isComplete  — false while the stroke is being drawn (live preview)
 *
 * getGeometry  → AABB from all points + padding for stroke width
 * hitTestPoint → point-to-polyline distance (8 px tolerance)
 * toSvg        → smoothed <path> using Catmull-Rom → cubic Bézier
 *
 * Path smoothing: Catmull-Rom spline converted to SVG cubic Bézier segments.
 * This gives natural-looking curves without requiring an external library.
 */

import { ShapeUtil } from './ShapeUtil';
import { T } from '../validators';
import { defineMigrations } from '../migrations';
import { makeBox } from '../types';
import type { GlideShape, Box2d, Vec2, GlideProps } from '../types';
import { STROKE_WIDTHS, resolveColor, type SizeStyle } from '../styles';

// ─────────────────────────────────────────────────────────────
// Freehand point type
// ─────────────────────────────────────────────────────────────

export interface FreehandPoint {
  x: number;
  y: number;
  /** Pointer pressure, 0–1. Defaults to 0.5 for mouse input. */
  pressure: number;
}

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

export interface FreehandProps {
  [key: string]: unknown;
  points:     FreehandPoint[];
  color:      string;
  size:       SizeStyle;
  opacity:    number;
  isClosed:   boolean;
  isComplete: boolean;
}

export type FreehandShape = GlideShape<FreehandProps>;

// ─────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────

const pointsValidator = {
  validate(v: unknown): FreehandPoint[] {
    if (!Array.isArray(v)) throw new Error('FreehandProps.points must be an array');
    return v as FreehandPoint[];
  },
};

const sizeStyleValidator = {
  validate(v: unknown): SizeStyle {
    if (!['thin', 'medium', 'thick', 'xl'].includes(v as string)) {
      throw new Error(`size must be thin|medium|thick|xl, got "${v}"`);
    }
    return v as SizeStyle;
  },
};

// ─────────────────────────────────────────────────────────────
// Catmull-Rom → SVG cubic Bézier
// ─────────────────────────────────────────────────────────────

/**
 * Convert an array of Vec2 into an SVG path string using Catmull-Rom spline.
 * Each segment is converted to a cubic Bézier so it's renderable in SVG.
 *
 * alpha = 0.5  → centripetal parameterisation (avoids cusps)
 * tension = 0  → standard catmull-rom
 */
export function catmullRomPath(pts: Vec2[], isClosed: boolean): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  }

  // Tension factor: 0 = standard, higher = tighter
  const t = 0.4;

  // Build extended point list (duplicate endpoints for boundary conditions)
  const p: Vec2[] = isClosed
    ? [pts[pts.length - 1]!, ...pts, pts[0]!, pts[1]!]
    : [pts[0]!, ...pts, pts[pts.length - 1]!];

  let d = `M ${p[1]!.x} ${p[1]!.y}`;

  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[i + 2]!;

    // Control points
    const cp1x = p1.x + (p2.x - p0.x) * t;
    const cp1y = p1.y + (p2.y - p0.y) * t;
    const cp2x = p2.x - (p3.x - p1.x) * t;
    const cp2y = p2.y - (p3.y - p1.y) * t;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  if (isClosed) d += ' Z';
  return d;
}

// ─────────────────────────────────────────────────────────────
// Hit-test helpers
// ─────────────────────────────────────────────────────────────

function pointToSegmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ─────────────────────────────────────────────────────────────
// FreehandUtil
// ─────────────────────────────────────────────────────────────

export class FreehandUtil extends ShapeUtil<FreehandShape> {
  static override readonly type = 'freehand';

  static override readonly props: GlideProps<FreehandProps> = {
    points:     pointsValidator,
    color:      T.string,
    size:       sizeStyleValidator,
    opacity:    T.number,
    isClosed:   T.boolean,
    isComplete: T.boolean,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 1,
    migrators: {
      1: {
        up: r => ({
          ...r,
          props: {
            points:     [],
            color:      'black',
            size:       'medium',
            opacity:    1,
            isClosed:   false,
            isComplete: false,
            ...(r['props'] as object),
          },
        }),
        down: r => r,
      },
    },
  });

  getDefaultProps(): FreehandProps {
    return {
      points:     [],
      color:      'black',
      size:       'medium',
      opacity:    1,
      isClosed:   false,
      isComplete: false,
    };
  }

  getGeometry(shape: FreehandShape): Box2d {
    const { points, size } = shape.props;
    const pad = STROKE_WIDTHS[size] * 2 + 4;

    if (points.length === 0) {
      return makeBox(shape.x - pad, shape.y - pad, pad * 2, pad * 2);
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }

    return makeBox(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
  }

  /**
   * Hit test: point must be within tolerance of any polyline segment.
   * Tolerance = strokeWidth + 4 px for comfortable clicking.
   */
  override hitTestPoint(shape: FreehandShape, point: Vec2): boolean {
    const { points, size, isClosed } = shape.props;
    if (points.length === 0) return false;
    if (points.length === 1) {
      return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= STROKE_WIDTHS[size] + 4;
    }

    const tolerance = STROKE_WIDTHS[size] + 4;
    const count = isClosed ? points.length : points.length - 1;

    for (let i = 0; i < count; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      if (pointToSegmentDist(point, a, b) <= tolerance) return true;
    }
    return false;
  }

  toSvg(shape: FreehandShape): SVGElement {
    const { props } = shape;
    const { points, color, size, opacity, isClosed } = props;
    const strokeW = STROKE_WIDTHS[size];
    const strokeColor = resolveColor(color);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (opacity < 1) g.setAttribute('opacity', String(opacity));

    if (points.length === 0) return g;

    const pathStr = catmullRomPath(points, isClosed);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathStr);
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('stroke-width', String(strokeW));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('fill', isClosed ? strokeColor : 'none');
    if (isClosed) path.setAttribute('fill-opacity', '0.12');
    g.appendChild(path);

    return g;
  }
}

// ─────────────────────────────────────────────────────────────
// Plugin export
// ─────────────────────────────────────────────────────────────

import type { GlidePlugin } from '../editor';

export const FreehandPlugin: GlidePlugin = {
  id: 'freehand',
  shapes: [FreehandUtil as any],
};
