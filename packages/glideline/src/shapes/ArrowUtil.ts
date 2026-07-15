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
import { Geometry2d, Polyline2d } from '../geometry';
import { resolveArrowRoute } from '../arrow-routing';
import { StyleValidators, STROKE_WIDTHS, STROKE_DASH_ARRAYS, resolveColor, type StrokeStyle, type SizeStyle } from '../styles';

const ARROW_HIT_TEST_PADDING = 8;

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

export type ArrowheadStyle = 'none' | 'arrow';

// ─────────────────────────────────────────────────────────────
// ArrowProps
// ─────────────────────────────────────────────────────────────

export interface ArrowProps {
  [key: string]: unknown;
  start: ArrowTerminal;
  end:   ArrowTerminal;
  /** 'curve' = quadratic Bézier arc, 'ortho' = rectilinear elbow */
  routeStyle: ArrowRouteStyle;
  /** Bend scalar for arc router. 0 = straight. */
  bend: number;
  arrowheadStart: ArrowheadStyle;
  arrowheadEnd: ArrowheadStyle;
  color: string;
  opacity: number;
  strokeStyle: StrokeStyle;
  strokeWidth: SizeStyle;
}

export type ArrowShape = GlideShape<ArrowProps>;
export type ArrowRouteStyle = 'curve' | 'ortho' | 'smart';

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
  validate(value: unknown): ArrowRouteStyle {
    if (value !== 'curve' && value !== 'ortho' && value !== 'smart') {
      throw new Error(`Arrow routeStyle must be "curve", "ortho", or "smart", got "${value}"`);
    }
    return value;
  },
};

const arrowheadStyleValidator = {
  validate(value: unknown): ArrowheadStyle {
    if (value !== 'none' && value !== 'arrow') {
      throw new Error(`Arrow arrowhead style must be "none" or "arrow", got "${value}"`);
    }
    return value;
  },
};

// ─────────────────────────────────────────────────────────────
// ArrowUtil — ShapeUtil for ArrowShape
// ─────────────────────────────────────────────────────────────

export class ArrowUtil extends ShapeUtil<ArrowShape> {
  static override readonly type = 'arrow';
  static override readonly references = [
    { path: '/props/start/boundShapeId', targetKind: 'shape', onDetach: 'null' },
    { path: '/props/end/boundShapeId', targetKind: 'shape', onDetach: 'null' },
  ] as const;

  static override readonly props: GlideProps<ArrowProps> = {
    start:       terminalValidator,
    end:         terminalValidator,
    routeStyle:  routeStyleValidator,
    bend:        T.number,
    arrowheadStart: arrowheadStyleValidator,
    arrowheadEnd: arrowheadStyleValidator,
    color:       T.string,
    opacity:     T.number,
    strokeStyle: StyleValidators.strokeStyle,
    strokeWidth: StyleValidators.strokeWidth,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 5,
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
      4: {
        up: r => ({
          ...r,
          props: {
            arrowheadStart: 'none',
            arrowheadEnd: 'arrow',
            ...(r['props'] as object),
          },
        }),
        down: r => r,
      },
      5: {
        up: r => r,
        down: (r: any) => ({
          ...r,
          props: {
            ...r.props,
            routeStyle: r.props?.routeStyle === 'smart' ? 'ortho' : r.props?.routeStyle,
          },
        }),
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
      arrowheadStart: 'none',
      arrowheadEnd: 'arrow',
      color:       'black',
      opacity:     1,
      strokeStyle: 'solid',
      strokeWidth: 'medium',
    };
  }

  /**
   * Returns a Geometry2d in LOCAL space.
   */
  getGeometry(shape: ArrowShape): Geometry2d {
    return new Polyline2d(this.getLocalPathPoints(shape), {
      boundsPadding: ARROW_HIT_TEST_PADDING,
      hitThreshold: ARROW_HIT_TEST_PADDING,
    });
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

  private getLocalPathPoints(shape: ArrowShape): Vec2[] {
    return resolveArrowRoute(this.editor as any, shape).localPoints;
  }


  /**
   * Override: hit-test the arrow line, not just its AABB.
   * NOTE: After Phase 1, `point` is in LOCAL space (page coord minus shape.x/y).
   * start.point = {0,0}, end.point = local offset.
   */
  override hitTestPoint(shape: ArrowShape, point: Vec2): boolean {
    return this.getGeometry(shape).hitTestPoint(point);
  }

  /**
   * Draw the arrow in local space.
   * start.point = {0,0} (local origin); end.point = local offset.
   * The parent <g transform="translate(shape.x, shape.y)"> in Canvas.tsx
   * provides world positioning.
   */
  toSvg(shape: ArrowShape): SVGElement {
    const {
      arrowheadStart,
      arrowheadEnd,
      color,
      opacity,
      strokeStyle,
      strokeWidth,
    } = shape.props;
    const route = resolveArrowRoute(this.editor as any, shape);
    const pathStr = route.path;
    const start = shape.props.start;
    const end = shape.props.end;

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

    if (arrowheadStart === 'arrow') {
      const startPt = arrowStartPoint(pathStr, start.point);
      const tangentTo = arrowTangentTo(pathStr, end.point);
      const pts = getArrowheadPoints(tangentTo, startPt);
      if (pts) {
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', pts);
        polygon.setAttribute('fill', strokeC);
        g.appendChild(polygon);
      }
    }

    if (arrowheadEnd === 'arrow') {
      const endPt = arrowEndPoint(pathStr, end.point);
      const tangentFrom = arrowTangentFrom(pathStr, start.point);
      const pts = getArrowheadPoints(tangentFrom, endPt);
      if (pts) {
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', pts);
        polygon.setAttribute('fill', strokeC);
        g.appendChild(polygon);
      }
    }

    return g;
  }
}

// ─────────────────────────────────────────────────────────────
// Arrow SVG Export Helpers
// ─────────────────────────────────────────────────────────────

function arrowStartPoint(pathStr: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const match = pathStr.match(/^M\s+([\d.\-eE+]+)\s+([\d.\-eE+]+)/);
  const x = match?.[1];
  const y = match?.[2];
  if (x !== undefined && y !== undefined) return { x: parseFloat(x), y: parseFloat(y) };
  return fallback;
}

function arrowTangentTo(pathStr: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const qMatch = pathStr.match(/^M\s+[\d.\-eE+]+\s+[\d.\-eE+]+\s+Q\s+([\d.\-eE+]+)\s+([\d.\-eE+]+)/);
  const qx = qMatch?.[1];
  const qy = qMatch?.[2];
  if (qx !== undefined && qy !== undefined) return { x: parseFloat(qx), y: parseFloat(qy) };
  const pts = getPathPoints(pathStr);
  if (pts.length >= 2) return pts[1]!;
  return fallback;
}

function arrowEndPoint(pathStr: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const match = pathStr.match(/(?:Q\s+[\d.\-eE+]+\s+[\d.\-eE+]+\s+|L\s+)([\d.\-eE+]+)\s+([\d.\-eE+]+)$/);
  const x = match?.[1];
  const y = match?.[2];
  if (x !== undefined && y !== undefined) return { x: parseFloat(x), y: parseFloat(y) };
  return fallback;
}

function arrowTangentFrom(pathStr: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const qMatch = pathStr.match(/Q\s+([\d.\-eE+]+)\s+([\d.\-eE+]+)\s+[\d.\-eE+]+\s+[\d.\-eE+]+/);
  const qx = qMatch?.[1];
  const qy = qMatch?.[2];
  if (qx !== undefined && qy !== undefined) return { x: parseFloat(qx), y: parseFloat(qy) };
  const pts = getPathPoints(pathStr);
  if (pts.length >= 2) return pts[pts.length - 2]!;
  return fallback;
}

function getPathPoints(pathStr: string): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const re = /[ML]\s+([\d.\-eE+]+)\s+([\d.\-eE+]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathStr)) !== null) {
    const x = m[1];
    const y = m[2];
    if (x !== undefined && y !== undefined) {
      pts.push({ x: parseFloat(x), y: parseFloat(y) });
    }
  }
  return pts;
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

export function getConnectionPoints(bounds: Box2d): Array<{ normalizedAnchor: Vec2; point: Vec2 }> {
  return [
    { normalizedAnchor: { x: 0.5, y: 0.0 }, point: { x: bounds.x + bounds.w / 2, y: bounds.y } },
    { normalizedAnchor: { x: 1.0, y: 0.5 }, point: { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 } },
    { normalizedAnchor: { x: 0.5, y: 1.0 }, point: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h } },
    { normalizedAnchor: { x: 0.0, y: 0.5 }, point: { x: bounds.x, y: bounds.y + bounds.h / 2 } },
  ];
}

/**
 * Snaps a target page-space point to the closest predefined connection point
 * (centers of the four edges) of a shape's bounding box.
 *
 * Even when the pointer is inside the shape, we still resolve to one of the
 * predefined anchors so preview and commit behavior stay predictable.
 */
export function getClosestConnectionPoint(pt: Vec2, bounds: Box2d): { normalizedAnchor: Vec2; point: Vec2 } {
  const points = getConnectionPoints(bounds);
  let minDistance = Infinity;
  let closest = points[0]!;
  for (const p of points) {
    const d = Math.hypot(pt.x - p.point.x, pt.y - p.point.y);
    if (d < minDistance) {
      minDistance = d;
      closest = p;
    }
  }
  return {
    normalizedAnchor: closest.normalizedAnchor,
    point: closest.point,
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
