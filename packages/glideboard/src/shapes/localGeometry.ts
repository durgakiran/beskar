import type { Box2d, Vec2 } from '@durgakiran/glideline';

export class RectangleGeometry {
  constructor(
    private readonly x: number,
    private readonly y: number,
    private readonly w: number,
    private readonly h: number,
  ) {}

  getBounds(): Box2d {
    return {
      x: this.x,
      y: this.y,
      w: this.w,
      h: this.h,
      minX: this.x,
      minY: this.y,
      maxX: this.x + this.w,
      maxY: this.y + this.h,
    };
  }

  hitTestPoint(point: Vec2): boolean {
    return (
      point.x >= this.x &&
      point.x <= this.x + this.w &&
      point.y >= this.y &&
      point.y <= this.y + this.h
    );
  }

  getOutline(): Vec2[] {
    return [
      { x: this.x, y: this.y },
      { x: this.x + this.w, y: this.y },
      { x: this.x + this.w, y: this.y + this.h },
      { x: this.x, y: this.y + this.h },
    ];
  }
}
