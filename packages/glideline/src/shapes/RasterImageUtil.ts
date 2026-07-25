import { Rectangle2d, type Geometry2d } from '../geometry';
import type { GlideAsset, GlideShape, AnyRecord } from '../types';
import { T } from '../validators';
import { ShapeUtil } from './ShapeUtil';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface RasterImageShapeProps {
  [key: string]: unknown;
  w: number;
  h: number;
  assetId: string;
}

export type RasterImageShape = GlideShape<RasterImageShapeProps>;

export class RasterImageUtil extends ShapeUtil<RasterImageShape> {
  static override readonly type = 'raster-image';
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

  getDefaultProps(): RasterImageShapeProps {
    return { w: 100, h: 100, assetId: '' };
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
    if (!asset || asset.kind !== 'asset' || asset.type !== 'raster-image') return group;
    const url = editor.resolveAssetUrl(asset);
    if (!url) return group;
    const image = document.createElementNS(SVG_NS, 'image');
    image.setAttribute('href', url);
    image.setAttribute('width', String(shape.props.w));
    image.setAttribute('height', String(shape.props.h));
    image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    group.appendChild(image);
    return group;
  }
}
