import { Rectangle2d, type Geometry2d } from '../geometry';
import type { GlideAsset, GlideShape, AnyRecord } from '../types';
import { T } from '../validators';
import type { SanitizedSvgAssetProps, SanitizedSvgPath } from '../content-ingress';
import { ShapeUtil } from './ShapeUtil';
import { RasterImageUtil } from './RasterImageUtil';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SanitizedSvgShapeProps {
  [key: string]: unknown;
  w: number;
  h: number;
  assetId: string;
}

export type SanitizedSvgShape = GlideShape<SanitizedSvgShapeProps>;

function setOptional(element: Element, name: string, value: unknown): void {
  if (value !== undefined) element.setAttribute(name, String(value));
}

function appendSafePath(group: SVGGElement, path: SanitizedSvgPath): void {
  const element = document.createElementNS(SVG_NS, 'path');
  element.setAttribute('d', path.d);
  element.setAttribute('fill', path.fill ?? 'black');
  element.setAttribute('stroke', path.stroke ?? 'none');
  setOptional(element, 'stroke-width', path.strokeWidth);
  setOptional(element, 'opacity', path.opacity);
  setOptional(element, 'fill-opacity', path.fillOpacity);
  setOptional(element, 'stroke-opacity', path.strokeOpacity);
  setOptional(element, 'fill-rule', path.fillRule);
  setOptional(element, 'stroke-linecap', path.strokeLinecap);
  setOptional(element, 'stroke-linejoin', path.strokeLinejoin);
  group.appendChild(element);
}

/** Renders canonical asset data by constructing fresh SVG nodes; raw upload markup is never attached. */
export class SanitizedSvgUtil extends ShapeUtil<SanitizedSvgShape> {
  static override readonly type = 'sanitized-svg';
  static override readonly references = [{
    path: '/props/assetId',
    targetKind: 'asset' as const,
    onDetach: 'delete' as const,
  }];
  static override readonly props = {
    w: T.number,
    h: T.number,
    assetId: T.string,
  };

  getDefaultProps(): SanitizedSvgShapeProps {
    return { w: 100, h: 100, assetId: '' };
  }

  getGeometry(shape: SanitizedSvgShape): Geometry2d {
    return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
  }

  toSvg(shape: SanitizedSvgShape): SVGElement {
    const group = document.createElementNS(SVG_NS, 'g');
    const editor = this.editor as typeof this.editor & {
      store: { get(id: string): Readonly<AnyRecord> | undefined };
    };
    const asset = editor.store.get(shape.props.assetId) as unknown as GlideAsset | undefined;
    if (!asset || asset.kind !== 'asset' || asset.type !== 'sanitized-svg') return group;
    const props = asset.props as SanitizedSvgAssetProps;
    const [minX, minY, viewWidth, viewHeight] = props.viewBox;
    group.setAttribute(
      'transform',
      `scale(${shape.props.w / viewWidth} ${shape.props.h / viewHeight}) translate(${-minX} ${-minY})`,
    );
    for (const path of props.paths) appendSafePath(group, path);
    return group;
  }
}

export const SanitizedAssetPlugin = {
  id: 'glideline-sanitized-assets',
  shapes: [SanitizedSvgUtil, RasterImageUtil],
};
