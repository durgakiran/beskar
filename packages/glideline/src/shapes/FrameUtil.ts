/**
 * FrameUtil — container shape (Story 2.3)
 *
 * canContain() = true → other shapes can be nested inside.
 * Renders as dashed-border rect with a label.
 * toSvg() returns a <g> with dashed <rect> + <text> label.
 */

import { ShapeUtil } from './ShapeUtil';
import { T } from '../validators';
import { defineMigrations } from '../migrations';
import { makeBox } from '../types';
import type { GlideShape, Box2d } from '../types';

export interface FrameProps {
  w:     number;
  h:     number;
  label: string;
  color: string;
}

export type FrameShape = GlideShape<FrameProps>;

export class FrameUtil extends ShapeUtil<FrameShape> {
  static override readonly type = 'frame';

  static override readonly props = {
    w:     T.number,
    h:     T.number,
    label: T.string,
    color: T.string,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 1,
    migrators: {
      1: {
        up:   r => ({ ...r, props: { label: 'Frame', color: '#313244', ...(r['props'] as object) } }),
        down: r => r,
      },
    },
  });

  getDefaultProps(): FrameProps {
    return { w: 400, h: 300, label: 'Frame', color: '#313244' };
  }

  getGeometry(shape: FrameShape): Box2d {
    return makeBox(shape.x, shape.y, shape.props.w, shape.props.h);
  }

  /** Frames act as containers — child shapes can be dropped inside. */
  override canContain(_shape: FrameShape): boolean {
    return true;
  }

  toSvg(shape: FrameShape): SVGElement {
    const { x, y, props } = shape;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // Dashed border
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x',              String(x));
    rect.setAttribute('y',              String(y));
    rect.setAttribute('width',          String(props.w));
    rect.setAttribute('height',         String(props.h));
    rect.setAttribute('fill',           `${props.color}22`);
    rect.setAttribute('stroke',         props.color);
    rect.setAttribute('stroke-width',   '2');
    rect.setAttribute('stroke-dasharray', '8 4');
    rect.setAttribute('rx',             '4');
    g.appendChild(rect);

    // Label (above top-left corner)
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x',           String(x + 8));
    label.setAttribute('y',           String(y - 6));
    label.setAttribute('font-size',   '13');
    label.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    label.setAttribute('fill',        props.color);
    label.textContent = props.label;
    g.appendChild(label);

    return g;
  }
}
