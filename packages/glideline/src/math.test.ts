
import test from "node:test";
import assert from "node:assert";
import { Vec, Mat, Box } from "./math";

test("Vec - arithmetic", () => {
    const v1 = new Vec(10, 20);
    const v2 = new Vec(5, 5);
    const v3 = Vec.add(v1, v2);
    assert.strictEqual(v3.x, 15);
    assert.strictEqual(v3.y, 25);
});

test("Mat - translation and scaling", () => {
    const v = new Vec(10, 10);
    const m = Mat.translate(100, 100);
    const v2 = m.apply(v);
    assert.strictEqual(v2.x, 110);
    assert.strictEqual(v2.y, 110);

    const m2 = Mat.scale(2);
    const v3 = m2.apply(v);
    assert.strictEqual(v3.x, 20);
    assert.strictEqual(v3.y, 20);
});

test("Box - bounds", () => {
    const b = new Box(10, 10, 100, 100);
    assert.strictEqual(b.maxX, 110);
    assert.ok(b.contains(new Vec(50, 50)));
    assert.ok(!b.contains(new Vec(200, 200)));
});
