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
import { wbEditor } from './editor';
import { useSignalValue } from '../useSignalValue';
import type { ShapeId, GlideShape } from '../../../glideline/src/types';
import type { ResizeHandle } from '../../../glideline/src/tools/SelectTool';
import { STICKY_COLORS } from '../../../glideline/src/shapes/StickyNoteUtil';

// ── Constants ────────────────────────────────────────────────

const HANDLE_SIZE = 8;
const ROTATION_HANDLE_OFFSET = 28; // px above top edge

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
  const isErasing = erasingIds ? erasingIds.has(id) : false;

  // Visibility culling via effect
  useEffect(() => {
    return effect(() => {
      if (!shape) return;
      const util = wbEditor.getShapeUtil(shape.type);
      const bounds = util.getGeometry(shape as any);
      const vp = wbEditor.getViewportBounds();
      const visible =
        bounds.maxX >= vp.minX && bounds.minX <= vp.maxX &&
        bounds.maxY >= vp.minY && bounds.minY <= vp.maxY;
      if (gRef.current) gRef.current.style.display = visible ? '' : 'none';
    });
  }, [shape?.id]);

  // Render shape SVG
  useEffect(() => {
    if (!contentRef.current || !shape) return;
    // Dim shape while editing (textarea overlay takes over visually)
    if (editingId === id) {
      contentRef.current.style.opacity = '0.3';
    } else {
      contentRef.current.style.opacity = '1';
    }
    const util = wbEditor.getShapeUtil(shape.type);
    if ((util as any).toSvg) {
      const el = (util as any).toSvg(shape);
      contentRef.current.innerHTML = '';
      if (el) contentRef.current.appendChild(el);
    }
  });

  if (!shape) return null;

  // Compute geometry to find center for rotation
  const util = wbEditor.getShapeUtil(shape.type);
  const bounds = util.getGeometry(shape as any);
  const cx = bounds.minX + bounds.w / 2;
  const cy = bounds.minY + bounds.h / 2;
  const angleDeg = ((shape.rotation || 0) * 180) / Math.PI;

  return (
    <g
      ref={gRef}
      id={`wb-shape-${id}`}
      data-shape-id={id}
      style={{ opacity: isErasing ? 0.4 : 1 }}
      transform={`rotate(${angleDeg}, ${cx}, ${cy})`}
    >
      <g ref={contentRef} />
      {/* Red tint overlay shown while the eraser is dragging over this shape */}
      {isErasing && bounds && (
        <rect
          x={bounds.minX} y={bounds.minY}
          width={bounds.w} height={bounds.h}
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

// ── Selection overlay (SVG) ───────────────────────────────────

interface OverlayBounds {
  minX: number; minY: number; maxX: number; maxY: number;
  w: number; h: number; rotation: number;
}

function SelectionOverlay() {
  const selectedIds = useSignalValue(wbEditor.getSelectionSignal());
  const camera = useSignalValue(wbEditor.camera.signal)!;
  // Reactively track selected shape positions using preact/signals effect.
  // getShape() uses peek() so we need effect() to subscribe to each shape signal.
  const [boxes, setBoxes] = useState<OverlayBounds[]>([]);

  useEffect(() => {
    if (!selectedIds || selectedIds.length === 0) {
      setBoxes([]);
      return;
    }
    // effect() from @preact/signals automatically tracks any .value reads inside.
    // When a shape moves (store signal changes), this re-runs and updates React state.
    return effect(() => {
      const next: OverlayBounds[] = [];
      for (const id of selectedIds) {
        const sig = wbEditor.store.getSignal(id);
        if (!sig) continue;
        const shape = sig.value as GlideShape | null; // reactive read
        if (!shape) continue;
        const util = wbEditor.getShapeUtil(shape.type);
        const b = util.getGeometry(shape as any);
        next.push({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, w: b.w, h: b.h, rotation: shape.rotation ?? 0 });
      }
      setBoxes(next);
    });
  }, [selectedIds]);

  if (!selectedIds || selectedIds.length === 0 || boxes.length === 0) return null;

  // Text shapes auto-size from content and have no w/h props — skip handles for them
  const allText = selectedIds.every(id => wbEditor.getShape(id)?.type === 'text');

  // Union bounding box of all selected shapes
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

  // In page coords — the SVG transform takes care of camera
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

  const hs = HANDLE_SIZE / camera.z; // handle size in page coords

  return (
    <g id="wb-selection-overlay" transform={transform}>
      {/* Bounding rect */}
      <rect
        x={minX} y={minY} width={W} height={H}
        fill="none" stroke="#89b4fa" strokeWidth={1 / camera.z}
        strokeDasharray={`${4 / camera.z} ${2 / camera.z}`}
        pointerEvents="none"
      />

      {/* Resize + rotation handles: hidden for text shapes (auto-size from content) */}
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

// ── Marquee overlay ───────────────────────────────────────────

function MarqueeOverlay() {
  const camera = useSignalValue(wbEditor.camera.signal)!;
  // Read marquee rect from the select tool's MarqueeSelecting state
  const selectTool = wbEditor.getCurrentTool();
  const marqueeState = (selectTool as any)._childMap?.get('marqueeSelecting');
  const rect = marqueeState?.marqueeRect;

  if (!rect) return null;

  return (
    <rect
      x={rect.minX} y={rect.minY}
      width={rect.maxX - rect.minX} height={rect.maxY - rect.minY}
      fill="#89b4fa11" stroke="#89b4fa"
      strokeWidth={1 / camera.z}
      strokeDasharray={`${3 / camera.z} ${2 / camera.z}`}
      pointerEvents="none"
    />
  );
}

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
  const bounds = util.getGeometry(shape as any);
  const topLeft = wbEditor.pageToScreen({ x: bounds.minX, y: bounds.minY });
  const w = bounds.w * camera.z;
  const h = bounds.h * camera.z;

  const key = 'text' in (shape.props as any) ? 'text' : 'label';
  const text: string = (shape.props as any)[key] ?? '';

  /** Write text to shape immediately (no history) so SVG + selection update live. */
  const liveUpdate = (newText: string) => {
    wbEditor.history.batch('Edit Text Preview', () => {
      wbEditor.updateShape(editingId, { props: { ...(shape.props as any), [key]: newText } });
    }, { history: 'ignore' });
  };

  const commit = (newText: string) => {
    if (newText.trim() === '') {
      wbEditor.history.batch('Delete Empty Text', () => {
        wbEditor.deleteShapes([editingId]);
      });
    } else {
      wbEditor.history.batch('Edit Text', () => {
        wbEditor.updateShape(editingId, { props: { ...(shape.props as any), [key]: newText } });
      });
    }
    wbEditor.stopEditing();
  };

  // Background colour for sticky notes
  let bg = 'rgba(30,30,46,0.85)';
  if (shape.type === 'sticky-note') {
    bg = STICKY_COLORS[(shape.props as any).color] ?? bg;
  }

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
        padding: shape.type === 'sticky-note' ? 12 : 0,
        transform: `rotate(${((shape.rotation || 0) * 180) / Math.PI}deg)`,
      }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => liveUpdate(e.currentTarget.value)}
        onBlur={e => commit(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') { wbEditor.stopEditing(); e.stopPropagation(); }
          if (e.key === 'Enter' && !e.shiftKey && shape.type !== 'sticky-note') {
            commit(e.currentTarget.value);
            e.preventDefault();
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          background: bg,
          color: (shape.props as any).textColor ?? (shape.props as any).labelColor ?? '#cdd6f4',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: Math.max(11, (typeof (shape.props as any).fontSize === 'number'
            ? (shape.props as any).fontSize
            : ((shape.props as any).fontSize === 'xl' ? 32 : (shape.props as any).fontSize === 'lg' ? 22 : (shape.props as any).fontSize === 'md' ? 16 : 12)) * camera.z),
          padding: 0,
          boxSizing: 'border-box',
          textAlign: (shape.props as any).textAlign ?? 'left',
          whiteSpace: shape.type === 'text' ? 'pre' : 'pre-wrap',
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
      const sel = wbEditor.getSelectedShapeIds();
      if (handleId === 'rotate') {
        // Rotation handle
        const boxes = sel.map(id => {
          const s = wbEditor.getShape(id); if (!s) return null;
          return wbEditor.getShapeUtil(s.type).getGeometry(s as any);
        }).filter(Boolean) as any[];
        const minX = Math.min(...boxes.map((b: any) => b.minX));
        const minY = Math.min(...boxes.map((b: any) => b.minY));
        const maxX = Math.max(...boxes.map((b: any) => b.maxX));
        const maxY = Math.max(...boxes.map((b: any) => b.maxY));
        const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
        const startAngle = Math.atan2(page.y - center.y, page.x - center.x);
        const initRot = new Map(sel.map(id => {
          const s = wbEditor.getShape(id);
          return [id, s?.rotation ?? 0] as [ShapeId, number];
        }));
        wbEditor.setCurrentTool('select');
        wbEditor.dispatchEvent({ type: 'pointerDown', point: page, shiftKey: e.shiftKey, target: 'canvas' });
        // Directly transition to draggingRotation
        const tool = wbEditor.getCurrentTool();
        (tool as any).transition('draggingRotation', { shapeIds: sel, center, initialRotation: initRot, startAngle });
      } else {
        // Resize handle
        const initialGeom = new Map(sel.map(id => {
          const s = wbEditor.getShape(id); if (!s) return null;
          const b = wbEditor.getShapeUtil(s.type).getGeometry(s as any);
          return [id, { x: s.x, y: s.y, w: b.w, h: b.h }] as [ShapeId, { x: number; y: number; w: number; h: number }];
        }).filter(Boolean) as [ShapeId, { x: number; y: number; w: number; h: number }][]);
        const tool = wbEditor.getCurrentTool();
        (tool as any).transition('draggingResize', {
          shapeIds: sel, handle: handleId as ResizeHandle,
          origin: page, initialGeom,
        });
      }
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

    if (e.key === 'Backspace' || e.key === 'Delete') {
      const ids = wbEditor.getSelectedShapeIds();
      if (ids.length > 0) wbEditor.deleteShapes(ids);
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      if (e.shiftKey) wbEditor.history.redo();
      else wbEditor.history.undo();
    } else if (e.key === 'd' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const ids = wbEditor.getSelectedShapeIds();
      if (ids.length > 0) {
        const newIds = wbEditor.duplicateShapes(ids, { x: 20, y: 20 });
        wbEditor.setSelectedShapeIds(newIds);
      }
    } else {
      wbEditor.dispatchEvent({ type: 'keyDown', key: e.key } as any);
    }
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
          <SelectionOverlay />
        </g>
      </svg>

      {/* Inline editor is rendered by WhiteboardApp as a sibling, outside pointer capture */}
    </div>
  );
}
