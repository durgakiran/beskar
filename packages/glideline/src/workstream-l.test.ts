// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createEditor } from './editor';
import { ArrowPlugin, ArrowUtil } from './shapes/ArrowUtil';
import { BoxUtil } from './shapes/BoxUtil';
import { TextUtil } from './shapes/TextUtil';
import { SelectTool } from './tools/SelectTool';
import { TextTool } from './tools/TextTool';

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
  it('uses left alignment for standalone text and center alignment for shape labels by default', () => {
    const editor = createEditor({
      plugins: [{ id: 'text-and-box', shapes: [TextUtil as any, BoxUtil as any] }],
    });
    const box = editor.createShape({ type: 'box', x: 0, y: 0, props: { label: 'Label' } });
    editor.setSelectedShapeIds([box]);
    const text = editor.createShape({ type: 'text', x: 0, y: 100, props: { text: 'Standalone' } });

    expect(editor.getShape(box)?.props.textAlign).toBe('center');
    expect(editor.getShape(text)?.props.textAlign).toBe('left');

    editor.activeStyles.value = { ...editor.activeStyles.peek(), textAlign: 'right' };
    const overridden = editor.createShape({ type: 'text', x: 0, y: 140, props: { text: 'Overridden' } });
    expect(editor.getShape(overridden)?.props.textAlign).toBe('right');
  });

  it('places standalone text left-aligned even when a restored active style is centered', () => {
    const editor = createEditor({
      plugins: [{ id: 'text-tool', shapes: [TextUtil as any], tools: [SelectTool, TextTool] }],
    });
    editor.activeStyles.value = { ...editor.activeStyles.peek(), textAlign: 'center' };
    editor.setCurrentTool('text');
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 40, y: 60 }, shiftKey: false, target: 'canvas' });

    const shape = editor.serialize().records.find(record => record.kind === 'shape' && record.type === 'text');
    expect(shape?.props.textAlign).toBe('left');
  });

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

  it('commits formatting-only rich-text changes as one history entry', () => {
    const editor = createEditor({ plugins: [{ id: 'text', shapes: [TextUtil as any] }] });
    const id = editor.createShape({
      type: 'text', x: 0, y: 0,
      props: { ...new TextUtil().getDefaultProps(), text: 'Same text' },
    });
    const historyBefore = editor.history.undoStack.length;
    const richText = {
      format: 'beskar-canvas-rich-text', version: 1, profile: 'text',
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{
        type: 'text', text: 'Same text', marks: [{ type: 'bold' }],
      }] }] },
    };

    editor.startEditing(id);
    editor.updateEditingDraft('Same text', { richText, w: 80, h: 22, sizeMode: 'auto' }, true);
    expect(editor.commitEditing()).toBe(true);

    expect((editor.getShape(id)?.props as any).richText).toEqual(richText);
    expect(editor.history.undoStack.length).toBe(historyBefore + 1);
  });

  it('publishes text while typing and records the edit as one undo step', () => {
    const editor = makeBoxEditor();
    const id = createBox(editor);
    const historyBefore = editor.history.undoStack.length;

    editor.startEditing(id);
    editor.updateEditingDraft('First');
    expect(editor.publishEditingDraft()).toBe(true);
    expect(editor.getShape(id)?.props.label).toBe('First');
    expect(editor.textEditing.session.peek()?.shapeId).toBe(id);

    editor.updateEditingDraft('Second');
    expect(editor.publishEditingDraft()).toBe(true);
    expect(editor.getShape(id)?.props.label).toBe('Second');
    expect(editor.history.undoStack.length).toBe(historyBefore);

    expect(editor.commitEditing()).toBe(true);
    expect(editor.history.undoStack.length).toBe(historyBefore + 1);
    expect(editor.undo().status).toBe('applied');
    expect(editor.getShape(id)?.props.label).toBe('Original');
  });

  it('restores the original shape when a live text edit is cancelled', () => {
    const editor = makeBoxEditor();
    const id = createBox(editor);

    editor.startEditing(id);
    editor.updateEditingDraft('Transient');
    editor.publishEditingDraft();
    expect(editor.getShape(id)?.props.label).toBe('Transient');

    editor.cancelEditing();
    expect(editor.getShape(id)?.props.label).toBe('Original');
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
