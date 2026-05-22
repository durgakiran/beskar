import { Box2d, Vec2, makeBox } from '../types';
import { Geometry2d } from './Geometry2d';

export class Rectangle2d extends Geometry2d {
  constructor(public x: number, public y: number, public w: number, public h: number) {
    super();
  }

  getBounds(): Box2d {
    return makeBox(this.x, this.y, this.w, this.h);
  }

  hitTestPoint(p: Vec2): boolean {
    return p.x >= this.x && p.x <= this.x + this.w &&
           p.y >= this.y && p.y <= this.y + this.h;
  }

  getOutline(): Vec2[] {
    return [
      { x: this.x, y: this.y },
      { x: this.x + this.w, y: this.y },
      { x: this.x + this.w, y: this.y + this.h },
      { x: this.x, y: this.y + this.h }
    ];
  }
}
