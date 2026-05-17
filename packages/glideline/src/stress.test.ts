
import { GlideStore } from "./store";
import { Camera } from "./camera";
import { GlideEditor } from "./editor";
import { Vec } from "./math";

const SHAPE_COUNT = 1000;
const store = new GlideStore();
const camera = new Camera();
const editor = new GlideEditor(store, camera);

console.log(`--- Stress Test: ${SHAPE_COUNT} shapes ---`);
const shapes = [];
for (let i = 0; i < SHAPE_COUNT; i++) {
    shapes.push({
        id: `shape:${i}`,
        type: 'box',
        x: Math.random() * 5000,
        y: Math.random() * 5000,
        w: 100,
        h: 100
    });
}

const startPut = performance.now();
store.put(shapes as any);
const endPut = performance.now();
console.log(`Put 1000 shapes: ${(endPut - startPut).toFixed(2)}ms`);

const startMove = performance.now();
editor.moveShapes(shapes.map(s => s.id), new Vec(10, 10));
const endMove = performance.now();
console.log(`Move 1000 shapes: ${(endMove - startMove).toFixed(2)}ms`);

const startMove10 = performance.now();
editor.moveShapes(shapes.slice(0, 10).map(s => s.id), new Vec(10, 10));
const endMove10 = performance.now();
console.log(`Move 10 shapes: ${(endMove10 - startMove10).toFixed(2)}ms`);

if (endMove - startMove < 16) {
    console.log("60fps target MET.");
} else {
    console.log("60fps target FAILED.");
}
