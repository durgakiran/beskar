import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { effect } from '@preact/signals';
import {
  FONT_FAMILIES,
  FONT_SIZES,
  STICKY_COLORS,
  type GlideShape,
  type ShapeId,
  type Vec2,
} from '@durgakiran/glideline';
import { readOnlySignal, wbEditor } from './editor';
import { MarqueeOverlay, SelectionLayer } from './SelectionLayer';
import { useSignalValue } from './useSignalValue';

const HANDLE_SIZE = 8;
const SELECTION_HIGHLIGHT_STROKE = '#89b4fa';
const BINDING_PREVIEW_STROKE = '#a6e3a1';
const BINDING_SOURCE_PREVIEW_STROKE = '#74c7ec';

function pointsToSvgPath(points: Vec2[], closed = false): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let path = `M ${first.x} ${first.y}`;
  for (const point of rest) {
    path += ` L ${point.x} ${point.y}`;
  }
  if (closed) path += ' Z';
  return path;
}

function renderGeometryOutline(
  shape: GlideShape,
  stroke: string,
  fill: string,
  strokeWidth: number,
  opacity: number,
) {
  const geometry = wbEditor.getShapeUtil(shape.type).getGeometry(shape as any);
  const outline = geometry.getOutline();

  return (
    <path
      d={pointsToSvgPath(outline, shape.type !== 'arrow' && shape.type !== 'freehand')}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
      opacity={opacity}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

function renderSelectionHighlight(shape: GlideShape, isSelected: boolean) {
  if (!isSelected) return null;
  return renderGeometryOutline(shape, SELECTION_HIGHLIGHT_STROKE, 'none', 2, 0.95);
}

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
        x={ox}
        y={oy}
        width={spacing}
        height={spacing}
        patternUnits="userSpaceOnUse"
      >
        <circle cx={dotR} cy={dotR} r={dotR} fill="#313244" />
      </pattern>
    </defs>
  );
}

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

  useEffect(() => {
    return effect(() => {
      if (!shape) return;
      const localBounds = wbEditor.getShapeUtil(shape.type).getGeometry(shape as any).getBounds();
      const viewport = wbEditor.getViewportBounds();
      const worldMinX = localBounds.minX + shape.x;
      const worldMinY = localBounds.minY + shape.y;
      const worldMaxX = localBounds.maxX + shape.x;
      const worldMaxY = localBounds.maxY + shape.y;
      const visible =
        worldMaxX >= viewport.minX &&
        worldMinX <= viewport.maxX &&
        worldMaxY >= viewport.minY &&
        worldMinY <= viewport.maxY;
      if (gRef.current) gRef.current.style.display = visible ? '' : 'none';
    });
  }, [shape?.id]);

  useEffect(() => {
    if (!contentRef.current || !shape) return;
    contentRef.current.style.opacity = '1';
    const util = wbEditor.getShapeUtil(shape.type);
    if ((util as any).toSvg) {
      const el = (util as any).toSvg(shape);
      contentRef.current.innerHTML = '';
      if (el) contentRef.current.appendChild(el);
      if (editingId === id) {
        const foreignObjects = contentRef.current.querySelectorAll('foreignObject');
        foreignObjects.forEach(node => {
          (node as unknown as SVGElement).style.opacity = '0';
        });
      }
    }
  });

  if (!shape) return null;

  const localBounds = wbEditor.getShapeUtil(shape.type).getGeometry(shape as any).getBounds();
  const cx = localBounds.minX + localBounds.w / 2;
  const cy = localBounds.minY + localBounds.h / 2;
  const angleDeg = ((shape.rotation || 0) * 180) / Math.PI;

  return (
    <g
      ref={gRef}
      id={`wb-shape-${id}`}
      data-shape-id={id}
      style={{ opacity: isErasing ? 0.4 : 1 }}
      transform={`translate(${shape.x}, ${shape.y}) rotate(${angleDeg}, ${cx}, ${cy})`}
    >
      <g ref={contentRef} />
      {renderSelectionHighlight(shape, isSelected)}
      {isErasing ? (
        <rect
          x={localBounds.minX}
          y={localBounds.minY}
          width={localBounds.w}
          height={localBounds.h}
          fill="#f38ba8"
          fillOpacity={0.35}
          stroke="#f38ba8"
          strokeWidth={2}
          strokeOpacity={0.8}
          pointerEvents="none"
          rx={2}
        />
      ) : null}
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
    const localBounds = wbEditor.getShapeUtil(shape.type).getGeometry(shape as any).getBounds();
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

  return (
    <>
      {preview.sourceCandidate && sourceShape
        ? renderCandidate(
            sourceShape,
            preview.sourceCandidate,
            'wb-binding-preview-source',
            BINDING_SOURCE_PREVIEW_STROKE,
            'rgba(116, 199, 236, 0.1)',
            2,
            5,
            7,
          )
        : null}
      {renderCandidate(
        activeShape,
        preview,
        'wb-binding-preview-target',
        BINDING_PREVIEW_STROKE,
        'rgba(166, 227, 161, 0.12)',
        2,
        5,
        7,
      )}
    </>
  );
}

export function InlineEditor() {
  const editingId = useSignalValue(wbEditor.editingShapeId);
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const readOnly = useSignalValue(readOnlySignal) ?? false;
  const sig = editingId ? wbEditor.store.getSignal(editingId) : undefined;
  const shape = useSignalValue(sig as any) as GlideShape | null;
  const [text, setText] = useState('');

  useEffect(() => {
    if (!shape) return;
    const key = shape.type === 'text' ? 'text' : 'label';
    setText(String(shape.props[key] ?? ''));
  }, [shape]);

  if (readOnly || !editingId || !shape) return null;

  const key = shape.type === 'text' ? 'text' : 'label';
  const localBounds = wbEditor.getShapeUtil(shape.type).getGeometry(shape as any).getBounds();
  const worldMinX = shape.x + localBounds.minX;
  const worldMinY = shape.y + localBounds.minY;
  const topLeft = wbEditor.pageToScreen({ x: worldMinX, y: worldMinY });
  const width = localBounds.w * camera.z;
  const height = Math.max(localBounds.h * camera.z, 32);

  const style = shape.type === 'sticky-note'
    ? {
        fontFamily: FONT_FAMILIES[(shape.props.font as keyof typeof FONT_FAMILIES) ?? 'sans'],
        fontSize: FONT_SIZES[(shape.props.fontSize as keyof typeof FONT_SIZES) ?? 'md'] * camera.z,
        color: String(shape.props.labelColor ?? '#1e1e2e'),
        background: STICKY_COLORS[String(shape.props.color ?? 'yellow') as keyof typeof STICKY_COLORS] ?? '#f9e2af',
        textAlign: String(shape.props.textAlign ?? 'left') as React.CSSProperties['textAlign'],
      }
    : shape.type === 'text'
      ? {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: Number(shape.props.fontSize ?? 16) * camera.z,
          color: String(shape.props.color ?? '#cdd6f4'),
          background: 'transparent',
          textAlign: 'left' as React.CSSProperties['textAlign'],
        }
      : {
          fontFamily: FONT_FAMILIES[(shape.props.font as keyof typeof FONT_FAMILIES) ?? 'sans'],
          fontSize: FONT_SIZES[(shape.props.fontSize as keyof typeof FONT_SIZES) ?? 'md'] * camera.z,
          color: String(shape.props.labelColor ?? '#111827'),
          background: 'transparent',
          textAlign: String(shape.props.textAlign ?? 'center') as React.CSSProperties['textAlign'],
        };

  const commit = (nextText: string) => {
    if (shape.type === 'text' && nextText.trim() === '') {
      wbEditor.history.batch('Delete Empty Text', () => {
        wbEditor.deleteShapes([editingId]);
      });
    } else {
      wbEditor.history.batch('Edit Text', () => {
        wbEditor.updateShape(editingId, {
          props: { ...shape.props, [key]: nextText },
        });
      });
    }
    wbEditor.stopEditing();
  };

  return (
    <textarea
      autoFocus
      value={text}
      onChange={event => {
        const nextText = event.target.value;
        setText(nextText);
        wbEditor.history.batch('Edit Text Preview', () => {
          wbEditor.updateShape(editingId, {
            props: { ...shape.props, [key]: nextText },
          });
        });
      }}
      onBlur={() => commit(text)}
      onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          commit(text);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          wbEditor.stopEditing();
        }
      }}
      style={{
        position: 'absolute',
        left: topLeft.x,
        top: topLeft.y,
        width,
        height,
        border: '1px solid #89b4fa',
        outline: 'none',
        resize: 'none',
        padding: shape.type === 'sticky-note' ? 12 : 4,
        boxSizing: 'border-box',
        borderRadius: shape.type === 'sticky-note' ? 10 : 4,
        lineHeight: 1.35,
        zIndex: 200,
        ...style,
      }}
    />
  );
}

export function Canvas() {
  const shapeIds = useSignalValue(wbEditor.store.getShapeIdsSignal())!;
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const readOnly = useSignalValue(readOnlySignal) ?? false;
  const containerRef = useRef<HTMLDivElement>(null);
  const preventFocusStealRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0]!.contentRect;
      wbEditor.camera.setViewportSize(width, height);
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    wbEditor.camera.setViewportSize(rect.width, rect.height);

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = el.getBoundingClientRect();
      const screenPt = { x: event.clientX - box.left, y: event.clientY - box.top };
      const cam = wbEditor.camera.getCamera();

      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        wbEditor.camera.setCamera({ x: cam.x + (event.deltaY + event.deltaX) / cam.z });
        return;
      }

      const rawDelta = event.ctrlKey || event.metaKey ? event.deltaY : event.deltaY * 0.5;
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

  const getPagePoint = useCallback((event: React.PointerEvent | React.WheelEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, page: wbEditor.screenToPage(screen) };
  }, []);

  const getShapeAtEvent = useCallback((event: React.PointerEvent) => {
    const { page } = getPagePoint(event);
    const hits = wbEditor.getShapesAtPoint(page);
    return hits.length > 0 ? hits[hits.length - 1] : null;
  }, [getPagePoint]);

  const getHandleAtEvent = useCallback((event: React.PointerEvent) => {
    const target = event.target as SVGElement;
    return target.getAttribute('data-handle');
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    containerRef.current!.setPointerCapture(event.pointerId);

    const { page } = getPagePoint(event);
    const handleId = getHandleAtEvent(event);

    if (handleId) {
      if (readOnly) return;
      wbEditor.setCurrentTool('select');
      wbEditor.dispatchEvent({
        type: 'pointerDown',
        point: page,
        shiftKey: event.shiftKey,
        target: 'handle',
        handleId,
      } as any);
      return;
    }

    const hit = getShapeAtEvent(event);
    const editingBefore = wbEditor.editingShapeId.peek();
    wbEditor.dispatchEvent({
      type: 'pointerDown',
      point: page,
      shiftKey: event.shiftKey,
      target: hit ? 'shape' : 'canvas',
      shapeId: hit?.id as ShapeId | undefined,
    } as any);
    if (!readOnly && wbEditor.editingShapeId.peek() !== editingBefore) {
      preventFocusStealRef.current = true;
    }
  }, [getHandleAtEvent, getPagePoint, getShapeAtEvent, readOnly]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const { page } = getPagePoint(event);
    wbEditor.dispatchEvent({ type: 'pointerMove', point: page, shiftKey: event.shiftKey, altKey: event.altKey } as any);
  }, [getPagePoint]);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    containerRef.current!.releasePointerCapture(event.pointerId);
    const { page } = getPagePoint(event);
    wbEditor.dispatchEvent({ type: 'pointerUp', point: page, shiftKey: event.shiftKey } as any);
  }, [getPagePoint]);

  const onDoubleClick = useCallback((event: React.MouseEvent) => {
    if (readOnly) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const page = wbEditor.screenToPage(screen);
    const hits = wbEditor.getShapesAtPoint(page);
    const hit = hits.length > 0 ? hits[hits.length - 1] : null;
    wbEditor.dispatchEvent({ type: 'doubleClick', point: page, shapeId: hit?.id as ShapeId | undefined } as any);
  }, [readOnly]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (readOnly || wbEditor.editingShapeId.peek()) return;
    wbEditor.dispatchEvent({ type: 'keyDown', key: event.key } as any);
  }, [readOnly]);

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
      onMouseDown={event => {
        if (preventFocusStealRef.current) {
          preventFocusStealRef.current = false;
          event.preventDefault();
        }
      }}
    >
      <svg
        id="wb-svg"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        <Grid />
        <rect x="0" y="0" width="100%" height="100%" fill="url(#wb-grid-pattern)" />
        <g id="wb-shapes" style={{ transform: `scale(${camera.z}) translate(${-camera.x}px, ${-camera.y}px)` }}>
          {(shapeIds ?? []).map((id: ShapeId) => (
            <ShapeLayer key={id} id={id} />
          ))}
          <BindingPreviewOverlay />
          <MarqueeOverlay />
        </g>
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
    </div>
  );
}
