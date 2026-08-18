import { describe, expect, it } from 'vitest';
import { BoxUtil, createEditor, type PageId, type ShapeId } from './index';

const createPagesEditor = () => createEditor({ plugins: [{ id: 'pages-test', shapes: [BoxUtil] }] });

function addBox(editor: ReturnType<typeof createEditor>, label: string): ShapeId {
  return editor.createShape({
    type: 'box', x: 10, y: 20, props: { w: 100, h: 60, label },
  });
}

describe('pages', () => {
  it('creates, renames, reorders, and restores page-local cameras', () => {
    const editor = createPagesEditor();
    const first = editor.getActivePageId();
    editor.camera.setCamera({ x: 120, y: 80, z: 1.5 });

    const second = editor.createPage('Architecture');
    expect(editor.getActivePageId()).toBe(second);
    expect(editor.camera.getCamera()).toEqual({ x: 0, y: 0, z: 1 });
    editor.camera.setCamera({ x: 500, y: 300, z: 0.5 });
    editor.renamePage(second, 'System Architecture');
    expect(editor.getPage(second)?.name).toBe('System Architecture');

    editor.setActivePage(first);
    expect(editor.camera.getCamera()).toEqual({ x: 120, y: 80, z: 1.5 });
    expect(editor.movePage(second, -1)).toBe(true);
    expect(editor.getPageIds()).toEqual([second, first]);
  });

  it('isolates creation, selection, hit testing, and select-all to the active page', () => {
    const editor = createPagesEditor();
    const first = editor.getActivePageId();
    const firstShape = addBox(editor, 'first');
    const second = editor.createPage('Second');
    const secondShape = addBox(editor, 'second');

    expect(editor.getShape(secondShape)?.parentId).toBe(second);
    expect(editor.getShapesAtPoint({ x: 20, y: 30 }).map(shape => shape.id)).toEqual([secondShape]);
    editor.setSelectedShapeIds([firstShape, secondShape]);
    expect(editor.getSelectedShapeIds()).toEqual([secondShape]);

    editor.setActivePage(first);
    editor.selectAll();
    expect(editor.getSelectedShapeIds()).toEqual([firstShape]);
    expect(editor.getShapesInViewport().map(shape => shape.id)).toEqual([firstShape]);
  });

  it('duplicates a page subtree and deletes with deterministic fallback', () => {
    const editor = createPagesEditor();
    const first = editor.getActivePageId();
    addBox(editor, 'source');
    const duplicate = editor.duplicatePage(first);

    expect(editor.getPage(duplicate)?.name).toBe('Page 1 Copy');
    expect(editor.getCurrentPageShapeIdsSignal().peek()).toHaveLength(1);
    expect(editor.getCurrentPageShapeIdsSignal().peek()[0]).not.toBe(
      editor.store.getShapeIdsOnPage(first)[0],
    );

    const fallback = editor.deletePage(duplicate);
    expect(fallback).toBe(first);
    expect(editor.getActivePageId()).toBe(first);
    expect(editor.getPageIds()).toEqual([first]);
    expect(() => editor.deletePage(first)).toThrow(/at least one page/);
  });

  it('selects the next adjacent page when deleting an active middle page', () => {
    const editor = createPagesEditor();
    const first = editor.getActivePageId();
    const middle = editor.createPage('Middle');
    const last = editor.createPage('Last');

    editor.setActivePage(middle);
    expect(editor.deletePage(middle)).toBe(last);
    expect(editor.getActivePageId()).toBe(last);
    expect(editor.getPageIds()).toEqual([first, last]);
  });

  it('rejects cross-page bindings', () => {
    const editor = createPagesEditor();
    const firstShape = addBox(editor, 'first');
    const second = editor.createPage('Second');
    const secondShape = addBox(editor, 'second');

    expect(() => editor.createBinding({
      type: 'test-binding', fromId: firstShape, toId: secondShape, props: {},
    })).toThrow(/bindings cannot cross pages/);
    expect(editor.getPage(second as PageId)).toBeTruthy();
  });

  it('pastes copied shapes into the currently active page', () => {
    const editor = createPagesEditor();
    const source = addBox(editor, 'source');
    editor.copy([source]);
    const targetPage = editor.createPage('Target');

    const [pasted] = editor.paste();
    expect(editor.getShape(pasted!)?.parentId).toBe(targetPage);
    expect(editor.getCurrentPageShapeIdsSignal().peek()).toEqual([pasted]);
  });
});
