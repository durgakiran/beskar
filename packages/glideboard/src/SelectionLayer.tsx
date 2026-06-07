import React, { useEffect, useState } from 'react';
import {
  getArrowBendHandlePoint,
  type ArrowShape,
  type GlideShape,
  type ResizeHandle,
} from '@durgakiran/glideline';
import { wbTheme } from './theme';
import { useSignalValue } from './useSignalValue';
import { wbEditor } from './editor';

const HANDLE_SIZE = 8;
const ROTATION_HANDLE_OFFSET = 20;

interface OverlayBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
  rotation: number;
}

export function SelectionLayer() {
  const selectedIds = useSignalValue(wbEditor.getSelectionSignal());
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const [boxes, setBoxes] = useState<OverlayBounds[]>([]);
  const [shapes, setShapes] = useState<GlideShape[]>([]);

  useEffect(() => {
    if (!selectedIds || selectedIds.length === 0) {
      setBoxes([]);
      setShapes([]);
      return;
    }

    const nextBoxes: OverlayBounds[] = [];
    const nextShapes: GlideShape[] = [];
    for (const id of selectedIds) {
      const shape = wbEditor.store.getSignal(id)?.value as GlideShape | null;
      if (!shape) continue;
      const localBounds = wbEditor.getShapeUtil(shape.type).getGeometry(shape as any).getBounds();
      nextBoxes.push({
        minX: localBounds.minX + shape.x,
        minY: localBounds.minY + shape.y,
        maxX: localBounds.maxX + shape.x,
        maxY: localBounds.maxY + shape.y,
        w: localBounds.w,
        h: localBounds.h,
        rotation: shape.rotation ?? 0,
      });
      nextShapes.push(shape);
    }
    setBoxes(nextBoxes);
    setShapes(nextShapes);
  }, [selectedIds]);

  if (!selectedIds || selectedIds.length === 0 || boxes.length === 0) return null;


  if (shapes.length === 1 && shapes[0]?.type === 'arrow') {
    const arrow = shapes[0] as ArrowShape;
    const { start, end } = arrow.props;
    const hs = HANDLE_SIZE / camera.z;
    const bendPoint = getArrowBendHandlePoint(wbEditor as any, arrow);
    const startWorldX = arrow.x + start.point.x;
    const startWorldY = arrow.y + start.point.y;
    const endWorldX = arrow.x + end.point.x;
    const endWorldY = arrow.y + end.point.y;

    return (
      <g id="wb-selection-overlay">
        <rect
          data-handle="start"
          x={startWorldX - hs / 2}
          y={startWorldY - hs / 2}
          width={hs}
          height={hs}
          fill={wbTheme.selectionFill}
          stroke={wbTheme.accent}
          strokeWidth={1 / camera.z}
          transform={`rotate(45, ${startWorldX}, ${startWorldY})`}
          style={{ cursor: 'crosshair' }}
        />
        <rect
          data-handle="end"
          x={endWorldX - hs / 2}
          y={endWorldY - hs / 2}
          width={hs}
          height={hs}
          fill={wbTheme.selectionFill}
          stroke={wbTheme.accent}
          strokeWidth={1 / camera.z}
          transform={`rotate(45, ${endWorldX}, ${endWorldY})`}
          style={{ cursor: 'crosshair' }}
        />
        {bendPoint ? (
          <circle
            data-handle="bend"
            cx={bendPoint.x}
            cy={bendPoint.y}
            r={5 / camera.z}
            fill={wbTheme.accent}
            stroke={wbTheme.selectionFill}
            strokeWidth={1 / camera.z}
            style={{ cursor: 'grab' }}
          />
        ) : null}
      </g>
    );
  }

  const minX = Math.min(...boxes.map(box => box.minX));
  const minY = Math.min(...boxes.map(box => box.minY));
  const maxX = Math.max(...boxes.map(box => box.maxX));
  const maxY = Math.max(...boxes.map(box => box.maxY));
  const width = maxX - minX;
  const height = maxY - minY;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const transform = boxes.length === 1 ? `rotate(${(boxes[0]!.rotation * 180) / Math.PI}, ${cx}, ${cy})` : undefined;

  const handles: { id: ResizeHandle; px: number; py: number }[] = [
    { id: 'nw', px: minX, py: minY },
    { id: 'n', px: minX + width / 2, py: minY },
    { id: 'ne', px: maxX, py: minY },
    { id: 'e', px: maxX, py: minY + height / 2 },
    { id: 'se', px: maxX, py: maxY },
    { id: 's', px: minX + width / 2, py: maxY },
    { id: 'sw', px: minX, py: maxY },
    { id: 'w', px: minX, py: minY + height / 2 },
  ];

  const hs = HANDLE_SIZE / camera.z;

  const allText = shapes.every(shape => shape.type === 'text');

  return (
    <g id="wb-selection-overlay" transform={transform}>
      <rect
        x={minX}
        y={minY}
        width={width}
        height={height}
        fill="none"
        stroke={wbTheme.accent}
        strokeWidth={1 / camera.z}
        strokeDasharray={`${4 / camera.z} ${2 / camera.z}`}
        pointerEvents="none"
      />

      {!allText ? (
        <>
          {handles.map(handle => (
            <rect
              key={handle.id}
              data-handle={handle.id}
              x={handle.px - hs / 2}
              y={handle.py - hs / 2}
              width={hs}
              height={hs}
              fill={wbTheme.selectionFill}
              stroke={wbTheme.accent}
              strokeWidth={1 / camera.z}
              rx={1 / camera.z}
              style={{ cursor: handleCursor(handle.id) }}
            />
          ))}
          <circle
            data-handle="rotate"
            cx={minX + width / 2}
            cy={minY - ROTATION_HANDLE_OFFSET / camera.z}
            r={5 / camera.z}
            fill={wbTheme.selectionFill}
            stroke={wbTheme.accent}
            strokeWidth={1 / camera.z}
            style={{ cursor: 'grab' }}
          />
          <line
            x1={minX + width / 2}
            y1={minY}
            x2={minX + width / 2}
            y2={minY - ROTATION_HANDLE_OFFSET / camera.z}
            stroke={wbTheme.accent}
            strokeWidth={1 / camera.z}
            pointerEvents="none"
          />
        </>
      ) : null}
    </g>
  );
}

function handleCursor(handle: ResizeHandle): string {
  const map: Record<ResizeHandle, string> = {
    nw: 'nw-resize',
    n: 'n-resize',
    ne: 'ne-resize',
    e: 'e-resize',
    se: 'se-resize',
    s: 's-resize',
    sw: 'sw-resize',
    w: 'w-resize',
  };
  return map[handle];
}

export function MarqueeOverlay() {
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const selectTool = wbEditor.getCurrentTool();
  const marqueeState = (selectTool as any)._childMap?.get('marqueeSelecting');
  const rect = useSignalValue(marqueeState?.marqueeBoxSignal) as
    | { minX: number; minY: number; w: number; h: number }
    | undefined;

  if (!rect || rect.w === 0 || rect.h === 0) return null;

  return (
    <rect
      x={rect.minX}
      y={rect.minY}
      width={rect.w}
      height={rect.h}
      fill={wbTheme.accentSurface}
      stroke={wbTheme.accent}
      strokeWidth={1 / camera.z}
      strokeDasharray={`${3 / camera.z} ${2 / camera.z}`}
      pointerEvents="none"
    />
  );
}
