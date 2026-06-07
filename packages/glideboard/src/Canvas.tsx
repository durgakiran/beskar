import React, { memo, useCallback, useEffect, useRef } from 'react';
import { effect } from '@preact/signals';
import type {
  GlideShape,
  ShapeId,
  Vec2,
  LabelProps,
} from '@durgakiran/glideline';
import { FONT_FAMILIES } from '@durgakiran/glideline';
import { readOnlySignal, wbEditor } from './editor';
import { MarqueeOverlay, SelectionLayer } from './SelectionLayer';
import { wbTheme } from './theme';
import { useSignalValue } from './useSignalValue';

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Grid (background SVG only)
// ─────────────────────────────────────────────────────────────

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
        <circle cx={dotR} cy={dotR} r={dotR} fill={wbTheme.grid} />
      </pattern>
    </defs>
  );
}

// ─────────────────────────────────────────────────────────────
// Binding Preview Overlay (now in overlay SVG, world coords)
// ─────────────────────────────────────────────────────────────

const BINDING_PREVIEW_STROKE = '#a6e3a1';
const BINDING_SOURCE_PREVIEW_STROKE = '#74c7ec';

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
            fill={wbTheme.selectionFill}
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
          stroke={wbTheme.selectionFill}
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

// ─────────────────────────────────────────────────────────────
// ShapeLayer — one HTML div per shape
// ─────────────────────────────────────────────────────────────

const ShapeLayer = memo(({ id, zIndex }: { id: ShapeId; zIndex: number }) => {
  const sig = wbEditor.store.getSignal(id);
  const shape = useSignalValue(sig as any) as GlideShape | null;
  const divRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const editingId = useSignalValue(wbEditor.editingShapeId);
  const erasingIds = useSignalValue(wbEditor.erasingShapeIds);
  const camera = useSignalValue(wbEditor.camera.signal)!;
  const readOnly = useSignalValue(readOnlySignal) ?? false;
  const isErasing = erasingIds ? erasingIds.has(id) : false;
  const isEditing = editingId === id;

  // Visibility culling
  useEffect(() => {
    if (!shape || !divRef.current) return;
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
    divRef.current.style.display = visible ? '' : 'none';
  }, [shape, camera]);

  // Inject toSvg() geometry output into the per-shape <svg>
  useEffect(() => {
    if (!svgRef.current || !shape) return;
    const util = wbEditor.getShapeUtil(shape.type);
    if ((util as any).toSvg) {
      const el = (util as any).toSvg(shape);
      svgRef.current.innerHTML = '';
      if (el) {
        const defs = el.querySelector('defs');
        if (defs) {
          svgRef.current.appendChild(defs);
        }
        svgRef.current.appendChild(el);
      }
    }
  }, [shape]);

  // Auto-focus label div when editing starts
  useEffect(() => {
    if (isEditing && labelRef.current) {
      labelRef.current.focus();
      // Move cursor to end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(labelRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [isEditing]);

  const util = shape ? wbEditor.getShapeUtil(shape.type) : null;
  const labelProps: LabelProps | null = (shape && util) ? ((util as any).getLabelProps?.(shape) ?? null) : null;

  // Keep contenteditable text content in sync manually (prevents React conflicts on re-render)
  const lastTextRef = useRef<string | undefined>(labelProps?.text);
  useEffect(() => {
    if (labelRef.current && labelProps) {
      if (!isEditing || lastTextRef.current !== labelProps.text) {
        labelRef.current.textContent = labelProps.text;
        lastTextRef.current = labelProps.text;
      }
    }
  }, [labelProps?.text, isEditing]);

  if (!shape || !util) return null;

  const isTextType = shape.type === 'text';
  const hasFixedWidth = isTextType && typeof (shape.props as any).w === 'number';

  const localBounds = util.getGeometry(shape as any).getBounds();
  const cx = localBounds.minX + localBounds.w / 2;
  const cy = localBounds.minY + localBounds.h / 2;
  const angleDeg = ((shape.rotation || 0) * 180) / Math.PI;
  const screenX = (shape.x - camera.x) * camera.z;
  const screenY = (shape.y - camera.y) * camera.z;

  const commitEdit = (text: string) => {
    const key = shape.type === 'sticky-note' ? 'text' : shape.type === 'text' ? 'text' : 'label';
    if (shape.type === 'text' && text.trim() === '') {
      wbEditor.history.batch('Delete Empty Text', () => {
        wbEditor.deleteShapes([id]);
      });
    } else {
      wbEditor.history.batch('Edit Text', () => {
        wbEditor.updateShape(id, { props: { ...shape.props, [key]: text } });
      });
    }
    wbEditor.stopEditing(true);
  };

  const handleLabelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      commitEdit(event.currentTarget.textContent ?? '');
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      wbEditor.stopEditing(true);
    }
  };

  return (
    <div
      ref={divRef}
      id={`wb-shape-${id}`}
      data-shape-id={id}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: localBounds.w,
        height: localBounds.h,
        transform: `translate(${screenX}px, ${screenY}px) scale(${camera.z}) translate(${cx}px, ${cy}px) rotate(${angleDeg}deg) translate(${-cx}px, ${-cy}px)`,
        transformOrigin: '0 0',
        zIndex,
        pointerEvents: 'none',
        opacity: isErasing ? 0.4 : 1,
      }}
    >
      {/* Geometry: 1×1px SVG with overflow:visible — contains toSvg() output */}
      <svg
        ref={svgRef}
        style={{
          overflow: 'visible',
          width: 1,
          height: 1,
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />

      {/* Erase overlay */}
      {isErasing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: '#f38ba8',
            opacity: 0.35,
            borderRadius: 2,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Label: native HTML div */}
      {labelProps && (
        <div
          ref={labelRef}
          contentEditable={isEditing && !readOnly ? true : undefined}
          suppressContentEditableWarning
          onBlur={isEditing ? (e) => commitEdit(e.currentTarget.textContent ?? '') : undefined}
          onKeyDown={isEditing ? handleLabelKeyDown : undefined}
          style={{
            position: 'absolute',
            left: labelProps.padding,
            top: labelProps.padding,
            right: (isTextType && isEditing && !hasFixedWidth) ? undefined : labelProps.padding,
            bottom: (isTextType && isEditing) ? undefined : labelProps.padding,
            width: (isTextType && isEditing && !hasFixedWidth) ? 'max-content' : '100%',
            height: (isTextType && isEditing) ? 'auto' : '100%',
            fontFamily: labelProps.fontFamily,
            fontSize: labelProps.fontSize,
            color: labelProps.color,
            background: labelProps.background ?? 'transparent',
            textAlign: labelProps.textAlign,
            display: 'flex',
            flexDirection: 'column',
            alignItems: labelProps.textAlign === 'left' ? 'flex-start' : labelProps.textAlign === 'right' ? 'flex-end' : 'center',
            justifyContent: labelProps.verticalAlign === 'center' ? 'center' : 'flex-start',
            pointerEvents: isEditing && !readOnly ? 'auto' : 'none',
            userSelect: isEditing ? 'text' : 'none',
            overflow: isEditing ? 'visible' : 'hidden',
            whiteSpace: (isTextType && !hasFixedWidth) ? 'pre' : 'pre-wrap',
            wordBreak: 'break-word',
            outline: 'none',
            cursor: isEditing ? 'text' : 'inherit',
            boxSizing: 'border-box',
            lineHeight: 1.35,
            minHeight: isEditing ? '1.35em' : undefined,
            minWidth: isEditing ? (isTextType ? '150px' : '2ch') : undefined,
          }}
        />
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
// Canvas
// ─────────────────────────────────────────────────────────────

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

  const cameraTransform = `scale(${camera.z}) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <div
      ref={containerRef}
      id="wb-canvas"
      tabIndex={0}
      style={{
        flex: 1,
        position: 'relative',
        background: wbTheme.canvasBg,
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
      {/* 1. Background grid SVG — no shapes */}
      <svg
        id="wb-bg"
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
      </svg>

      {/* 2. HTML shape layer — one div per shape */}
      <div
        id="wb-shapes"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
        }}
      >
        {(shapeIds ?? []).map((id: ShapeId, index: number) => (
          <ShapeLayer key={id} id={id} zIndex={index + 1} />
        ))}
      </div>

      {/* 3. Overlay SVG — selection handles, marquee, binding preview */}
      <svg
        id="wb-overlay"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        <g
          id="wb-selection-group"
          style={{
            transform: cameraTransform,
            pointerEvents: 'auto',
          }}
        >
          <SelectionLayer />
          <BindingPreviewOverlay />
          <MarqueeOverlay />
        </g>
      </svg>
    </div>
  );
}
