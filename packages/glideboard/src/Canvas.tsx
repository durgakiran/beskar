import React, { memo, useCallback, useEffect, useRef } from 'react';
import { effect } from '@preact/signals';
import type {
  GlideShape,
  ShapeId,
  Vec2,
  LabelProps,
} from '@durgakiran/glideline';
import { FONT_FAMILIES } from '@durgakiran/glideline';
import { CanvasOverlays, getHandleAtPagePoint, getCursorForHandle } from './CanvasOverlays';
import { useGlideboardController } from './GlideboardContext';
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
  const controller = useGlideboardController();
  const camera = useSignalValue(controller.editor.camera.signal)!;
  const spacing = 24 * camera.z;
  const dotR = 1;
  const ox = ((-camera.x * camera.z) % spacing + spacing) % spacing;
  const oy = ((-camera.y * camera.z) % spacing + spacing) % spacing;

  return (
    <defs>
      <pattern
        id={controller.domId('grid-pattern')}
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
// ShapeLayer — one HTML div per shape
// ─────────────────────────────────────────────────────────────

const ShapeLayer = memo(({ id, zIndex }: { id: ShapeId; zIndex: number }) => {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const sig = editor.getShapeSignal(id);
  const shape = useSignalValue(sig as any) as GlideShape | null;
  const divRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const editingId = useSignalValue(editor.editingShapeId);
  const erasingIds = useSignalValue(editor.erasingShapeIds);
  const camera = useSignalValue(editor.camera.signal)!;
  const readOnly = useSignalValue(controller.readOnlySignal) ?? false;
  const isErasing = erasingIds ? erasingIds.has(id) : false;
  const isEditing = editingId === id;

  // Visibility culling
  useEffect(() => {
    if (!shape || !divRef.current) return;
    const localBounds = editor.getShapeUtil(shape.type).getGeometry(shape as any).getBounds();
    const viewport = editor.getViewportBounds();
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
  }, [editor, shape, camera]);

  // Inject toSvg() geometry output into the per-shape <svg>
  useEffect(() => {
    if (!svgRef.current || !shape) return;
    const util = editor.getShapeUtil(shape.type);
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
  }, [editor, shape]);

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

  const util = shape ? editor.getShapeUtil(shape.type) : null;
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
      editor.history.batch('Delete Empty Text', () => {
        editor.deleteShapes([id]);
      });
    } else {
      editor.history.batch('Edit Text', () => {
        editor.updateShape(id, { props: { ...shape.props, [key]: text } });
      });
    }
    editor.stopEditing(true);
  };

  const handleLabelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      commitEdit(event.currentTarget.textContent ?? '');
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      editor.stopEditing(true);
    }
  };

  return (
    <div
      ref={divRef}
      id={controller.domId(`shape-${id}`)}
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
  const controller = useGlideboardController();
  const editor = controller.editor;
  const shapeIds = useSignalValue(editor.getShapeIdsSignal())!;
  const camera = useSignalValue(editor.camera.signal)!;
  const readOnly = useSignalValue(controller.readOnlySignal) ?? false;
  const containerRef = useRef<HTMLDivElement>(null);
  const preventFocusStealRef = useRef(false);
  const isMiddleDraggingRef = useRef(false);
  const originalToolBeforeMiddleDragRef = useRef<string | null>(null);
  const isPointerDownRef = useRef(false);
  const activeTool = useSignalValue(editor.currentToolId);

  useEffect(() => {
    if (!readOnly) return;
    isMiddleDraggingRef.current = false;
    originalToolBeforeMiddleDragRef.current = null;
  }, [readOnly]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    controller.setCanvasElement(el);

    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0]!.contentRect;
      editor.camera.setViewportSize(width, height);
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    editor.camera.setViewportSize(rect.width, rect.height);

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = el.getBoundingClientRect();
      const screenPt = { x: event.clientX - box.left, y: event.clientY - box.top };
      const cam = editor.camera.getCamera();

      // Branch 1: Pinch-to-zoom — browsers set ctrlKey=true for trackpad pinch gestures
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.01);
        const newZ = Math.max(0.1, Math.min(8, cam.z * factor));
        const pagePtX = screenPt.x / cam.z + cam.x;
        const pagePtY = screenPt.y / cam.z + cam.y;
        editor.camera.setCamera({
          x: pagePtX - screenPt.x / newZ,
          y: pagePtY - screenPt.y / newZ,
          z: newZ,
        });
        return;
      }

      // Branch 2: Shift+scroll → horizontal pan only
      if (event.shiftKey) {
        editor.camera.setCamera({
          x: cam.x + (event.deltaY + event.deltaX) / cam.z,
        });
        return;
      }

      // Branch 3: Plain scroll / trackpad two-finger swipe → translate camera
      editor.camera.setCamera({
        x: cam.x + event.deltaX / cam.z,
        y: cam.y + event.deltaY / cam.z,
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', handleWheel);
      if (controller.getCanvasElement() === el) {
        controller.setCanvasElement(null);
      }
    };
  }, [controller, editor]);

  const getPagePoint = useCallback((event: React.PointerEvent | React.WheelEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, page: editor.screenToPage(screen) };
  }, [editor]);

  const getShapeAtEvent = useCallback((event: React.PointerEvent) => {
    const { page } = getPagePoint(event);
    const hits = editor.getShapesAtPoint(page);
    return hits.length > 0 ? hits[hits.length - 1] : null;
  }, [editor, getPagePoint]);

  const getHandleAtEvent = useCallback((event: React.PointerEvent) => {
    const { page } = getPagePoint(event);
    return getHandleAtPagePoint(editor, page.x, page.y);
  }, [editor, getPagePoint]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;

    if (event.button === 1) {
      if (readOnly) return;
      event.preventDefault();
      isMiddleDraggingRef.current = true;
      originalToolBeforeMiddleDragRef.current = editor.currentToolId.peek();
      editor.setCurrentTool('hand');
    }

    isPointerDownRef.current = true;
    controller.isCanvasDraggingRef.current = true;
    containerRef.current!.setPointerCapture(event.pointerId);

    const { screen, page } = getPagePoint(event);
    const handleId = readOnly ? null : getHandleAtEvent(event);

    if (handleId && event.button === 0) {
      if (readOnly) return;
      editor.setCurrentTool('select');
      editor.dispatchEvent({
        type: 'pointerDown',
        point: page,
        screenPoint: screen,
        shiftKey: event.shiftKey,
        target: 'handle',
        handleId,
      } as any);
      return;
    }

    const hit = getShapeAtEvent(event);
    const editingBefore = editor.editingShapeId.peek();
    editor.dispatchEvent({
      type: 'pointerDown',
      point: page,
      screenPoint: screen,
      shiftKey: event.shiftKey,
      target: (hit && event.button === 0) ? 'shape' : 'canvas',
      shapeId: (hit && event.button === 0) ? (hit.id as ShapeId) : undefined,
    } as any);
    if (!readOnly && editor.editingShapeId.peek() !== editingBefore) {
      preventFocusStealRef.current = true;
    }
  }, [controller, editor, getHandleAtEvent, getPagePoint, getShapeAtEvent, readOnly]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const { screen, page } = getPagePoint(event);
    const handleId = controller.readOnlySignal.peek()
      ? null
      : getHandleAtPagePoint(editor, page.x, page.y);
    if (containerRef.current) {
      const currentTool = editor.currentToolId.peek();
      if (currentTool === 'hand') {
        containerRef.current.style.cursor = event.buttons === 1 ? 'grabbing' : 'grab';
      } else {
        containerRef.current.style.cursor = handleId ? getCursorForHandle(handleId) : 'default';
      }
    }
    editor.dispatchEvent({ type: 'pointerMove', point: page, screenPoint: screen, shiftKey: event.shiftKey, altKey: event.altKey } as any);
    
    const awareness = controller.awarenessSignal.peek();
    if (awareness) {
      awareness.setLocalStateField('cursor', page);
    }
  }, [controller, editor, getPagePoint]);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    isPointerDownRef.current = false;
    if (containerRef.current?.hasPointerCapture?.(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
    const { screen, page } = getPagePoint(event);
    editor.dispatchEvent({ type: 'pointerUp', point: page, screenPoint: screen, shiftKey: event.shiftKey } as any);

    controller.isCanvasDraggingRef.current = false;

    if (isMiddleDraggingRef.current) {
      isMiddleDraggingRef.current = false;
      const restoreTool = originalToolBeforeMiddleDragRef.current;
      originalToolBeforeMiddleDragRef.current = null;
      if (restoreTool && !controller.readOnlySignal.peek()) {
        controller.setCurrentTool(restoreTool);
      }
    }

    // Restore tool deferred from a spacebar release mid-drag
    const deferredTool = controller.deferredToolRestoreRef.current;
    controller.deferredToolRestoreRef.current = null;
    if (deferredTool && !controller.readOnlySignal.peek()) {
      controller.setCurrentTool(deferredTool);
    }
  }, [controller, editor, getPagePoint]);

  const cancelPointerInteraction = useCallback((pointerId?: number) => {
    if (!isPointerDownRef.current && !editor.interactions.active) return;
    isPointerDownRef.current = false;
    controller.isCanvasDraggingRef.current = false;
    if (pointerId !== undefined && containerRef.current?.hasPointerCapture?.(pointerId)) {
      containerRef.current.releasePointerCapture(pointerId);
    }
    editor.dispatchEvent({ type: 'keyDown', key: 'Escape' } as any);
    if (editor.interactions.active) editor.interactions.cancel();
    isMiddleDraggingRef.current = false;
    originalToolBeforeMiddleDragRef.current = null;
    controller.deferredToolRestoreRef.current = null;
  }, [controller, editor]);

  useEffect(() => {
    const handleWindowBlur = () => cancelPointerInteraction();
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      cancelPointerInteraction();
    };
  }, [cancelPointerInteraction]);

  const onDoubleClick = useCallback((event: React.MouseEvent) => {
    if (readOnly) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const page = editor.screenToPage(screen);
    const hits = editor.getShapesAtPoint(page);
    const hit = hits.length > 0 ? hits[hits.length - 1] : null;
    editor.dispatchEvent({ type: 'doubleClick', point: page, shapeId: hit?.id as ShapeId | undefined } as any);
  }, [editor, readOnly]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (readOnly || editor.editingShapeId.peek()) return;
    editor.dispatchEvent({ type: 'keyDown', key: event.key } as any);
  }, [editor, readOnly]);

  const onPointerLeave = useCallback(() => {
    const awareness = controller.awarenessSignal.peek();
    if (awareness) {
      awareness.setLocalStateField('cursor', null);
    }
  }, [controller]);

  // Sync canvas cursor when active tool changes (e.g. spacebar activates hand tool)
  useEffect(() => {
    if (!containerRef.current) return;
    if (activeTool === 'hand') {
      containerRef.current.style.cursor = 'grab';
    } else {
      containerRef.current.style.cursor = 'default';
    }
  }, [activeTool]);

  const cameraTransform = `scale(${camera.z}) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <div
      ref={containerRef}
      id={controller.domId('canvas')}
      data-glideboard-role="canvas"
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
      onPointerCancel={event => cancelPointerInteraction(event.pointerId)}
      onLostPointerCapture={event => cancelPointerInteraction(event.pointerId)}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onMouseDown={event => {
        if (event.button === 1) {
          event.preventDefault();
        }
        if (preventFocusStealRef.current) {
          preventFocusStealRef.current = false;
          event.preventDefault();
        }
      }}
    >
      {/* 1. Background grid SVG — no shapes */}
      <svg
        id={controller.domId('background')}
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
        <rect x="0" y="0" width="100%" height="100%" fill={`url(#${controller.domId('grid-pattern')})`} />
      </svg>

      {/* 2. HTML shape layer — one div per shape */}
      <div
        id={controller.domId('shapes')}
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

      {/* 3. Overlay Canvas — selection handles, marquee, binding preview */}
      <CanvasOverlays />
    </div>
  );
}
