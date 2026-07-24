import type { GlideEditor, ShapeId } from '@durgakiran/glideline';

const VIEWPORT_OVERSCAN_PX = 200;

export interface ViewportShapeEntry {
  readonly id: ShapeId;
  readonly zIndex: number;
}

function addRelatedConnectorIds(
  editor: GlideEditor,
  ids: Set<ShapeId>,
): void {
  for (const id of [...ids]) {
    for (const binding of editor.getBindingsToShape(id)) {
      const connector = editor.getShape(binding.fromId);
      if (connector?.type === 'arrow') ids.add(connector.id as ShapeId);
    }
  }
}

export function getViewportShapeEntries(editor: GlideEditor): ViewportShapeEntry[] {
  const viewport = editor.getViewportBounds();
  const zoom = editor.camera.signal.peek().z;
  const overscan = VIEWPORT_OVERSCAN_PX / zoom;
  const ids = new Set<ShapeId>(
    editor.getShapesInBox({
      minX: viewport.minX - overscan,
      minY: viewport.minY - overscan,
      maxX: viewport.maxX + overscan,
      maxY: viewport.maxY + overscan,
    }).map(shape => shape.id as ShapeId),
  );

  for (const id of editor.getSelectedShapeIds()) ids.add(id);
  for (const id of editor.interactions.changedIds) {
    if (editor.getShape(id as ShapeId)) ids.add(id as ShapeId);
  }
  for (const id of editor.store.getEphemeralIds()) {
    if (editor.getShape(id as ShapeId)) ids.add(id as ShapeId);
  }
  for (const id of editor.erasingShapeIds.peek()) ids.add(id);

  const editingId = editor.editingShapeId.peek();
  if (editingId) ids.add(editingId);

  const bindingPreview = editor.bindingPreview.peek();
  if (bindingPreview) {
    ids.add(bindingPreview.targetId);
    if (bindingPreview.sourceCandidate) {
      ids.add(bindingPreview.sourceCandidate.targetId);
    }
  }

  addRelatedConnectorIds(editor, ids);

  const orderedIds = editor.getOrderedShapeIds();
  const entries: ViewportShapeEntry[] = [];
  for (let index = 0; index < orderedIds.length; index++) {
    const id = orderedIds[index]!;
    if (ids.has(id)) entries.push({ id, zIndex: index + 1 });
  }
  return entries;
}

export function sameViewportEntries(
  left: readonly ViewportShapeEntry[],
  right: readonly ViewportShapeEntry[],
): boolean {
  return left.length === right.length
    && left.every((entry, index) => (
      entry.id === right[index]?.id
      && entry.zIndex === right[index]?.zIndex
    ));
}
