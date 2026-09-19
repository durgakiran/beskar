import { Box2d, Vec2 } from '../types.js';

export abstract class Geometry2d {
  abstract getBounds(): Box2d;
  abstract hitTestPoint(point: Vec2): boolean;
  abstract getOutline(): Vec2[];
}
