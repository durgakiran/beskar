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
 */

import { ShapeUtil } from './ShapeUtil.js';
import { T } from '../validators.js';
import { defineMigrations } from '../migrations.js';
import { makeBox } from '../types.js';
import type { GlideShape, Vec2, GlideProps } from '../types.js';
import { STROKE_WIDTHS, STROKE_DASH_ARRAYS, resolveColor, StyleValidators } from '../styles.js';
import type { SizeStyle, StrokeStyle } from '../styles.js';
import { Geometry2d, Polyline2d } from '../geometry/index.js';
import { getStroke } from 'perfect-freehand';
import { pencilStrokeRadius, renderPencilStroke } from '../pencil-stroke.js';
import { addSketchOutline, sketchOutlinePath } from '../sketch-stroke.js';

// ─────────────────────────────────────────────────────────────
// Freehand point type
// ─────────────────────────────────────────────────────────────

export interface FreehandPoint {
  x: number;
  y: number;
  /** Pointer pressure, 0–1. Defaults to 0.5 for mouse input. */
  pressure: number;
  tilt?: number;
  tiltDirection?: Vec2;
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
  pressureSensitive: boolean;
  simulatePressure: boolean;
  opacity:     number;
  isHighlighter?: true;
  isPencil?: true;
  isClosed:    boolean;
  isComplete:  boolean;
}

export type FreehandShape = GlideShape<FreehandProps>;

export function getFreehandStrokeWidth(props: FreehandProps): number {
  return STROKE_WIDTHS[props.strokeWidth] * (props.isHighlighter ? 4 : 1);
}

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
 * A tangent scale of 1/6 gives the uniform Catmull–Rom interpolant.
 */
export function catmullRomPath(pts: Vec2[], isClosed: boolean, tangentScale = 0.4): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) {
    const first = pts[0]!;
    const second = pts[1]!;
    return `M ${first.x} ${first.y} L ${second.x} ${second.y}`;
  }

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
    const cp1x = p1.x + (p2.x - p0.x) * tangentScale;
    const cp1y = p1.y + (p2.y - p0.y) * tangentScale;
    const cp2x = p2.x - (p3.x - p1.x) * tangentScale;
    const cp2y = p2.y - (p3.y - p1.y) * tangentScale;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  if (isClosed) d += ' Z';
  return d;
}

// ─────────────────────────────────────────────────────────────
// Smooth the centerline without shifting endpoints or rounding widely spaced
// corners by more than one stroke width. Keep raw samples in the document.
function inkCenterline(points: Vec2[], width: number): Vec2[] {
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    const prev = points[index - 1]!;
    const next = points[index + 1]!;
    // A five-sample binomial filter attenuates jitter through a turn.
    // Use the smaller symmetric window next to either endpoint.
    const outerPrev = points[index - 2];
    const outerNext = points[index + 2];
    let dx = (prev.x - point.x + next.x - point.x) / 4;
    let dy = (prev.y - point.y + next.y - point.y) / 4;
    if (outerPrev && outerNext) {
      dx += (outerPrev.x - point.x + outerNext.x - point.x) / 16;
      dy += (outerPrev.y - point.y + outerNext.y - point.y) / 16;
    }
    const scale = width / Math.max(width, Math.hypot(dx, dy));
    return { x: point.x + dx * scale, y: point.y + dy * scale };
  });
}

// ─────────────────────────────────────────────────────────────
// FreehandUtil
// ─────────────────────────────────────────────────────────────

export class FreehandUtil extends ShapeUtil<FreehandShape> {
  static override readonly type = 'freehand';

  override getConnectionAnchors() {
    return [];
  }

  override canEditLabel(_shape: FreehandShape): boolean { return false; }

  override supportsSketchStroke(): boolean { return true; }

  static override readonly props: GlideProps<FreehandProps> = {
    points:      pointsValidator,
    color:       T.string,
    strokeWidth: StyleValidators.strokeWidth,
    strokeStyle: StyleValidators.strokeStyle,
    pressureSensitive: T.boolean,
    simulatePressure: T.boolean,
    opacity:     T.number,
    isHighlighter: T.optional(T.literal(true)),
    isPencil:    T.optional(T.literal(true)),
    isClosed:    T.boolean,
    isComplete:  T.boolean,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 3,
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
      3: {
        up: r => ({
          ...r,
          props: {
            pressureSensitive: false,
            simulatePressure: false,
            ...(r['props'] as object),
          },
        }),
        down: r => {
          const props = { ...((r['props'] as object) || {}) } as Record<string, unknown>;
          delete props.pressureSensitive;
          delete props.simulatePressure;
          return { ...r, props };
        },
      },
    },
  });

  getDefaultProps(): FreehandProps {
    return {
      points:      [],
      color:       'black',
      strokeWidth: 'medium',
      strokeStyle: 'solid',
      pressureSensitive: false,
      simulatePressure: false,
      opacity:     1,
      isClosed:    false,
      isComplete:  false,
    };
  }

  getGeometry(shape: FreehandShape): Geometry2d {
    const { points } = shape.props;
    const localPoints = points.map(pt => ({ x: pt.x - shape.x, y: pt.y - shape.y }));
    const width = getFreehandStrokeWidth(shape.props);
    const radius = shape.props.isPencil ? pencilStrokeRadius(width) : width / 2;
    return new Polyline2d(localPoints, {
      boundsPadding: shape.props.isHighlighter || shape.props.isPencil || points.length === 1 ? radius : 0,
      hitThreshold: shape.props.isHighlighter || shape.props.isPencil ? Math.max(5, radius) : undefined,
    });
  }

  toSvg(shape: FreehandShape): SVGElement {
    const { props } = shape;
    const {
      points, color, strokeStyle, pressureSensitive, simulatePressure, opacity, isClosed,
      isComplete,
    } = props;
    const strokeW = getFreehandStrokeWidth(props);
    const strokeColor = resolveColor(color);
    const dashArray = STROKE_DASH_ARRAYS[strokeStyle];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (opacity < 1) g.setAttribute('opacity', String(opacity));

    if (points.length === 0) return g;
    if (props.isPencil) {
      renderPencilStroke(g, points, shape, strokeW, strokeColor);
      return g;
    }

    // Freehand points are in world space; offset by -shape.x, -shape.y to draw in local space.
    if (points.length === 1) {
      const point = points[0]!;
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(point.x - shape.x));
      dot.setAttribute('cy', String(point.y - shape.y));
      dot.setAttribute('r', String(strokeW / 2));
      dot.setAttribute('fill', strokeColor);
      g.appendChild(dot);
      return g;
    }

    const pathStr = pressureSensitive
      ? pressureStrokePath(points.map(point => [
        point.x - shape.x,
        point.y - shape.y,
        point.pressure,
      ]), strokeW, simulatePressure, isComplete)
      : catmullRomPath(inkCenterline(points.map(point => ({
        x: point.x - shape.x,
        y: point.y - shape.y,
      })), strokeW), isClosed, 1 / 6);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathStr);
    path.setAttribute('stroke', pressureSensitive ? 'none' : strokeColor);
    if (!pressureSensitive) path.setAttribute('stroke-width', String(strokeW));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('fill', pressureSensitive || isClosed ? strokeColor : 'none');
    if (isClosed && !pressureSensitive) path.setAttribute('fill-opacity', '0.12');
    if (!pressureSensitive && dashArray !== 'none') {
      path.setAttribute('stroke-dasharray', dashArray);
    }
    g.appendChild(path);
    if (!pressureSensitive && strokeStyle === 'sketch') {
      addSketchOutline(path, shape.id, (seed, strength) => sketchOutlinePath(pathStr, seed, strength));
    }

    return g;
  }
}

export function pressureStrokePath(
  points: Array<[number, number, number]>,
  size: number,
  simulatePressure: boolean,
  isComplete = true,
): string {
  const outline = getStroke(points, {
    size,
    // Distance-based pressure can approach zero on fast mouse movements.
    // Keep a readable width floor while preserving the full stylus response.
    thinning: simulatePressure ? 0.2 : 0.7,
    smoothing: 0.65,
    streamline: simulatePressure ? 0.64 : 0.45,
    simulatePressure,
    last: isComplete,
  });
  if (outline.length === 0) return '';
  const first = outline[0]!;
  let path = `M ${first[0]} ${first[1]} Q`;
  for (let index = 0; index < outline.length; index += 1) {
    const point = outline[index]!;
    const next = outline[(index + 1) % outline.length]!;
    path += ` ${point[0]} ${point[1]} ${(point[0] + next[0]) / 2} ${(point[1] + next[1]) / 2}`;
  }
  return `${path} Z`;
}

// ─────────────────────────────────────────────────────────────
// Plugin export
// ─────────────────────────────────────────────────────────────

import type { GlidePlugin } from '../editor.js';

export const FreehandPlugin: GlidePlugin = {
  id: 'freehand',
  shapes: [FreehandUtil as any],
};
