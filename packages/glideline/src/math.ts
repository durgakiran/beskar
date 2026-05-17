
export class Vec {
    constructor(public x: number, public y: number) {}
    
    static add(a: Vec, b: Vec) { return new Vec(a.x + b.x, a.y + b.y); }
    static sub(a: Vec, b: Vec) { return new Vec(a.x - b.x, a.y - b.y); }
    static mul(v: Vec, s: number) { return new Vec(v.x * s, v.y * s); }
    static div(v: Vec, s: number) { return new Vec(v.x / s, v.y / s); }
    static dist(a: Vec, b: Vec) { return Math.hypot(a.x - b.x, a.y - b.y); }
}

export class Box {
    constructor(public x: number, public y: number, public w: number, public h: number) {}
    
    get minX() { return this.x; }
    get minY() { return this.y; }
    get maxX() { return this.x + this.w; }
    get maxY() { return this.y + this.h; }
    get center() { return new Vec(this.x + this.w / 2, this.y + this.h / 2); }

    contains(p: Vec) {
        return p.x >= this.x && p.x <= this.maxX && p.y >= this.y && p.y <= this.maxY;
    }
}

export class Mat {
    constructor(
        public a: number, public b: number,
        public c: number, public d: number,
        public e: number, public f: number
    ) {}

    static identity() { return new Mat(1, 0, 0, 1, 0, 0); }

    static multiply(m1: Mat, m2: Mat) {
        return new Mat(
            m1.a * m2.a + m1.c * m2.b,
            m1.b * m2.a + m1.d * m2.b,
            m1.a * m2.c + m1.c * m2.d,
            m1.b * m2.c + m1.d * m2.d,
            m1.a * m2.e + m1.c * m2.f + m1.e,
            m1.b * m2.e + m1.d * m2.f + m1.f
        );
    }

    apply(v: Vec) {
        return new Vec(
            this.a * v.x + this.c * v.y + this.e,
            this.b * v.x + this.d * v.y + this.f
        );
    }
    
    static translate(x: number, y: number) {
        return new Mat(1, 0, 0, 1, x, y);
    }

    static scale(s: number, origin = new Vec(0, 0)) {
        return new Mat(s, 0, 0, s, origin.x * (1 - s), origin.y * (1 - s));
    }
}
