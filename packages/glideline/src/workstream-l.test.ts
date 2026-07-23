// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createEditor } from './editor';
import { ArrowPlugin, ArrowUtil } from './shapes/ArrowUtil';
import { BoxUtil } from './shapes/BoxUtil';
import { TextUtil } from './shapes/TextUtil';
import { SelectTool } from './tools/SelectTool';

const makeBoxEditor = () => createEditor({
  plugins: [{ id: 'box', shapes: [BoxUtil as any] }],
});

function createBox(editor: ReturnType<typeof makeBoxEditor>) {
  return editor.createShape({
    type: 'box',
    x: 10,
    y: 20,
    props: {
      ...new BoxUtil().getDefaultProps(),
      label: 'Original',
      color: '#111111',
    },
  });
}

describe('Workstream L — text edit safety', () => {
  it('commits only the owned text field and preserves concurrent style changes', () => {
    const editor = makeBoxEditor();
    const id = createBox(editor);

    editor.startEditing(id);
    editor.updateEditingDraft('Local draft');
    editor.updateShape(id, { props: { color: '#ff0000' } });

    expect(editor.commitEditing()).toBe(true);
    expect(editor.getShape(id)?.props).toMatchObject({
      label: 'Local draft',
      color: '#ff0000',
    });
  });

  it('does not overwrite a concurrent change to the same text field', () => {
    const editor = makeBoxEditor();
    const id = createBox(editor);

    editor.startEditing(id);
    editor.updateEditingDraft('Local draft');
    editor.updateShape(id, { props: { label: 'Remote value' } });

    expect(editor.textEditing.session.peek()?.status).toBe('conflicted');
    expect(editor.commitEditing()).toBe(false);
    expect(editor.getShape(id)?.props.label).toBe('Remote value');
    editor.cancelEditing(true, true);
    expect(editor.textEditing.recoverableDraft.peek()?.text).toBe('Local draft');
  });

  it('does not commit while an IME composition is active', () => {
    const editor = makeBoxEditor();
    const id = createBox(editor);

    editor.startEditing(id);
    editor.updateEditingDraft('編集中');
    editor.setEditingComposition(true);
    expect(editor.commitEditing()).toBe(false);
    expect(editor.getShape(id)?.props.label).toBe('Original');

    editor.setEditingComposition(false);
    expect(editor.commitEditing()).toBe(true);
    expect(editor.getShape(id)?.props.label).toBe('編集中');
  });

  it('commits once and cancellation never mutates the shape', () => {
    const editor = makeBoxEditor();
    const id = createBox(editor);

    editor.startEditing(id);
    editor.updateEditingDraft('Cancelled');
    editor.cancelEditing();
    expect(editor.getShape(id)?.props.label).toBe('Original');

    editor.startEditing(id);
    editor.updateEditingDraft('Committed');
    expect(editor.commitEditing()).toBe(true);
    const revision = editor.store.revision;
    expect(editor.commitEditing()).toBe(false);
    expect(editor.store.revision).toBe(revision);
    expect(editor.getShape(id)?.props.label).toBe('Committed');
  });

  it('keeps a recoverable draft when the edited shape is deleted', () => {
    const editor = makeBoxEditor();
    const id = createBox(editor);

    editor.startEditing(id);
    editor.updateEditingDraft('Unsaved draft');
    editor.deleteShapes([id]);

    expect(editor.textEditing.session.peek()).toBeNull();
    expect(editor.textEditing.recoverableDraft.peek()).toEqual({
      shapeId: id,
      field: 'label',
      text: 'Unsaved draft',
    });
  });

  it('removes an untouched empty standalone text shape when editing finishes', () => {
    const editor = createEditor({
      plugins: [{ id: 'text', shapes: [TextUtil as any] }],
    });
    const id = editor.createShape({
      type: 'text',
      x: 0,
      y: 0,
      props: new TextUtil().getDefaultProps(),
    });

    editor.startEditing(id);
    expect(editor.commitEditing()).toBe(true);
    expect(editor.getShape(id)).toBeUndefined();
  });

  it('keeps a rotated standalone text anchor fixed when its content grows', () => {
    const editor = createEditor({
      plugins: [{ id: 'text', shapes: [TextUtil as any] }],
    });
    const id = editor.createShape({
      type: 'text',
      x: 140,
      y: 90,
      rotation: Math.PI / 3,
      props: {
        ...new TextUtil().getDefaultProps(),
        text: 'Short',
      },
    });
    const anchoredOrigin = editor.localToPage(id, { x: 0, y: 0 });

    editor.startEditing(id);
    editor.updateEditingDraft('A much longer rotated text label');
    expect(editor.commitEditing()).toBe(true);

    const committedOrigin = editor.localToPage(id, { x: 0, y: 0 });
    expect(committedOrigin.x).toBeCloseTo(anchoredOrigin.x, 8);
    expect(committedOrigin.y).toBeCloseTo(anchoredOrigin.y, 8);
  });

  it('makes arrow labels route-relative and exportable', () => {
    const editor = createEditor({ plugins: [ArrowPlugin] });
    const util = editor.getShapeUtil('arrow') as ArrowUtil;
    const id = editor.createShape({
      type: 'arrow',
      x: 0,
      y: 0,
      props: {
        ...new ArrowUtil().getDefaultProps(),
        label: 'Approval',
        end: {
          boundShapeId: null,
          normalizedAnchor: { x: 0.5, y: 0.5 },
          point: { x: 200, y: 100 },
        },
      },
    });
    const before = util.getLabelProps(editor.getShape(id) as any);

    editor.updateShape(id, {
      props: {
        end: {
          boundShapeId: null,
          normalizedAnchor: { x: 0.5, y: 0.5 },
          point: { x: 300, y: 200 },
        },
      },
    });
    const shape = editor.getShape(id) as any;
    const after = util.getLabelProps(shape);

    expect({ x: after.x, y: after.y }).not.toEqual({ x: before.x, y: before.y });
    expect(util.hitTestPoint(shape, {
      x: (after.x ?? 0) + 5,
      y: (after.y ?? 0) + 5,
    })).toBe(true);
    const visualBounds = editor.getShapeVisualWorldBounds(id);
    expect(visualBounds.minX).toBeLessThanOrEqual((after.x ?? 0) + shape.x);
    expect(visualBounds.minY).toBeLessThanOrEqual((after.y ?? 0) + shape.y);
    expect(util.toSvgExport(shape).textContent).toContain('Approval');
  });

  it('places the first arrow label at the double-click and re-edits that label', () => {
    const editor = createEditor({
      plugins: [ArrowPlugin],
      tools: [SelectTool],
    });
    editor.setCurrentTool('select');
    const id = editor.createShape({
      type: 'arrow',
      x: 0,
      y: 0,
      props: {
        ...new ArrowUtil().getDefaultProps(),
        end: {
          boundShapeId: null,
          normalizedAnchor: { x: 0.5, y: 0.5 },
          point: { x: 200, y: 0 },
        },
      },
    });

    editor.dispatchEvent({
      type: 'doubleClick',
      point: { x: 160, y: 0 },
      shapeId: id,
    });
    expect(editor.getShape(id)?.props.labelPosition).toBe(0.5);
    expect(editor.textEditing.session.peek()?.pendingProps?.['labelPosition']).toBeCloseTo(0.8);
    editor.updateEditingDraft('First label');
    expect(editor.commitEditing()).toBe(true);
    expect(editor.getShape(id)?.props).toMatchObject({
      label: 'First label',
      labelPosition: 0.8,
    });

    editor.dispatchEvent({
      type: 'doubleClick',
      point: { x: 20, y: 0 },
      shapeId: id,
    });
    expect(editor.textEditing.session.peek()).toMatchObject({
      draft: 'First label',
    });
    expect(editor.textEditing.session.peek()?.pendingProps).toBeUndefined();
    editor.updateEditingDraft('Updated label');
    expect(editor.commitEditing()).toBe(true);
    expect(editor.getShape(id)?.props).toMatchObject({
      label: 'Updated label',
      labelPosition: 0.8,
    });
    expect(editor.getShapes().filter(shape => shape.type === 'arrow')).toHaveLength(1);
  });
});
