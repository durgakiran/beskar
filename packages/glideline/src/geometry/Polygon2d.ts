import { Box2d, Vec2, makeBox } from '../types';
import { Geometry2d } from './Geometry2d';

export class Polygon2d extends Geometry2d {
  constructor(public points: Vec2[]) {
    super();
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

    return makeBox(minX, minY, maxX - minX, maxY - minY);
  }

  hitTestPoint(point: Vec2): boolean {
    if (this.points.length < 3) return false;

    let inside = false;
    for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
      const a = this.points[i]!;
      const b = this.points[j]!;
      const intersects = ((a.y > point.y) !== (b.y > point.y))
        && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
      if (intersects) inside = !inside;
    }

    return inside;
  }

  getOutline(): Vec2[] {
    return this.points;
  }
}
