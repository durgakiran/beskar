import { Box2d, Vec2, makeBox } from '../types.js';
import { Geometry2d } from './Geometry2d.js';

interface Polyline2dOptions {
  boundsPadding?: number;
  hitThreshold?: number;
}

export class Polyline2d extends Geometry2d {
  private readonly boundsPadding: number;
  private readonly hitThreshold: number;

  constructor(public points: Vec2[], options: Polyline2dOptions = {}) {
    super();
    this.boundsPadding = options.boundsPadding ?? 0;
    this.hitThreshold = options.hitThreshold ?? 5;
  }

  getBounds(): Box2d {
    if (this.points.length === 0) return makeBox(0, 0, 0, 0);
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    for (const p of this.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    const pad = this.boundsPadding;
    return makeBox(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
  }

  hitTestPoint(p: Vec2): boolean {
    if (this.points.length === 0) return false;
    if (this.points.length === 1) {
      const point = this.points[0]!;
      const dist = Math.hypot(p.x - point.x, p.y - point.y);
      return dist <= this.hitThreshold;
    }

    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      const dist = this.distToSegment(p, a, b);
      if (dist <= this.hitThreshold) return true;
    }
    return false;
  }

  private distToSegment(p: Vec2, v: Vec2, w: Vec2): number {
    const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  }

  getOutline(): Vec2[] {
    return this.points;
  }
}
