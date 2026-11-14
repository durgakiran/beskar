import {
  boundsAnchors, curvePoints, geometryAnchors, interpolate, MIDPOINT, polygonPoints, QUARTERS,
  segmentPoints, type ShapeConnectionAnchor,
} from '../connection-anchors.js';
import { ShapeUtil } from './ShapeUtil.js';
import { T } from '../validators.js';
import { defineMigrations } from '../migrations.js';
import type { GlideShape, GlideProps, Vec2 } from '../types.js';
import { Geometry2d, Polygon2d, Rectangle2d } from '../geometry/index.js';
import {
  StyleValidators, STROKE_WIDTHS, STROKE_DASH_ARRAYS,
  svgFill, resolveColor, inlinePatternDefs, createTextForeignObjectForExport,
  FONT_FAMILIES, FONT_SIZES,
  type FillStyle, type StrokeStyle, type SizeStyle, type FontSize,
  type TextAlign, type Font, type LabelProps,
} from '../styles.js';

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
    color: 'black',
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

  protected get anchorFractions(): readonly number[] { return MIDPOINT; }
  protected get hasVariableAnchorGeometry(): boolean { return false; }

  override getConnectionAnchors(shape: S): readonly ShapeConnectionAnchor[] {
    const { w, h } = shape.props;
    const points = (width: number, height: number) =>
      polygonPoints(this.getVertices({ ...shape, props: { ...shape.props, w: width, h: height } }), this.anchorFractions);
    if (this.hasVariableAnchorGeometry) return geometryAnchors(w, h, points);
    const reference = { ...shape, props: { ...shape.props, w: 1, h: 1 } };
    const bounds = this.getGeometry(reference).getBounds();
    return points(1, 1).map(p => ({
      normalizedAnchor: { x: (p.x - bounds.minX) / bounds.w, y: (p.y - bounds.minY) / bounds.h },
    }));
  }

  override getGeometry(shape: S): Geometry2d {
    return new Polygon2d(this.getVertices(shape));
  }

  /** Geometry-only SVG — no text labels. For interactive canvas rendering. */
  toSvg(shape: S): SVGElement {
    const { props } = shape;
    const points = this.getVertices(shape);
    const strokeW = STROKE_WIDTHS[props.strokeWidth];
    const fillColor = svgFill(props.fillStyle, resolveColor(props.color), shape.id);
    const strokeColor = resolveColor(props.color);
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));

    const defs = inlinePatternDefs(props.fillStyle, props.color, shape.id);
    if (defs) g.appendChild(defs);

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
    return g;
  }

  /** CSS label properties for the HTML overlay div. */
  override getLabelProps(shape: S): LabelProps | null {
    const { props } = shape;
    return {
      text:          props.label || '',
      fontFamily:    FONT_FAMILIES[props.font] ?? FONT_FAMILIES.sans,
      fontSize:      FONT_SIZES[props.fontSize] ?? FONT_SIZES.md,
      color:         resolveColor(props.labelColor),
      textAlign:     props.textAlign,
      verticalAlign: 'center',
      padding:       8,
    };
  }

  /** Full SVG for export — includes foreignObject text label. */
  override toSvgExport(shape: S): SVGElement {
    const g = this.toSvg(shape) as SVGGElement;
    const { props } = shape;
    if (props.label) {
      const fo = createTextForeignObjectForExport({
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

abstract class BasePathShapeUtil<S extends GlideShape<GeoShapeProps>> extends ShapeUtil<S> {
  static override readonly props = GEO_SHAPE_PROPS;
  static override readonly migrations = GEO_SHAPE_MIGRATIONS;

  override getDefaultProps(): GeoShapeProps {
    return getDefaultGeoShapeProps();
  }

  protected abstract getPathD(w: number, h: number): string;

  override getGeometry(shape: S): Geometry2d {
    return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
  }

  toSvg(shape: S): SVGElement {
    const { props } = shape;
    const strokeW = STROKE_WIDTHS[props.strokeWidth];
    const fillColor = svgFill(props.fillStyle, resolveColor(props.color), shape.id);
    const strokeColor = resolveColor(props.color);
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));

    const defs = inlinePatternDefs(props.fillStyle, props.color, shape.id);
    if (defs) g.appendChild(defs);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', this.getPathD(props.w, props.h));
    path.setAttribute('fill', fillColor);
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('stroke-width', String(strokeW));
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    if (dashArray !== 'none') path.setAttribute('stroke-dasharray', dashArray);
    g.appendChild(path);
    return g;
  }

  override getLabelProps(shape: S): LabelProps | null {
    const { props } = shape;
    return {
      text: props.label || '',
      fontFamily: FONT_FAMILIES[props.font] ?? FONT_FAMILIES.sans,
      fontSize: FONT_SIZES[props.fontSize] ?? FONT_SIZES.md,
      color: resolveColor(props.labelColor),
      textAlign: props.textAlign,
      verticalAlign: 'center',
      padding: 8,
    };
  }

  override toSvgExport(shape: S): SVGElement {
    const g = this.toSvg(shape) as SVGGElement;
    const { props } = shape;
    if (props.label) {
      g.appendChild(createTextForeignObjectForExport({
        x: 0, y: 0, w: props.w, h: props.h,
        text: props.label,
        font: props.font,
        fontSize: props.fontSize,
        textAlign: props.textAlign,
        color: props.labelColor,
        verticalAlign: 'center',
      }));
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
  protected override get hasVariableAnchorGeometry(): boolean { return true; }

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
  protected override get anchorFractions(): readonly number[] { return []; }

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

export type RoundedRectShape = GlideShape<GeoShapeProps>;

export class RoundedRectUtil extends BaseGeoShapeUtil<RoundedRectShape> {
  static override readonly type = 'rounded-rect';

  protected override getVertices(shape: RoundedRectShape): Vec2[] {
    const { w, h } = shape.props;
    return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  }

  private cornerRadius(w: number, h: number): number { return Math.min(w, h) * 0.15; }

  override getConnectionAnchors(shape: RoundedRectShape): readonly ShapeConnectionAnchor[] {
    const { w, h } = shape.props;
    const r = this.cornerRadius(w, h);
    return boundsAnchors(QUARTERS).map(({ normalizedAnchor }) => {
      const { x, y } = normalizedAnchor;
      const corner = (x === 0 || x === 1) && (y === 0 || y === 1);
      const inset = r * (1 - Math.SQRT1_2);
      const localPoint = corner
        ? { x: x === 0 ? inset : w - inset, y: y === 0 ? inset : h - inset }
        : {
            x: x === 0 || x === 1 ? x * w : r + x * (w - 2 * r),
            y: y === 0 || y === 1 ? y * h : r + y * (h - 2 * r),
          };
      return { normalizedAnchor, localPoint };
    });
  }

  override toSvg(shape: RoundedRectShape): SVGElement {
    const { props } = shape;
    const { w, h } = props;
    const rx = this.cornerRadius(w, h);
    const strokeW = STROKE_WIDTHS[props.strokeWidth];
    const fillColor = svgFill(props.fillStyle, resolveColor(props.color), shape.id);
    const strokeColor = resolveColor(props.color);
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));
    const defs = inlinePatternDefs(props.fillStyle, props.color, shape.id);
    if (defs) g.appendChild(defs);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(h));
    rect.setAttribute('rx', String(rx));
    rect.setAttribute('ry', String(rx));
    rect.setAttribute('fill', fillColor);
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', String(strokeW));
    if (dashArray !== 'none') {
      rect.setAttribute('stroke-dasharray', dashArray);
      if (props.strokeStyle === 'dotted') rect.setAttribute('stroke-linecap', 'round');
    }
    g.appendChild(rect);
    return g;
  }
}

export type ParallelogramShape = GlideShape<GeoShapeProps>;
export class ParallelogramUtil extends BaseGeoShapeUtil<ParallelogramShape> {
  static override readonly type = 'parallelogram';
  protected override get anchorFractions(): readonly number[] { return QUARTERS; }
  protected override getVertices(shape: ParallelogramShape): Vec2[] {
    const { w, h } = shape.props;
    const skew = w * 0.2;
    return [{ x: skew, y: 0 }, { x: w, y: 0 }, { x: w - skew, y: h }, { x: 0, y: h }];
  }
}

export type ChevronShape = GlideShape<GeoShapeProps>;
export class ChevronUtil extends BaseGeoShapeUtil<ChevronShape> {
  static override readonly type = 'chevron';
  protected override getVertices(shape: ChevronShape): Vec2[] {
    const { w, h } = shape.props;
    const notch = w * 0.25;
    const mid = h / 2;
    return [
      { x: 0, y: 0 }, { x: w - notch, y: 0 }, { x: w, y: mid },
      { x: w - notch, y: h }, { x: 0, y: h }, { x: notch, y: mid },
    ];
  }
}

export type DocumentShape = GlideShape<GeoShapeProps>;
export class DocumentUtil extends BasePathShapeUtil<DocumentShape> {
  static override readonly type = 'document';
  private wave(w: number, h: number) {
    const y = h * 0.88;
    return [
      [{ x: w, y }, { x: w * 0.75, y }, { x: w * 0.75, y: h }, { x: w * 0.5, y: h }],
      [{ x: w * 0.5, y: h }, { x: w * 0.25, y: h }, { x: w * 0.25, y }, { x: 0, y }],
    ] as const;
  }

  protected override getPathD(w: number, h: number): string {
    const wave = this.wave(w, h);
    const svg = ({ x, y }: Vec2) => `${x} ${y}`;
    return `M 0 0 L ${w} 0 L ${svg(wave[0][0])} ${wave.map(([, ...points]) => 'C ' + points.map(svg).join(' ')).join(' ')} Z`;
  }

  override getConnectionAnchors(shape: DocumentShape): readonly ShapeConnectionAnchor[] {
    return geometryAnchors(shape.props.w, shape.props.h, (w, h) => {
      const wave = this.wave(w, h);
      const topLeft = { x: 0, y: 0 }, topRight = { x: w, y: 0 };
      const bottomRight = wave[0][0], bottomLeft = wave[1][3];
      const fractions = [0.25, 0.75];
      return [
        topLeft, topRight, bottomRight, bottomLeft,
        ...segmentPoints(topLeft, topRight, fractions),
        ...segmentPoints(topRight, bottomRight, fractions),
        ...segmentPoints(bottomLeft, topLeft, fractions),
        ...curvePoints(t => {
          const [a, b, c, d] = wave[t < 0.5 ? 0 : 1];
          const u = t < 0.5 ? t * 2 : t * 2 - 1;
          const ab = interpolate(a, b, u), bc = interpolate(b, c, u), cd = interpolate(c, d, u);
          return interpolate(interpolate(ab, bc, u), interpolate(bc, cd, u), u);
        }, fractions),
      ];
    });
  }
}

export type CylinderShape = GlideShape<GeoShapeProps>;
export class CylinderUtil extends BasePathShapeUtil<CylinderShape> {
  static override readonly type = 'cylinder';

  private capRadius(h: number): number { return h * 0.12; }

  override getConnectionAnchors(shape: CylinderShape): readonly ShapeConnectionAnchor[] {
    return geometryAnchors(shape.props.w, shape.props.h, (w, h) => {
      const r = this.capRadius(h);
      return [
        ...[0, w].flatMap(x => segmentPoints({ x, y: r }, { x, y: h - r }, QUARTERS)),
        ...[r, h - r].flatMap((y, i) => curvePoints(t => ({
          x: (1 + Math.cos(Math.PI * t)) * w / 2,
          y: y + (i === 0 ? -1 : 1) * r * Math.sin(Math.PI * t),
        }), QUARTERS)),
      ];
    });
  }
  protected override getPathD(w: number, h: number): string {
    const rx = w / 2;
    const ry = this.capRadius(h);
    const topY = ry;
    const botY = h - ry;
    return [
      `M 0 ${topY}`, `A ${rx} ${ry} 0 0 1 ${w} ${topY}`,
      `L ${w} ${botY}`, `A ${rx} ${ry} 0 0 1 0 ${botY}`, 'Z',
    ].join(' ');
  }
  override toSvg(shape: CylinderShape): SVGElement {
    const g = super.toSvg(shape) as SVGGElement;
    const { props } = shape;
    const rx = props.w / 2;
    const ry = this.capRadius(props.h);
    const rim = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    rim.setAttribute('cx', String(rx));
    rim.setAttribute('cy', String(ry));
    rim.setAttribute('rx', String(rx));
    rim.setAttribute('ry', String(ry));
    rim.setAttribute('fill', 'none');
    rim.setAttribute('stroke', resolveColor(props.color));
    rim.setAttribute('stroke-width', String(STROKE_WIDTHS[props.strokeWidth]));
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];
    if (dashArray !== 'none') rim.setAttribute('stroke-dasharray', dashArray);
    g.appendChild(rim);
    return g;
  }
}

export type NoteShape = GlideShape<GeoShapeProps>;
export class NoteUtil extends BasePathShapeUtil<NoteShape> {
  static override readonly type = 'note';

  private foldSize(w: number, h: number): number { return Math.min(w * 0.2, h * 0.2, 24); }

  override getConnectionAnchors(shape: NoteShape): readonly ShapeConnectionAnchor[] {
    return geometryAnchors(shape.props.w, shape.props.h, (w, h) => {
      const f = this.foldSize(w, h);
      return polygonPoints([{ x: 0, y: 0 }, { x: w - f, y: 0 }, { x: w, y: f }, { x: w, y: h }, { x: 0, y: h }], MIDPOINT);
    });
  }
  protected override getPathD(w: number, h: number): string {
    const fold = this.foldSize(w, h);
    return ['M 0 0', `L ${w - fold} 0`, `L ${w} ${fold}`, `L ${w} ${h}`, `L 0 ${h}`, 'Z'].join(' ');
  }
  override toSvg(shape: NoteShape): SVGElement {
    const g = super.toSvg(shape) as SVGGElement;
    const { props } = shape;
    const fold = this.foldSize(props.w, props.h);
    const crease = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    crease.setAttribute('points', `${props.w - fold},0 ${props.w - fold},${fold} ${props.w},${fold}`);
    crease.setAttribute('fill', 'none');
    crease.setAttribute('stroke', resolveColor(props.color));
    crease.setAttribute('stroke-width', String(STROKE_WIDTHS[props.strokeWidth]));
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];
    if (dashArray !== 'none') crease.setAttribute('stroke-dasharray', dashArray);
    g.appendChild(crease);
    return g;
  }
}

export type CalloutShape = GlideShape<GeoShapeProps>;
export class CalloutUtil extends BasePathShapeUtil<CalloutShape> {
  static override readonly type = 'callout';
  private outlineDimensions(w: number, h: number) {
    const tailX = w * 0.2;
    const halfTail = w * 0.15 / 2;
    return { rx: Math.min(w, h) * 0.12, left: tailX - halfTail, right: tailX + halfTail, bodyH: h * 0.8 };
  }

  override getConnectionAnchors(shape: CalloutShape): readonly ShapeConnectionAnchor[] {
    return geometryAnchors(shape.props.w, shape.props.h, (w, h) => {
      const { rx, left, right, bodyH } = this.outlineDimensions(w, h);
      return [
        ...segmentPoints({ x: rx, y: 0 }, { x: w - rx, y: 0 }, QUARTERS),
        { x: 0, y: bodyH / 2 }, { x: w, y: bodyH / 2 },
        { x: (left + rx) / 2, y: bodyH }, { x: (right + w - rx) / 2, y: bodyH },
        { x: left, y: h },
      ];
    });
  }

  protected override getPathD(w: number, h: number): string {
    const { rx, left, right, bodyH } = this.outlineDimensions(w, h);
    return [
      `M ${rx} 0`, `L ${w - rx} 0`, `Q ${w} 0 ${w} ${rx}`,
      `L ${w} ${bodyH - rx}`, `Q ${w} ${bodyH} ${w - rx} ${bodyH}`,
      `L ${right} ${bodyH}`, `L ${left} ${h}`,
      `L ${left} ${bodyH}`, `L ${rx} ${bodyH}`,
      `Q 0 ${bodyH} 0 ${bodyH - rx}`, `L 0 ${rx}`, `Q 0 0 ${rx} 0`, 'Z',
    ].join(' ');
  }
}

import type { GlidePlugin } from '../editor.js';

export const GeoShapePlugin: GlidePlugin = {
  id: 'geo-shapes',
  shapes: [
    TriangleUtil as any,
    DiamondUtil as any,
    HexagonUtil as any,
    StarUtil as any,
  ],
};

export const P1ShapesPlugin: GlidePlugin = {
  id: 'p1-engineering-shapes',
  shapes: [
    RoundedRectUtil as any,
    ParallelogramUtil as any,
    ChevronUtil as any,
    DocumentUtil as any,
    CylinderUtil as any,
    NoteUtil as any,
    CalloutUtil as any,
  ],
};
