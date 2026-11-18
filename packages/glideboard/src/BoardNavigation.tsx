import React, { memo, useEffect, useMemo, useState } from 'react';
import type { Box2d, GlideEditor, GlideShape, ShapeId } from '@durgakiran/glideline';
import { makeBox } from '@durgakiran/glideline';
import { BackToContentButton } from './BackToContentButton.js';
import { useGlideboardController } from './GlideboardContext.js';
import { wbTheme } from './theme.js';
import { useSignalValue } from './useSignalValue.js';

const EDIT_IDLE_DELAY = 1500;

type BoardItem = { shape: GlideShape; bounds: Box2d };

function intersects(a: Box2d, b: Box2d): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function readBoardItems(editor: GlideEditor): BoardItem[] {
  const items: BoardItem[] = [];
  for (const shape of editor.getShapes(true)) {
    if (shape.type === 'group') continue;
    const bounds = editor.getShapeVisualWorldBounds(shape);
    let { minX, minY, maxX, maxY } = bounds;
    for (const frame of editor.getClippingFrameAncestors(shape.id as ShapeId)) {
      const clip = editor.getShapeWorldBounds(frame);
      minX = Math.max(minX, clip.minX);
      minY = Math.max(minY, clip.minY);
      maxX = Math.min(maxX, clip.maxX);
      maxY = Math.min(maxY, clip.maxY);
    }
    if (maxX >= minX && maxY >= minY) {
      items.push({ shape, bounds: makeBox(minX, minY, maxX - minX, maxY - minY) });
    }
  }
  return items;
}

function distanceToContent(box: Box2d, x: number, y: number): number {
  return Math.hypot(Math.max(0, box.minX - x, x - box.maxX), Math.max(0, box.minY - y, y - box.maxY));
}

function useMinimapVisibility(editor: GlideEditor, editing: boolean): boolean {
  const [coolingDown, setCoolingDown] = useState(editing);
  const [localEditRevision, setLocalEditRevision] = useState(0);

  useEffect(() => editor.store.listen(change => {
    // Click-to-place, paste, and keyboard commands can commit without a live preview.
    if (change.scope !== 'document'
      || !['user', 'undo', 'redo'].includes(change.origin)
      || !change.deltas.some(({ before, after }) => {
        const kind = (after ?? before)?.['kind'];
        return kind === 'shape' || kind === 'binding';
      })) return;
    setCoolingDown(true);
    setLocalEditRevision(change.revision);
  }), [editor]);

  useEffect(() => {
    if (editing) {
      setCoolingDown(true);
      return;
    }
    if (coolingDown) {
      const timer = setTimeout(() => setCoolingDown(false), EDIT_IDLE_DELAY);
      return () => clearTimeout(timer);
    }
  }, [editing, coolingDown, localEditRevision]);
  return !editing && !coolingDown;
}

function rectProps(bounds: Box2d) {
  return { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h };
}

const MinimapContent = memo(function MinimapContent({ editor, items }: { editor: GlideEditor; items: BoardItem[] }) {
  return items.map(({ shape, bounds }) => {
    const id = shape.id as ShapeId;
    if (shape.type === 'freehand' || shape.type === 'arrow' || shape.type === 'line') {
      const points = editor.transforms.getWorldOutline(id);
      if (points.length > 1) {
        return <polyline key={id} points={points.map(point => `${point.x},${point.y}`).join(' ')}
          fill="none" stroke={wbTheme.textSoft} strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
      }
    }
    return <rect key={id} {...rectProps(bounds)}
      fill={shape.type === 'frame' ? 'none' : wbTheme.borderStrong}
      stroke={wbTheme.textSoft} strokeOpacity={0.65} vectorEffect="non-scaling-stroke" />;
  });
});

function Minimap({ editor, items, viewport }: { editor: GlideEditor; items: BoardItem[]; viewport: Box2d }) {
  let { minX, minY, maxX, maxY } = viewport;
  for (const { bounds } of items) {
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  const padding = Math.max(maxX - minX, maxY - minY) * 0.05;
  const viewBox = [minX - padding, minY - padding, maxX - minX + 2 * padding, maxY - minY + 2 * padding].join(' ');

  return (
    <div data-glideboard-role="minimap" style={{
      position: 'absolute', right: 16, bottom: 68, zIndex: 49,
      width: 152, height: 98, padding: 5, boxSizing: 'border-box',
      background: wbTheme.surface, border: `1px solid ${wbTheme.border}`,
      borderRadius: 10, boxShadow: wbTheme.statusShadow,
      pointerEvents: 'none',
    }}>
      <svg role="img" aria-label="Minimap of the current whiteboard page and viewport"
        width="100%" height="100%" viewBox={viewBox}>
        <MinimapContent editor={editor} items={items} />
        <rect data-glideboard-role="minimap-viewport" {...rectProps(viewport)} fill={wbTheme.accentSurface}
          stroke={wbTheme.accent} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function BoardNavigation({ viewportRevision, pointerEditing }: { viewportRevision: number; pointerEditing: boolean }) {
  const { editor, assetPlacementSignal } = useGlideboardController();
  const camera = useSignalValue(editor.camera.signal);
  const pageId = useSignalValue(editor.activePageId);
  const editingId = useSignalValue(editor.editingShapeId);
  const interactionKind = useSignalValue(editor.interactions.getKindSignal());
  const assetPlacement = useSignalValue(assetPlacementSignal);
  const documentVersion = useSignalValue(editor.getDocumentVersionSignal());
  const editing = pointerEditing || interactionKind === 'document'
    || Boolean(editingId) || assetPlacement?.status === 'pending';
  // Document previews can change on every pointer move. Skip intermediate
  // preview revisions while the minimap is hidden.
  const contentVersion = editing ? editor.store.getVersionSignal().peek() : documentVersion;
  const items = useMemo(() => readBoardItems(editor), [editor, pageId, contentVersion, editing]);
  const viewport = useMemo(() => editor.getViewportBounds(), [editor, camera, viewportRevision]);
  const showMinimap = useMinimapVisibility(editor, editing);

  if (viewport.w <= 0 || viewport.h <= 0) return null;
  const showBackToContent = items.length > 0 && !items.some(({ bounds }) => intersects(bounds, viewport));

  const returnToContent = () => {
    const { x, y, w, h } = editor.getViewportBounds();
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    let nearest = items[0]!.bounds;
    let distance = distanceToContent(nearest, centerX, centerY);
    for (const { bounds } of items) {
      const nextDistance = distanceToContent(bounds, centerX, centerY);
      if (nextDistance < distance) {
        nearest = bounds;
        distance = nextDistance;
      }
    }
    editor.camera.setCamera({ x: nearest.x + (nearest.w - w) / 2, y: nearest.y + (nearest.h - h) / 2 });
  };

  return (
    <>
      {showMinimap ? <Minimap editor={editor} items={items} viewport={viewport} /> : null}
      {showBackToContent ? <BackToContentButton onClick={returnToContent} /> : null}
    </>
  );
}
