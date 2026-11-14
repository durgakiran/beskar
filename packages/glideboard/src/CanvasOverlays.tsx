import React, { useEffect, useRef } from 'react';
import {
  type LineShape,
  getArrowBendHandlePoint,
  getOrthoHandles,
  type ArrowShape,
  type GlideEditor,
  type GlideShape,
  type ResizeHandle,
  type ShapeId,
} from '@durgakiran/glideline';
import { useGlideboardController } from './GlideboardContext.js';
import { wbTheme } from './theme.js';

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

function getSelectionData(editor: GlideEditor) {
  const selectedIds = editor.getSelectionSignal().value;
  if (!selectedIds || selectedIds.length === 0) return null;

  const boxes: OverlayBounds[] = [];
  const shapes: GlideShape[] = [];
  for (const id of selectedIds) {
    const shape = editor.getShapeSignal(id).value as GlideShape | null;
    if (!shape || editor.isShapeEffectivelyHidden(id)) continue;
    const worldBounds = editor.getShapeWorldBounds(shape);
    boxes.push({
      minX: worldBounds.minX,
      minY: worldBounds.minY,
      maxX: worldBounds.maxX,
      maxY: worldBounds.maxY,
      w: worldBounds.w,
      h: worldBounds.h,
      rotation: shape.rotation ?? 0,
    });
    shapes.push(shape);
  }

  return { boxes, shapes };
}

const ORTHO_RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const;

export function getCursorForHandle(handleId: string, editor?: GlideEditor): string {
  if (editor && handleId.startsWith('ortho-segment-')) {
    const [id] = editor.getSelectedShapeIds();
    const arrow = id && editor.getShape(id);
    if (arrow?.type === 'arrow') {
      const { a, b, c, d } = editor.transforms.getParentWorldTransform(arrow.parentId);
      const angle = handleId.startsWith('ortho-segment-x-') ? Math.atan2(b, a) : Math.atan2(d, c);
      const direction = Math.round(angle / (Math.PI / 4));
      return ORTHO_RESIZE_CURSORS[(direction + 4) % 4]!;
    }
  }
  if (handleId.startsWith('ortho-segment-x-')) return 'ew-resize';
  if (handleId.startsWith('ortho-segment-y-')) return 'ns-resize';
  if (handleId.startsWith('ortho-waypoint-')) return 'move';
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

export function getHandleAtPagePoint(editor: GlideEditor, pageX: number, pageY: number): string | null {
  const selData = getSelectionData(editor);
  if (!selData || selData.boxes.length === 0) return null;

  const { boxes, shapes } = selData;
  const camera = editor.camera.signal.value;
  const zoom = camera.z;

  const single = shapes.length === 1 ? shapes[0] : undefined;
  if (single?.type === 'arrow' || single?.type === 'line') {
    const { start, end } = getEndpointPositions(editor, single as ArrowShape | LineShape);

    // Start handle
    const distStart = Math.hypot((pageX - start.x) * zoom, (pageY - start.y) * zoom);
    if (distStart <= 8) return 'start';

    // End handle
    const distEnd = Math.hypot((pageX - end.x) * zoom, (pageY - end.y) * zoom);
    if (distEnd <= 8) return 'end';

    if (single.type === 'line') return null;
    const arrow = single as ArrowShape;
    if (arrow.props.routeStyle === 'ortho') {
      return getOrthoHandles(editor, arrow).find(({ point }) =>
        Math.hypot(pageX - point.x, pageY - point.y) * zoom <= 8,
      )?.id ?? null;
    }
    const bendPoint = getArrowBendHandlePoint(editor, arrow);
    if (bendPoint) {
      const distBend = Math.hypot((pageX - bendPoint.x) * zoom, (pageY - bendPoint.y) * zoom);
      if (distBend <= 8) return 'bend';
    }
    return null;
  }

  if (shapes.length === 1) {
    const shape = shapes[0]!;
    const util = editor.getShapeUtil(shape.type);
    const bounds = util.getGeometry(shape as any).getBounds();
    const centerX = bounds.minX + bounds.w / 2;
    const centerY = bounds.minY + bounds.h / 2;
    const supportedHandles = util.getResizeHandles(shape as any);
    const allHandles: { id: ResizeHandle; point: { x: number; y: number } }[] = [
      { id: 'nw', point: { x: bounds.minX, y: bounds.minY } },
      { id: 'n', point: { x: centerX, y: bounds.minY } },
      { id: 'ne', point: { x: bounds.maxX, y: bounds.minY } },
      { id: 'e', point: { x: bounds.maxX, y: centerY } },
      { id: 'se', point: { x: bounds.maxX, y: bounds.maxY } },
      { id: 's', point: { x: centerX, y: bounds.maxY } },
      { id: 'sw', point: { x: bounds.minX, y: bounds.maxY } },
      { id: 'w', point: { x: bounds.minX, y: centerY } },
    ];
    const handles = allHandles.filter(handle => supportedHandles.includes(handle.id));
    if (!util.hideRotateHandle(shape as any)) {
      const rotatePoint = editor.localToPage(shape.id as any, {
        x: centerX,
        y: bounds.minY - ROTATION_HANDLE_OFFSET / zoom,
      });
      if (Math.hypot((pageX - rotatePoint.x) * zoom, (pageY - rotatePoint.y) * zoom) <= 8) return 'rotate';
    }
    if (!util.hideResizeHandles(shape as any)) {
      for (const handle of handles) {
        const point = editor.localToPage(shape.id as any, handle.point);
        if (Math.hypot((pageX - point.x) * zoom, (pageY - point.y) * zoom) <= 8) return handle.id;
      }
    }
    return null;
  }

  const minX = Math.min(...boxes.map(box => box.minX));
  const minY = Math.min(...boxes.map(box => box.minY));
  const maxX = Math.max(...boxes.map(box => box.maxX));
  const maxY = Math.max(...boxes.map(box => box.maxY));
  const width = maxX - minX;
  const height = maxY - minY;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const rotation = 0;

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
    const util = editor.getShapeUtil(shapes[0]!.type);
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
  editor: GlideEditor,
  ctx: CanvasRenderingContext2D,
  shape: GlideShape,
  stroke: string,
  fill: string,
  strokeWidth: number,
  zoom: number,
) {
  const geometry = editor.getShapeUtil(shape.type).getGeometry(shape as any);
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
  editor: GlideEditor,
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
  ctx.save();
  const transform = editor.getWorldTransform(shape.id as any);
  ctx.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  drawGeometryOutline(editor, ctx, shape, stroke, fill, strokeWidth, zoom);
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

function drawSelectedShapeOutline(
  editor: GlideEditor,
  ctx: CanvasRenderingContext2D,
  shape: GlideShape,
  stroke: string,
  zoom: number,
) {
  const id = shape.id as ShapeId;
  ctx.save();

  // Match the shape layer's clipping frame, in page coordinates.
  const frame = editor.getClippingFrameAncestors(id)[0];
  if (frame) {
    const corners = editor.getShapeLocalOutline(frame.id as ShapeId)
      .map(point => editor.localToPage(frame.id as ShapeId, point));
    ctx.beginPath();
    ctx.moveTo(corners[0]!.x, corners[0]!.y);
    for (const point of corners.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.clip();
  }

  const { a, b, c, d, e, f } = editor.getWorldTransform(id);
  ctx.transform(a, b, c, d, e, f);
  ctx.setLineDash([]);
  drawGeometryOutline(editor, ctx, shape, stroke, 'transparent', 2, zoom);
  ctx.restore();
}

function getEndpointPositions(editor: GlideEditor, shape: ArrowShape | LineShape) {
  const { start, end } = shape.props;
  return {
    start: editor.localToPage(shape.id, 'point' in start ? start.point : start),
    end: editor.localToPage(shape.id, 'point' in end ? end.point : end),
  };
}

function drawSelection(editor: GlideEditor, ctx: CanvasRenderingContext2D, zoom: number) {
  const selData = getSelectionData(editor);
  if (!selData || selData.boxes.length === 0) return;

  const { boxes, shapes } = selData;

  const single = shapes.length === 1 ? shapes[0] : undefined;
  if (single?.type === 'arrow' || single?.type === 'line') {
    const arrow = single.type === 'arrow' ? single as ArrowShape : undefined;
    const bendPoint = arrow && arrow.props.routeStyle !== 'ortho' ? getArrowBendHandlePoint(editor, arrow) : null;
    const { start: startWorld, end: endWorld } = getEndpointPositions(editor, single as ArrowShape | LineShape);

    const hs = HANDLE_SIZE / zoom;

    ctx.save();
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = resolveColor(wbTheme.accent);
    ctx.fillStyle = resolveColor(wbTheme.selectionFill);
    ctx.setLineDash([]);

    // Start diamond
    ctx.save();
    ctx.translate(startWorld.x, startWorld.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-hs / 2, -hs / 2, hs, hs);
    ctx.strokeRect(-hs / 2, -hs / 2, hs, hs);
    ctx.restore();

    // End diamond
    ctx.save();
    ctx.translate(endWorld.x, endWorld.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-hs / 2, -hs / 2, hs, hs);
    ctx.strokeRect(-hs / 2, -hs / 2, hs, hs);
    ctx.restore();

    for (const { point, moveAxis } of arrow ? getOrthoHandles(editor, arrow) : []) {
      ctx.save();
      ctx.translate(point.x, point.y);
      if (moveAxis) {
        const origin = editor.pageToParent(single.parentId, point);
        const along = editor.parentToPage(single.parentId, {
          x: origin.x + (moveAxis === 'y' ? 1 : 0),
          y: origin.y + (moveAxis === 'x' ? 1 : 0),
        });
        ctx.rotate(Math.atan2(along.y - point.y, along.x - point.x));
      }
      const w = (moveAxis ? 14 : 8) / zoom;
      const h = (moveAxis ? 6 : 8) / zoom;
      if (moveAxis && ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }

    // Curve bend handle
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

  if (shapes.length === 1) {
    const shape = shapes[0]!;
    const util = editor.getShapeUtil(shape.type);
    const bounds = util.getGeometry(shape as any).getBounds();
    const centerX = bounds.minX + bounds.w / 2;
    const transform = editor.getWorldTransform(shape.id as any);
    ctx.save();
    ctx.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
    ctx.strokeStyle = resolveColor(wbTheme.accent);
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([4 / zoom, 2 / zoom]);
    ctx.strokeRect(bounds.minX, bounds.minY, bounds.w, bounds.h);

    ctx.setLineDash([]);
    if (!util.hideRotateHandle(shape as any)) {
      const rotateY = bounds.minY - ROTATION_HANDLE_OFFSET / zoom;
      ctx.beginPath();
      ctx.moveTo(centerX, bounds.minY);
      ctx.lineTo(centerX, rotateY);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(centerX, rotateY, 5 / zoom, 0, 2 * Math.PI);
      ctx.fillStyle = resolveColor(wbTheme.selectionFill);
      ctx.fill();
      ctx.stroke();
    }
    if (!util.hideResizeHandles(shape as any)) {
      const hs = HANDLE_SIZE / zoom;
      const allPoints: { id: ResizeHandle; x: number; y: number }[] = [
        { id: 'nw', x: bounds.minX, y: bounds.minY },
        { id: 'n', x: centerX, y: bounds.minY },
        { id: 'ne', x: bounds.maxX, y: bounds.minY },
        { id: 'e', x: bounds.maxX, y: bounds.minY + bounds.h / 2 },
        { id: 'se', x: bounds.maxX, y: bounds.maxY },
        { id: 's', x: centerX, y: bounds.maxY },
        { id: 'sw', x: bounds.minX, y: bounds.maxY },
        { id: 'w', x: bounds.minX, y: bounds.minY + bounds.h / 2 },
      ];
      const points = allPoints.filter(handle => util.getResizeHandles(shape as any).includes(handle.id));
      for (const { x, y } of points) {
        ctx.fillRect(x! - hs / 2, y! - hs / 2, hs, hs);
        ctx.strokeRect(x! - hs / 2, y! - hs / 2, hs, hs);
      }
    }
    ctx.restore();
    return;
  }

  const accent = resolveColor(wbTheme.accent);
  for (const shape of shapes) drawSelectedShapeOutline(editor, ctx, shape, accent, zoom);

  const minX = Math.min(...boxes.map(box => box.minX));
  const minY = Math.min(...boxes.map(box => box.minY));
  const maxX = Math.max(...boxes.map(box => box.maxX));
  const maxY = Math.max(...boxes.map(box => box.maxY));
  const width = maxX - minX;
  const height = maxY - minY;
  const cx = minX + width / 2;
  const cy = minY + height / 2;
  const rotation = boxes.length === 1 ? boxes[0]!.rotation : 0;

  ctx.save();
  if (boxes.length === 1 && rotation !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.translate(-cx, -cy);
  }

  // Bounding dashed rect
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 2 / zoom]);
  ctx.strokeRect(minX, minY, width, height);

  let showRotate = true;
  let showResize = true;
  if (boxes.length === 1) {
    const util = editor.getShapeUtil(shapes[0]!.type);
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

  ctx.restore();
}

function drawMarquee(editor: GlideEditor, ctx: CanvasRenderingContext2D, zoom: number) {
  const selectTool = editor.getCurrentTool();
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

function drawSnapGuides(editor: GlideEditor, ctx: CanvasRenderingContext2D, zoom: number) {
  const guides = editor.snapping.guides.peek();
  if (guides.length === 0) return;
  ctx.save();
  ctx.strokeStyle = resolveColor(wbTheme.accent);
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([3 / zoom, 3 / zoom]);
  for (const guide of guides) {
    ctx.beginPath();
    if (guide.axis === 'x') {
      ctx.moveTo(guide.position, guide.start);
      ctx.lineTo(guide.position, guide.end);
    } else {
      ctx.moveTo(guide.start, guide.position);
      ctx.lineTo(guide.end, guide.position);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawBindingPreview(editor: GlideEditor, ctx: CanvasRenderingContext2D, zoom: number) {
  const preview = editor.bindingPreview.value;
  if (!preview) return;

  const activeSig = editor.getShapeSignal(preview.targetId);
  const activeShape = activeSig.value as GlideShape | null;
  if (!activeShape) return;

  const sourceSig = preview.sourceCandidate ? editor.getShapeSignal(preview.sourceCandidate.targetId) : undefined;
  const sourceShape = sourceSig?.value as GlideShape | null;

  if (preview.sourceCandidate && sourceShape) {
    drawCandidate(
      editor,
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
    editor,
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
  const controller = useGlideboardController();
  const { editor } = controller;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let marqueeSignal: { subscribe(callback: () => void): () => void } | null = null;
    let disposeMarquee: (() => void) | null = null;
    let subscribingMarquee = false;

    const syncMarqueeSubscription = () => {
      const selectTool = editor.currentToolId.peek() === 'select'
        ? editor.getCurrentTool()
        : null;
      const nextSignal = (selectTool as any)?._childMap
        ?.get('marqueeSelecting')
        ?.marqueeBoxSignal as typeof marqueeSignal;
      if (nextSignal === marqueeSignal) return;

      disposeMarquee?.();
      marqueeSignal = nextSignal ?? null;
      disposeMarquee = null;
      if (marqueeSignal) {
        subscribingMarquee = true;
        disposeMarquee = marqueeSignal.subscribe(() => {
          if (!subscribingMarquee) draw();
        });
        subscribingMarquee = false;
      }
    };

    const draw = () => {
      syncMarqueeSubscription();
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { x: cx, y: cy, z: zoom } = editor.camera.signal.value;
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

      drawSelection(editor, ctx, zoom);
      drawSnapGuides(editor, ctx, zoom);
      drawMarquee(editor, ctx, zoom);
      drawBindingPreview(editor, ctx, zoom);
    };

    const observedSignals = [
      editor.camera.signal,
      editor.bindingPreview,
      editor.getSelectionSignal(),
      editor.currentToolId,
      editor.interactions.getChangedIdsSignal(),
      editor.snapping.guides,
    ];
    let subscribingBaseSignals = true;
    const disposers = observedSignals.map(observed => observed.subscribe(() => {
      if (!subscribingBaseSignals) draw();
    }));
    subscribingBaseSignals = false;
    const disposeStore = editor.store.listen(changes => {
      const selectedIds = editor.getSelectedShapeIds();
      const relevantIds = new Set<string>([
        ...selectedIds,
        ...editor.interactions.changedIds,
      ]);
      const preview = editor.bindingPreview.peek();
      if (preview) {
        relevantIds.add(preview.targetId);
        if (preview.sourceCandidate) relevantIds.add(preview.sourceCandidate.targetId);
      }
      const selectedGroups = new Set<string>();
      for (const selectedId of selectedIds) {
        for (const ancestor of editor.getAncestors(selectedId)) relevantIds.add(ancestor.id);
        if (editor.getShape(selectedId)?.type === 'group') selectedGroups.add(selectedId);
        for (const binding of editor.getBindingsFromShape(selectedId)) {
          relevantIds.add(binding.id);
          relevantIds.add(binding.toId);
        }
      }
      if (changes.changedIds.some(id => relevantIds.has(id))) {
        draw();
        return;
      }
      // Check both parents so deletion and moving a child out of a group
      // refresh the group's outline as well as additions and moves within it.
      if (selectedGroups.size > 0 && changes.deltas.some(({ before, after }) =>
        [before, after].some(record => {
          if (record?.['kind'] !== 'shape') return false;
          const parentId = record['parentId'] as ShapeId;
          return selectedGroups.has(parentId)
            || editor.getAncestors(parentId).some(parent => selectedGroups.has(parent.id));
        }),
      )) draw();
    });

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => draw());
    resizeObserver?.observe(canvas);
    draw();

    return () => {
      resizeObserver?.disconnect();
      disposeMarquee?.();
      disposeStore();
      for (const dispose of disposers) dispose();
    };
  }, [editor]);

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
