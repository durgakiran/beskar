import type { Box2d, Vec2 } from '@durgakiran/glideline';
export declare class RectangleGeometry {
    private readonly x;
    private readonly y;
    private readonly w;
    private readonly h;
    constructor(x: number, y: number, w: number, h: number);
    getBounds(): Box2d;
    hitTestPoint(point: Vec2): boolean;
    getOutline(): Vec2[];
}
