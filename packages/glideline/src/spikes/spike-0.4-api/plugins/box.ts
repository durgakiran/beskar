/**
 * Spike 0.4 — BoxPlugin
 *
 * A minimal rectangle shape plugin. Demonstrates:
 *  - Typed props via GlideShape<BoxProps>
 *  - getGeometry returning correct Box2d
 *  - component / indicator rendering
 *  - defaultProps with sensible values
 */

import type { GlideShape, ShapeUtil, Box2d, Vec2, ReactNode, GlidePlugin } from "../types.js";

// ── Shape record type ───────────────────────────────────────

export interface BoxProps {
  w: number;
  h: number;
  color: string;
  label: string;
}

export type BoxShape = GlideShape<BoxProps>;

// ── ShapeUtil ───────────────────────────────────────────────

export const boxShapeUtil: ShapeUtil<BoxShape> = {
  type: "box",

  defaultProps(): BoxProps {
    return { w: 120, h: 80, color: "#3b82f6", label: "" };
  },

  getGeometry(shape): Box2d {
    return {
      x: shape.x, y: shape.y,
      w: shape.props.w, h: shape.props.h,
      get minX() { return shape.x; },
      get minY() { return shape.y; },
      get maxX() { return shape.x + shape.props.w; },
      get maxY() { return shape.y + shape.props.h; },
    };
  },

  component(shape): ReactNode {
    const { w, h, color, label } = shape.props;
    // Returns plain SVG element descriptions for the prototype
    // (React not wired in this spike — verified structurally)
    return {
      tag: "rect",
      attrs: { x: 0, y: 0, width: w, height: h, fill: color, rx: 4 },
      children: label
        ? [{ tag: "text", attrs: { x: w / 2, y: h / 2 + 5, textAnchor: "middle", fill: "#fff", fontSize: 14 }, text: label }]
        : [],
    } as unknown as ReactNode;
  },

  indicator(shape): ReactNode {
    const { w, h } = shape.props;
    return {
      tag: "rect",
      attrs: { x: -2, y: -2, width: w + 4, height: h + 4, fill: "none", stroke: "#2563eb", strokeWidth: 2, rx: 4 },
    } as unknown as ReactNode;
  },

  hitTestPoint(shape, point: Vec2): boolean {
    const { x, y } = shape;
    const { w, h } = shape.props;
    return point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h;
  },
};

// ── Plugin ──────────────────────────────────────────────────

export const BoxPlugin: GlidePlugin = {
  id: "glideline/box",
  shapes: [boxShapeUtil],
};
