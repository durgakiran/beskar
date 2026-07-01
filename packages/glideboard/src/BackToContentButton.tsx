import React, { useMemo } from 'react';
import { useSignalValue } from './useSignalValue';
import { wbEditor } from './editor';
import { wbTheme } from './theme';

export function BackToContentButton() {
  const camera = useSignalValue(wbEditor.camera.signal);
  const shapeIds = useSignalValue(wbEditor.store.getShapeIdsSignal());

  const isOffscreen = useMemo(() => {
    if (!shapeIds || shapeIds.length === 0) return false;

    const shapes = wbEditor.getShapes();
    if (shapes.length === 0) return false;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const shape of shapes) {
      const bounds = wbEditor.getShapeWorldBounds(shape);
      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.minY < minY) minY = bounds.minY;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.maxY > maxY) maxY = bounds.maxY;
    }

    if (minX === Infinity) return false;

    const vp = wbEditor.getViewportBounds();
    // Check if the viewport completely misses the content bounding box
    const intersects = !(vp.maxX < minX || vp.minX > maxX || vp.maxY < minY || vp.minY > maxY);
    return !intersects;
  }, [camera, shapeIds]);

  if (!isOffscreen) return null;

  const handleBackToContent = () => {
    const shapes = wbEditor.getShapes();
    if (shapes.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const shape of shapes) {
      const bounds = wbEditor.getShapeWorldBounds(shape);
      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.minY < minY) minY = bounds.minY;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.maxY > maxY) maxY = bounds.maxY;
    }

    if (minX === Infinity) return;

    const container = document.getElementById('wb-canvas');
    if (!container) return;

    const { width, height } = container.getBoundingClientRect();
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const camera = wbEditor.camera.getCamera();

    wbEditor.camera.setCamera({
      x: cx - (width / 2) / camera.z,
      y: cy - (height / 2) / camera.z,
    });
  };

  return (
    <button
      id="wb-back-to-content"
      onClick={handleBackToContent}
      style={{
        position: 'absolute',
        bottom: 72,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: wbTheme.surface,
        color: wbTheme.accentText,
        border: `1px solid ${wbTheme.border}`,
        borderRadius: 24,
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: wbTheme.shadow,
        transition: 'background 0.1s',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = wbTheme.surfaceInset;
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = wbTheme.surface;
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 18-6-6 6-6"/>
      </svg>
      Back to content
    </button>
  );
}
