import { Rectangle2d, type Geometry2d } from '../geometry/index.js';
import type { GlideAsset, GlideShape, AnyRecord, Validator } from '../types.js';
import { T } from '../validators.js';
import type { SanitizedSvgAssetProps, SanitizedSvgPath } from '../content-ingress.js';
import { ShapeUtil } from './ShapeUtil.js';
import {
  RasterImageUtil,
  assetDimensionValidator,
  renderMissingAssetPlaceholder,
} from './RasterImageUtil.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SanitizedSvgShapeProps {
  [key: string]: unknown;
  w: number;
  h: number;
  assetId: string;
  colorMode?: 'native' | 'monochrome';
  themeColor?: string;
  altText?: string;
  aspectLocked?: boolean;
}

export type SanitizedSvgShape = GlideShape<SanitizedSvgShapeProps>;

function setOptional(element: Element, name: string, value: unknown): void {
  if (value !== undefined) element.setAttribute(name, String(value));
}

const themeColorValidator: Validator<string> = {
  validate(value: unknown): string {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) {
      throw new Error('Theme color must be a 6 or 8 digit hex color');
    }
    return value;
  },
};

const altTextValidator: Validator<string> = {
  validate(value: unknown): string {
    if (typeof value !== 'string' || value.length > 2_000) throw new Error('Invalid alt text');
    if (/[^\t\n\r\x20-\uFFFF]/u.test(value)) throw new Error('Alt text contains control characters');
    return value;
  },
};

function appendSafePath(
  group: SVGGElement,
  path: SanitizedSvgPath,
  colorMode: 'native' | 'monochrome',
  themeColor: string,
): void {
  const element = document.createElementNS(SVG_NS, 'path');
  element.setAttribute('d', path.d);
  const fill = path.fill ?? 'black';
  const stroke = path.stroke ?? 'none';
  element.setAttribute('fill', colorMode === 'monochrome' && fill !== 'none' ? themeColor : fill);
  element.setAttribute('stroke', colorMode === 'monochrome' && stroke !== 'none' ? themeColor : stroke);
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
    w: assetDimensionValidator,
    h: assetDimensionValidator,
    assetId: T.string,
    colorMode: T.optional(T.union(T.literal('native'), T.literal('monochrome'))),
    themeColor: T.optional(themeColorValidator),
    altText: T.optional(altTextValidator),
    aspectLocked: T.optional(T.boolean),
  };

  getDefaultProps(): SanitizedSvgShapeProps {
    return {
      w: 100,
      h: 100,
      assetId: '',
      colorMode: 'native',
      themeColor: '#000000',
      altText: '',
      aspectLocked: true,
    };
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
    if (!asset || asset.kind !== 'asset' || asset.type !== 'sanitized-svg') {
      return renderMissingAssetPlaceholder(shape.props.w, shape.props.h, shape.props.altText);
    }
    const props = asset.props as SanitizedSvgAssetProps;
    const [minX, minY, viewWidth, viewHeight] = props.viewBox;
    if (shape.props.altText) {
      group.setAttribute('role', 'img');
      group.setAttribute('aria-label', shape.props.altText);
    } else {
      group.setAttribute('aria-hidden', 'true');
    }
    group.setAttribute(
      'transform',
      `scale(${shape.props.w / viewWidth} ${shape.props.h / viewHeight}) translate(${-minX} ${-minY})`,
    );
    const colorMode = shape.props.colorMode ?? 'native';
    const themeColor = shape.props.themeColor ?? '#000000';
    for (const path of props.paths) appendSafePath(group, path, colorMode, themeColor);
    return group;
  }
}

export const SanitizedAssetPlugin = {
  id: 'glideline-sanitized-assets',
  shapes: [SanitizedSvgUtil, RasterImageUtil],
};
