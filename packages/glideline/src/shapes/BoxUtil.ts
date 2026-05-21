/**
 * BoxUtil — rectangle with label and corner radius (Story 2.3)
 *
 * static props    : w, h, cornerRadius, color, label
 * static migrations: v1 (initial)
 * getGeometry()   : AABB from (x, y, w, h)
 * hitTestPoint()  : AABB (inherited default)
 * canContain()    : false (override in FrameUtil)
 * toSvg()         : <rect> with optional rx for corner radius
 */

import { ShapeUtil } from './ShapeUtil';
import { T } from '../validators';
import { defineMigrations } from '../migrations';
import { makeBox } from '../types';
import type { GlideShape, Box2d } from '../types';

export interface BoxProps {
  [key: string]: unknown;
  w: number;
  h: number;
  cornerRadius: number;
  color: string;
  label: string;
}

export type BoxShape = GlideShape<BoxProps>;

export class BoxUtil extends ShapeUtil<BoxShape> {
  static override readonly type = 'box';

  static override readonly props = {
    w:            T.number,
    h:            T.number,
    cornerRadius: T.number,
    color:        T.string,
    label:        T.string,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 1,
    migrators: {
      1: {
        up:   r => ({ ...r, props: { cornerRadius: 0, color: '#6366f1', label: '', ...(r['props'] as object) } }),
        down: r => r,
      },
    },
  });

  getDefaultProps(): BoxProps {
    return { w: 120, h: 80, cornerRadius: 0, color: '#6366f1', label: '' };
  }

  getGeometry(shape: BoxShape): Box2d {
    return makeBox(shape.x, shape.y, shape.props.w, shape.props.h);
  }

  /** Returns an SVGRectElement representing the box. */
  toSvg(shape: BoxShape): SVGElement {
    const { x, y, props } = shape;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x',      String(x));
    rect.setAttribute('y',      String(y));
    rect.setAttribute('width',  String(props.w));
    rect.setAttribute('height', String(props.h));
    rect.setAttribute('fill',   props.color);
    if (props.cornerRadius > 0) {
      rect.setAttribute('rx', String(props.cornerRadius));
      rect.setAttribute('ry', String(props.cornerRadius));
    }
    return rect;
  }
}
