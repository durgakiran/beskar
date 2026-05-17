/**
 * TextUtil — auto-sizing text block (Story 2.3)
 *
 * Geometry is computed from fontSize + line count.
 * No fixed w/h in props; bounding box estimated from content.
 * toSvg() returns a <text> element inside a <g>.
 */

import { ShapeUtil } from './ShapeUtil';
import { T } from '../validators';
import { defineMigrations } from '../migrations';
import { makeBox } from '../types';
import type { GlideShape, Box2d, Vec2 } from '../types';

export interface TextProps {
  text:     string;
  fontSize: number;
  color:    string;
}

export type TextShape = GlideShape<TextProps>;

/** Estimate text bounding box from font metrics. No canvas needed. */
function estimateBounds(text: string, fontSize: number): { w: number; h: number } {
  const lines = text.split('\n');
  const longestLine = lines.reduce((max, l) => Math.max(max, l.length), 0);
  const w = Math.max(longestLine * fontSize * 0.6, 10); // rough em width ≈ 0.6×
  const h = lines.length * fontSize * 1.4;              // line-height ≈ 1.4×
  return { w, h };
}

export class TextUtil extends ShapeUtil<TextShape> {
  static override readonly type = 'text';

  static override readonly props = {
    text:     T.string,
    fontSize: T.number,
    color:    T.string,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 1,
    migrators: {
      1: {
        up:   r => ({ ...r, props: { fontSize: 16, color: '#cdd6f4', ...(r['props'] as object) } }),
        down: r => r,
      },
    },
  });

  getDefaultProps(): TextProps {
    return { text: '', fontSize: 16, color: '#cdd6f4' };
  }

  getGeometry(shape: TextShape): Box2d {
    const { w, h } = estimateBounds(shape.props.text, shape.props.fontSize);
    return makeBox(shape.x, shape.y, w, h);
  }

  override hitTestPoint(shape: TextShape, point: Vec2): boolean {
    const b = this.getGeometry(shape);
    return point.x >= b.minX && point.x <= b.maxX &&
           point.y >= b.minY && point.y <= b.maxY;
  }

  toSvg(shape: TextShape): SVGElement {
    const { x, y, props } = shape;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const lines = props.text.split('\n');

    lines.forEach((line, i) => {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x',            String(x));
      t.setAttribute('y',            String(y + (i + 1) * props.fontSize * 1.4));
      t.setAttribute('font-size',    String(props.fontSize));
      t.setAttribute('fill',         props.color);
      t.setAttribute('font-family',  'Inter, system-ui, sans-serif');
      t.textContent = line;
      g.appendChild(t);
    });

    return g;
  }
}
