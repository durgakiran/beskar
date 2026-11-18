import type { Vec2 } from './types.js';

function seededOffset(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  return ((hash ^ (hash >>> 13)) >>> 1) / 0x7fffffff * 2 - 1;
}

const xy = ({ x, y }: Vec2) => `${x} ${y}`;

function sketchSegment(start: Vec2, end: Vec2, seed: string, strength: number): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 12) return `L ${xy(end)}`;

  const drift = seededOffset(seed) * Math.min(strength, length * 0.09);
  const x = -dy / length * drift;
  const y = dx / length * drift;
  // Opposite offsets retain the edge midpoint and both vertices.
  return `C ${start.x + dx / 3 + x} ${start.y + dy / 3 + y} ` +
    `${start.x + dx * 2 / 3 - x} ${start.y + dy * 2 / 3 - y} ${xy(end)}`;
}

export function sketchPolyline(points: readonly Vec2[], seed: string, strength = 4.5): string {
  const first = points[0];
  if (!first) return '';
  return [`M ${xy(first)}`, ...points.slice(1).map((end, index) =>
    sketchSegment(points[index]!, end, `${seed}:${index}`, strength))].join(' ');
}

export function polygonOutline(points: readonly Vec2[], closed = true): string {
  if (!points.length) return '';
  return `M ${points.map(xy).join(' L ')}${closed ? ' Z' : ''}`;
}

export function rectangleOutline(w: number, h: number, radius = 0): string {
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0) return polygonOutline([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]);
  return `M ${r} 0 L ${w - r} 0 A ${r} ${r} 0 0 1 ${w} ${r} L ${w} ${h - r} ` +
    `A ${r} ${r} 0 0 1 ${w - r} ${h} L ${r} ${h} A ${r} ${r} 0 0 1 0 ${h - r} ` +
    `L 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}

export function sketchEllipse(rx: number, ry: number, seed: string, cx = rx, cy = ry): string {
  const k = 0.5522847498;
  const drift = (index: number, radius: number) =>
    seededOffset(`${seed}:${index}`) * Math.min(4, radius * 0.18);
  // Preserve the four cardinal points while varying the tangents.
  return [
    `M ${cx} ${cy - ry}`,
    `C ${cx + rx * k + drift(0, rx)} ${cy - ry} ${cx + rx} ${cy - ry * k + drift(1, ry)} ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + ry * k + drift(2, ry)} ${cx + rx * k + drift(3, rx)} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - rx * k + drift(4, rx)} ${cy + ry} ${cx - rx} ${cy + ry * k + drift(5, ry)} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - ry * k + drift(6, ry)} ${cx - rx * k + drift(7, rx)} ${cy - ry} ${cx} ${cy - ry} Z`,
  ].join(' ');
}

/** Stylize the absolute commands emitted by the built-in outline generators. */
export function sketchOutlinePath(outline: string, seed: string, strength: number): string {
  const commands = outline.matchAll(/([MLCQAZ])([^MLCQAZ]*)/g);
  let point: Vec2 = { x: 0, y: 0 };
  let first = point;
  return Array.from(commands, ([, command, args], index) => {
    const values = args!.trim().split(/[\s,]+/).map(Number);
    const end = command === 'Z' ? first : { x: values.at(-2)!, y: values.at(-1)! };
    let segment = `${command} ${args!.trim()}`.trim();
    if (command === 'M') first = end;
    if (command === 'L' || command === 'Z') {
      segment = sketchSegment(point, end, `${seed}:${index - 1}`, strength);
      if (command === 'Z') segment += ' Z';
    } else if (command === 'Q' || command === 'C') {
      const dx = end.x - point.x;
      const dy = end.y - point.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        const drift = seededOffset(`${seed}:${index}`) * Math.min(strength, Math.max(12, length) * 0.09);
        const x = -dy / length * drift;
        const y = dx / length * drift;
        const first = `${values[0]! + x} ${values[1]! + y}`;
        const second = command === 'C' ? ` ${values[2]! - x} ${values[3]! - y}` : '';
        segment = `${command} ${first}${second} ${xy(end)}`;
      }
    }
    point = end;
    return segment;
  }).join(' ');
}

/** Keep the original fill and draw the two passes as stroke-only paths. */
export function addSketchOutline(
  element: SVGElement,
  seed: string,
  getPass: (seed: string, strength: number) => string,
): void {
  const color = element.getAttribute('stroke')!;
  const width = Number(element.getAttribute('stroke-width'));
  element.setAttribute('stroke', 'none');
  let previous = element;
  [3.5, 6.5].forEach((strength, index) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'glideline-sketch-outline');
    path.setAttribute('d', getPass(`${seed}:${index}`, strength));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(index === 0 ? width : width * 0.6));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    previous.after(path);
    previous = path;
  });
}
