/**
 * BoxUtil — rectangle with label and corner radius (Story 2.3)
 *
 * static props    : w, h, cornerRadius, color, label, etc.
 * static migrations: v2
 * getGeometry()   : AABB from (x, y, w, h)
 * hitTestPoint()  : AABB (inherited default)
 * canContain()    : false (override in FrameUtil)
 * toSvg()         : <rect> with optional rx for corner radius
 */

import { ShapeUtil } from './ShapeUtil';
import { T } from '../validators';
import { defineMigrations } from '../migrations';
import { makeBox } from '../types';
import type { GlideShape } from '../types';
import { Geometry2d, Rectangle2d } from '../geometry';
import {
  StyleValidators, STROKE_WIDTHS, STROKE_DASH_ARRAYS,
  svgFill, resolveColor, createTextForeignObject,
  type FillStyle, type StrokeStyle, type SizeStyle, type FontSize,
  type TextAlign, type Font,
} from '../styles';

export interface BoxProps {
  [key: string]: unknown;
  w:           number;
  h:           number;
  cornerRadius:number;
  color:       string;
  opacity:     number;
  fillStyle:   FillStyle;
  strokeStyle: StrokeStyle;
  strokeWidth: SizeStyle;
  label:       string;
  labelColor:  string;
  font:        Font;
  fontSize:    FontSize;
  textAlign:   TextAlign;
}

export type BoxShape = GlideShape<BoxProps>;

export class BoxUtil extends ShapeUtil<BoxShape> {
  static override readonly type = 'box';

  static override readonly props = {
    w:            T.number,
    h:            T.number,
    cornerRadius: T.number,
    color:        T.string,
    opacity:      T.number,
    fillStyle:    StyleValidators.fillStyle,
    strokeStyle:  StyleValidators.strokeStyle,
    strokeWidth:  StyleValidators.strokeWidth,
    label:        T.string,
    labelColor:   T.string,
    font:         StyleValidators.font,
    fontSize:     StyleValidators.fontSize,
    textAlign:    StyleValidators.textAlign,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 2,
    migrators: {
      1: {
        up:   r => ({ ...r, props: { cornerRadius: 0, color: 'blue', label: '', ...(r['props'] as object) } }),
        down: r => r,
      },
      2: {
        up:   r => ({
          ...r,
          props: {
            opacity:     1,
            fillStyle:   'solid',
            strokeStyle: 'solid',
            strokeWidth: 'medium',
            labelColor:  'black',
            font:        'sans',
            fontSize:    'md',
            textAlign:   'center',
            ...(r['props'] as object),
          }
        }),
        down: r => r,
      }
    },
  });

  getDefaultProps(): BoxProps {
    return {
      w:           120,
      h:           80,
      cornerRadius:0,
      color:       'blue',
      opacity:     1,
      fillStyle:   'none',
      strokeStyle: 'solid',
      strokeWidth: 'medium',
      label:       '',
      labelColor:  'black',
      font:        'sans',
      fontSize:    'md',
      textAlign:   'center',
    };
  }

  getGeometry(shape: BoxShape): Geometry2d {
    return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
  }

  /** Returns an SVGRectElement representing the box (local coords, origin at 0,0). */
  toSvg(shape: BoxShape): SVGElement {
    const { props } = shape;
    
    const strokeW = STROKE_WIDTHS[props.strokeWidth];
    const fillColor = svgFill(props.fillStyle, resolveColor(props.color));
    const strokeColor = props.fillStyle === 'none' ? resolveColor(props.color) : resolveColor(props.color);
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x',      '0');
    rect.setAttribute('y',      '0');
    rect.setAttribute('width',  String(props.w));
    rect.setAttribute('height', String(props.h));
    rect.setAttribute('fill',   fillColor);
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', String(strokeW));
    
    if (dashArray !== 'none') {
      rect.setAttribute('stroke-dasharray', dashArray);
      if (props.strokeStyle === 'dotted') {
        rect.setAttribute('stroke-linecap', 'round');
      }
    }

    if (props.cornerRadius > 0) {
      rect.setAttribute('rx', String(props.cornerRadius));
      rect.setAttribute('ry', String(props.cornerRadius));
    }
    
    g.appendChild(rect);
    
    if (props.label) {
      const fo = createTextForeignObject({
        x: 0, y: 0, w: props.w, h: props.h,
        text: props.label,
        font: props.font,
        fontSize: props.fontSize,
        textAlign: props.textAlign,
        color: props.labelColor,
        verticalAlign: 'center',
      });
      g.appendChild(fo);
    }

    return g;
  }
}
