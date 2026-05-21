/**
 * whiteboard/ZoomWidget.tsx
 *
 * Bottom-right zoom controls:
 *  - Zoom-in / zoom-out buttons
 *  - Current zoom % display (click to reset to 100%)
 *  - Fit-to-screen button (fits all shapes in viewport)
 */

import React from 'react';
import { wbEditor } from './editor';
import { useSignalValue } from '../useSignalValue';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;

export function fitToScreen() {
  const shapes = wbEditor.getShapes();
  if (shapes.length === 0) {
    wbEditor.camera.setCamera({ x: 0, y: 0, z: 1 });
    return;
  }

  const container = document.getElementById('wb-canvas');
  if (!container) return;
  const { width, height } = container.getBoundingClientRect();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of shapes) {
    const util = wbEditor.getShapeUtil(shape.type);
    const b = util.getGeometry(shape as any);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  const PAD = 60;
  const cw = maxX - minX + PAD * 2;
  const ch = maxY - minY + PAD * 2;
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(width / cw, height / ch)));

  wbEditor.camera.setCamera({
    x: minX - PAD,
    y: minY - PAD,
    z,
  });
}

const btnStyle: React.CSSProperties = {
  width:          36,
  height:         36,
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  background:     'transparent',
  border:         'none',
  color:          '#a6adc8',
  cursor:         'pointer',
  fontSize:       18,
  borderRadius:   8,
  transition:     'background 0.12s, color 0.12s',
};
// ── zoomToward ────────────────────────────────────────────────
// Zoom to `newZ` keeping the viewport centre fixed in page space.
// Uses the same invariant as the wheel handler:
//   pagePt = screenPt / z + cam  →  newCam = pagePt - screenPt / newZ

function zoomToward(newZ: number) {
  const cam = wbEditor.camera.getCamera();
  const container = document.getElementById('wb-canvas');
  if (!container) {
    wbEditor.camera.setCamera({ z: newZ });
    return;
  }
  const { width, height } = container.getBoundingClientRect();
  // Viewport centre in screen space
  const sx = width / 2;
  const sy = height / 2;
  // Page-space point currently under screen centre
  const pagePtX = sx / cam.z + cam.x;
  const pagePtY = sy / cam.z + cam.y;
  // New camera origin that keeps that page point at screen centre
  wbEditor.camera.setCamera({
    x: pagePtX - sx / newZ,
    y: pagePtY - sy / newZ,
    z: newZ,
  });
}


export function ZoomWidget() {
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const zoom = camera?.z ?? 1;
  const pct = Math.round(zoom * 100);

  const zoomIn  = () => zoomToward(Math.min(MAX_ZOOM, zoom + ZOOM_STEP));
  const zoomOut = () => zoomToward(Math.max(MIN_ZOOM, zoom - ZOOM_STEP));
  const reset   = () => {
    // Reset zoom keeping viewport centre fixed
    zoomToward(1);
  };

  return (
    <div
      id="wb-zoom-widget"
      style={{
        position:      'absolute',
        bottom:         16,
        right:          16,
        zIndex:         50,
        display:        'flex',
        alignItems:     'center',
        gap:            2,
        background:     '#1e1e2e',
        border:         '1px solid #313244',
        borderRadius:   10,
        padding:        '3px 6px',
        boxShadow:      '0 4px 16px rgba(0,0,0,0.3)',
      }}
    >
      {/* Fit to screen */}
      <button id="wb-fit" title="Fit to screen (⇧1)" onClick={fitToScreen} style={btnStyle}>
        ⊞
      </button>

      <div style={{ width: 1, height: 24, background: '#313244', margin: '0 2px' }} />

      {/* Zoom out */}
      <button id="wb-zoom-out" title="Zoom out (−)" onClick={zoomOut} style={btnStyle}>−</button>

      {/* Zoom % display — click to reset */}
      <button
        id="wb-zoom-pct"
        title="Reset zoom (1)"
        onClick={reset}
        style={{ ...btnStyle, width: 56, fontSize: 13, fontFamily: 'Inter, monospace', fontWeight: 600, color: '#cdd6f4' }}
      >
        {pct}%
      </button>

      {/* Zoom in */}
      <button id="wb-zoom-in" title="Zoom in (+)" onClick={zoomIn} style={btnStyle}>+</button>
    </div>
  );
}
