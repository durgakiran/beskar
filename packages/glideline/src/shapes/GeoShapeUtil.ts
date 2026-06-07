import { ShapeUtil } from './ShapeUtil';
import { T } from '../validators';
import { defineMigrations } from '../migrations';
import type { GlideShape, GlideProps, Vec2 } from '../types';
import { Geometry2d, Polygon2d } from '../geometry';
import {
  StyleValidators, STROKE_WIDTHS, STROKE_DASH_ARRAYS,
  svgFill, resolveColor, createTextForeignObject,
  type FillStyle, type StrokeStyle, type SizeStyle, type FontSize,
  type TextAlign, type Font,
} from '../styles';

export interface GeoShapeProps {
  [key: string]: unknown;
  w: number;
  h: number;
  color: string;
  opacity: number;
  fillStyle: FillStyle;
  strokeStyle: StrokeStyle;
  strokeWidth: SizeStyle;
  label: string;
  labelColor: string;
  font: Font;
  fontSize: FontSize;
  textAlign: TextAlign;
}

export type TriangleShape = GlideShape<GeoShapeProps>;
export type DiamondShape = GlideShape<GeoShapeProps>;
export type HexagonShape = GlideShape<GeoShapeProps>;
export type StarShape = GlideShape<GeoShapeProps>;

const GEO_SHAPE_PROPS: GlideProps<GeoShapeProps> = {
  w: T.number,
  h: T.number,
  color: T.string,
  opacity: T.number,
  fillStyle: StyleValidators.fillStyle,
  strokeStyle: StyleValidators.strokeStyle,
  strokeWidth: StyleValidators.strokeWidth,
  label: T.string,
  labelColor: T.string,
  font: StyleValidators.font,
  fontSize: StyleValidators.fontSize,
  textAlign: StyleValidators.textAlign,
};

const GEO_SHAPE_MIGRATIONS = defineMigrations({
  currentVersion: 1,
  migrators: {
    1: {
      up: r => ({
        ...r,
        props: {
          w: 120,
          h: 100,
          color: 'blue',
          opacity: 1,
          fillStyle: 'solid',
          strokeStyle: 'solid',
          strokeWidth: 'medium',
          label: '',
          labelColor: 'black',
          font: 'sans',
          fontSize: 'md',
          textAlign: 'center',
          ...(r['props'] as object),
        },
      }),
      down: r => r,
    },
  },
});

function getDefaultGeoShapeProps(): GeoShapeProps {
  return {
    w: 120,
    h: 100,
    color: 'blue',
    opacity: 1,
    fillStyle: 'none',
    strokeStyle: 'solid',
    strokeWidth: 'medium',
    label: '',
    labelColor: 'black',
    font: 'sans',
    fontSize: 'md',
    textAlign: 'center',
  };
}

function pointsToSvg(points: Vec2[]): string {
  return points.map(p => `${p.x},${p.y}`).join(' ');
}

abstract class BaseGeoShapeUtil<S extends GlideShape<GeoShapeProps>> extends ShapeUtil<S> {
  static override readonly props = GEO_SHAPE_PROPS;
  static override readonly migrations = GEO_SHAPE_MIGRATIONS;

  override getDefaultProps(): GeoShapeProps {
    return getDefaultGeoShapeProps();
  }

  protected abstract getVertices(shape: S): Vec2[];

  override getGeometry(shape: S): Geometry2d {
    return new Polygon2d(this.getVertices(shape));
  }

  toSvg(shape: S): SVGElement {
    const { props } = shape;
    const points = this.getVertices(shape);
    const strokeW = STROKE_WIDTHS[props.strokeWidth];
    const fillColor = svgFill(props.fillStyle, resolveColor(props.color));
    const strokeColor = resolveColor(props.color);
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));

    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', pointsToSvg(points));
    polygon.setAttribute('fill', fillColor);
    polygon.setAttribute('stroke', strokeColor);
    polygon.setAttribute('stroke-width', String(strokeW));
    polygon.setAttribute('stroke-linejoin', 'round');
    if (dashArray !== 'none') {
      polygon.setAttribute('stroke-dasharray', dashArray);
      if (props.strokeStyle === 'dotted') {
        polygon.setAttribute('stroke-linecap', 'round');
      }
    }
    g.appendChild(polygon);

    if (props.label) {
      const fo = createTextForeignObject({
        x: 0,
        y: 0,
        w: props.w,
        h: props.h,
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

export class TriangleUtil extends BaseGeoShapeUtil<TriangleShape> {
  static override readonly type = 'triangle';

  protected override getVertices(shape: TriangleShape): Vec2[] {
    const { w, h } = shape.props;
    return [
      { x: w / 2, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }
}

export class DiamondUtil extends BaseGeoShapeUtil<DiamondShape> {
  static override readonly type = 'diamond';

  protected override getVertices(shape: DiamondShape): Vec2[] {
    const { w, h } = shape.props;
    return [
      { x: w / 2, y: 0 },
      { x: w, y: h / 2 },
      { x: w / 2, y: h },
      { x: 0, y: h / 2 },
    ];
  }
}

export class HexagonUtil extends BaseGeoShapeUtil<HexagonShape> {
  static override readonly type = 'hexagon';

  protected override getVertices(shape: HexagonShape): Vec2[] {
    const { w, h } = shape.props;
    const inset = Math.min(w * 0.25, h * 0.3);
    return [
      { x: inset, y: 0 },
      { x: w - inset, y: 0 },
      { x: w, y: h / 2 },
      { x: w - inset, y: h },
      { x: inset, y: h },
      { x: 0, y: h / 2 },
    ];
  }
}

export class StarUtil extends BaseGeoShapeUtil<StarShape> {
  static override readonly type = 'star';

  protected override getVertices(shape: StarShape): Vec2[] {
    const { w, h } = shape.props;
    const cx = w / 2;
    const cy = h / 2;
    const rx = w / 2;
    const ry = h / 2;
    const innerRatio = 0.45;
    const points: Vec2[] = [];

    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + i * (Math.PI / 5);
      const radiusX = i % 2 === 0 ? rx : rx * innerRatio;
      const radiusY = i % 2 === 0 ? ry : ry * innerRatio;
      points.push({
        x: cx + Math.cos(angle) * radiusX,
        y: cy + Math.sin(angle) * radiusY,
      });
    }

    return points;
  }
}

import type { GlidePlugin } from '../editor';

export const GeoShapePlugin: GlidePlugin = {
  id: 'geo-shapes',
  shapes: [
    TriangleUtil as any,
    DiamondUtil as any,
    HexagonUtil as any,
    StarUtil as any,
  ],
};
