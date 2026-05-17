/**
 * Spike 0.4 — ArrowPlugin
 *
 * Demonstrates:
 *  - Arrow shape with typed props (routeStyle, bend, terminals)
 *  - ArrowBinding (BindingUtil) with fromEdge/toEdge (Spike 0.3 decision)
 *  - onAfterChangeToShape: recompute terminal on target move
 *  - onBeforeDeleteToShape: detach gracefully
 *
 * IMPORTANT: This plugin depends on BoxPlugin (or any shape that can be bound to).
 * Arrow rendering (arc/elbow path math) is stubbed here — the full implementation
 * belongs in Phase 4. This spike validates the API surface, not the routing math.
 */

import type {
  GlideShape, GlideBinding, ShapeUtil, BindingUtil,
  Box2d, Vec2, ReactNode, GlidePlugin, GlideEditor,
  ShapeId, BindingId, EdgeName,
} from "../types.js";
import { sid, bid } from "../types.js";

// ── Arrow shape ──────────────────────────────────────────────

export interface ArrowTerminal {
  /** If bound: which shape */
  boundShapeId: ShapeId | null;
  /** Normalized position on the shape (0–1). Only used when boundShapeId is set. */
  normalizedAnchor: { x: number; y: number };
  /** Page-space position. For unbound terminals, this IS the point. For bound, computed from shape. */
  point: Vec2;
}

export interface ArrowProps {
  /** "curve" = arc (Spike 0.3), "ortho" = elbow */
  routeStyle: "curve" | "ortho";
  /** For "curve" style: positive/negative curvature. 0 = straight. */
  bend: number;
  start: ArrowTerminal;
  end: ArrowTerminal;
  arrowheadStart: "none" | "arrow";
  arrowheadEnd: "none" | "arrow";
  color: string;
  strokeWidth: number;
}

export type ArrowShape = GlideShape<ArrowProps>;

export const arrowShapeUtil: ShapeUtil<ArrowShape> = {
  type: "arrow",

  defaultProps(): ArrowProps {
    return {
      routeStyle: "curve",
      bend: 0,
      start: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 0, y: 0 } },
      end:   { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 100, y: 0 } },
      arrowheadStart: "none",
      arrowheadEnd: "arrow",
      color: "#1e293b",
      strokeWidth: 2,
    };
  },

  getGeometry(shape): Box2d {
    // Bounding box of start → end (approximate — good enough for culling)
    const { start, end } = shape.props;
    const minX = Math.min(start.point.x, end.point.x);
    const minY = Math.min(start.point.y, end.point.y);
    const maxX = Math.max(start.point.x, end.point.x);
    const maxY = Math.max(start.point.y, end.point.y);
    return {
      x: minX, y: minY,
      w: maxX - minX || 1,
      h: maxY - minY || 1,
      get minX() { return minX; },
      get minY() { return minY; },
      get maxX() { return maxX; },
      get maxY() { return maxY; },
    };
  },

  component(shape): ReactNode {
    // Routing math stubbed — just return the path data shape the renderer expects
    const { start, end, color, strokeWidth } = shape.props;
    const d = `M ${start.point.x} ${start.point.y} L ${end.point.x} ${end.point.y}`;
    return {
      tag: "path",
      attrs: { d, stroke: color, strokeWidth, fill: "none", markerEnd: "url(#arrowhead)" },
    } as unknown as ReactNode;
  },

  indicator(_shape): ReactNode | null {
    // Selection indicator is just a highlight on the path — stub
    return null;
  },
};

// ── Arrow binding ────────────────────────────────────────────

export interface ArrowBindingProps {
  terminal: "start" | "end";
  normalizedAnchor: { x: number; y: number };
  /** Which named edge this terminal exits/enters (Spike 0.3 decision) */
  fromEdge: EdgeName;
  isPrecise: boolean;
}

export type ArrowBinding = GlideBinding<ArrowBindingProps>;

/**
 * Compute which edge a normalizedAnchor is closest to.
 * This is what replaces the float normal-vector approach.
 * "right" if x > 0.75, "left" if x < 0.25, "bottom" if y > 0.75, "top" otherwise.
 */
function anchorToEdge(anchor: { x: number; y: number }): EdgeName {
  const { x, y } = anchor;
  if (x > 0.75) return "right";
  if (x < 0.25) return "left";
  if (y > 0.75) return "bottom";
  return "top";
}

export const arrowBindingUtil: BindingUtil<ArrowBinding> = {
  type: "arrow",

  defaultProps(): ArrowBindingProps {
    return {
      terminal: "end",
      normalizedAnchor: { x: 0.5, y: 0.5 },
      fromEdge: "right",
      isPrecise: false,
    };
  },

  onAfterChangeToShape(binding, editor) {
    // Target shape moved/resized → recompute arrow terminal point
    const targetShape = editor.getShape(binding.toId);
    if (!targetShape) return;

    const util = editor.getShapeUtil(targetShape);
    const bounds = util.getGeometry(targetShape);
    const { normalizedAnchor, terminal } = binding.props;

    // Compute page-space point from normalizedAnchor on the target bounds
    const point: Vec2 = {
      x: bounds.x + normalizedAnchor.x * bounds.w,
      y: bounds.y + normalizedAnchor.y * bounds.h,
    };

    // Recompute fromEdge from the anchor position (not a stored normal vector)
    const fromEdge = anchorToEdge(normalizedAnchor);

    // Update the arrow shape
    const arrowShape = editor.getShape<ArrowShape>(binding.fromId);
    if (!arrowShape) return;

    const terminalUpdate = {
      ...arrowShape.props[terminal],
      point,
      boundShapeId: binding.toId,
    };

    editor.updateShape<ArrowShape>(binding.fromId, {
      props: {
        ...arrowShape.props,
        [terminal]: terminalUpdate,
      },
    });

    // Update the binding's fromEdge so elbow router has it
    editor.updateBinding<ArrowBinding>(binding.id, { fromEdge });
  },

  onBeforeDeleteToShape(binding, editor) {
    // Target shape being deleted → detach arrow (make terminal free-floating)
    const arrowShape = editor.getShape<ArrowShape>(binding.fromId);
    if (!arrowShape) return;

    const { terminal } = binding.props;
    editor.updateShape<ArrowShape>(binding.fromId, {
      props: {
        ...arrowShape.props,
        [terminal]: {
          ...arrowShape.props[terminal],
          boundShapeId: null,
        },
      },
    });

    // Delete the binding itself
    editor.deleteBindings([binding.id]);
  },
};

// ── Plugin ──────────────────────────────────────────────────

export const ArrowPlugin: GlidePlugin = {
  id: "glideline/arrow",
  shapes: [arrowShapeUtil],
  bindings: [arrowBindingUtil],
};
