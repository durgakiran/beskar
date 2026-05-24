export class RectangleGeometry {
    constructor(x, y, w, h) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
    }
    getBounds() {
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
    hitTestPoint(point) {
        return (point.x >= this.x &&
            point.x <= this.x + this.w &&
            point.y >= this.y &&
            point.y <= this.y + this.h);
    }
    getOutline() {
        return [
            { x: this.x, y: this.y },
            { x: this.x + this.w, y: this.y },
            { x: this.x + this.w, y: this.y + this.h },
            { x: this.x, y: this.y + this.h },
        ];
    }
}
//# sourceMappingURL=localGeometry.js.map