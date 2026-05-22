/**
 * Glideline — ArrowUtil + ArrowBindingUtil (Phase 4, Story 4.4)
 *
 * ArrowShape: connector with two typed terminals (start, end).
 * Each terminal carries:
 *   - boundShapeId: ShapeId | null  — null when unbound (floating)
 *   - normalizedAnchor: Vec2        — [0..1, 0..1] within target bounds
 *   - point: Vec2                   — absolute page-space position (computed)
 *
 * ArrowBindingUtil:
 *   - onAfterChangeToShape: recomputes terminal point from normalizedAnchor
 *     against current target bounds; derives fromEdge from anchor position.
 *   - onBeforeDeleteToShape: detaches terminal (boundShapeId → null).
 */

import { ShapeUtil, BindingUtil, type ResizeInfo } from './ShapeUtil';
import { T } from '../validators';
import { defineMigrations } from '../migrations';
import type {
  GlideShape, GlideBinding, GlideProps,
  Box2d, Vec2, EdgeName, ShapeId,
} from '../types';
import { makeBox as makeBoxFn } from '../types';
import { Geometry2d, Polyline2d } from '../geometry';
import { computeArcPath, intersectBezierWithBox, getBezierSegment } from '../arc-router';
import { computeElbowPath, parseElbowPoints } from '../elbow-router';
import { StyleValidators, STROKE_WIDTHS, STROKE_DASH_ARRAYS, resolveColor, type StrokeStyle, type SizeStyle } from '../styles';

// ─────────────────────────────────────────────────────────────
// Arrow terminal type
// ─────────────────────────────────────────────────────────────

export interface ArrowTerminal {
  /** null = floating (not bound to a shape) */
  boundShapeId: ShapeId | null;
  /** [0..1] within the target shape's bounding box */
  normalizedAnchor: Vec2;
  /** Absolute page-space position (authoritative for rendering) */
  point: Vec2;
}

// ─────────────────────────────────────────────────────────────
// ArrowProps
// ─────────────────────────────────────────────────────────────

export interface ArrowProps {
  [key: string]: unknown;
  start: ArrowTerminal;
  end:   ArrowTerminal;
  /** 'curve' = quadratic Bézier arc, 'ortho' = rectilinear elbow */
  routeStyle: 'curve' | 'ortho';
  /** Bend scalar for arc router. 0 = straight. */
  bend: number;
  color: string;
  opacity: number;
  strokeStyle: StrokeStyle;
  strokeWidth: SizeStyle;
}

export type ArrowShape = GlideShape<ArrowProps>;

// ─────────────────────────────────────────────────────────────
// ArrowProps validators (nested object — validated top-level only)
// ─────────────────────────────────────────────────────────────

const terminalValidator = {
  validate(value: unknown): ArrowTerminal {
    if (typeof value !== 'object' || value === null) {
      throw new Error('Arrow terminal must be an object');
    }
    const v = value as Record<string, unknown>;
    if (typeof v['point'] !== 'object' || v['point'] === null) {
      throw new Error('Arrow terminal.point must be a Vec2 object');
    }
    return value as ArrowTerminal;
  },
};

const routeStyleValidator = {
  validate(value: unknown): 'curve' | 'ortho' {
    if (value !== 'curve' && value !== 'ortho') {
      throw new Error(`Arrow routeStyle must be "curve" or "ortho", got "${value}"`);
    }
    return value;
  },
};

// ─────────────────────────────────────────────────────────────
// ArrowUtil — ShapeUtil for ArrowShape
// ─────────────────────────────────────────────────────────────

export class ArrowUtil extends ShapeUtil<ArrowShape> {
  static override readonly type = 'arrow';

  static override readonly props: GlideProps<ArrowProps> = {
    start:       terminalValidator,
    end:         terminalValidator,
    routeStyle:  routeStyleValidator,
    bend:        T.number,
    color:       T.string,
    opacity:     T.number,
    strokeStyle: StyleValidators.strokeStyle,
    strokeWidth: StyleValidators.strokeWidth,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 3,
    migrators: {
      1: {
        up:   r => ({
          ...r,
          props: {
            routeStyle: 'curve',
            bend: 0,
            ...(r['props'] as object),
          },
        }),
        down: r => r,
      },
      2: {
        up: r => ({
          ...r,
          props: {
            color: '#f38ba8',
            opacity: 1,
            strokeStyle: 'solid',
            strokeWidth: 'medium',
            ...(r['props'] as object),
          }
        }),
        down: r => r,
      },
      3: {
        // v3: Convert world-space terminal points → local-coordinate model.
        // shape.x/y = start terminal world position;
        // start.point = {0,0}; end.point = local offset from start.
        up: (r: any) => {
          const s = r.props.start.point as { x: number; y: number };
          const e = r.props.end.point   as { x: number; y: number };
          return {
            ...r,
            x: s.x,
            y: s.y,
            props: {
              ...r.props,
              start: { ...r.props.start, point: { x: 0, y: 0 } },
              end:   { ...r.props.end,   point: { x: e.x - s.x, y: e.y - s.y } },
            },
          };
        },
        down: (r: any) => {
          const e = r.props.end.point as { x: number; y: number };
          return {
            ...r,
            x: 0,
            y: 0,
            props: {
              ...r.props,
              start: { ...r.props.start, point: { x: r.x, y: r.y } },
              end:   { ...r.props.end,   point: { x: r.x + e.x, y: r.y + e.y } },
            },
          };
        },
      },
    },
  });

  getDefaultProps(): ArrowProps {
    const zero: Vec2 = { x: 0, y: 0 };
    const terminal: ArrowTerminal = {
      boundShapeId:     null,
      normalizedAnchor: { x: 0.5, y: 0.5 },
      point:            zero,
    };
    return {
      start:      terminal,
      end:        terminal,
      routeStyle: 'curve',
      bend:       0,
      color:       '#f38ba8',
      opacity:     1,
      strokeStyle: 'solid',
      strokeWidth: 'medium',
    };
  }

  /**
   * Returns a Geometry2d in LOCAL space.
   */
  getGeometry(shape: ArrowShape): Geometry2d {
    const { start, end } = shape.props;
    return new Polyline2d([start.point, end.point]);
  }

  /** Arrows are resized via terminal handle drags, not the standard resize UI. */
  override hideResizeHandles(_shape: ArrowShape): boolean { return true; }

  /** Arrows are rotated by orbiting shape.x/y + rotating end.point vector. */
  override hideRotateHandle(_shape: ArrowShape): boolean { return true; }

  override onResize(shape: ArrowShape, info: ResizeInfo<ArrowShape>): Partial<ArrowShape> {
    const base = super.onResize(shape, info) as any;
    const { scaleX, scaleY, initialShape: arr } = info;
    return {
      ...base,
      props: {
        ...arr.props,
        end: {
          ...arr.props.end,
          point: {
            x: arr.props.end.point.x * scaleX,
            y: arr.props.end.point.y * scaleY,
          },
        },
      },
    };
  }


  /**
   * Override: hit-test the arrow line, not just its AABB.
   * NOTE: After Phase 1, `point` is in LOCAL space (page coord minus shape.x/y).
   * start.point = {0,0}, end.point = local offset.
   */
  override hitTestPoint(shape: ArrowShape, point: Vec2): boolean {
    const { start, end, routeStyle, bend } = shape.props;

    if (routeStyle === 'ortho') {
      const editor = this.editor as any;
      const fromShape = start.boundShapeId ? editor.getShape(start.boundShapeId) : null;
      const toShape   = end.boundShapeId   ? editor.getShape(end.boundShapeId)   : null;
      let pathStr: string;
      if (fromShape && toShape) {
        const fu = editor.getShapeUtil(fromShape.type);
        const tu = editor.getShapeUtil(toShape.type);
        // Convert world-space bounds of bound shapes to local space
        const fwb = fu.getGeometry(fromShape as any).getBounds();
        const twb = tu.getGeometry(toShape as any).getBounds();
        const fromBounds = {
          ...fwb,
          x: fwb.minX + fromShape.x - shape.x, y: fwb.minY + fromShape.y - shape.y,
          minX: fwb.minX + fromShape.x - shape.x, minY: fwb.minY + fromShape.y - shape.y,
          maxX: fwb.maxX + fromShape.x - shape.x, maxY: fwb.maxY + fromShape.y - shape.y,
        };
        const toBounds = {
          ...twb,
          x: twb.minX + toShape.x - shape.x, y: twb.minY + toShape.y - shape.y,
          minX: twb.minX + toShape.x - shape.x, minY: twb.minY + toShape.y - shape.y,
          maxX: twb.maxX + toShape.x - shape.x, maxY: twb.maxY + toShape.y - shape.y,
        };
        const bindings = editor.getBindingsFromShape(shape.id);
        const startBind = bindings.find((b: any) => b.props.terminal === 'start');
        const endBind   = bindings.find((b: any) => b.props.terminal === 'end');
        const fromEdge = startBind?.props.fromEdge ?? 'right';
        const toEdge   = endBind?.props.fromEdge ?? 'left';
        pathStr = computeElbowPath(fromBounds, toBounds, fromEdge, toEdge, bend);
      } else {
        pathStr = computeArcPath(start.point, end.point, 0);
      }
      const pts = parseElbowPoints(pathStr);
      let minDist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = pointToSegmentDist(point, pts[i], pts[i+1]);
        if (d < minDist) minDist = d;
      }
      return minDist <= 8;
    } else {
      // Curve style hit test — all coords are local
      const editor = this.editor as any;
      let sourceBox: Box2d | null = null;
      let destBox: Box2d | null = null;

      if (start.boundShapeId) {
        const s = editor.getShape(start.boundShapeId);
        if (s) {
          const u = editor.getShapeUtil(s.type);
          const wb = u.getGeometry(s).getBounds();
          sourceBox = {
            ...wb,
            x: wb.minX + s.x - shape.x, y: wb.minY + s.y - shape.y,
            minX: wb.minX + s.x - shape.x, minY: wb.minY + s.y - shape.y,
            maxX: wb.maxX + s.x - shape.x, maxY: wb.maxY + s.y - shape.y,
          };
        }
      }
      if (end.boundShapeId) {
        const d = editor.getShape(end.boundShapeId);
        if (d) {
          const u = editor.getShapeUtil(d.type);
          const wb = u.getGeometry(d).getBounds();
          destBox = {
            ...wb,
            x: wb.minX + d.x - shape.x, y: wb.minY + d.y - shape.y,
            minX: wb.minX + d.x - shape.x, minY: wb.minY + d.y - shape.y,
            maxX: wb.maxX + d.x - shape.x, maxY: wb.maxY + d.y - shape.y,
          };
        }
      }

      // Local coords: start.point = {0,0}, end.point = local offset
      const sx = start.point.x;
      const sy = start.point.y;
      const ex = end.point.x;
      const ey = end.point.y;
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2;
      const dx = ex - sx;
      const dy = ey - sy;
      const chord = Math.sqrt(dx * dx + dy * dy);

      let cpx = mx;
      let cpy = my;
      if (chord >= 1e-9 && bend !== 0) {
        const perpX = dy / chord;
        const perpY = -dx / chord;
        const offset = chord * bend;
        cpx = mx + perpX * offset;
        cpy = my + perpY * offset;
      }

      const p0 = start.point;
      const p1 = { x: cpx, y: cpy };
      const p2 = end.point;

      let tStart = 0;
      let tEnd = 1;

      if (sourceBox) {
        const tStartIntersections = intersectBezierWithBox(p0, p1, p2, sourceBox);
        const valid = tStartIntersections.filter(t => t > 0);
        if (valid.length > 0) {
          tStart = Math.min(...valid);
        }
      }

      if (destBox) {
        const tEndIntersections = intersectBezierWithBox(p0, p1, p2, destBox);
        const valid = tEndIntersections.filter(t => t < 1);
        if (valid.length > 0) {
          tEnd = Math.max(...valid);
        }
      }

      if (tStart >= tEnd) {
        return pointToSegmentDist(point, start.point, end.point) <= 8;
      }

      const [q0, q1, q2] = getBezierSegment(p0, p1, p2, tStart, tEnd);

      if (bend === 0) {
        return pointToSegmentDist(point, q0, q2) <= 8;
      }

      const steps = 30;
      let minDist = Infinity;
      let prev = q0;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const pt = {
          x: mt * mt * q0.x + 2 * mt * t * q1.x + t * t * q2.x,
          y: mt * mt * q0.y + 2 * mt * t * q1.y + t * t * q2.y,
        };
        const d = pointToSegmentDist(point, prev, pt);
        if (d < minDist) minDist = d;
        prev = pt;
      }
      return minDist <= 8;
    }
  }

  /**
   * Draw the arrow in local space.
   * start.point = {0,0} (local origin); end.point = local offset.
   * The parent <g transform="translate(shape.x, shape.y)"> in Canvas.tsx
   * provides world positioning.
   */
  toSvg(shape: ArrowShape): SVGElement {
    const { start, end, routeStyle, bend, color, opacity, strokeStyle, strokeWidth } = shape.props;
    let pathStr: string;

    const editor = this.editor as any;

    if (routeStyle === 'ortho') {
      const fromShape = start.boundShapeId ? editor.getShape(start.boundShapeId) : null;
      const toShape   = end.boundShapeId   ? editor.getShape(end.boundShapeId)   : null;

      if (fromShape && toShape) {
        const bindings = editor.getBindingsFromShape(shape.id) || [];
        const startBind = bindings.find((b: any) => b.props.terminal === 'start');
        const endBind   = bindings.find((b: any) => b.props.terminal === 'end');
        const fromEdge = startBind?.props.fromEdge ?? 'right';
        const toEdge   = endBind?.props.fromEdge ?? 'left';

        const fu = editor.getShapeUtil(fromShape.type);
        const tu = editor.getShapeUtil(toShape.type);
        // Convert world-space bounds of bound shapes to local space for routing
        const fwb = fu.getGeometry(fromShape as any).getBounds();
        const twb = tu.getGeometry(toShape as any).getBounds();
        const fromBounds = {
          ...fwb,
          x:    fwb.minX + fromShape.x - shape.x,
          y:    fwb.minY + fromShape.y - shape.y,
          minX: fwb.minX + fromShape.x - shape.x,
          minY: fwb.minY + fromShape.y - shape.y,
          maxX: fwb.maxX + fromShape.x - shape.x,
          maxY: fwb.maxY + fromShape.y - shape.y,
        };
        const toBounds = {
          ...twb,
          x:    twb.minX + toShape.x - shape.x,
          y:    twb.minY + toShape.y - shape.y,
          minX: twb.minX + toShape.x - shape.x,
          minY: twb.minY + toShape.y - shape.y,
          maxX: twb.maxX + toShape.x - shape.x,
          maxY: twb.maxY + toShape.y - shape.y,
        };
        pathStr = computeElbowPath(fromBounds, toBounds, fromEdge, toEdge, bend);
      } else {
        // Floating: draw from {0,0} to end.point local offset
        pathStr = computeArcPath(start.point, end.point, 0);
      }
    } else {
      // Draw from {0,0} (start) to end.point local offset
      pathStr = computeArcPath(start.point, end.point, bend);
    }

    const strokeW = STROKE_WIDTHS[strokeWidth] ?? 2;
    const strokeC = resolveColor(color) ?? color;
    const dashArray = STROKE_DASH_ARRAYS[strokeStyle] ?? 'none';

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'glideline-arrow');
    if (opacity < 1) g.setAttribute('opacity', String(opacity));

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathStr);
    path.setAttribute('stroke', strokeC);
    path.setAttribute('stroke-width', String(strokeW));
    path.setAttribute('fill', 'none');
    if (dashArray !== 'none') {
      path.setAttribute('stroke-dasharray', dashArray);
    }
    g.appendChild(path);

    const endPt = arrowEndPoint(pathStr, end.point);
    const tangentFrom = arrowTangentFrom(pathStr, start.point);
    const pts = getArrowheadPoints(tangentFrom, endPt);
    if (pts) {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', pts);
      polygon.setAttribute('fill', strokeC);
      g.appendChild(polygon);
    }

    return g;
  }
}

// ─────────────────────────────────────────────────────────────
// Arrow SVG Export Helpers
// ─────────────────────────────────────────────────────────────

function arrowEndPoint(pathStr: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const match = pathStr.match(/(?:Q\s+[\d.\-eE+]+\s+[\d.\-eE+]+\s+|L\s+)([\d.\-eE+]+)\s+([\d.\-eE+]+)$/);
  if (match) return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
  return fallback;
}

function arrowTangentFrom(pathStr: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const qMatch = pathStr.match(/Q\s+([\d.\-eE+]+)\s+([\d.\-eE+]+)\s+[\d.\-eE+]+\s+[\d.\-eE+]+/);
  if (qMatch) return { x: parseFloat(qMatch[1]), y: parseFloat(qMatch[2]) };
  const pts: { x: number; y: number }[] = [];
  const re = /[ML]\s+([\d.\-eE+]+)\s+([\d.\-eE+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathStr)) !== null) pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  if (pts.length >= 2) return pts[pts.length - 2];
  return fallback;
}

function getArrowheadPoints(tangentFrom: Vec2, tip: Vec2) {
  const dx = tip.x - tangentFrom.x;
  const dy = tip.y - tangentFrom.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return '';
  const ux = dx / len; const uy = dy / len;
  const p1 = `${tip.x},${tip.y}`;
  const p2 = `${tip.x - ux * 14 - uy * 6},${tip.y - uy * 14 + ux * 6}`;
  const p3 = `${tip.x - ux * 14 + uy * 6},${tip.y - uy * 14 - ux * 6}`;
  return `${p1} ${p2} ${p3}`;
}

// ─────────────────────────────────────────────────────────────
// Helper: point-to-segment distance
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
// ArrowBindingProps
// ─────────────────────────────────────────────────────────────

export interface ArrowBindingProps {
  [key: string]: unknown;
  /** 'start' or 'end' — which terminal of the arrow is bound */
  terminal: 'start' | 'end';
  /** [0..1] anchor within target shape bounds */
  normalizedAnchor: Vec2;
  /** Closest edge of target from this anchor (derived, not stored as float) */
  fromEdge: EdgeName;
}

export type ArrowBinding = GlideBinding<ArrowBindingProps>;

// ─────────────────────────────────────────────────────────────
// Helpers: derive EdgeName from normalizedAnchor
// ─────────────────────────────────────────────────────────────

/**
 * Derive the closest edge name from a [0..1, 0..1] normalised anchor.
 *
 * Quadrant analysis:
 *   - If closer to left/right walls than top/bottom: left or right
 *   - Otherwise: top or bottom
 */
export function anchorToEdge(anchor: Vec2): EdgeName {
  const { x, y } = anchor;
  // Distance to each edge (0..0.5)
  const dLeft   = x;
  const dRight  = 1 - x;
  const dTop    = y;
  const dBottom = 1 - y;

  const minDist = Math.min(dLeft, dRight, dTop, dBottom);
  if (minDist === dLeft)   return 'left';
  if (minDist === dRight)  return 'right';
  if (minDist === dTop)    return 'top';
  return 'bottom';
}

export function anchorToPoint(anchor: Vec2, bounds: Box2d): Vec2 {
  return {
    x: bounds.x + anchor.x * bounds.w,
    y: bounds.y + anchor.y * bounds.h,
  };
}

/**
 * Snaps a target page-space point to the closest predefined connection point
 * (centers of the four edges) of a shape's bounding box.
 */
export function getClosestConnectionPoint(pt: Vec2, bounds: Box2d): { normalizedAnchor: Vec2; point: Vec2 } {
  if (pt.x >= bounds.x && pt.x <= bounds.x + bounds.w && pt.y >= bounds.y && pt.y <= bounds.y + bounds.h) {
    return {
      normalizedAnchor: {
        x: bounds.w > 0 ? (pt.x - bounds.x) / bounds.w : 0.5,
        y: bounds.h > 0 ? (pt.y - bounds.y) / bounds.h : 0.5,
      },
      point: pt,
    };
  }

  const points = [
    { anchor: { x: 0.5, y: 0.0 }, pt: { x: bounds.x + bounds.w / 2, y: bounds.y } },
    { anchor: { x: 1.0, y: 0.5 }, pt: { x: bounds.x + bounds.w,     y: bounds.y + bounds.h / 2 } },
    { anchor: { x: 0.5, y: 1.0 }, pt: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h } },
    { anchor: { x: 0.0, y: 0.5 }, pt: { x: bounds.x,                y: bounds.y + bounds.h / 2 } },
  ];
  let minDistance = Infinity;
  let closest = points[0];
  for (const p of points) {
    const d = Math.hypot(pt.x - p.pt.x, pt.y - p.pt.y);
    if (d < minDistance) {
      minDistance = d;
      closest = p;
    }
  }
  return {
    normalizedAnchor: closest.anchor,
    point: closest.pt,
  };
}

// ─────────────────────────────────────────────────────────────
// ArrowBindingUtil
// ─────────────────────────────────────────────────────────────

export class ArrowBindingUtil extends BindingUtil<ArrowBinding> {
  static override readonly type = 'arrow';

  static override readonly props: GlideProps<ArrowBindingProps> = {
    terminal: {
      validate(v: unknown): 'start' | 'end' {
        if (v !== 'start' && v !== 'end') throw new Error(`terminal must be "start" or "end"`);
        return v;
      },
    },
    normalizedAnchor: {
      validate(v: unknown): Vec2 {
        if (typeof v !== 'object' || v === null) throw new Error('normalizedAnchor must be Vec2');
        return v as Vec2;
      },
    },
    fromEdge: {
      validate(v: unknown): EdgeName {
        if (!['top', 'right', 'bottom', 'left'].includes(v as string)) {
          throw new Error(`fromEdge must be EdgeName`);
        }
        return v as EdgeName;
      },
    },
  };

  getDefaultProps(): ArrowBindingProps {
    return {
      terminal:         'end',
      normalizedAnchor: { x: 0.5, y: 0.5 },
      fromEdge:         'left',
    };
  }

  /**
   * Called whenever the target shape (toId) changes.
   * Recomputes terminal position in LOCAL arrow space from normalizedAnchor.
   *
   * Local model:
   *  - shape.x/y = world position of the START terminal
   *  - props.start.point = {0, 0} always
   *  - props.end.point = local offset (world_end - world_start)
   */
  override onAfterChangeToShape(binding: ArrowBinding): void {
    const editor = this.editor as import('../editor').GlideEditor;
    const arrow = editor.getShape<ArrowShape>(binding.fromId as ShapeId);
    if (!arrow) return;

    const targetShape = editor.getShape(binding.toId);
    if (!targetShape) return;

    const util = editor.getShapeUtil(targetShape.type);
    // getGeometry returns LOCAL bounds for non-arrow shapes (minX=0, minY=0)
    // anchorToPoint uses bounds.x/bounds.y which equals 0 for local bounds.
    // We need WORLD position, so use targetShape.x/y + local offset.
    const localBounds = util.getGeometry(targetShape as any).getBounds();
    // World bounds = localBounds shifted by targetShape.x/y
    const worldBounds = {
      ...localBounds,
      x:    localBounds.minX + targetShape.x,
      y:    localBounds.minY + targetShape.y,
      minX: localBounds.minX + targetShape.x,
      minY: localBounds.minY + targetShape.y,
      maxX: localBounds.maxX + targetShape.x,
      maxY: localBounds.maxY + targetShape.y,
    };

    const { normalizedAnchor, terminal } = binding.props;
    const worldPoint = anchorToPoint(normalizedAnchor, worldBounds);
    const fromEdge   = anchorToEdge(normalizedAnchor);

    const terminalData = arrow.props[terminal];

    if (terminal === 'start') {
      // Start terminal: shape.x/y IS the world position of start.
      // Keep end visually stable by recomputing its local offset.
      const currentEndWorldX = arrow.x + arrow.props.end.point.x;
      const currentEndWorldY = arrow.y + arrow.props.end.point.y;
      const newEndLocalX = currentEndWorldX - worldPoint.x;
      const newEndLocalY = currentEndWorldY - worldPoint.y;

      editor.updateShape<ArrowShape>(binding.fromId as ShapeId, {
        x: worldPoint.x,
        y: worldPoint.y,
        props: {
          ...arrow.props,
          start: {
            ...terminalData,
            point: { x: 0, y: 0 },
            boundShapeId: binding.toId as ShapeId,
          },
          end: {
            ...arrow.props.end,
            point: { x: newEndLocalX, y: newEndLocalY },
          },
        },
      });
    } else {
      // End terminal: compute local offset from arrow origin
      const localX = worldPoint.x - arrow.x;
      const localY = worldPoint.y - arrow.y;

      editor.updateShape<ArrowShape>(binding.fromId as ShapeId, {
        props: {
          ...arrow.props,
          [terminal]: {
            ...terminalData,
            point: { x: localX, y: localY },
            boundShapeId: binding.toId as ShapeId,
          },
        },
      });
    }

    // Update binding's fromEdge
    editor.updateBinding(binding.id, { fromEdge });
  }

  /**
   * Called before the target shape (toId) is deleted.
   * Detaches the terminal: sets boundShapeId = null, keeps last known point.
   */
  override onBeforeDeleteToShape(binding: ArrowBinding): void {
    const editor = this.editor as import('../editor').GlideEditor;
    const arrow = editor.getShape<ArrowShape>(binding.fromId as ShapeId);
    if (!arrow) return;

    const { terminal } = binding.props;
    const terminalData = arrow.props[terminal];
    editor.updateShape<ArrowShape>(binding.fromId as ShapeId, {
      props: {
        ...arrow.props,
        [terminal]: {
          ...terminalData,
          boundShapeId: null,
        },
      },
    });
  }
}

// ─────────────────────────────────────────────────────────────
// ArrowPlugin convenience export
// ─────────────────────────────────────────────────────────────

import type { GlidePlugin } from '../editor';

export const ArrowPlugin: GlidePlugin = {
  id: 'arrow',
  shapes:   [ArrowUtil as any],
  bindings: [ArrowBindingUtil as any],
};
