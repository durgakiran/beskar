import React, { useEffect, useState } from 'react';
import { useSignalValue } from '../useSignalValue';
import { effect } from '@preact/signals';
import type { GlideShape } from '../../../glideline/src/types';
import type { ResizeHandle } from '../../../glideline/src/shapes/ShapeUtil';
import type { ArrowShape } from '../../../glideline/src/shapes/ArrowUtil';
import { getArrowBendHandlePoint } from '../../../glideline/src/arrow-routing';
import { wbEditor } from './editor';

const HANDLE_SIZE = 8;
const ROTATION_HANDLE_OFFSET = 20;

interface OverlayBounds {
  minX: number; minY: number; maxX: number; maxY: number;
  w: number; h: number; rotation: number;
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
    return effect(() => {
      const nextBoxes: OverlayBounds[] = [];
      const nextShapes: GlideShape[] = [];
      for (const id of selectedIds) {
        const sig = wbEditor.store.getSignal(id);
        if (!sig) continue;
        const shape = sig.value as GlideShape | null;
        if (!shape) continue;
        const util = wbEditor.getShapeUtil(shape.type);
        const localB = util.getGeometry(shape as any).getBounds();
        // Convert local bounds to world space for the selection overlay
        const worldMinX = localB.minX + shape.x;
        const worldMinY = localB.minY + shape.y;
        const worldMaxX = localB.maxX + shape.x;
        const worldMaxY = localB.maxY + shape.y;
        nextBoxes.push({
          minX: worldMinX, minY: worldMinY,
          maxX: worldMaxX, maxY: worldMaxY,
          w: worldMaxX - worldMinX,
          h: worldMaxY - worldMinY,
          rotation: shape.rotation ?? 0,
        });
        nextShapes.push(shape);
      }
      setBoxes(nextBoxes);
      setShapes(nextShapes);
    });
  }, [selectedIds]);

  if (!selectedIds || selectedIds.length === 0 || boxes.length === 0) return null;

  const allText = shapes.every(s => s.type === 'text');
  
  // Arrow handles (if a single arrow is selected)
  if (shapes.length === 1 && shapes[0].type === 'arrow') {
    const arrow = shapes[0] as unknown as ArrowShape;
    const { start, end } = arrow.props;
    const hs = HANDLE_SIZE / camera.z;
    const bendPoint = getArrowBendHandlePoint(wbEditor as any, arrow);
    // Convert local arrow terminal coords to world space
    const startWorldX = arrow.x + start.point.x;
    const startWorldY = arrow.y + start.point.y;
    const endWorldX = arrow.x + end.point.x;
    const endWorldY = arrow.y + end.point.y;

    // We just render start and end diamonds for now
    return (
      <g id="wb-selection-overlay">
        <rect
          data-handle="start"
          x={startWorldX - hs/2} y={startWorldY - hs/2}
          width={hs} height={hs}
          fill="#1e1e2e" stroke="#89b4fa" strokeWidth={1 / camera.z}
          transform={`rotate(45, ${startWorldX}, ${startWorldY})`}
          style={{ cursor: 'crosshair' }}
        />
        <rect
          data-handle="end"
          x={endWorldX - hs/2} y={endWorldY - hs/2}
          width={hs} height={hs}
          fill="#1e1e2e" stroke="#89b4fa" strokeWidth={1 / camera.z}
          transform={`rotate(45, ${endWorldX}, ${endWorldY})`}
          style={{ cursor: 'crosshair' }}
        />
        {bendPoint ? (
          <circle
            data-handle="bend"
            cx={bendPoint.x}
            cy={bendPoint.y}
            r={5 / camera.z}
            fill="#89b4fa"
            stroke="#1e1e2e"
            strokeWidth={1 / camera.z}
            style={{ cursor: 'grab' }}
          />
        ) : null}
      </g>
    );
  }

  // Union bounding box
  const minX = Math.min(...boxes.map(b => b.minX));
  const minY = Math.min(...boxes.map(b => b.minY));
  const maxX = Math.max(...boxes.map(b => b.maxX));
  const maxY = Math.max(...boxes.map(b => b.maxY));
  const W = maxX - minX;
  const H = maxY - minY;
  const cx = minX + W / 2;
  const cy = minY + H / 2;

  let transform = undefined;
  if (boxes.length === 1) {
    const angleDeg = (boxes[0].rotation * 180) / Math.PI;
    transform = `rotate(${angleDeg}, ${cx}, ${cy})`;
  }

  const handles: { id: ResizeHandle; px: number; py: number }[] = [
    { id: 'nw', px: minX,       py: minY },
    { id: 'n',  px: minX + W/2, py: minY },
    { id: 'ne', px: maxX,       py: minY },
    { id: 'e',  px: maxX,       py: minY + H/2 },
    { id: 'se', px: maxX,       py: maxY },
    { id: 's',  px: minX + W/2, py: maxY },
    { id: 'sw', px: minX,       py: maxY },
    { id: 'w',  px: minX,       py: minY + H/2 },
  ];

  const hs = HANDLE_SIZE / camera.z;

  return (
    <g id="wb-selection-overlay" transform={transform}>
      <rect
        x={minX} y={minY} width={W} height={H}
        fill="none" stroke="#89b4fa" strokeWidth={1 / camera.z}
        strokeDasharray={`${4 / camera.z} ${2 / camera.z}`}
        pointerEvents="none"
      />

      {!allText && (
        <>
          {handles.map(h => (
            <rect
              key={h.id}
              data-handle={h.id}
              x={h.px - hs / 2} y={h.py - hs / 2}
              width={hs} height={hs}
              fill="#1e1e2e" stroke="#89b4fa" strokeWidth={1 / camera.z}
              rx={1 / camera.z}
              style={{ cursor: handleCursor(h.id) }}
            />
          ))}
          <circle
            data-handle="rotate"
            cx={minX + W / 2}
            cy={minY - ROTATION_HANDLE_OFFSET / camera.z}
            r={5 / camera.z}
            fill="#1e1e2e" stroke="#89b4fa" strokeWidth={1 / camera.z}
            style={{ cursor: 'grab' }}
          />
          <line
            x1={minX + W / 2} y1={minY}
            x2={minX + W / 2} y2={minY - ROTATION_HANDLE_OFFSET / camera.z}
            stroke="#89b4fa" strokeWidth={1 / camera.z}
            pointerEvents="none"
          />
        </>
      )}
    </g>
  );
}

function handleCursor(h: ResizeHandle): string {
  const map: Record<ResizeHandle, string> = {
    nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
    e: 'e-resize', se: 'se-resize', s: 's-resize',
    sw: 'sw-resize', w: 'w-resize',
  };
  return map[h];
}

export function MarqueeOverlay() {
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const selectTool = wbEditor.getCurrentTool();
  const marqueeState = (selectTool as any)._childMap?.get('marqueeSelecting');
  const rect = useSignalValue(marqueeState?.marqueeBoxSignal) as any;

  if (!rect || rect.w === 0 || rect.h === 0) return null;

  return (
    <rect
      x={rect.minX} y={rect.minY}
      width={rect.w} height={rect.h}
      fill="#89b4fa11" stroke="#89b4fa"
      strokeWidth={1 / camera.z}
      strokeDasharray={`${3 / camera.z} ${2 / camera.z}`}
      pointerEvents="none"
    />
  );
}
