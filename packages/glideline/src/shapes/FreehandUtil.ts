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
import type { GlideShape, Vec2, GlideProps } from '../types';
import { STROKE_WIDTHS, STROKE_DASH_ARRAYS, resolveColor, StyleValidators } from '../styles';
import type { SizeStyle, StrokeStyle } from '../styles';
import { Geometry2d, Polyline2d } from '../geometry';

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
  points:      FreehandPoint[];
  color:       string;
  strokeWidth: SizeStyle;
  strokeStyle: StrokeStyle;
  opacity:     number;
  isClosed:    boolean;
  isComplete:  boolean;
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
    const first = pts[0]!;
    const second = pts[1]!;
    return `M ${first.x} ${first.y} L ${second.x} ${second.y}`;
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
// Hit-test helpers removed (now handled by Geometry2d)
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// FreehandUtil
// ─────────────────────────────────────────────────────────────

export class FreehandUtil extends ShapeUtil<FreehandShape> {
  static override readonly type = 'freehand';

  override canEditLabel(_shape: FreehandShape): boolean { return false; }

  static override readonly props: GlideProps<FreehandProps> = {
    points:      pointsValidator,
    color:       T.string,
    strokeWidth: StyleValidators.strokeWidth,
    strokeStyle: StyleValidators.strokeStyle,
    opacity:     T.number,
    isClosed:    T.boolean,
    isComplete:  T.boolean,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 2,
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
      2: {
        up: r => {
          const props = (r['props'] as any) || {};
          const strokeWidth = props.strokeWidth || props.size || 'medium';
          const strokeStyle = props.strokeStyle || 'solid';
          const newProps = { ...props, strokeWidth, strokeStyle };
          delete newProps.size;
          return {
            ...r,
            props: newProps,
          };
        },
        down: r => r,
      },
    },
  });

  getDefaultProps(): FreehandProps {
    return {
      points:      [],
      color:       'black',
      strokeWidth: 'medium',
      strokeStyle: 'solid',
      opacity:     1,
      isClosed:    false,
      isComplete:  false,
    };
  }

  getGeometry(shape: FreehandShape): Geometry2d {
    const { points } = shape.props;
    const localPoints = points.map(pt => ({ x: pt.x - shape.x, y: pt.y - shape.y }));
    return new Polyline2d(localPoints);
  }

  toSvg(shape: FreehandShape): SVGElement {
    const { props } = shape;
    const { points, color, strokeWidth, strokeStyle, opacity, isClosed } = props;
    const strokeW = STROKE_WIDTHS[strokeWidth];
    const strokeColor = resolveColor(color);
    const dashArray = STROKE_DASH_ARRAYS[strokeStyle];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (opacity < 1) g.setAttribute('opacity', String(opacity));

    if (points.length === 0) return g;

    // Freehand points are in world space; offset by -shape.x, -shape.y to draw in local space
    const localPoints = points.map(pt => ({ x: pt.x - shape.x, y: pt.y - shape.y }));
    const pathStr = catmullRomPath(localPoints, isClosed);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathStr);
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('stroke-width', String(strokeW));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('fill', isClosed ? strokeColor : 'none');
    if (isClosed) path.setAttribute('fill-opacity', '0.12');
    if (dashArray !== 'none') {
      path.setAttribute('stroke-dasharray', dashArray);
    }
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
