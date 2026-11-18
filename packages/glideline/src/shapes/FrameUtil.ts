import { FONT_FAMILIES } from '../board-fonts.js';
import { createSvgLabel } from './TextUtil.js';
import { boundsAnchors, QUARTERS } from '../connection-anchors.js';
import { addSketchOutline, rectangleOutline, sketchOutlinePath } from '../sketch-stroke.js';
/**
 * FrameUtil — container shape (Story 2.3)
 *
 * canContain() = true → other shapes can be nested inside.
 * Renders as dashed-border rect with a label.
 * toSvg() returns geometry; getLabelProps() owns the editable label layout.
 */

import { ShapeUtil } from './ShapeUtil.js';
import { T } from '../validators.js';
import { defineMigrations } from '../migrations.js';
import { makeBox } from '../types.js';
import type { GlideShape } from '../types.js';
import { Geometry2d, Rectangle2d } from '../geometry/index.js';
import {
  FONT_SIZES, inlinePatternDefs, STROKE_DASH_ARRAYS, STROKE_WIDTHS, StyleValidators, svgFill,
  type FillStyle, type Font, type FontSize, type LabelProps, type SizeStyle, type StrokeStyle,
} from '../styles.js';

export interface FrameProps {
  [key: string]: unknown;
  w:     number;
  h:     number;
  label: string;
  color: string;
  opacity: number;
  clipContent: boolean;
  font?: Font;
  fontSize?: FontSize;
  fillStyle?: FillStyle;
  strokeStyle?: StrokeStyle;
  strokeWidth?: SizeStyle;
}

export type FrameShape = GlideShape<FrameProps>;

export class FrameUtil extends ShapeUtil<FrameShape> {
  static override readonly type = 'frame';

  override getConnectionAnchors() {
    return boundsAnchors(QUARTERS);
  }
  static override readonly canContainChildren = true;

  override supportsSketchStroke(): boolean { return true; }

  static override readonly props = {
    w:     T.number,
    h:     T.number,
    label: T.string,
    color: T.string,
    opacity: T.number,
    clipContent: T.boolean,
    font: T.optional(StyleValidators.font),
    fontSize: T.optional(StyleValidators.fontSize),
    fillStyle: T.optional(StyleValidators.fillStyle),
    strokeStyle: T.optional(StyleValidators.strokeStyle),
    strokeWidth: T.optional(StyleValidators.strokeWidth),
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 3,
    migrators: {
      1: {
        up:   r => ({ ...r, props: { label: 'Frame', color: '#313244', ...(r['props'] as object) } }),
        down: r => r,
      },
      2: {
        up: r => ({
          ...r,
          props: { ...(r['props'] as object), clipContent: false },
        }),
        down: r => {
          const props = { ...(r['props'] as Record<string, unknown>) };
          delete props.clipContent;
          return { ...r, props };
        },
      },
      3: {
        up: r => ({
          ...r,
          props: { ...(r['props'] as object), opacity: 1 },
        }),
        down: r => {
          const props = { ...(r['props'] as Record<string, unknown>) };
          delete props.opacity;
          return { ...r, props };
        },
      },
    },
  });

  getDefaultProps(): FrameProps {
    return { w: 400, h: 300, label: 'Frame', color: '#313244', opacity: 1, clipContent: false };
  }

  getGeometry(shape: FrameShape): Geometry2d {
    return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
  }

  /** Frames act as containers — child shapes can be dropped inside. */
  override canContain(_shape: FrameShape): boolean {
    return true;
  }

  override getLabelProps(shape: FrameShape): LabelProps {
    return {
      text: shape.props.label,
      fontFamily: FONT_FAMILIES[shape.props.font ?? 'sans'],
      fontSize: shape.props.fontSize ? FONT_SIZES[shape.props.fontSize] : 13,
      color: shape.props.color,
      textAlign: 'left',
      verticalAlign: 'center',
      padding: 0,
      x: 8,
      y: -26,
      w: Math.max(40, shape.props.w - 16),
      h: 20,
    };
  }

  override getVisualBounds(shape: FrameShape) {
    const bounds = this.getGeometry(shape).getBounds();
    const label = this.getLabelProps(shape);
    const minX = Math.min(bounds.minX, label.x ?? bounds.minX);
    const minY = Math.min(bounds.minY, label.y ?? bounds.minY);
    const maxX = Math.max(bounds.maxX, (label.x ?? 0) + (label.w ?? 0));
    const maxY = Math.max(bounds.maxY, (label.y ?? 0) + (label.h ?? 0));
    return makeBox(minX, minY, maxX - minX, maxY - minY);
  }

  toSvg(shape: FrameShape): SVGElement {
    const { props } = shape;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));

    const fill = props.fillStyle;
    const pattern = fill && inlinePatternDefs(fill, props.color, shape.id);
    if (pattern) g.appendChild(pattern);
    const dash = STROKE_DASH_ARRAYS[props.strokeStyle ?? 'dashed'];
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x',              '0');
    rect.setAttribute('y',              '0');
    rect.setAttribute('width',          String(props.w));
    rect.setAttribute('height',         String(props.h));
    rect.setAttribute('fill',           fill ? svgFill(fill, props.color, shape.id) : `${props.color}22`);
    rect.setAttribute('stroke',         props.color);
    rect.setAttribute('stroke-width',   String(props.strokeWidth ? STROKE_WIDTHS[props.strokeWidth] : 2));
    if (dash !== 'none') rect.setAttribute('stroke-dasharray', dash);
    if (props.strokeStyle === 'dotted') rect.setAttribute('stroke-linecap', 'round');
    rect.setAttribute('rx',             '4');
    g.appendChild(rect);
    if (props.strokeStyle === 'sketch') {
      const outline = rectangleOutline(props.w, props.h, 4);
      addSketchOutline(rect, shape.id, (seed, strength) => sketchOutlinePath(outline, seed, strength));
    }

    return g;
  }

  override toSvgExport(shape: FrameShape): SVGElement {
    const geometry = this.toSvg(shape);
    const label = this.getLabelProps(shape);
    if (label?.text) geometry.appendChild(createSvgLabel(label, this.getGeometry(shape).getBounds()));
    return geometry;
  }
}
