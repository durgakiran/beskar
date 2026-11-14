import { Polyline2d } from '../geometry/index.js';
import { ShapeUtil, type ResizeInfo } from './ShapeUtil.js';
import { STROKE_DASH_ARRAYS, STROKE_WIDTHS, StyleValidators, resolveColor, type SizeStyle, type StrokeStyle } from '../styles.js';
import type { GlidePlugin } from '../editor.js';
import type { GlideShape, Vec2 } from '../types.js';
import { T } from '../validators.js';

export interface LineProps {
  [key: string]: unknown;
  start: Vec2;
  end: Vec2;
  color: string;
  opacity: number;
  strokeStyle: StrokeStyle;
  strokeWidth: SizeStyle;
}

export type LineShape = GlideShape<LineProps>;

const point = {
  validate(value: unknown): Vec2 {
    const point = value as Partial<Vec2> | null;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error('Line endpoints must have finite coordinates');
    }
    return point as Vec2;
  },
};

export class LineUtil extends ShapeUtil<LineShape> {
  static override readonly type = 'line';
  static override readonly props = {
    start: point,
    end: point,
    color: T.string,
    opacity: T.number,
    strokeStyle: StyleValidators.strokeStyle,
    strokeWidth: StyleValidators.strokeWidth,
  };

  override getDefaultProps(): LineProps {
    return {
      start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
      color: 'black', opacity: 1, strokeStyle: 'solid', strokeWidth: 'medium',
    };
  }

  override getGeometry(shape: LineShape): Polyline2d {
    return new Polyline2d([shape.props.start, shape.props.end], { boundsPadding: 5 });
  }

  override getConnectionAnchors(): [] { return []; }
  override hideResizeHandles(): boolean { return true; }
  override hideRotateHandle(): boolean { return true; }

  override onResize(_shape: LineShape, { initialShape, scaleX, scaleY }: ResizeInfo<LineShape>): Partial<LineShape> {
    const scale = ({ x, y }: Vec2) => ({ x: x * scaleX, y: y * scaleY });
    return {
      props: { ...initialShape.props, start: scale(initialShape.props.start), end: scale(initialShape.props.end) },
    };
  }

  override toSvg({ props }: LineShape): SVGElement {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'glideline-line');
    line.setAttribute('x1', String(props.start.x));
    line.setAttribute('y1', String(props.start.y));
    line.setAttribute('x2', String(props.end.x));
    line.setAttribute('y2', String(props.end.y));
    line.setAttribute('stroke', resolveColor(props.color));
    line.setAttribute('stroke-width', String(STROKE_WIDTHS[props.strokeWidth]));
    line.setAttribute('stroke-dasharray', STROKE_DASH_ARRAYS[props.strokeStyle]);
    line.setAttribute('opacity', String(props.opacity));
    return line;
  }
}

export const LinePlugin: GlidePlugin = { id: 'line', shapes: [LineUtil] };
