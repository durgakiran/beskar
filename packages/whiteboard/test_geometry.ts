import { Editor, createShapeId, TLShapeId } from 'tldraw';

const editor = new Editor({ shapeUtils: [] });
const rectId: TLShapeId = createShapeId('rect');
editor.createShape({ id: rectId, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100, geo: 'rectangle' } });

const ellipseId: TLShapeId = createShapeId('ellipse');
editor.createShape({ id: ellipseId, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100, geo: 'ellipse' } });

console.log('Rect vertices:', editor.getShapeGeometry(rectId).vertices.length);
console.log('Ellipse vertices:', editor.getShapeGeometry(ellipseId).vertices.length);

const rectVerts = editor.getShapeGeometry(rectId).vertices;
console.log('Rect Vertices:', rectVerts);
