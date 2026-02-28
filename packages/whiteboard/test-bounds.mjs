import { createShapeId, Editor } from 'tldraw';

const editor = new Editor();
const id = createShapeId();
editor.createShape({
    id,
    type: 'geo',
    x: 100,
    y: 100,
    props: {
        geo: 'rectangle',
        w: 200,
        h: 100
    }
});

const shape = editor.getShape(id);
const geometry = editor.getShapeGeometry(shape);
const bounds = geometry.bounds;
const pageBounds = editor.getShapePageBounds(id);

console.log('Shape x, y:', shape.x, shape.y);
console.log('Geometry Bounds:', { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY, midX: bounds.midX, midY: bounds.midY });
console.log('Page Bounds:', pageBounds);
console.log('Transform:', editor.getShapePageTransform(id));
