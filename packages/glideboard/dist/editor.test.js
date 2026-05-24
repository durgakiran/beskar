import { describe, expect, it } from 'vitest';
import { createGlideboardEditorInstance } from './editor';
function createBoxRecord(id, x, y) {
    return {
        id,
        type: 'box',
        x,
        y,
        index: 'a0001',
        rotation: 0,
        props: {
            w: 120,
            h: 80,
            label: '',
        },
        meta: {},
    };
}
describe('createGlideboardEditorInstance', () => {
    it('registers the interactive drawing tools used by the UI', () => {
        const editor = createGlideboardEditorInstance();
        editor.setCurrentTool('box');
        expect(editor.currentToolId.peek()).toBe('box');
        editor.setCurrentTool('arrow');
        expect(editor.currentToolId.peek()).toBe('arrow');
    });
    it('creates a bound arrow connection when dragged between two boxes', () => {
        const editor = createGlideboardEditorInstance();
        editor.createShape(createBoxRecord('box:a', 40, 120));
        editor.createShape(createBoxRecord('box:b', 320, 120));
        editor.setCurrentTool('arrow');
        editor.dispatchEvent({
            type: 'pointerDown',
            point: { x: 152, y: 160 },
            shiftKey: false,
            target: 'shape',
            shapeId: 'box:a',
        });
        expect(editor.bindingPreview.peek()).toMatchObject({
            terminal: 'start',
            targetId: 'box:a',
        });
        editor.dispatchEvent({ type: 'pointerMove', point: { x: 328, y: 160 } });
        editor.dispatchEvent({ type: 'pointerUp', point: { x: 328, y: 160 } });
        expect(editor.getAIContext().connections).toEqual([
            expect.objectContaining({
                fromId: 'box:a',
                toId: 'box:b',
                routeStyle: 'curve',
            }),
        ]);
    });
});
//# sourceMappingURL=editor.test.js.map