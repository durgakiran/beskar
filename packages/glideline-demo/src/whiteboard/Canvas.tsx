/**
 * whiteboard/Canvas.tsx
 *
 * The main interactive SVG canvas layer.
 * Responsibilities:
 *  - Renders all shapes via shape-specific SVG rendering
 *  - Handles all pointer/key/wheel events, converting screen→page coords
 *  - Dispatches events to the editor's FSM
 *  - Renders selection bounding box + 8 resize handles + rotation handle
 *  - Renders marquee selection rectangle
 *  - Renders inline text editor (textarea overlay) when editingShapeId is set
 *  - Dot-grid background
 */

import React, { useRef, useEffect, useCallback, memo, useState } from 'react';
import { effect } from '@preact/signals';

import { SelectionLayer, MarqueeOverlay } from './SelectionLayer';
import { preventFocusStealRef } from './WhiteboardApp';
import { wbEditor } from './editor';
import { useSignalValue } from '../useSignalValue';
import type { ShapeId, GlideShape } from '../../../glideline/src/types';
import { STICKY_COLORS } from '../../../glideline/src/shapes/StickyNoteUtil';
import { FONT_SIZES, FONT_FAMILIES } from '../../../glideline/src/styles';
import { Rectangle2d, Ellipse2d, Polygon2d, Polyline2d } from '../../../glideline/src/geometry';

// ── Constants ────────────────────────────────────────────────

const HANDLE_SIZE = 8;
const SELECTION_HIGHLIGHT_STROKE = '#89b4fa';
const BINDING_PREVIEW_STROKE = '#a6e3a1';
const BINDING_SOURCE_PREVIEW_STROKE = '#74c7ec';

function renderGeometryOutline(
  shape: GlideShape,
  stroke: string,
  fill: string,
  strokeWidth: number,
  opacity: number
) {
  const geometry = wbEditor.getShapeUtil(shape.type).getGeometry(shape as any);
  const sharedProps = {
    fill,
    stroke,
    strokeWidth,
    vectorEffect: 'non-scaling-stroke' as const,
    pointerEvents: 'none' as const,
    opacity,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };

  if (geometry instanceof Rectangle2d) {
    const { x, y, w, h } = geometry.getBounds();
    return <rect {...sharedProps} x={x} y={y} width={w} height={h} rx={2} />;
  }

  if (geometry instanceof Ellipse2d) {
    return <ellipse {...sharedProps} cx={geometry.cx} cy={geometry.cy} rx={geometry.rx} ry={geometry.ry} />;
  }

  if (geometry instanceof Polyline2d) {
    return <path {...sharedProps} d={pointsToSvgPath(geometry.getOutline(), false)} />;
  }

  if (geometry instanceof Polygon2d) {
    return <path {...sharedProps} d={pointsToSvgPath(geometry.getOutline(), true)} />;
  }

  return <path {...sharedProps} d={pointsToSvgPath(geometry.getOutline(), true)} />;
}

function pointsToSvgPath(points: { x: number; y: number }[], closed = false): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let path = `M ${first.x} ${first.y}`;
  for (const p of rest) {
    path += ` L ${p.x} ${p.y}`;
  }
  if (closed) path += ' Z';
  return path;
}

function renderSelectionHighlight(shape: GlideShape, isSelected: boolean) {
  if (!isSelected) return null;
  return renderGeometryOutline(shape, SELECTION_HIGHLIGHT_STROKE, 'none', 2, 0.95);
}

// ── Grid background ──────────────────────────────────────────

function Grid() {
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const spacing = 24 * camera.z;
  const dotR = 1;

  const ox = ((-camera.x * camera.z) % spacing + spacing) % spacing;
  const oy = ((-camera.y * camera.z) % spacing + spacing) % spacing;

  return (
    <defs>
      <pattern
        id="wb-grid-pattern"
        x={ox} y={oy}
        width={spacing} height={spacing}
        patternUnits="userSpaceOnUse"
      >
        <circle cx={dotR} cy={dotR} r={dotR} fill="#313244" />
      </pattern>
    </defs>
  );
}

// ── Per-shape renderer ────────────────────────────────────────

const ShapeLayer = memo(({ id }: { id: ShapeId }) => {
  const sig = wbEditor.store.getSignal(id);
  const shape = useSignalValue(sig as any) as GlideShape | null;
  const gRef = useRef<SVGGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const editingId = useSignalValue(wbEditor.editingShapeId);
  const erasingIds = useSignalValue(wbEditor.erasingShapeIds);
  const selectedIds = useSignalValue(wbEditor.getSelectionSignal()) ?? [];
  const isErasing = erasingIds ? erasingIds.has(id) : false;
  const isSelected = selectedIds.includes(id);
  const isEditing = editingId === id;

  // Visibility culling via effect
  useEffect(() => {
    return effect(() => {
      if (!shape) return;
      const util = wbEditor.getShapeUtil(shape.type);
      const localBounds = util.getGeometry(shape as any).getBounds();
      const vp = wbEditor.getViewportBounds();
      // Convert local bounds to world bounds for viewport culling
      const worldMinX = localBounds.minX + shape.x;
      const worldMinY = localBounds.minY + shape.y;
      const worldMaxX = localBounds.maxX + shape.x;
      const worldMaxY = localBounds.maxY + shape.y;
      const visible =
        worldMaxX >= vp.minX && worldMinX <= vp.maxX &&
        worldMaxY >= vp.minY && worldMinY <= vp.maxY;
      if (gRef.current) gRef.current.style.display = visible ? '' : 'none';
    });
  }, [shape?.id]);

  // Render shape SVG
  useEffect(() => {
    if (!contentRef.current || !shape) return;
    // Dim shape while editing (textarea overlay takes over visually)
    if (editingId === id) {
      // Don't dim the whole shape, just hide the text elements to prevent double-vision
      contentRef.current.style.opacity = '1';
    } else {
      contentRef.current.style.opacity = '1';
    }
    const util = wbEditor.getShapeUtil(shape.type);
    if ((util as any).toSvg) {
      const el = (util as any).toSvg(shape);
      contentRef.current.innerHTML = '';
      if (el) contentRef.current.appendChild(el);
      
      // Hide SVG text (now foreignObject) while editing
      if (editingId === id) {
        const fos = contentRef.current.querySelectorAll('foreignObject');
        fos.forEach((fo: any) => fo.style.opacity = '0');
      }
    }
  });

  if (!shape) return null;

  // getGeometry returns LOCAL bounds; center for rotation in local space
  const util = wbEditor.getShapeUtil(shape.type);
  const localBounds = util.getGeometry(shape as any).getBounds();
  // Rotation center in local space
  const cx = localBounds.minX + localBounds.w / 2;
  const cy = localBounds.minY + localBounds.h / 2;
  const angleDeg = ((shape.rotation || 0) * 180) / Math.PI;

  return (
    <g
      ref={gRef}
      id={`wb-shape-${id}`}
      data-shape-id={id}
      style={{ opacity: isErasing ? 0.4 : 1 }}
      // World-space translate: positions the local-coord SVG correctly
      transform={`translate(${shape.x}, ${shape.y}) rotate(${angleDeg}, ${cx}, ${cy})`}
    >
      <g ref={contentRef} />
      {renderSelectionHighlight(shape, isSelected || isEditing)}
      {/* Red tint overlay shown while the eraser is dragging over this shape */}
      {isErasing && localBounds && (
        <rect
          x={localBounds.minX} y={localBounds.minY}
          width={localBounds.w} height={localBounds.h}
          fill="#f38ba8"
          fillOpacity={0.35}
          stroke="#f38ba8"
          strokeWidth={2}
          strokeOpacity={0.8}
          pointerEvents="none"
          rx={2}
        />
      )}
    </g>
  );
});

export function BindingPreviewOverlay() {
  const preview = useSignalValue(wbEditor.bindingPreview);
  const activeSig = preview ? wbEditor.store.getSignal(preview.targetId) : undefined;
  const sourceSig = preview?.sourceCandidate ? wbEditor.store.getSignal(preview.sourceCandidate.targetId) : undefined;
  const activeShape = useSignalValue(activeSig as any) as GlideShape | null;
  const sourceShape = useSignalValue(sourceSig as any) as GlideShape | null;

  if (!preview || !activeShape) return null;

  const renderCandidate = (
    shape: GlideShape,
    candidate: NonNullable<typeof preview.sourceCandidate> | typeof preview,
    id: string,
    stroke: string,
    fill: string,
    strokeWidth: number,
    anchorRadius: number,
    activeRadius: number,
  ) => {
    const util = wbEditor.getShapeUtil(shape.type);
    const localBounds = util.getGeometry(shape as any).getBounds();
    const cx = localBounds.minX + localBounds.w / 2;
    const cy = localBounds.minY + localBounds.h / 2;
    const angleDeg = ((shape.rotation || 0) * 180) / Math.PI;

    return (
      <>
        <g
          id={id}
          transform={`translate(${shape.x}, ${shape.y}) rotate(${angleDeg}, ${cx}, ${cy})`}
          pointerEvents="none"
        >
          {renderGeometryOutline(shape, stroke, fill, strokeWidth, 1)}
        </g>
        {candidate.candidateAnchors.map(anchor => (
          <circle
            key={`${id}-${anchor.normalizedAnchor.x}-${anchor.normalizedAnchor.y}`}
            cx={anchor.point.x}
            cy={anchor.point.y}
            r={anchorRadius}
            fill="#181825"
            stroke={stroke}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))}
        <circle
          id={`${id}-active-anchor`}
          cx={candidate.point.x}
          cy={candidate.point.y}
          r={activeRadius}
          fill={stroke}
          stroke="#181825"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      </>
    );
  };

  const showSourceAsPrimary = preview.terminal === 'start' || !preview.sourceCandidate;

  return (
    <>
      {preview.sourceCandidate && sourceShape && preview.sourceCandidate.targetId !== preview.targetId
        ? renderCandidate(
            sourceShape,
            preview.sourceCandidate,
            'wb-binding-preview-source',
            BINDING_SOURCE_PREVIEW_STROKE,
            '#74c7ec14',
            2,
            4,
            5,
          )
        : null}
      {renderCandidate(
        activeShape,
        preview,
        showSourceAsPrimary ? 'wb-binding-preview-source' : 'wb-binding-preview-target',
        showSourceAsPrimary ? BINDING_SOURCE_PREVIEW_STROKE : BINDING_PREVIEW_STROKE,
        showSourceAsPrimary ? '#74c7ec14' : '#a6e3a11a',
        showSourceAsPrimary ? 2 : 2.5,
        showSourceAsPrimary ? 4 : 5,
        showSourceAsPrimary ? 5 : 6,
      )}
    </>
  );
}

// Removed SelectionOverlay and MarqueeOverlay (moved to SelectionLayer.tsx)

// ── Inline editor overlay ────────────────────────────────────
// Exported so WhiteboardApp can render it as a sibling of Canvas,
// outside the pointer-capturing canvas div.

export function InlineEditor() {
  const editingId = useSignalValue(wbEditor.editingShapeId);
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const sig = editingId ? wbEditor.store.getSignal(editingId) : undefined;
  const shape = useSignalValue(sig as any) as GlideShape | null;

  useEffect(() => {
    if (editingId && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editingId]);

  if (!editingId || !shape) return null;

  const util = wbEditor.getShapeUtil(shape.type);
  const localBounds = util.getGeometry(shape as any).getBounds();
  // Convert local bounds to world coords for screen positioning
  const worldMinX = localBounds.minX + shape.x;
  const worldMinY = localBounds.minY + shape.y;
  const topLeft = wbEditor.pageToScreen({ x: worldMinX, y: worldMinY });
  const w = localBounds.w * camera.z;
  const h = localBounds.h * camera.z;

  const key = 'text' in (shape.props as any) ? 'text' : 'label';
  const text: string = (shape.props as any)[key] ?? '';

  /** Write text to shape immediately (no history) so SVG + selection update live. */
  const liveUpdate = (newText: string) => {
    wbEditor.history.batch('Edit Text Preview', () => {
      wbEditor.updateShape(editingId, { props: { ...(shape.props as any), [key]: newText } });
    }, { history: 'ignore' });
  };

  const commit = (newText: string, selectAgain = false) => {
    if (newText.trim() === '' && shape.type === 'text') {
      wbEditor.history.batch('Delete Empty Text', () => {
        wbEditor.deleteShapes([editingId]);
      });
    } else {
      wbEditor.history.batch('Edit Text', () => {
        wbEditor.updateShape(editingId, { props: { ...(shape.props as any), [key]: newText } });
      });
    }
    wbEditor.stopEditing(selectAgain);
  };

  // Background colour for sticky notes
  let bg = 'rgba(30,30,46,0.85)';
  let isSticky = false;
  let isText = false;
  if (shape.type === 'sticky-note') {
    bg = STICKY_COLORS[(shape.props as any).color] ?? bg;
    isSticky = true;
  } else if (shape.type === 'text') {
    bg = 'transparent';
    isText = true;
  } else {
    bg = 'transparent';
  }

  const font = (shape.props as any).font || 'sans';
  const fontSize = (shape.props as any).fontSize || 'md';

  return (
    <div
      style={{
        position: 'absolute',
        left: topLeft.x,
        top: topLeft.y,
        width: w,
        height: h,
        zIndex: 100,
        boxSizing: 'border-box',
        padding: isSticky ? 12 : 0,
        transform: `rotate(${((shape.rotation || 0) * 180) / Math.PI}deg)`,
        display: 'flex',
        alignItems: isSticky || isText ? 'flex-start' : 'center',
        justifyContent: 'center',
        background: bg,
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => {
          liveUpdate(e.currentTarget.value);
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';
        }}
        onBlur={e => commit(e.currentTarget.value, false)}
        onKeyDown={e => {
          if (e.key === 'Escape') { wbEditor.stopEditing(true); e.stopPropagation(); }
          if (e.key === 'Enter' && !e.shiftKey && !isSticky) {
            commit(e.currentTarget.value, true);
            e.preventDefault();
          }
        }}
        style={{
          width: '100%',
          height: 'auto',
          minHeight: '1em',
          background: 'transparent',
          color: (shape.props as any).textColor ?? (shape.props as any).labelColor ?? '#cdd6f4',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontFamily: FONT_FAMILIES[font as keyof typeof FONT_FAMILIES] || FONT_FAMILIES.sans,
          fontSize: (typeof fontSize === 'number' ? fontSize : FONT_SIZES[fontSize as keyof typeof FONT_SIZES] || 16) * camera.z,
          lineHeight: 'normal',
          padding: 0,
          margin: 0,
          boxSizing: 'border-box',
          textAlign: (shape.props as any).textAlign ?? 'left',
          whiteSpace: isText ? 'pre' : 'pre-wrap',
          overflow: 'hidden',
        }}
      />
    </div>
  );
}

// ── Main Canvas component ─────────────────────────────────────

export function Canvas() {
  const shapeIds = useSignalValue(wbEditor.store.getShapeIdsSignal())!;
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const containerRef = useRef<HTMLDivElement>(null);
  // Set to true when onPointerDown causes startEditing() to be called.
  // Consumed by the immediately-following mousedown to prevent focus steal.
  const preventFocusStealRef = useRef(false);

  // Keep editor camera synced with container size + attach non-passive wheel listener.
  // React 17+ registers onWheel as passive, so e.preventDefault() is silently ignored.
  // We must use addEventListener({passive:false}) directly on the DOM node.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0]!.contentRect;
      wbEditor.camera.setViewportSize(width, height);
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    wbEditor.camera.setViewportSize(r.width, r.height);

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const cam = wbEditor.camera.getCamera();

      if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
        wbEditor.camera.setCamera({ x: cam.x + (e.deltaY + e.deltaX) / cam.z });
        return;
      }

      const rawDelta = e.ctrlKey || e.metaKey ? e.deltaY : e.deltaY * 0.5;
      const factor = Math.exp(-rawDelta * 0.01);
      const newZ = Math.max(0.1, Math.min(8, cam.z * factor));
      const pagePtX = screenPt.x / cam.z + cam.x;
      const pagePtY = screenPt.y / cam.z + cam.y;
      wbEditor.camera.setCamera({
        x: pagePtX - screenPt.x / newZ,
        y: pagePtY - screenPt.y / newZ,
        z: newZ,
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // ── Event helpers ──────────────────────────────────────────

  const getPagePoint = useCallback((e: React.PointerEvent | React.WheelEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    return { screen, page: wbEditor.screenToPage(screen) };
  }, []);

  const getShapeAtEvent = useCallback((e: React.PointerEvent) => {
    const { page } = getPagePoint(e);
    const hits = wbEditor.getShapesAtPoint(page);
    return hits.length > 0 ? hits[hits.length - 1] : null;
  }, [getPagePoint]);

  // ── Resize / rotation handle detection ────────────────────

  const getHandleAtEvent = useCallback((e: React.PointerEvent): string | null => {
    const target = e.target as SVGElement;
    return target.getAttribute('data-handle');
  }, []);

  // ── Pointer events ─────────────────────────────────────────

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    containerRef.current!.setPointerCapture(e.pointerId);

    const { screen, page } = getPagePoint(e);
    const handleId = getHandleAtEvent(e);

    // Check resize/rotation handle first
    if (handleId) {
      wbEditor.setCurrentTool('select');
      wbEditor.dispatchEvent({
        type: 'pointerDown',
        point: page,
        shiftKey: e.shiftKey,
        target: 'handle',
        handleId,
      } as any);
      return;
    }

    // Normal shape/canvas pointer down
    const hit = getShapeAtEvent(e);
    const editingBefore = wbEditor.editingShapeId.peek();
    wbEditor.dispatchEvent({
      type: 'pointerDown',
      point: page,
      shiftKey: e.shiftKey,
      target: hit ? 'shape' : 'canvas',
      shapeId: hit?.id as ShapeId | undefined,
    } as any);
    // If this dispatch caused a NEW editing session, block the upcoming mousedown
    // from stealing focus away from the freshly-mounted textarea.
    if (wbEditor.editingShapeId.peek() !== editingBefore) {
      preventFocusStealRef.current = true;
    }
  }, [getPagePoint, getHandleAtEvent, getShapeAtEvent]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const { page } = getPagePoint(e);
    wbEditor.dispatchEvent({ type: 'pointerMove', point: page, shiftKey: e.shiftKey, altKey: e.altKey } as any);
  }, [getPagePoint]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    containerRef.current!.releasePointerCapture(e.pointerId);
    const { page } = getPagePoint(e);
    wbEditor.dispatchEvent({ type: 'pointerUp', point: page, shiftKey: e.shiftKey } as any);
  }, [getPagePoint]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const page = wbEditor.screenToPage(screen);
    const hits = wbEditor.getShapesAtPoint(page);
    const hit = hits.length > 0 ? hits[hits.length - 1] : null;
    wbEditor.dispatchEvent({ type: 'doubleClick', point: page, shapeId: hit?.id as ShapeId | undefined } as any);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Stop inline editor keystrokes from reaching canvas
    if (wbEditor.editingShapeId.peek()) return;

    wbEditor.dispatchEvent({ type: 'keyDown', key: e.key } as any);
  }, []);

  // Wheel zoom is handled via a native non-passive addEventListener in the
  // setup useEffect above — no onWheel prop needed.

  return (
    <div
      ref={containerRef}
      id="wb-canvas"
      tabIndex={0}
      style={{
        flex: 1,
        position: 'relative',
        background: '#181825',
        overflow: 'hidden',
        touchAction: 'none',
        outline: 'none',
        cursor: 'default',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}

      onMouseDown={e => {
        // pointerdown fires before mousedown, so if onPointerDown just opened
        // the inline editor (preventFocusStealRef = true), block this mousedown
        // from giving focus to the canvas div (which would instantly blur the textarea).
        // We consume the flag immediately — every subsequent click works normally.
        if (preventFocusStealRef.current) {
          preventFocusStealRef.current = false;
          e.preventDefault();
        }
      }}
    >
      {/* SVG layer: grid + shapes + selection + marquee */}
      <svg
        id="wb-svg"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
      >
        <Grid />
        {/* Grid fill */}
        <rect x="0" y="0" width="100%" height="100%" fill="url(#wb-grid-pattern)" />

        {/* Shapes layer (in page space via transform group) */}
        <g id="wb-shapes" style={{ transform: `scale(${camera.z}) translate(${-camera.x}px, ${-camera.y}px)` }}>
          {(shapeIds ?? []).map((id: ShapeId) => (
            <ShapeLayer key={id} id={id} />
          ))}
          <BindingPreviewOverlay />
          <MarqueeOverlay />
        </g>

        {/* Selection overlay in a separate group with pointer events enabled
            so resize/rotation handles receive clicks. Shapes above are non-interactive. */}
        <g
          id="wb-selection-group"
          style={{
            transform: `scale(${camera.z}) translate(${-camera.x}px, ${-camera.y}px)`,
            pointerEvents: 'auto',
          }}
        >
          <SelectionLayer />
        </g>
      </svg>

      {/* Inline editor is rendered by WhiteboardApp as a sibling, outside pointer capture */}
    </div>
  );
}
