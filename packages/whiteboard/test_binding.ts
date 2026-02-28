import { Editor, createShapeId, createBindingId, TLArrowShape, TLShapeId } from 'tldraw';

const editor = new Editor({ shapeUtils: [] });
const rectId: TLShapeId = createShapeId('rect');
editor.createShape({ id: rectId, type: 'geo', x: 100, y: 100, props: { w: 100, h: 100 } });

const arrowId: TLShapeId = createShapeId('arrow');
editor.createShape({ id: arrowId, type: 'arrow', x: 200, y: 150, props: { start: { x: 0, y: 0 }, end: { x: 50, y: 0 } } });

editor.createBinding({
    type: 'arrow',
    fromId: arrowId,
    toId: rectId,
    props: {
        terminal: 'start',
        normalizedAnchor: { x: 1, y: 0.5 },
        isExact: false,
        isPrecise: true
    }
});

console.log('Arrow bindings:', editor.getBindingsFromShape(arrowId, 'arrow'));

editor.updateShape({ id: rectId, type: 'geo', x: 50, y: 50 });
// Wait for binding to update?
console.log('Arrow post-update start:', editor.getShape<TLArrowShape>(arrowId)?.props.start);
