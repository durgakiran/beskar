import { Box2d, Vec2, makeBox } from '../types.js';
import { Geometry2d } from './Geometry2d.js';

export class Ellipse2d extends Geometry2d {
  constructor(public cx: number, public cy: number, public rx: number, public ry: number) {
    super();
  }

  getBounds(): Box2d {
    return makeBox(this.cx - this.rx, this.cy - this.ry, this.rx * 2, this.ry * 2);
  }

  hitTestPoint(p: Vec2): boolean {
    if (this.rx === 0 || this.ry === 0) return false;
    const dx = p.x - this.cx;
    const dy = p.y - this.cy;
    return (dx * dx) / (this.rx * this.rx) + (dy * dy) / (this.ry * this.ry) <= 1;
  }

  getOutline(): Vec2[] {
    const points: Vec2[] = [];
    const NUM_SAMPLES = 16;
    for (let i = 0; i < NUM_SAMPLES; i++) {
      const angle = (i / NUM_SAMPLES) * Math.PI * 2;
      points.push({
        x: this.cx + Math.cos(angle) * this.rx,
        y: this.cy + Math.sin(angle) * this.ry
      });
    }
    return points;
  }
}
