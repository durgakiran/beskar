import React from 'react';
import type { GlideboardController } from './GlideboardController';
import { useGlideboardController } from './GlideboardContext';
import { wbTheme } from './theme';
import { useSignalValue } from './useSignalValue';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;

export function fitToScreen(controller: GlideboardController) {
  const editor = controller.editor;
  const shapes = editor.getShapes();
  if (shapes.length === 0) {
    editor.camera.setCamera({ x: 0, y: 0, z: 1 });
    return;
  }

  const container = controller.getCanvasElement();
  if (!container) return;
  const { width, height } = container.getBoundingClientRect();

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const shape of shapes) {
    const bounds = editor.getShapeWorldBounds(shape);
    if (bounds.minX < minX) minX = bounds.minX;
    if (bounds.minY < minY) minY = bounds.minY;
    if (bounds.maxX > maxX) maxX = bounds.maxX;
    if (bounds.maxY > maxY) maxY = bounds.maxY;
  }

  const pad = 60;
  const contentWidth = maxX - minX + pad * 2;
  const contentHeight = maxY - minY + pad * 2;
  const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(width / contentWidth, height / contentHeight)));

  editor.camera.setCamera({
    x: minX - pad,
    y: minY - pad,
    z,
  });
}

const buttonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: wbTheme.textMuted,
  cursor: 'pointer',
  fontSize: 18,
  borderRadius: 8,
  transition: 'background 0.12s, color 0.12s',
};

function zoomToward(controller: GlideboardController, newZ: number) {
  const editor = controller.editor;
  const camera = editor.camera.getCamera();
  const container = controller.getCanvasElement();
  if (!container) {
    editor.camera.setCamera({ z: newZ });
    return;
  }

  const { width, height } = container.getBoundingClientRect();
  const screenX = width / 2;
  const screenY = height / 2;
  const pagePointX = screenX / camera.z + camera.x;
  const pagePointY = screenY / camera.z + camera.y;

  editor.camera.setCamera({
    x: pagePointX - screenX / newZ,
    y: pagePointY - screenY / newZ,
    z: newZ,
  });
}

export function ZoomWidget() {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const camera = useSignalValue(editor.camera.signal)!;
  const zoom = camera?.z ?? 1;
  const pct = Math.round(zoom * 100);

  const zoomIn = () => zoomToward(controller, Math.min(MAX_ZOOM, zoom + ZOOM_STEP));
  const zoomOut = () => zoomToward(controller, Math.max(MIN_ZOOM, zoom - ZOOM_STEP));
  const reset = () => zoomToward(controller, 1);

  return (
    <div
      id={controller.domId('zoom-widget')}
      data-glideboard-role="zoom-widget"
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: wbTheme.surface,
        border: `1px solid ${wbTheme.border}`,
        borderRadius: 10,
        padding: '3px 6px',
        boxShadow: wbTheme.statusShadow,
      }}
    >
      <button id={controller.domId('fit')} data-glideboard-control="fit" title="Fit to screen (⇧1)" onClick={() => fitToScreen(controller)} style={buttonStyle}>
        ⊞
      </button>
      <div style={{ width: 1, height: 24, background: wbTheme.border, margin: '0 2px' }} />
      <button id={controller.domId('zoom-out')} data-glideboard-control="zoom-out" title="Zoom out (−)" onClick={zoomOut} style={buttonStyle}>−</button>
      <button
        id={controller.domId('zoom-pct')}
        data-glideboard-control="zoom-pct"
        title="Reset zoom (1)"
        onClick={reset}
        style={{ ...buttonStyle, width: 56, fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 600, color: wbTheme.text }}
      >
        {pct}%
      </button>
      <button id={controller.domId('zoom-in')} data-glideboard-control="zoom-in" title="Zoom in (+)" onClick={zoomIn} style={buttonStyle}>+</button>
    </div>
  );
}
