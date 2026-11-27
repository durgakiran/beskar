import type { FreehandPoint } from './shapes/FreehandUtil.js';
import type { Vec2 } from './types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SECTIONS = 900;
const PAPER_TILE_SIZE = 52;
let nextPaperTextureId = 0;
const GRAPHITE_BANDS = [0.12, 0.19, 0.27, 0.35, 0.44, 0.53, 0.63, 0.74, 0.86, 1];
const DEFAULT_TIP_DIRECTION = { x: -0.28, y: 0.96 };

export function pencilStrokeRadius(width: number): number {
  return width * 4.8;
}

function unit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

type PencilSample = Required<FreehandPoint>;

function tiltVector(point: FreehandPoint, tilt: number): Vec2 {
  const direction = point.tiltDirection;
  if (direction && Number.isFinite(direction.x) && Number.isFinite(direction.y)) {
    return { x: Math.max(-1, Math.min(1, direction.x)), y: Math.max(-1, Math.min(1, direction.y)) };
  }
  return { x: DEFAULT_TIP_DIRECTION.x * tilt, y: DEFAULT_TIP_DIRECTION.y * tilt };
}

function smoothSamples(points: readonly FreehandPoint[], width: number): PencilSample[] {
  return points.map((point, index) => {
    const before = points[index - 1];
    const after = points[index + 1];
    const pressure = unit(point.pressure, 0.5);
    const tilt = unit(point.tilt, 0);
    const tiltDirection = tiltVector(point, tilt);
    if (!before || !after) return { x: point.x, y: point.y, pressure, tilt, tiltDirection };

    // Filter jitter close to the tip while limiting how far the filter can round a corner.
    const dx = (before.x + after.x - 2 * point.x) / 4;
    const dy = (before.y + after.y - 2 * point.y) / 4;
    const scale = Math.min(1, width * 0.7 / Math.hypot(dx, dy));
    const previousDirection = tiltVector(before, unit(before.tilt, tilt));
    const nextDirection = tiltVector(after, unit(after.tilt, tilt));
    return {
      x: point.x + dx * scale,
      y: point.y + dy * scale,
      pressure: (unit(before.pressure, pressure) + 2 * pressure + unit(after.pressure, pressure)) / 4,
      tilt: (unit(before.tilt, tilt) + 2 * tilt + unit(after.tilt, tilt)) / 4,
      tiltDirection: {
        x: (previousDirection.x + 2 * tiltDirection.x + nextDirection.x) / 4,
        y: (previousDirection.y + 2 * tiltDirection.y + nextDirection.y) / 4,
      },
    };
  });
}

interface GraphiteSection extends Vec2 {
  normal: Vec2;
  feather: number;
  contact: number;
  firmContact: number;
}

function buildSections(samples: readonly PencilSample[], width: number): GraphiteSection[] {
  let normal: Vec2 = { x: 0, y: 1 };
  return samples.map((sample, index) => {
    const before = samples[Math.max(0, index - 1)]!;
    const after = samples[Math.min(samples.length - 1, index + 1)]!;
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    if (length > 0) normal = { x: -dy / length, y: dx / length };

    // Project the laid-over lead onto the local normal. Rolling the stylus
    // past the direction of travel moves the feather to the opposite edge.
    const tilt = sample.tilt;
    const projectedTilt = normal.x * sample.tiltDirection.x + normal.y * sample.tiltDirection.y;
    const upright = normal.x * DEFAULT_TIP_DIRECTION.x + normal.y * DEFAULT_TIP_DIRECTION.y;
    const sideways = Math.max(-tilt, Math.min(tilt, projectedTilt));
    const projection = upright * (1 - tilt) + sideways;
    const load = Math.sqrt(sample.pressure);
    // Loading the lead as it moves exposes more of its face than a steady pass.
    const pressureRise = length > 0 ? unit((after.pressure - before.pressure) * width * 130 / length, 0) : 0;
    const tipWidth = width * (0.96 + 0.31 * pressureRise);
    const lengthwiseTilt = tilt - Math.abs(sideways);
    const contact = tipWidth * (0.09 + 0.31 * load) * (1 - 0.88 * lengthwiseTilt);
    const feather = tipWidth * (2.1 + 2.2 * load) * projection * (1 - 0.95 * lengthwiseTilt);
    const leadOffset = feather * 0.48;
    return {
      x: sample.x - normal.x * leadOffset,
      y: sample.y - normal.y * leadOffset,
      normal,
      feather,
      contact,
      firmContact: contact * unit((sample.pressure - 0.64) / 0.36, 0),
    };
  });
}

function pointAt(section: GraphiteSection, offset: number, origin: Vec2): Vec2 {
  return {
    x: section.x - origin.x + section.normal.x * offset,
    y: section.y - origin.y + section.normal.y * offset,
  };
}

function xy(point: Vec2): string {
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

/** Smooth a ribbon edge while retaining both endpoints of the stroke. */
function edgePath(points: readonly Vec2[]): string {
  const parts: string[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i]!;
    const next = points[i + 1]!;
    parts.push(`Q${xy(point)} ${xy({ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 })}`);
  }
  return `${parts.join('')}L${xy(points.at(-1)!)}`;
}

function ribbonPath(sections: readonly GraphiteSection[], origin: Vec2, fraction: number): string {
  const lower = sections.map(section =>
    pointAt(section, Math.min(0, section.feather * fraction) - section.contact, origin));
  const upper = sections.map(section =>
    pointAt(section, Math.max(0, section.feather * fraction) + section.contact, origin)).reverse();
  return `M${xy(lower[0]!)}${edgePath(lower)}L${xy(upper[0]!)}${edgePath(upper)}Z`;
}

function graphitePath(parent: SVGGElement, d: string, color: string, opacity: number, className: string): void {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', className);
  path.setAttribute('d', d);
  path.setAttribute('fill', color);
  path.setAttribute('fill-opacity', String(opacity));
  parent.appendChild(path);
}

/** Put the paper tooth in the paint itself so every layer has transparent grain. */
function paperPaint(parent: SVGGElement, color: string): string {
  const id = `glideline-pencil-paper-${++nextPaperTextureId}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', `${id}-tooth`);
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  const noise = document.createElementNS(SVG_NS, 'feTurbulence');
  noise.setAttribute('type', 'fractalNoise');
  noise.setAttribute('baseFrequency', '0.83 0.95');
  noise.setAttribute('numOctaves', '2');
  noise.setAttribute('seed', '17');
  noise.setAttribute('stitchTiles', 'stitch');
  filter.appendChild(noise);

  // Convert the noise to alpha. The low values break up dense graphite and
  // let the canvas show through even where many shade layers overlap.
  const alpha = document.createElementNS(SVG_NS, 'feColorMatrix');
  alpha.setAttribute('type', 'matrix');
  alpha.setAttribute('values', '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.8 0 0 0 -1.06');
  alpha.setAttribute('result', 'paper-tooth');
  filter.appendChild(alpha);

  const deposit = document.createElementNS(SVG_NS, 'feComposite');
  deposit.setAttribute('in', 'SourceGraphic');
  deposit.setAttribute('in2', 'paper-tooth');
  deposit.setAttribute('operator', 'in');
  filter.appendChild(deposit);

  const pattern = document.createElementNS(SVG_NS, 'pattern');
  pattern.setAttribute('id', id);
  pattern.setAttribute('class', 'glideline-pencil-paper');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('width', String(PAPER_TILE_SIZE));
  pattern.setAttribute('height', String(PAPER_TILE_SIZE));

  const tile = document.createElementNS(SVG_NS, 'rect');
  tile.setAttribute('width', String(PAPER_TILE_SIZE));
  tile.setAttribute('height', String(PAPER_TILE_SIZE));
  tile.setAttribute('fill', color);
  tile.setAttribute('filter', `url(#${id}-tooth)`);
  pattern.appendChild(tile);
  defs.append(filter, pattern);
  parent.appendChild(defs);
  return `url(#${id})`;
}

/** Layer translucent ribbons to make a dark contact edge and an outward falloff. */
export function renderPencilStroke(
  parent: SVGGElement, points: readonly FreehandPoint[], origin: Vec2, width: number, color: string,
): void {
  const first = points[0];
  if (!first) return;
  const paint = paperPaint(parent, color);
  if (points.length === 1) {
    const dab = document.createElementNS(SVG_NS, 'circle');
    dab.setAttribute('cx', String(first.x - origin.x));
    dab.setAttribute('cy', String(first.y - origin.y));
    dab.setAttribute('r', String(width * (0.25 + 0.35 * unit(first.pressure, 0.5))));
    dab.setAttribute('fill', paint);
    dab.setAttribute('fill-opacity', '0.47');
    parent.appendChild(dab);
    return;
  }

  const step = Math.max(1, Math.ceil(points.length / MAX_SECTIONS));
  const samples = smoothSamples(points, width).filter((_, index) => index % step === 0 || index === points.length - 1);
  const sections = buildSections(samples, width);
  for (const [index, band] of GRAPHITE_BANDS.entries()) {
    graphitePath(parent, ribbonPath(sections, origin, band), paint, index === 0 ? 0.069 : 0.050,
      index === 0 ? 'glideline-pencil-core' : 'glideline-pencil-shade');
  }
  if (sections.some(section => section.firmContact > 0)) {
    // Extra graphite under firm pressure uses the same paper paint as the soft layers.
    const firmSections = sections.map(section => ({ ...section, contact: section.firmContact }));
    graphitePath(parent, ribbonPath(firmSections, origin, 0), paint, 0.115, 'glideline-pencil-firm');
  }
}
