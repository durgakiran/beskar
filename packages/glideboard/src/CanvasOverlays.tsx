import React, { useEffect, useRef } from 'react';
import { effect } from '@preact/signals';
import {
  getArrowBendHandlePoint,
  type ArrowShape,
  type GlideShape,
  type ResizeHandle,
  type Vec2,
} from '@durgakiran/glideline';
import { wbTheme } from './theme';
import { wbEditor } from './editor';

const HANDLE_SIZE = 8;
const ROTATION_HANDLE_OFFSET = 20;

function resolveColor(color: string): string {
  if (typeof window === 'undefined') return color;
  if (!color.startsWith('var(')) return color;

  const match = color.match(/^var\((--[a-zA-Z0-9-]+)(?:,\s*(.+))?\)$/);
  if (!match) return color;

  const propName = match[1];
  const fallback = match[2];

  const resolved = window.getComputedStyle(document.documentElement || document.body)
    .getPropertyValue(propName)
    .trim();

  if (resolved) return resolved;
  if (fallback) {
    return resolveColor(fallback);
  }
  return color;
}

interface OverlayBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
  rotation: number;
}

function getSelectionData() {
  const selectedIds = wbEditor.getSelectionSignal().value;
  if (!selectedIds || selectedIds.length === 0) return null;

  const boxes: OverlayBounds[] = [];
  const shapes: GlideShape[] = [];
  for (const id of selectedIds) {
    const shape = wbEditor.store.getSignal(id)?.value as GlideShape | null;
    if (!shape) continue;
    const localBounds = wbEditor.getShapeUtil(shape.type).getGeometry(shape as any).getBounds();
    boxes.push({
      minX: localBounds.minX + shape.x,
      minY: localBounds.minY + shape.y,
      maxX: localBounds.maxX + shape.x,
      maxY: localBounds.maxY + shape.y,
      w: localBounds.w,
      h: localBounds.h,
      rotation: shape.rotation ?? 0,
    });
    shapes.push(shape);
  }

  return { boxes, shapes };
}

export function getCursorForHandle(handleId: string): string {
  if (handleId === 'rotate' || handleId === 'bend') {
    return 'grab';
  }
  if (handleId === 'start' || handleId === 'end') {
    return 'crosshair';
  }
  const map: Record<string, string> = {
    nw: 'nw-resize',
    n: 'n-resize',
    ne: 'ne-resize',
    e: 'e-resize',
    se: 'se-resize',
    s: 's-resize',
    sw: 'sw-resize',
    w: 'w-resize',
  };
  return map[handleId] || 'default';
}

export function getHandleAtPagePoint(pageX: number, pageY: number): string | null {
  const selData = getSelectionData();
  if (!selData || selData.boxes.length === 0) return null;

  const { boxes, shapes } = selData;
  const camera = wbEditor.camera.signal.value;
  const zoom = camera.z;

  // Single arrow check
  if (shapes.length === 1 && shapes[0]?.type === 'arrow') {
    const arrow = shapes[0] as ArrowShape;
    const { start, end } = arrow.props;
    const startWorldX = arrow.x + start.point.x;
    const startWorldY = arrow.y + start.point.y;
    const endWorldX = arrow.x + end.point.x;
    const endWorldY = arrow.y + end.point.y;

    // Start handle
    const distStart = Math.hypot((pageX - startWorldX) * zoom, (pageY - startWorldY) * zoom);
    if (distStart <= 8) return 'start';

    // End handle
    const distEnd = Math.hypot((pageX - endWorldX) * zoom, (pageY - endWorldY) * zoom);
    if (distEnd <= 8) return 'end';

    // Bend handle
    const bendPoint = getArrowBendHandlePoint(wbEditor as any, arrow);
    if (bendPoint) {
      const distBend = Math.hypot((pageX - bendPoint.x) * zoom, (pageY - bendPoint.y) * zoom);
      if (distBend <= 8) return 'bend';
    }
    return null;
  }

  // Check if text elements only
  const allText = shapes.every(shape => shape.type === 'text');
  if (allText) return null;

  const minX = Math.min(...boxes.map(box => box.minX));
  const minY = Math.min(...boxes.map(box => box.minY));
  const maxX = Math.max(...boxes.map(box => box.maxX));
  const maxY = Math.max(...boxes.map(box => box.maxY));
  const width = maxX - minX;
  const height = maxY - minY;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const rotation = boxes.length === 1 ? boxes[0]!.rotation : 0;

  const getRotatedPoint = (px: number, py: number) => {
    if (boxes.length !== 1 || rotation === 0) {
      return { x: px, y: py };
    }
    const dx = px - cx;
    const dy = py - cy;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  };

  // Rotate handle
  let showRotate = true;
  let showResize = true;
  if (boxes.length === 1) {
    const util = wbEditor.getShapeUtil(shapes[0]!.type);
    showRotate = !util.hideRotateHandle(shapes[0] as any);
    showResize = !util.hideResizeHandles(shapes[0] as any);
  }

  if (showRotate && boxes.length === 1) {
    const rotateWorld = getRotatedPoint(cx, minY - ROTATION_HANDLE_OFFSET / zoom);
    const distRotate = Math.hypot((pageX - rotateWorld.x) * zoom, (pageY - rotateWorld.y) * zoom);
    if (distRotate <= 8) return 'rotate';
  }

  // Resize handles
  if (showResize) {
    const handles: { id: ResizeHandle; px: number; py: number }[] = [
      { id: 'nw', px: minX, py: minY },
      { id: 'n', px: cx, py: minY },
      { id: 'ne', px: maxX, py: minY },
      { id: 'e', px: maxX, py: minY + height / 2 },
      { id: 'se', px: maxX, py: maxY },
      { id: 's', px: cx, py: maxY },
      { id: 'sw', px: minX, py: maxY },
      { id: 'w', px: minX, py: minY + height / 2 },
    ];

    for (const h of handles) {
      const rotated = getRotatedPoint(h.px, h.py);
      const dist = Math.hypot((pageX - rotated.x) * zoom, (pageY - rotated.y) * zoom);
      if (dist <= 8) return h.id;
    }
  }

  return null;
}

function drawGeometryOutline(
  ctx: CanvasRenderingContext2D,
  shape: GlideShape,
  stroke: string,
  fill: string,
  strokeWidth: number,
  zoom: number,
) {
  const geometry = wbEditor.getShapeUtil(shape.type).getGeometry(shape as any);
  const outline = geometry.getOutline();
  if (outline.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(outline[0].x, outline[0].y);
  for (let i = 1; i < outline.length; i++) {
    ctx.lineTo(outline[i].x, outline[i].y);
  }
  if (shape.type !== 'arrow' && shape.type !== 'freehand') {
    ctx.closePath();
  }

  ctx.lineWidth = strokeWidth / zoom;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = resolveColor(stroke);
  ctx.fillStyle = resolveColor(fill);

  if (fill !== 'transparent') {
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

function drawCandidate(
  ctx: CanvasRenderingContext2D,
  shape: GlideShape,
  candidate: any,
  stroke: string,
  fill: string,
  strokeWidth: number,
  anchorRadius: number,
  activeRadius: number,
  zoom: number,
) {
  const localBounds = wbEditor.getShapeUtil(shape.type).getGeometry(shape as any).getBounds();
  const cx = localBounds.minX + localBounds.w / 2;
  const cy = localBounds.minY + localBounds.h / 2;

  ctx.save();
  ctx.translate(shape.x, shape.y);
  if (shape.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate(shape.rotation);
    ctx.translate(-cx, -cy);
  }
  drawGeometryOutline(ctx, shape, stroke, fill, strokeWidth, zoom);
  ctx.restore();

  ctx.save();
  ctx.lineWidth = 2 / zoom;
  ctx.strokeStyle = resolveColor(stroke);
  ctx.fillStyle = resolveColor(wbTheme.selectionFill);
  for (const anchor of candidate.candidateAnchors) {
    ctx.beginPath();
    ctx.arc(anchor.point.x, anchor.point.y, anchorRadius / zoom, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(candidate.point.x, candidate.point.y, activeRadius / zoom, 0, 2 * Math.PI);
  ctx.fillStyle = resolveColor(stroke);
  ctx.strokeStyle = resolveColor(wbTheme.selectionFill);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawSelection(ctx: CanvasRenderingContext2D, zoom: number) {
  const selData = getSelectionData();
  if (!selData || selData.boxes.length === 0) return;

  const { boxes, shapes } = selData;

  // Single arrow drawing
  if (shapes.length === 1 && shapes[0]?.type === 'arrow') {
    const arrow = shapes[0] as ArrowShape;
    const { start, end } = arrow.props;
    const bendPoint = getArrowBendHandlePoint(wbEditor as any, arrow);
    const startWorldX = arrow.x + start.point.x;
    const startWorldY = arrow.y + start.point.y;
    const endWorldX = arrow.x + end.point.x;
    const endWorldY = arrow.y + end.point.y;

    const hs = HANDLE_SIZE / zoom;

    ctx.save();
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = resolveColor(wbTheme.accent);
    ctx.fillStyle = resolveColor(wbTheme.selectionFill);
    ctx.setLineDash([]);

    // Start diamond
    ctx.save();
    ctx.translate(startWorldX, startWorldY);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-hs / 2, -hs / 2, hs, hs);
    ctx.strokeRect(-hs / 2, -hs / 2, hs, hs);
    ctx.restore();

    // End diamond
    ctx.save();
    ctx.translate(endWorldX, endWorldY);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-hs / 2, -hs / 2, hs, hs);
    ctx.strokeRect(-hs / 2, -hs / 2, hs, hs);
    ctx.restore();

    // Bend handle
    if (bendPoint) {
      ctx.beginPath();
      ctx.arc(bendPoint.x, bendPoint.y, 5 / zoom, 0, 2 * Math.PI);
      ctx.fillStyle = resolveColor(wbTheme.accent);
      ctx.strokeStyle = resolveColor(wbTheme.selectionFill);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const minX = Math.min(...boxes.map(box => box.minX));
  const minY = Math.min(...boxes.map(box => box.minY));
  const maxX = Math.max(...boxes.map(box => box.maxX));
  const maxY = Math.max(...boxes.map(box => box.maxY));
  const width = maxX - minX;
  const height = maxY - minY;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const rotation = boxes.length === 1 ? boxes[0]!.rotation : 0;

  const allText = shapes.every(shape => shape.type === 'text');

  ctx.save();
  if (boxes.length === 1 && rotation !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.translate(-cx, -cy);
  }

  // Bounding dashed rect
  ctx.strokeStyle = resolveColor(wbTheme.accent);
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 2 / zoom]);
  ctx.strokeRect(minX, minY, width, height);

  if (!allText) {
    let showRotate = true;
    let showResize = true;
    if (boxes.length === 1) {
      const util = wbEditor.getShapeUtil(shapes[0]!.type);
      showRotate = !util.hideRotateHandle(shapes[0] as any);
      showResize = !util.hideResizeHandles(shapes[0] as any);
    }

    ctx.setLineDash([]);

    // Rotate handle
    if (showRotate && boxes.length === 1) {
      const rotY = minY - ROTATION_HANDLE_OFFSET / zoom;
      ctx.beginPath();
      ctx.moveTo(cx, minY);
      ctx.lineTo(cx, rotY);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, rotY, 5 / zoom, 0, 2 * Math.PI);
      ctx.fillStyle = resolveColor(wbTheme.selectionFill);
      ctx.fill();
      ctx.stroke();
    }

    // Resize handles
    if (showResize) {
      const hs = HANDLE_SIZE / zoom;
      const rx = 1 / zoom;
      const handles = [
        { id: 'nw', px: minX, py: minY },
        { id: 'n', px: cx, py: minY },
        { id: 'ne', px: maxX, py: minY },
        { id: 'e', px: maxX, py: minY + height / 2 },
        { id: 'se', px: maxX, py: maxY },
        { id: 's', px: cx, py: maxY },
        { id: 'sw', px: minX, py: maxY },
        { id: 'w', px: minX, py: minY + height / 2 },
      ];

      ctx.fillStyle = resolveColor(wbTheme.selectionFill);
      for (const h of handles) {
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(h.px - hs / 2, h.py - hs / 2, hs, hs, rx);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillRect(h.px - hs / 2, h.py - hs / 2, hs, hs);
          ctx.strokeRect(h.px - hs / 2, h.py - hs / 2, hs, hs);
        }
      }
    }
  }

  ctx.restore();
}

function drawMarquee(ctx: CanvasRenderingContext2D, zoom: number) {
  const selectTool = wbEditor.getCurrentTool();
  const marqueeState = (selectTool as any)._childMap?.get('marqueeSelecting');
  const rect = marqueeState?.marqueeBoxSignal?.value as { minX: number; minY: number; w: number; h: number } | undefined;

  if (!rect || rect.w === 0 || rect.h === 0) return;

  ctx.save();
  ctx.fillStyle = resolveColor(wbTheme.accentSurface);
  ctx.strokeStyle = resolveColor(wbTheme.accent);
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([3 / zoom, 2 / zoom]);
  ctx.fillRect(rect.minX, rect.minY, rect.w, rect.h);
  ctx.strokeRect(rect.minX, rect.minY, rect.w, rect.h);
  ctx.restore();
}

function drawBindingPreview(ctx: CanvasRenderingContext2D, zoom: number) {
  const preview = wbEditor.bindingPreview.value;
  if (!preview) return;

  const activeSig = wbEditor.store.getSignal(preview.targetId);
  const activeShape = activeSig?.value as GlideShape | null;
  if (!activeShape) return;

  const sourceSig = preview.sourceCandidate ? wbEditor.store.getSignal(preview.sourceCandidate.targetId) : undefined;
  const sourceShape = sourceSig?.value as GlideShape | null;

  if (preview.sourceCandidate && sourceShape) {
    drawCandidate(
      ctx,
      sourceShape,
      preview.sourceCandidate,
      '#74c7ec', // BINDING_SOURCE_PREVIEW_STROKE
      'rgba(116, 199, 236, 0.1)',
      2,
      5,
      7,
      zoom
    );
  }

  drawCandidate(
    ctx,
    activeShape,
    preview,
    '#a6e3a1', // BINDING_PREVIEW_STROKE
    'rgba(166, 227, 161, 0.12)',
    2,
    5,
    7,
    zoom
  );
}

export function CanvasOverlays() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dispose = effect(() => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { x: cx, y: cy, z: zoom } = wbEditor.camera.signal.value;
      const dpr = window.devicePixelRatio || 1;

      // Get bounds and adjust dimensions for high-DPI scaling
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      const physicalW = Math.ceil(w * dpr);
      const physicalH = Math.ceil(h * dpr);
      if (canvas.width !== physicalW || canvas.height !== physicalH) {
        canvas.width = physicalW;
        canvas.height = physicalH;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.scale(zoom * dpr, zoom * dpr);
      ctx.translate(-cx, -cy);

      // Force Preact tracking
      wbEditor.store.getVersionSignal().value;
      wbEditor.bindingPreview.value;

      drawSelection(ctx, zoom);
      drawMarquee(ctx, zoom);
      drawBindingPreview(ctx, zoom);
    });

    return () => {
      dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}
