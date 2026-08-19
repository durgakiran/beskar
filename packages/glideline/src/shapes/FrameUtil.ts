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
import { createTextForeignObjectForExport, type LabelProps } from '../styles.js';

export interface FrameProps {
  [key: string]: unknown;
  w:     number;
  h:     number;
  label: string;
  color: string;
  opacity: number;
  clipContent: boolean;
}

export type FrameShape = GlideShape<FrameProps>;

export class FrameUtil extends ShapeUtil<FrameShape> {
  static override readonly type = 'frame';
  static override readonly canContainChildren = true;

  static override readonly props = {
    w:     T.number,
    h:     T.number,
    label: T.string,
    color: T.string,
    opacity: T.number,
    clipContent: T.boolean,
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
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 13,
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

    // Dashed border (local coords: x=0, y=0)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x',              '0');
    rect.setAttribute('y',              '0');
    rect.setAttribute('width',          String(props.w));
    rect.setAttribute('height',         String(props.h));
    rect.setAttribute('fill',           `${props.color}22`);
    rect.setAttribute('stroke',         props.color);
    rect.setAttribute('stroke-width',   '2');
    rect.setAttribute('stroke-dasharray', '8 4');
    rect.setAttribute('rx',             '4');
    g.appendChild(rect);

    return g;
  }

  override toSvgExport(shape: FrameShape): SVGElement {
    const g = this.toSvg(shape);
    const label = this.getLabelProps(shape);
    g.appendChild(createTextForeignObjectForExport({
      x: label.x ?? 8,
      y: label.y ?? -26,
      w: label.w ?? Math.max(40, shape.props.w - 16),
      h: label.h ?? 20,
      text: shape.props.label,
      font: label.fontFamily,
      fontSize: label.fontSize,
      textAlign: 'left',
      color: label.color,
      verticalAlign: 'center',
    }));
    return g;
  }
}
