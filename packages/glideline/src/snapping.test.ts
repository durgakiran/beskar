// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createEditor, type GlidePlugin } from './editor';
import { BoxUtil } from './shapes/BoxUtil';
import { makeBox, sid } from './types';

const plugin: GlidePlugin = { id: 'snap-test', shapes: [BoxUtil as any] };

function addBox(editor: ReturnType<typeof createEditor>, id: string, x: number, y: number, w = 40, h = 40) {
  return editor.createShape({ id: sid(id), type: 'box', x, y, props: { w, h } });
}

describe('SnapManager', () => {
  it('snaps moving edges to object edges using screen-pixel tolerance', () => {
    const editor = createEditor({ plugins: [plugin] });
    const moving = addBox(editor, 'shape:moving', 0, 0);
    addBox(editor, 'shape:target', 100, 80);
    const result = editor.snapping.snapTranslation(editor, [moving], editor.getShapeVisualWorldBounds(moving), { x: 97, y: 79 });
    expect(result.delta).toEqual({ x: 100, y: 80 });
    expect(result.guides.map(guide => guide.axis).sort()).toEqual(['x', 'y']);
  });

  it('supports grid snapping and Alt-style bypass', () => {
    const editor = createEditor({ plugins: [plugin] });
    const moving = addBox(editor, 'shape:moving', 3, 5);
    editor.snapping.updateSettings({ snapToObjects: false, snapToGrid: true, gridSize: 20 });
    const snapped = editor.snapping.snapTranslation(editor, [moving], makeBox(3, 5, 40, 40), { x: 14, y: 13 });
    expect(snapped.delta).toEqual({ x: 17, y: 15 });
    const bypassed = editor.snapping.snapTranslation(editor, [moving], makeBox(3, 5, 40, 40), { x: 14, y: 13 }, true);
    expect(bypassed.delta).toEqual({ x: 14, y: 13 });
    expect(editor.snapping.guides.peek()).toEqual([]);
  });

  it('snaps a shape into an equal gap', () => {
    const editor = createEditor({ plugins: [plugin] });
    const moving = addBox(editor, 'shape:moving', 0, 0);
    addBox(editor, 'shape:left', 100, 0);
    addBox(editor, 'shape:right', 300, 0);
    const result = editor.snapping.snapTranslation(editor, [moving], editor.getShapeVisualWorldBounds(moving), { x: 197, y: 60 });
    expect(result.delta.x).toBeCloseTo(200, 7);
    expect(result.guides.some(guide => guide.kind === 'gap')).toBe(true);
  });

  it('snaps resize dimensions to another shape', () => {
    const editor = createEditor({ plugins: [plugin] });
    const moving = addBox(editor, 'shape:moving', 0, 0, 40, 40);
    addBox(editor, 'shape:target', 200, 0, 120, 70);
    const result = editor.snapping.snapDimensions(editor, moving, 116, 67, { width: true, height: true });
    expect(result.width).toBe(120);
    expect(result.height).toBe(70);
    expect(result.guides).toHaveLength(2);
  });
});
