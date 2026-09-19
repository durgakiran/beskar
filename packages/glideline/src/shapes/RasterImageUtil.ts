import { Rectangle2d, type Geometry2d } from '../geometry/index.js';
import type { GlideAsset, GlideShape, AnyRecord, Validator } from '../types.js';
import { T } from '../validators.js';
import { ShapeUtil } from './ShapeUtil.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface RasterImageShapeProps {
  [key: string]: unknown;
  w: number;
  h: number;
  assetId: string;
  /** Normalized source bounds. Omitted by legacy records and treated as the full image. */
  crop?: RasterCrop;
  altText?: string;
  /** Omitted by legacy records and treated as locked. */
  aspectLocked?: boolean;
}

export interface RasterCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RasterImageShape = GlideShape<RasterImageShapeProps>;

const FULL_CROP: RasterCrop = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

export const assetDimensionValidator: Validator<number> = {
  validate(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error('Expected a positive finite number');
    }
    return value;
  },
};

const cropValidator: Validator<RasterCrop> = {
  validate(value: unknown): RasterCrop {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Expected normalized crop bounds');
    }
    const crop = value as Record<string, unknown>;
    if (Object.keys(crop).some(key => !['x', 'y', 'w', 'h'].includes(key))) {
      throw new Error('Crop contains an unsupported property');
    }
    const values = ['x', 'y', 'w', 'h'].map(key => crop[key]);
    if (values.some(item => typeof item !== 'number' || !Number.isFinite(item))) {
      throw new Error('Crop bounds must be finite numbers');
    }
    const { x, y, w, h } = crop as unknown as RasterCrop;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 || y + h > 1) {
      throw new Error('Crop bounds must define a non-empty region inside the source image');
    }
    return { x, y, w, h };
  },
};

const altTextValidator: Validator<string> = {
  validate(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Alt text must be a string');
    if (value.length > 2_000) throw new Error('Alt text exceeds 2000 characters');
    if (/[^\t\n\r\x20-\uFFFF]/u.test(value)) throw new Error('Alt text contains control characters');
    return value;
  },
};

function applyAccessibility(element: SVGElement, altText: string | undefined): void {
  if (altText) {
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', altText);
  } else {
    element.setAttribute('aria-hidden', 'true');
  }
}

export function renderMissingAssetPlaceholder(
  width: number,
  height: number,
  altText?: string,
): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('data-missing-asset', 'true');
  applyAccessibility(group, altText ? `Missing asset: ${altText}` : 'Missing asset');
  const viewport = document.createElementNS(SVG_NS, 'svg');
  viewport.setAttribute('x', '0');
  viewport.setAttribute('y', '0');
  viewport.setAttribute('width', String(width));
  viewport.setAttribute('height', String(height));
  viewport.setAttribute('viewBox', `0 0 ${width} ${height}`);
  viewport.setAttribute('overflow', 'hidden');
  group.appendChild(viewport);

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', '0');
  rect.setAttribute('y', '0');
  rect.setAttribute('width', String(width));
  rect.setAttribute('height', String(height));
  rect.setAttribute('fill', '#f3f4f6');
  rect.setAttribute('stroke', '#9ca3af');
  rect.setAttribute('stroke-width', String(Math.min(2, Math.max(1, Math.min(width, height) / 20))));
  viewport.appendChild(rect);

  for (const [x1, y1, x2, y2] of [[0, 0, width, height], [width, 0, 0, height]]) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', '#9ca3af');
    line.setAttribute('stroke-width', '1');
    viewport.appendChild(line);
  }
  return group;
}

export class RasterImageUtil extends ShapeUtil<RasterImageShape> {
  static override readonly type = 'raster-image';
  static override readonly references = [{
    path: '/props/assetId',
    targetKind: 'asset' as const,
    onDetach: 'delete' as const,
  }];
  static override readonly props = {
    w: assetDimensionValidator,
    h: assetDimensionValidator,
    assetId: T.string,
    crop: T.optional(cropValidator),
    altText: T.optional(altTextValidator),
    aspectLocked: T.optional(T.boolean),
  };

  getDefaultProps(): RasterImageShapeProps {
    return { w: 100, h: 100, assetId: '', crop: FULL_CROP, altText: '', aspectLocked: true };
  }

  getGeometry(shape: RasterImageShape): Geometry2d {
    return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
  }

  toSvg(shape: RasterImageShape): SVGElement {
    const group = document.createElementNS(SVG_NS, 'g');
    const editor = this.editor as typeof this.editor & {
      store: { get(id: string): Readonly<AnyRecord> | undefined };
      resolveAssetUrl(asset: GlideAsset): string | null;
    };
    const asset = editor.store.get(shape.props.assetId) as unknown as GlideAsset | undefined;
    if (!asset || asset.kind !== 'asset' || asset.type !== 'raster-image') {
      return renderMissingAssetPlaceholder(shape.props.w, shape.props.h, shape.props.altText);
    }
    const url = editor.resolveAssetUrl(asset);
    if (!url) return renderMissingAssetPlaceholder(shape.props.w, shape.props.h, shape.props.altText);
    applyAccessibility(group, shape.props.altText);

    const assetWidth = Number(asset.props['width']);
    const assetHeight = Number(asset.props['height']);
    if (!Number.isFinite(assetWidth) || !Number.isFinite(assetHeight) || assetWidth <= 0 || assetHeight <= 0) {
      return renderMissingAssetPlaceholder(shape.props.w, shape.props.h, shape.props.altText);
    }
    const crop = shape.props.crop ?? FULL_CROP;
    const viewport = document.createElementNS(SVG_NS, 'svg');
    viewport.setAttribute('x', '0');
    viewport.setAttribute('y', '0');
    viewport.setAttribute('width', String(shape.props.w));
    viewport.setAttribute('height', String(shape.props.h));
    viewport.setAttribute('viewBox', [
      crop.x * assetWidth,
      crop.y * assetHeight,
      crop.w * assetWidth,
      crop.h * assetHeight,
    ].join(' '));
    viewport.setAttribute('preserveAspectRatio', 'none');
    viewport.setAttribute('overflow', 'hidden');
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('href', url);
    image.setAttribute('width', String(assetWidth));
    image.setAttribute('height', String(assetHeight));
    image.setAttribute('aria-hidden', 'true');
    viewport.appendChild(image);
    group.appendChild(viewport);
    return group;
  }
}
