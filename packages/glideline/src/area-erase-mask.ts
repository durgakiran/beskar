import { matrixToSvg, multiplyMatrices, type Matrix2d } from './transform.js';
import type { Box2d, GlideShape } from './types.js';

// Each cut records horizontal spans (row, start, end) in the brush's sampling
// grid and a transform from that grid into normalized shape coordinates.
export interface AreaEraseCut {
  readonly matrix: Matrix2d;
  readonly spans: readonly number[];
}

export const AREA_ERASE_META_KEY = 'areaEraseCuts';

export function getAreaEraseCuts(shape: GlideShape): readonly AreaEraseCut[] {
  const cuts = shape.meta[AREA_ERASE_META_KEY];
  if (!Array.isArray(cuts)) return [];
  return cuts.filter((cut): cut is AreaEraseCut => {
    const matrix = cut?.matrix;
    return matrix && ['a', 'b', 'c', 'd', 'e', 'f'].every(key => Number.isFinite(matrix[key]))
      && Array.isArray(cut.spans) && cut.spans.length % 3 === 0
      && cut.spans.every(Number.isSafeInteger);
  });
}

export function areaEraseBoundsTransform(bounds: Box2d): Matrix2d {
  return { a: Math.max(bounds.w, 1), b: 0, c: 0, d: Math.max(bounds.h, 1), e: bounds.minX, f: bounds.minY };
}

export function getAreaEraseMaskBounds(bounds: Box2d) {
  const padding = 24;
  return { x: bounds.minX - padding, y: bounds.minY - padding,
    width: bounds.w + padding * 2, height: bounds.h + padding * 2 };
}

export function getAreaEraseMaskPaths(cuts: readonly AreaEraseCut[], bounds: Box2d) {
  const size = areaEraseBoundsTransform(bounds);
  return cuts.map(({ matrix, spans }) => {
    const commands: string[] = [];
    for (let i = 0; i < spans.length; i += 3) {
      const row = spans[i]!;
      const start = spans[i + 1]!;
      const width = spans[i + 2]! - start;
      if (width > 0) commands.push(`M${start} ${row}h${width}v1h-${width}Z`);
    }
    return { d: commands.join(''), transform: matrixToSvg(multiplyMatrices(size, matrix)) };
  });
}

export function maskAreaErasedSvg(content: SVGElement, cuts: readonly AreaEraseCut[], bounds: Box2d, id: string): SVGElement {
  if (cuts.length === 0) return content;
  const ns = 'http://www.w3.org/2000/svg';
  const mask = document.createElementNS(ns, 'mask');
  mask.setAttribute('id', id);
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
  const background = document.createElementNS(ns, 'rect');
  for (const [key, value] of Object.entries(getAreaEraseMaskBounds(bounds))) {
    mask.setAttribute(key, String(value));
    background.setAttribute(key, String(value));
  }
  background.setAttribute('fill', 'white');
  mask.append(background);
  for (const { d, transform } of getAreaEraseMaskPaths(cuts, bounds)) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('transform', transform);
    path.setAttribute('fill', 'black');
    mask.append(path);
  }
  const defs = document.createElementNS(ns, 'defs');
  defs.append(mask);
  const ink = document.createElementNS(ns, 'g');
  ink.setAttribute('mask', `url(#${id})`);
  ink.append(content);
  const group = document.createElementNS(ns, 'g');
  group.append(defs, ink);
  return group;
}
