import rough from 'roughjs';
import type { ArrowShape, ArrowUtil, GlidePlugin, Vec2 } from '@durgakiran/glideline';
import { resolveArrowRoute } from '@durgakiran/glideline';

export type SketchRenderer = 'seeded' | 'rough';

const SVG = 'http://www.w3.org/2000/svg';
const generator = rough.generator();

function seedFor(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  return ((hash ^ (hash >>> 13)) >>> 1) || 1;
}

function sketchOutline(element: SVGElement, id: string): void {
  const stroke = element.getAttribute('stroke');
  if (!stroke || stroke === 'none' || element.hasAttribute('stroke-dasharray')) return;
  const width = Number(element.getAttribute('stroke-width')) || 2.5;
  const options = { seed: seedFor(id), stroke, strokeWidth: width, roughness: 0.9, preserveVertices: true };
  let passes: string[];

  if (element instanceof SVGEllipseElement) {
    const rx = element.rx.baseVal.value;
    const ry = element.ry.baseVal.value;
    passes = generator.toPaths(generator.ellipse(rx, ry, 2 * rx, 2 * ry, options)).map(path => path.d);
  } else {
    let points: Vec2[];
    if (element instanceof SVGRectElement && !element.rx.baseVal.value) {
      const w = element.width.baseVal.value;
      const h = element.height.baseVal.value;
      points = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    } else if (element instanceof SVGPolygonElement) {
      points = Array.from({ length: element.points.numberOfItems }, (_, i) => element.points.getItem(i));
    } else {
      return;
    }
    passes = generator.toPaths(generator.polygon(points.map(({ x, y }) => [x, y]), options)).map(path => path.d);
  }

  element.setAttribute('stroke', 'none');
  let previous: SVGElement = element;
  passes.forEach(d => {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', stroke);
    path.setAttribute('stroke-width', String(width));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.dataset.sketchOutline = 'rough';
    previous.after(path);
    previous = path;
  });
}

function sketchConnector(path: SVGPathElement, points: readonly Vec2[], id: string): void {
  if (points.length < 2 || path.hasAttribute('stroke-dasharray')) return;
  const width = Number(path.getAttribute('stroke-width')) || 2.5;
  const d = points.slice(1).map((end, i) => {
    const start = points[i]!;
    return generator.toPaths(generator.line(start.x, start.y, end.x, end.y, {
      seed: seedFor(`${id}:${i}`),
      roughness: 0.75,
      strokeWidth: width,
      disableMultiStroke: true,
      preserveVertices: true,
    }))[0]!.d;
  }).join(' ');
  path.setAttribute('d', d);
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.dataset.sketchShaft = 'rough';
}

/** Wrap the SVG output of this demo board's utilities. The board still owns geometry and interaction. */
export function sketchStrokesPlugin(): GlidePlugin {
  return {
    id: 'rough-sketch-comparison',
    onInstall(editor) {
      for (const type of ['box', 'ellipse', 'diamond']) {
        const util = editor.getShapeUtil(type);
        const toSvg = util.toSvg.bind(util);
        util.toSvg = shape => {
          const svg = toSvg(shape);
          const outline = svg.querySelector<SVGElement>(':scope > rect, :scope > ellipse, :scope > polygon');
          if (outline) sketchOutline(outline, shape.id);
          return svg;
        };
      }
      const arrow = editor.getShapeUtil<ArrowShape>('arrow') as ArrowUtil;
      const toSvg = arrow.toSvg.bind(arrow);
      arrow.toSvg = (shape, editingLabel) => {
        const svg = toSvg(shape, editingLabel);
        const shaft = svg.querySelector<SVGPathElement>(':scope > path');
        if (shape.props.routeStyle === 'ortho' && shaft) {
          sketchConnector(shaft, resolveArrowRoute(editor, shape).localPoints, shape.id);
        }
        return svg;
      };
    },
  };
}
