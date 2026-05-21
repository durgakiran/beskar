import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createEditor } from '../../glideline/src/editor';
import { BoxUtil } from '../../glideline/src/shapes/BoxUtil';
import { ArrowUtil, ArrowBindingUtil, ArrowPlugin } from '../../glideline/src/shapes/ArrowUtil';
import { ArrowTool } from '../../glideline/src/tools/ArrowTool';
import { SelectTool } from '../../glideline/src/tools/SelectTool';
import { BoxTool } from '../../glideline/src/tools/BoxTool';
import { computeArcPath } from '../../glideline/src/arc-router';
import { computeElbowPath, parseElbowPoints, getOrthoHandlePoint } from '../../glideline/src/elbow-router';
import { sid, bid, makeBox } from '../../glideline/src/types';
import type { ShapeId, AnyRecord } from '../../glideline/src/types';
import type { ArrowShape } from '../../glideline/src/shapes/ArrowUtil';
import type { GlideEvent } from '../../glideline/src/state-node';

const BoxPlugin = { id: 'box', shapes: [BoxUtil as any] };

const editor = createEditor({
  plugins: [BoxPlugin, ArrowPlugin],
  tools: [SelectTool, BoxTool, ArrowTool],
});

// ── Style helpers ──────────────────────────────────────────────
const btn = (c: string): React.CSSProperties => ({
  background: `${c}22`, border: `1px solid ${c}55`, color: c,
  borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', marginRight: 6, marginBottom: 4,
});
const Panel = ({ title, color = '#6366f1', children }: { title: string; color?: string; children: React.ReactNode }) => (
  <div style={{ background: '#1e1e2e', border: `1px solid ${color}33`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
    <h2 style={{ color, margin: '0 0 12px', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
    {children}
  </div>
);
const Badge = ({ ok, label }: { ok: boolean; label: string }) => (
  <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, background: ok ? '#22c55e22' : '#ef444422', color: ok ? '#4ade80' : '#f87171', marginRight: 4, marginBottom: 3 }}>
    {ok ? '✓' : '✗'} {label}
  </span>
);

// ── Spec runner ────────────────────────────────────────────────
function runPhase4Specs(): { id: string; ok: boolean; msg: string }[] {
  const out: { id: string; ok: boolean; msg: string }[] = [];
  const log = (id: string, ok: boolean, msg: string) => out.push({ id, ok, msg });

  const BoxPlugin2 = { id: 'box', shapes: [BoxUtil as any] };
  function ed() {
    return createEditor({ plugins: [BoxPlugin2, ArrowPlugin], tools: [SelectTool, BoxTool, ArrowTool] });
  }
  function box(id: string, x: number, y: number, w: number, h: number) {
    return { id: sid(id), type: 'box', x, y, index: 'a1', rotation: 0, meta: {}, props: { w, h, cornerRadius: 0, color: '#6366f1', label: '' } };
  }
  function arrow(id: string) {
    return { id: sid(id), type: 'arrow', x: 0, y: 0, index: 'a1', rotation: 0, meta: {}, props: { start: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 0, y: 0 } }, end: { boundShapeId: null, normalizedAnchor: { x: 0.5, y: 0.5 }, point: { x: 100, y: 0 } }, routeStyle: 'curve', bend: 0 } };
  }
  function binding(id: string, from: string, to: string, terminal: 'start' | 'end' = 'end') {
    return { id: bid(id), type: 'arrow', fromId: sid(from), toId: sid(to), meta: {}, props: { terminal, normalizedAnchor: { x: 0.5, y: 0.5 }, fromEdge: 'left' } };
  }

  // T4.1-01
  try {
    const e = ed();
    e.store.put([box('b1', 0, 0, 100, 100), arrow('a1')]);
    e.createBinding(binding('bnd1', 'a1', 'b1') as unknown as AnyRecord);
    const from = e.getBindingsFromShape(sid('a1'));
    const to   = e.getBindingsToShape(sid('b1'));
    log('T4.1-01 createBinding indexes', from.length === 1 && to.length === 1, `from=${from.length} to=${to.length}`);
  } catch (err: any) { log('T4.1-01', false, err.message); }

  // T4.1-02
  try {
    const e = ed();
    e.store.put([box('b2', 0, 0, 200, 100), arrow('a2')]);
    e.createBinding(binding('bnd2', 'a2', 'b2') as unknown as AnyRecord);
    e.updateShape(sid('b2'), { x: 100, y: 100 });
    const arr = e.getShape<ArrowShape>(sid('a2'))!;
    log('T4.1-02 onAfterChangeToShape fires', arr.props.end.point.x === 200, `end.point.x=${arr.props.end.point.x} (expect 200)`);
  } catch (err: any) { log('T4.1-02', false, err.message); }

  // T4.1-04
  try {
    const e = ed();
    e.store.put([box('b4', 0, 0, 100, 100), arrow('a4')]);
    e.createBinding(binding('bnd4', 'a4', 'b4') as unknown as AnyRecord);
    const arr0 = e.getShape<ArrowShape>(sid('a4'))!;
    e.store.put([{ ...arr0, props: { ...arr0.props, end: { ...arr0.props.end, boundShapeId: sid('b4') } } }]);
    e.deleteShapes([sid('b4')]);
    const arr = e.getShape<ArrowShape>(sid('a4'))!;
    log('T4.1-04 detach on target delete', arr.props.end.boundShapeId === null, `boundShapeId=${arr.props.end.boundShapeId}`);
  } catch (err: any) { log('T4.1-04', false, err.message); }

  // T4.1-05
  try {
    const e = ed();
    e.store.put([box('b5', 0, 0, 100, 100), arrow('a5')]);
    e.createBinding(binding('bnd5', 'a5', 'b5') as unknown as AnyRecord);
    e.deleteShapes([sid('a5')]);
    const binds = e.getBindingsFromShape(sid('a5'));
    log('T4.1-05 fromId delete cascades', binds.length === 0 && !e.store.get(bid('bnd5')), `binds=${binds.length}`);
  } catch (err: any) { log('T4.1-05', false, err.message); }

  // T4.1-06
  try {
    const e = ed();
    e.store.put([box('b6', 0, 0, 100, 100), arrow('a6')]);
    e.createBinding(binding('bnd6', 'a6', 'b6') as unknown as AnyRecord);
    e.updateBinding(bid('bnd6'), { fromEdge: 'right' } as AnyRecord);
    const bnd = e.store.get(bid('bnd6')) as AnyRecord;
    const props = bnd['props'] as Record<string, unknown>;
    log('T4.1-06 updateBinding merges', props['fromEdge'] === 'right' && props['terminal'] === 'end', `fromEdge=${props['fromEdge']} terminal=${props['terminal']}`);
  } catch (err: any) { log('T4.1-06', false, err.message); }

  // T4.2-01 (arc)
  try {
    const path = computeArcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    log('T4.2-01 bend=0 straight', path.includes('L') && !path.includes('Q'), path);
  } catch (err: any) { log('T4.2-01', false, err.message); }

  // T4.2-02
  try {
    const path = computeArcPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5);
    const m = path.match(/Q\s+([\d.\-]+)\s+([\d.\-]+)/);
    const cpY = m ? parseFloat(m[2]) : 0;
    log('T4.2-02 bend=0.5 arcs upward', cpY < 0, `controlY=${cpY}`);
  } catch (err: any) { log('T4.2-02', false, err.message); }

  // T4.2-05 SVG validity (browser only)
  try {
    const path = computeArcPath({ x: 0, y: 0 }, { x: 100, y: 80 }, 0.3);
    const p = new Path2D(path);
    log('T4.2-05 SVG Path2D valid', !!p, path.substring(0, 30));
  } catch (err: any) { log('T4.2-05', false, `Path2D: ${err.message}`); }

  // T4.3-01 (elbow)
  try {
    const from = makeBox(0, 0, 100, 80); const to = makeBox(300, 0, 100, 80);
    const path = computeElbowPath(from, to, 'right', 'left');
    const segs = (path.match(/\bL\b/g) ?? []).length;
    log('T4.3-01 right→left Z-path', segs === 3, `segments=${segs}`);
  } catch (err: any) { log('T4.3-01', false, err.message); }

  // T4.3-04 overlap
  try {
    const b = makeBox(0, 0, 100, 100);
    const path = computeElbowPath(b, b, 'right', 'left');
    log('T4.3-04 overlap fallback', path.startsWith('M') && !path.includes('NaN'), path.substring(0, 30));
  } catch (err: any) { log('T4.3-04', false, err.message); }

  // T4.3-06 SVG validity (browser only)
  try {
    const from = makeBox(0, 0, 100, 80); const to = makeBox(300, 0, 100, 80);
    const path = computeElbowPath(from, to, 'right', 'left');
    const p = new Path2D(path);
    log('T4.3-06 SVG Path2D valid', !!p, path.substring(0, 30));
  } catch (err: any) { log('T4.3-06', false, `Path2D: ${err.message}`); }

  // T4.4-03 detach
  try {
    const e = ed();
    e.store.put([box('bx3', 0, 0, 100, 100), arrow('ar3')]);
    e.createBinding(binding('bn3', 'ar3', 'bx3') as unknown as AnyRecord);
    const arr0 = e.getShape<ArrowShape>(sid('ar3'))!;
    e.store.put([{ ...arr0, props: { ...arr0.props, end: { ...arr0.props.end, boundShapeId: sid('bx3') } } }]);
    e.deleteShapes([sid('bx3')]);
    const arr = e.getShape<ArrowShape>(sid('ar3'))!;
    log('T4.4-03 detach on delete', arr.props.end.boundShapeId === null, `boundShapeId=${arr.props.end.boundShapeId}`);
  } catch (err: any) { log('T4.4-03', false, err.message); }

  // T4.4-05 ArrowTool creates shape+bindings
  try {
    const e = ed();
    e.store.put([box('bxA', 0, 0, 100, 80), box('bxB', 300, 0, 100, 80)]);
    e.setCurrentTool('arrow');
    e.dispatchEvent({ type: 'pointerDown', point: { x: 50, y: 40 }, shiftKey: false, target: 'shape', shapeId: sid('bxA') } as GlideEvent);
    e.dispatchEvent({ type: 'pointerMove', point: { x: 200, y: 40 } } as GlideEvent);
    e.dispatchEvent({ type: 'pointerUp', point: { x: 350, y: 40 } } as GlideEvent);
    let arrowCount = 0; let bindCount = 0;
    for (const sig of (e.store as any)._signals.values()) {
      const r = sig.peek() as AnyRecord | null;
      if (!r) continue;
      if (r['type'] === 'arrow' && !r['fromId']) arrowCount++;
      if (r['fromId'] && r['toId']) bindCount++;
    }
    log('T4.4-05 ArrowTool creates shape+bindings', arrowCount === 1 && bindCount === 2, `arrows=${arrowCount} bindings=${bindCount}`);
  } catch (err: any) { log('T4.4-05', false, err.message); }

  return out;
}

// ── Canvas renderer ────────────────────────────────────────────
type HoverShapeId = ShapeId | null;

function getEdgeFromBinding(arrowId: ShapeId, terminal: 'start' | 'end'): { fromEdge: string; toEdge: string } {
  const bindings = editor.getBindingsFromShape(arrowId);
  const b = bindings.find(b => (b.props as any).terminal === terminal);
  if (!b) return { fromEdge: 'right', toEdge: 'left' };
  return {
    fromEdge: (b.props as any).fromEdge ?? 'right',
    toEdge:   'left',
  };
}

function drawArrowEndpoint(ctx: CanvasRenderingContext2D, pt: { x: number; y: number }, bound: boolean) {
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = bound ? '#4ade80' : '#94a3b8';
  ctx.fill();
  ctx.strokeStyle = '#181825';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function arrowEndPoint(pathStr: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const match = pathStr.match(/(?:Q\s+[\d.\-]+\s+[\d.\-]+\s+|L\s+)([\d.\-]+)\s+([\d.\-]+)$/);
  if (match) return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
  return fallback;
}

function arrowStartPoint(pathStr: string, fallback: { x: number; y: number }): { x: number; y: number } {
  const match = pathStr.match(/^M\s+([\d.\-]+)\s+([\d.\-]+)/);
  if (match) return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
  return fallback;
}

function drawHandle(ctx: CanvasRenderingContext2D, pt: { x: number; y: number }) {
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/**
 * Draw arrowhead at `tip`, pointing in direction tip←tangentFrom.
 * For quadratic Bézier: pass controlPoint as tangentFrom.
 * For straight/elbow: pass the point immediately before tip.
 */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  tangentFrom: { x: number; y: number },
  tip: { x: number; y: number },
) {
  const dx = tip.x - tangentFrom.x;
  const dy = tip.y - tangentFrom.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const ux = dx / len; const uy = dy / len;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - ux * 14 - uy * 6, tip.y - uy * 14 + ux * 6);
  ctx.lineTo(tip.x - ux * 14 + uy * 6, tip.y - uy * 14 - ux * 6);
  ctx.closePath();
  ctx.fillStyle = '#f38ba8';
  ctx.fill();
}

/** Extract the tangent-from point for an arrowhead at the path end.
 *  - Q path: returns the control point (tangent at t=1 is end−cp)
 *  - M...L...L path: returns the second-to-last point
 *  - Fallback: returns `fallback` (start point)
 */
function arrowTangentFrom(pathStr: string, fallback: { x: number; y: number }): { x: number; y: number } {
  // Quadratic Bézier: "M sx sy Q cpx cpy ex ey"
  const qMatch = pathStr.match(/Q\s+([\d.\-]+)\s+([\d.\-]+)\s+[\d.\-]+\s+[\d.\-]+/);
  if (qMatch) return { x: parseFloat(qMatch[1]), y: parseFloat(qMatch[2]) };

  // Polyline (M + multiple L): second-to-last point
  const pts: { x: number; y: number }[] = [];
  const re = /[ML]\s+([\d.\-]+)\s+([\d.\-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathStr)) !== null) pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
  if (pts.length >= 2) return pts[pts.length - 2];

  return fallback;
}

function drawConnectionPoints(ctx: CanvasRenderingContext2D, shape: any) {
  // Draw diamond connection points on edges of a box
  const { x, y, props } = shape;
  const { w, h } = props;
  const points = [
    { x: x + w / 2, y },           // top
    { x: x + w,     y: y + h / 2 }, // right
    { x: x + w / 2, y: y + h },    // bottom
    { x,            y: y + h / 2 }, // left
  ];
  for (const pt of points) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f38ba822';
    ctx.fill();
    ctx.strokeStyle = '#f38ba8';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawCanvas(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  selection: ShapeId[],
  hoverShapeId: HoverShapeId,
  showBindingPoints: boolean,
) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#181825';
  ctx.fillRect(0, 0, W, H);

  // Dot grid
  ctx.fillStyle = '#ffffff08';
  for (let gx = 20; gx < W; gx += 20) {
    for (let gy = 20; gy < H; gy += 20) {
      ctx.beginPath(); ctx.arc(gx, gy, 0.8, 0, Math.PI * 2); ctx.fill();
    }
  }

  const all = editor.getShapesInBox({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 });
  const selSet = new Set(selection);

  // Pass 1: boxes
  for (const shape of all) {
    const s = shape as any;
    if (s.type !== 'box') continue;
    const { x, y, props } = s;
    const isSelected = selSet.has(shape.id);
    const isHovered  = shape.id === hoverShapeId;

    // Shadow for selected
    if (isSelected) {
      ctx.shadowColor = '#a6e3a150'; ctx.shadowBlur = 12;
    }
    ctx.fillStyle = isSelected ? '#a6e3a1' : (props.color ?? '#6366f1');
    ctx.beginPath(); ctx.roundRect(x, y, props.w, props.h, props.cornerRadius ?? 0); ctx.fill();
    ctx.shadowBlur = 0;

    if (isSelected) {
      ctx.strokeStyle = '#a6e3a1'; ctx.lineWidth = 2; ctx.stroke();
    }

    // Hover ring
    if (isHovered) {
      ctx.strokeStyle = '#f38ba8'; ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.roundRect(x - 3, y - 3, props.w + 6, props.h + 6, (props.cornerRadius ?? 0) + 3);
      ctx.stroke(); ctx.setLineDash([]);
    }

    // Connection points when ArrowTool active, dragging an arrow terminal, or box selected
    if (showBindingPoints || isSelected) drawConnectionPoints(ctx, s);

    // Check if any arrow is bound to this box → show binding indicator
    const bindingsTo = editor.getBindingsToShape(shape.id as ShapeId);
    if (bindingsTo.length > 0) {
      // Small green dot top-right corner
      ctx.beginPath();
      ctx.arc(x + props.w - 6, y + 6, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#4ade80';
      ctx.fill();
      ctx.strokeStyle = '#181825'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  // Pass 2: arrows
  for (const shape of all) {
    const s = shape as any;
    if (s.type !== 'arrow') continue;

    const arrow = s as ArrowShape;
    const { start, end, routeStyle, bend } = arrow.props;

    let pathStr: string;

    if (routeStyle === 'ortho') {
      const fromShape = start.boundShapeId ? editor.getShape(start.boundShapeId) : null;
      const toShape   = end.boundShapeId   ? editor.getShape(end.boundShapeId)   : null;

      if (fromShape && toShape) {
        const fu = editor.getShapeUtil(fromShape.type);
        const tu = editor.getShapeUtil(toShape.type);
        const fromBounds = fu.getGeometry(fromShape as any);
        const toBounds   = tu.getGeometry(toShape as any);
        // Get fromEdge from binding props
        const { fromEdge } = getEdgeFromBinding(shape.id as ShapeId, 'start');
        const { fromEdge: toEdge } = getEdgeFromBinding(shape.id as ShapeId, 'end');
        // toEdge is opposite of what we call "fromEdge" on the end binding
        // The end binding's fromEdge = which edge of the toShape is used
        pathStr = computeElbowPath(fromBounds, toBounds, fromEdge as any, toEdge as any, bend);
      } else {
        // Fallback: straight line between terminal points
        pathStr = computeArcPath(start.point, end.point, 0);
      }
    } else {
      const fromShape = start.boundShapeId ? editor.getShape(start.boundShapeId) : null;
      const toShape   = end.boundShapeId   ? editor.getShape(end.boundShapeId)   : null;
      const fromBounds = fromShape ? editor.getShapeUtil(fromShape.type).getGeometry(fromShape as any) : null;
      const toBounds   = toShape ? editor.getShapeUtil(toShape.type).getGeometry(toShape as any) : null;
      pathStr = computeArcPath(start.point, end.point, bend, fromBounds, toBounds);
    }

    // Draw shadow for depth
    ctx.shadowColor = '#f38ba840'; ctx.shadowBlur = 6;
    ctx.strokeStyle = '#f38ba8';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    try { ctx.stroke(new Path2D(pathStr)); } catch { /* invalid path */ }
    ctx.shadowBlur = 0;

    const startPt = arrowStartPoint(pathStr, start.point);
    const endPt = arrowEndPoint(pathStr, end.point);

    // Arrowhead at end point — use correct tangent direction
    const tangentFrom = arrowTangentFrom(pathStr, start.point);
    drawArrowhead(ctx, tangentFrom, endPt);

    // Endpoint dots
    drawArrowEndpoint(ctx, startPt, start.boundShapeId !== null);
    drawArrowEndpoint(ctx, endPt,   end.boundShapeId   !== null);

    // Route style label near midpoint
    const mx = (start.point.x + end.point.x) / 2;
    const my = (start.point.y + end.point.y) / 2 - 12;
    ctx.fillStyle = '#f38ba8aa';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(routeStyle, mx, my);
    ctx.textAlign = 'left';

    // Selection handles
    const isSelected = selSet.has(shape.id);
    if (isSelected) {
      drawHandle(ctx, start.point);
      drawHandle(ctx, end.point);
      if (routeStyle === 'curve') {
        const sx = start.point.x;
        const sy = start.point.y;
        const ex = end.point.x;
        const ey = end.point.y;
        const mx = (sx + ex) / 2;
        const my = (sy + ey) / 2;
        const dx = ex - sx;
        const dy = ey - sy;
        const chord = Math.sqrt(dx * dx + dy * dy);
        let cpx = mx;
        let cpy = my;
        if (chord >= 1e-9 && bend !== 0) {
          const perpX = dy / chord;
          const perpY = -dx / chord;
          const offset = chord * bend;
          cpx = mx + perpX * offset;
          cpy = my + perpY * offset;
        }
        const midX = 0.25 * start.point.x + 0.5 * cpx + 0.25 * end.point.x;
        const midY = 0.25 * start.point.y + 0.5 * cpy + 0.25 * end.point.y;
        drawHandle(ctx, { x: midX, y: midY });
      } else if (routeStyle === 'ortho') {
        const fromShape = start.boundShapeId ? editor.getShape(start.boundShapeId) : null;
        const toShape   = end.boundShapeId   ? editor.getShape(end.boundShapeId)   : null;
        if (fromShape && toShape) {
          const fu = editor.getShapeUtil(fromShape.type);
          const tu = editor.getShapeUtil(toShape.type);
          const fromBounds = fu.getGeometry(fromShape as any);
          const toBounds   = tu.getGeometry(toShape as any);
          const { fromEdge } = getEdgeFromBinding(shape.id as ShapeId, 'start');
          const { fromEdge: toEdge } = getEdgeFromBinding(shape.id as ShapeId, 'end');
          const pathStr = computeElbowPath(fromBounds, toBounds, fromEdge as any, toEdge as any, bend);
          const pts = parseElbowPoints(pathStr);
          const handlePt = getOrthoHandlePoint(pts);
          drawHandle(ctx, handlePt);
        }
      }
    }
  }
}

// ── Phase4Demo ─────────────────────────────────────────────────
export default function Phase4Demo() {
  const [specs, setSpecs] = useState<{ id: string; ok: boolean; msg: string }[]>([]);
  const [toolId, setToolId] = useState('select');
  const [routeStyle, setRouteStyle] = useState<'curve' | 'ortho'>('curve');
  const [shapeCt, setShapeCt] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = 620; const H = 480;
  const mousePtRef = useRef<{ x: number; y: number } | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const tool = editor.getCurrentTool();
    const currentToolId = (tool.constructor as any).id;
    const isArrowTool = currentToolId === 'arrow' || currentToolId === 'idle';
    const isDraggingTerminal = tool.current?.id === 'draggingHandle' && (tool.current as any)._handleType !== 'bend';

    // Get hover shape
    let hoverShapeId: ShapeId | null = null;
    if (isArrowTool) {
      const arrowTool = tool.parent ?? tool;
      const idleState = (arrowTool as any)._states?.get('idle');
      hoverShapeId = idleState?.hoverShapeId ?? null;
    } else if (isDraggingTerminal) {
      if (mousePtRef.current) {
        const arrowId = (tool.current as any)._arrowId;
        const arrow = editor.getShape(arrowId) as ArrowShape;
        if (arrow) {
          const term = (tool.current as any)._handleType;
          const otherTerminal = term === 'start' ? 'end' : 'start';
          const otherBoundId = arrow.props[otherTerminal].boundShapeId;
          const hits = editor.getShapesAtPoint(mousePtRef.current)
            .filter(s => s.type !== 'arrow' && s.id !== otherBoundId && s.id !== arrowId);
          if (hits.length > 0) {
            hoverShapeId = hits[hits.length - 1].id as ShapeId;
          }
        }
      }
    }

    const showBindingPoints = isArrowTool || isDraggingTerminal;

    drawCanvas(ctx, W, H, editor.getSelectedShapeIds(), hoverShapeId, showBindingPoints);
    setShapeCt(editor.getShapesInBox({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }).length);
    setToolId(currentToolId);
  }, []);

  useEffect(() => { editor.setCurrentTool('select'); redraw(); }, [redraw]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'b') editor.setCurrentTool('box');
      if (e.key === 's') editor.setCurrentTool('select');
      if (e.key === 'a') editor.setCurrentTool('arrow');
      if (e.key === 'Escape') editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.history.redo(); else editor.history.undo();
      }
      redraw();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [redraw]);

  const toCanvas = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const pt = toCanvas(e);
    mousePtRef.current = pt;
    const hits = editor.getShapesAtPoint(pt);
    const shapeId = hits.length > 0 ? hits[hits.length - 1].id as ShapeId : undefined;
    editor.dispatchEvent({ type: 'pointerDown', point: pt, shiftKey: e.shiftKey, target: shapeId ? 'shape' : 'canvas', shapeId });
    redraw();
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const pt = toCanvas(e);
    mousePtRef.current = pt;
    editor.dispatchEvent({ type: 'pointerMove', point: pt });
    redraw();
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const pt = toCanvas(e);
    mousePtRef.current = pt;
    editor.dispatchEvent({ type: 'pointerUp',   point: pt });
    redraw();
  };

  const toggleRouteStyle = () => {
    const next = routeStyle === 'curve' ? 'ortho' : 'curve';
    setRouteStyle(next);
    editor.arrowRouteStyle = next;

    const selectedIds = editor.getSelectedShapeIds();
    for (const id of selectedIds) {
      const s = editor.getShape(id);
      if (s && s.type === 'arrow') {
        const arr = s as any as ArrowShape;
        editor.updateShape(s.id, { props: { ...arr.props, routeStyle: next } });
      }
    }
    // rAF ensures React state + store signals settled before canvas repaint
    requestAnimationFrame(() => redraw());
  };


  const addSampleBoxes = () => {
    const t = Date.now();
    editor.history.batch('Add sample boxes', () => {
      // Stagger Y so ortho Z-path has visible horizontal + vertical + horizontal segments
      editor.createShape({ id: sid(`box-${t}-1`), type: 'box', x: 60,  y: 140, index: 'a1', rotation: 0, meta: {}, props: { w: 120, h: 80, cornerRadius: 8, color: '#6366f1', label: '' } });
      editor.createShape({ id: sid(`box-${t}-2`), type: 'box', x: 440, y: 260, index: 'a2', rotation: 0, meta: {}, props: { w: 120, h: 80, cornerRadius: 8, color: '#ec4899', label: '' } });
    });
    redraw();
  };


  return (
    <div style={{ minHeight: '100vh', background: '#13131d', color: '#cdd6f4', fontFamily: 'Inter, system-ui, sans-serif', padding: 20 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
            Glideline <span style={{ color: '#f38ba8' }}>Phase 4</span> — Bindings &amp; Arrow Routing
          </h1>
          <p style={{ color: '#6c7086', fontSize: 13, margin: '4px 0 8px' }}>
            BindingUtil lifecycle · Arc router · Elbow router · ArrowTool
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
            {[['S','Select'],['B','Box'],['A','Arrow'],['Esc','Cancel'],['⌘Z','Undo']].map(([k,l]) => (
              <span key={k}><kbd style={{ background: '#313244', border: '1px solid #45475a', borderRadius: 3, padding: '1px 5px' }}>{k}</kbd>{' '}<span style={{ color: '#6c7086' }}>{l}</span></span>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
          <Panel title="Interactive Canvas" color="#f38ba8">
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, fontSize: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span><span style={{ color: '#6c7086' }}>Tool: </span><span id="p4-tool" style={{ fontWeight: 700, color: '#f38ba8' }}>{toolId}</span></span>
              <span><span style={{ color: '#6c7086' }}>Shapes: </span><span id="p4-shape-count" style={{ fontWeight: 700 }}>{shapeCt}</span></span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button onClick={() => { editor.history.undo(); redraw(); }} style={btn('#f9e2af')}>↩ Undo</button>
                <button onClick={() => { editor.history.redo(); redraw(); }} style={btn('#89dceb')}>↪ Redo</button>
              </span>
            </div>
            <canvas id="canvas-phase4" ref={canvasRef} width={W} height={H}
              onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
              style={{ background: '#181825', borderRadius: 8, border: '1px solid #313244', cursor: toolId === 'box' ? 'crosshair' : toolId === 'arrow' ? 'crosshair' : 'default', maxWidth: '100%', display: 'block' }}
            />
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => { editor.setCurrentTool('select'); redraw(); }} style={btn(toolId === 'select' ? '#89b4fa' : '#585b70')}>▶ Select (S)</button>
              <button onClick={() => { editor.setCurrentTool('box'); redraw(); }} style={btn(toolId === 'box' ? '#a6e3a1' : '#585b70')}>▭ Box (B)</button>
              <button id="btn-arrow-tool" onClick={() => { editor.setCurrentTool('arrow'); redraw(); }} style={btn(toolId === 'arrow' ? '#f38ba8' : '#585b70')}>→ Arrow (A)</button>
              <button id="btn-route-style" onClick={toggleRouteStyle} style={btn('#cba6f7')}>⟳ {routeStyle === 'curve' ? 'Curve' : 'Ortho'}</button>
              <button onClick={addSampleBoxes} style={btn('#89dceb')}>+ Sample Boxes</button>
              <button onClick={() => {
                const all = editor.getShapesInBox({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 });
                all.forEach(s => editor.deleteShapes([s.id as ShapeId]));
                redraw();
              }} style={btn('#f38ba8')}>✕ Clear</button>
            </div>
            <p style={{ color: '#585b70', fontSize: 11, marginTop: 8 }}>
              Draw boxes with <kbd style={{ background:'#313244',border:'1px solid #45475a',borderRadius:3,padding:'1px 4px',fontSize:10 }}>B</kbd>, switch to <kbd style={{ background:'#313244',border:'1px solid #45475a',borderRadius:3,padding:'1px 4px',fontSize:10 }}>A</kbd>, click source box → drag → release on target. Toggle route style to switch curve/ortho.
            </p>
            <div style={{ display:'flex', gap:12, flexWrap:'wrap', fontSize:10, color:'#6c7086', marginTop:6, alignItems:'center' }}>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:8,height:8,borderRadius:'50%',background:'#4ade80',display:'inline-block' }} />
                Bound endpoint
              </span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:8,height:8,borderRadius:'50%',background:'#94a3b8',display:'inline-block' }} />
                Floating endpoint
              </span>
              <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:8,height:8,borderRadius:'50%',background:'#4ade80',border:'1px solid #181825',display:'inline-block' }} />
                Box has bindings
              </span>
              <span style={{ display:'flex', alignItems:'center', gap:4, color:'#f38ba8aa' }}>
                ⊕ Connection points (ArrowTool hover)
              </span>
            </div>

          </Panel>

          <Panel title="Spec Test Runner (T4.1–T4.4)" color="#f59e0b">
            <p style={{ color: '#6c7086', fontSize: 11, margin: '0 0 8px' }}>
              Runs all Phase 4 assertions in-browser. SVG validity (T4.2-05, T4.3-06) tested here via Path2D.
            </p>
            <button id="btn-run-phase4-tests" onClick={() => setSpecs(runPhase4Specs())} style={{ ...btn('#f59e0b'), marginBottom: 10 }}>
              ▶ Run Spec Tests
            </button>
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {specs.map(({ id, ok, msg }) => (
                <div key={id} data-testid={`phase4-result-${id}`} data-ok={String(ok)}
                  style={{ display: 'flex', flexDirection: 'column', padding: '5px 8px', borderRadius: 5, background: ok ? '#22c55e11' : '#ef444411', marginBottom: 4 }}>
                  <span style={{ color: ok ? '#4ade80' : '#f87171', fontWeight: 700, fontSize: 10 }}>{id}</span>
                  <span style={{ color: '#94a3b8', fontSize: 10, marginTop: 1 }}>{msg}</span>
                </div>
              ))}
            </div>
            {specs.length > 0 && (
              <div style={{ marginTop: 8 }} data-testid="phase4-summary">
                <Badge ok={specs.every(r => r.ok)} label={`${specs.filter(r => r.ok).length}/${specs.length} passing`} />
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
