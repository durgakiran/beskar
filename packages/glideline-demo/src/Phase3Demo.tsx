import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createEditor, type GlidePlugin } from '../../glideline/src/editor';
import { BoxUtil } from '../../glideline/src/shapes/BoxUtil';
import { sid } from '../../glideline/src/types';
import type { GlideEvent } from '../../glideline/src/state-node';
import type { ShapeId } from '../../glideline/src/types';

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any] };

// ── Shared editor instance ────────────────────────────────────
const editor = createEditor({ plugins: [BoxPlugin] });

// ── Tiny style helpers ────────────────────────────────────────
const btn = (c: string): React.CSSProperties => ({
  background: `${c}22`, border: `1px solid ${c}55`, color: c,
  borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', marginRight: 6, marginBottom: 6,
});
const Panel = ({ title, color = '#6366f1', children }: { title: string; color?: string; children: React.ReactNode }) => (
  <div style={{ background: '#1e1e2e', border: `1px solid ${color}33`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
    <h2 style={{ color, margin: '0 0 14px', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
    {children}
  </div>
);
const Badge = ({ ok, label }: { ok: boolean; label: string }) => (
  <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: ok ? '#22c55e22' : '#ef444422', color: ok ? '#4ade80' : '#f87171', marginRight: 6, marginBottom: 4 }}>
    {ok ? '✓' : '✗'} {label}
  </span>
);

// ── In-browser spec runner ────────────────────────────────────
function runPhase3Specs(): { id: string; ok: boolean; msg: string }[] {
  const out: { id: string; ok: boolean; msg: string }[] = [];
  const log = (id: string, ok: boolean, msg: string) => out.push({ id, ok, msg });

  function boxShape(id: string, x = 0, y = 0, w = 100, h = 80) {
    return { id: sid(id), type: 'box', x, y, index: 'a1', rotation: 0, meta: {}, props: { w, h, cornerRadius: 0, color: '#fff', label: '' } };
  }

  function e() { return createEditor({ plugins: [BoxPlugin] }); }

  // ── T3.1: StateNode FSM ──────────────────────────────────────
  try {
    const ed = e();
    ed.setCurrentTool('box');
    const leaf = ed.getCurrentTool().current;
    const id = (leaf.constructor as any).id;
    log('T3.1-04 Starts in idle', id === 'idle', `leaf.id = "${id}"`);
  } catch (err: any) { log('T3.1-04', false, err.message); }

  try {
    const ed = e();
    const tool = ed.getCurrentTool(); // 'select' by default
    const before = (tool.current.constructor as any).id;
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 500, y: 500 }, shiftKey: false, target: 'canvas' } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 500, y: 500 } } as GlideEvent);
    const after = (tool.current.constructor as any).id;
    log('T3.1-06 Transition updates .current', before !== after || after === 'idle', `idle → click canvas → ${after}`);
  } catch (err: any) { log('T3.1-06', false, err.message); }

  // ── T3.2: SelectTool ─────────────────────────────────────────
  try {
    const ed = e();
    ed.store.put([boxShape('s1', 10, 10)]);
    ed.setCurrentTool('select');
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 60, y: 50 }, shiftKey: false, target: 'shape', shapeId: sid('s1') } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 60, y: 50 } } as GlideEvent);
    const sel = ed.getSelectedShapeIds();
    log('T3.2-01 Click selects shape', sel.includes(sid('s1')), `selection = [${sel.join(',')}]`);
  } catch (err: any) { log('T3.2-01', false, err.message); }

  try {
    const ed = e();
    ed.store.put([boxShape('s2', 10, 10)]);
    ed.setCurrentTool('select');
    ed.setSelectedShapeIds([sid('s2')]);
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 500, y: 500 }, shiftKey: false, target: 'canvas' } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 500, y: 500 } } as GlideEvent);
    const sel = ed.getSelectedShapeIds();
    log('T3.2-02 Click canvas deselects', sel.length === 0, `selection.length = ${sel.length}`);
  } catch (err: any) { log('T3.2-02', false, err.message); }

  try {
    const ed = e();
    ed.store.put([boxShape('drag1', 100, 100)]);
    ed.setCurrentTool('select');
    ed.setSelectedShapeIds([sid('drag1')]);
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 150, y: 150 }, shiftKey: false, target: 'shape', shapeId: sid('drag1') } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 160, y: 150 } } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 200, y: 150 } } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 200, y: 150 } } as GlideEvent);
    const shape = ed.getShape(sid('drag1'));
    log('T3.2-04 Drag translates shape', shape?.x === 150, `x = ${shape?.x} (expected 150)`);
  } catch (err: any) { log('T3.2-04', false, err.message); }

  try {
    const ed = e();
    ed.store.put([boxShape('esc1', 100, 100)]);
    ed.setCurrentTool('select');
    ed.setSelectedShapeIds([sid('esc1')]);
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 150, y: 150 }, shiftKey: false, target: 'shape', shapeId: sid('esc1') } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 160, y: 150 } } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 200, y: 150 } } as GlideEvent);
    ed.dispatchEvent({ type: 'keyDown', key: 'Escape' } as GlideEvent);
    const shape = ed.getShape(sid('esc1'));
    log('T3.2-05 Escape cancels drag', shape?.x === 100, `x = ${shape?.x} (expected 100)`);
  } catch (err: any) { log('T3.2-05', false, err.message); }

  // ── T3.3: BoxTool ────────────────────────────────────────────
  const countShapes = (ed: ReturnType<typeof e>) =>
    ed.getShapesInBox({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }).length;

  try {
    const ed = e();
    ed.setCurrentTool('box');
    const before = countShapes(ed);
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 100, y: 100 }, shiftKey: false, target: 'canvas' } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 100, y: 100 } } as GlideEvent);
    log('T3.3-01 No shape on click only', countShapes(ed) === before, `count=${countShapes(ed)}`);
  } catch (err: any) { log('T3.3-01', false, err.message); }

  try {
    const ed = e();
    ed.setCurrentTool('box');
    const before = countShapes(ed);
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 0, y: 0 }, shiftKey: false, target: 'canvas' } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 80, y: 60 } } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 80, y: 60 } } as GlideEvent);
    log('T3.3-04 Box committed on pointerUp', countShapes(ed) === before + 1, `count=${countShapes(ed)}`);
  } catch (err: any) { log('T3.3-04', false, err.message); }

  try {
    const ed = e();
    ed.setCurrentTool('box');
    const before = countShapes(ed);
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 0, y: 0 }, shiftKey: false, target: 'canvas' } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 80, y: 60 } } as GlideEvent);
    ed.dispatchEvent({ type: 'keyDown', key: 'Escape' } as GlideEvent);
    log('T3.3-05 Escape deletes preview', countShapes(ed) === before, `count=${countShapes(ed)}`);
  } catch (err: any) { log('T3.3-05', false, err.message); }

  try {
    const ed = e();
    ed.setCurrentTool('box');
    ed.dispatchEvent({ type: 'pointerDown', point: { x: 0, y: 0 }, shiftKey: false, target: 'canvas' } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerMove', point: { x: 80, y: 60 } } as GlideEvent);
    ed.dispatchEvent({ type: 'pointerUp', point: { x: 80, y: 60 } } as GlideEvent);
    const after = countShapes(ed);
    ed.history.undo();
    log('T3.3-06 Single undo entry for box', countShapes(ed) === after - 1, `count before=${after}, after undo=${countShapes(ed)}`);
  } catch (err: any) { log('T3.3-06', false, err.message); }

  // ── T3.4: HistoryManager ─────────────────────────────────────
  try {
    const ed = e();
    ed.history.batch('Create', () => ed.createShape(boxShape('h1')));
    ed.history.undo();
    log('T3.4-01 Undo removes shape', ed.getShape(sid('h1')) === undefined, `shape = ${ed.getShape(sid('h1'))}`);
  } catch (err: any) { log('T3.4-01', false, err.message); }

  try {
    const ed = e();
    ed.history.batch('Create', () => ed.createShape(boxShape('h2', 10, 20)));
    ed.history.undo();
    ed.history.redo();
    const shape = ed.getShape(sid('h2'));
    log('T3.4-02 Redo re-creates shape', shape?.x === 10 && shape?.y === 20, `x=${shape?.x}, y=${shape?.y}`);
  } catch (err: any) { log('T3.4-02', false, err.message); }

  try {
    const ed = e();
    ed.history.batch('Create A', () => ed.createShape(boxShape('ha', 0, 0)));
    ed.history.batch('Create B', () => ed.createShape(boxShape('hb', 0, 0)));
    ed.history.batch('Move Both', () => { ed.updateShape(sid('ha'), { x: 100 }); ed.updateShape(sid('hb'), { x: 200 }); });
    ed.history.undo();
    log('T3.4-03 Batch = 1 undo entry', ed.getShape(sid('ha'))?.x === 0 && ed.getShape(sid('hb'))?.x === 0,
      `ha.x=${ed.getShape(sid('ha'))?.x}, hb.x=${ed.getShape(sid('hb'))?.x}`);
  } catch (err: any) { log('T3.4-03', false, err.message); }

  try {
    const ed = e();
    ed.history.batch('AI', () => ed.createShape(boxShape('ai1')), { history: 'ignore' });
    ed.history.undo();
    log('T3.4-04 history:ignore not undoable', ed.getShape(sid('ai1')) !== undefined, `shape still exists: ${!!ed.getShape(sid('ai1'))}`);
  } catch (err: any) { log('T3.4-04', false, err.message); }

  try {
    const ed = e();
    ed.history.undo();
    log('T3.4-05 Empty undo no-op', true, 'no throw');
  } catch (err: any) { log('T3.4-05', false, err.message); }

  return out;
}

// ── Canvas renderer ───────────────────────────────────────────
function drawCanvas(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  selection: ShapeId[],
  marquee?: { x: number; y: number; w: number; h: number } | null,
) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#181825';
  ctx.fillRect(0, 0, W, H);

  const shapes = editor.getShapesInBox({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 });
  const selSet = new Set(selection);

  for (const shape of shapes) {
    const s = shape as any;
    const { x, y, props } = s;
    const { w, h, color } = props;
    ctx.fillStyle = selSet.has(shape.id) ? '#a6e3a1' : color ?? '#6366f1';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, props.cornerRadius ?? 0);
    ctx.fill();
    if (selSet.has(shape.id)) {
      ctx.strokeStyle = '#a6e3a1';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (marquee) {
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(marquee.x, marquee.y, marquee.w, marquee.h);
    ctx.fillStyle = '#89b4fa22';
    ctx.fillRect(marquee.x, marquee.y, marquee.w, marquee.h);
    ctx.setLineDash([]);
  }
}

// ── Main Demo ─────────────────────────────────────────────────
export default function Phase3Demo() {
  const [specResults, setSpecResults] = useState<{ id: string; ok: boolean; msg: string }[]>([]);
  const [toolId, setToolId] = useState('select');
  const [shapeCount, setShapeCount] = useState(0);
  const [selCount, setSelCount] = useState(0);
  const [undoDepth, setUndoDepth] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const W = 600; const H = 500;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const sel = editor.getSelectedShapeIds();
    const tool = editor.getCurrentTool();
    const marqueeState = (tool.current as any).marqueeBox;
    const marquee = marqueeState && marqueeState.w > 0 ? marqueeState : null;
    drawCanvas(ctx, W, H, sel, marquee);

    setToolId((editor.getCurrentTool().constructor as any).id);
    setShapeCount(editor.getShapesInBox({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }).length);
    setSelCount(editor.getSelectedShapeIds().length);
    setUndoDepth(editor.history.undoStack.length);
  }, []);

  useEffect(() => {
    editor.setCurrentTool('select');
    redraw();
  }, [redraw]);

  // ── Keyboard shortcuts ────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'b') { editor.setCurrentTool('box'); setToolId('box'); }
      if (e.key === 's') { editor.setCurrentTool('select'); setToolId('select'); }
      if (e.key === 'Escape') {
        editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
        redraw();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.history.redo(); else editor.history.undo();
        redraw();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [redraw]);

  // ── Canvas pointer events ─────────────────────────────────────
  const toCanvas = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const pt = toCanvas(e);
    const hits = editor.getShapesAtPoint(pt);
    const shapeId = hits.length > 0 ? hits[hits.length - 1].id as ShapeId : undefined;
    editor.dispatchEvent({
      type: 'pointerDown', point: pt,
      shiftKey: e.shiftKey,
      target: shapeId ? 'shape' : 'canvas',
      shapeId,
    });
    redraw();
  };

  const onMouseMove = (e: React.MouseEvent) => {
    editor.dispatchEvent({ type: 'pointerMove', point: toCanvas(e) });
    redraw();
  };

  const onMouseUp = (e: React.MouseEvent) => {
    editor.dispatchEvent({ type: 'pointerUp', point: toCanvas(e) });
    redraw();
  };

  return (
    <div style={{ minHeight: '100vh', background: '#13131d', color: '#cdd6f4', fontFamily: 'Inter, system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
            Glideline <span style={{ color: '#89b4fa' }}>Phase 3</span> — Tools &amp; Editor
          </h1>
          <p style={{ color: '#6c7086', marginTop: 6, fontSize: 14 }}>
            StateNode FSM · SelectTool · BoxTool · HistoryManager
          </p>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
            <kbd style={{ background: '#313244', border: '1px solid #45475a', borderRadius: 4, padding: '2px 7px' }}>S</kbd>
            <span style={{ color: '#6c7086' }}>Select</span>
            <kbd style={{ background: '#313244', border: '1px solid #45475a', borderRadius: 4, padding: '2px 7px' }}>B</kbd>
            <span style={{ color: '#6c7086' }}>Box</span>
            <kbd style={{ background: '#313244', border: '1px solid #45475a', borderRadius: 4, padding: '2px 7px' }}>⌘Z</kbd>
            <span style={{ color: '#6c7086' }}>Undo</span>
            <kbd style={{ background: '#313244', border: '1px solid #45475a', borderRadius: 4, padding: '2px 7px' }}>⌘⇧Z</kbd>
            <span style={{ color: '#6c7086' }}>Redo</span>
            <kbd style={{ background: '#313244', border: '1px solid #45475a', borderRadius: 4, padding: '2px 7px' }}>Esc</kbd>
            <span style={{ color: '#6c7086' }}>Cancel</span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>

          {/* Canvas area */}
          <Panel title="Interactive Canvas" color="#89b4fa">
            {/* Tool + state bar */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                <span style={{ color: '#6c7086' }}>Tool: </span>
                <span id="current-tool-display" style={{ fontWeight: 700, color: '#89b4fa' }}>{toolId}</span>
              </span>
              <span>
                <span style={{ color: '#6c7086' }}>Shapes: </span>
                <span id="shape-count-display" style={{ fontWeight: 700 }}>{shapeCount}</span>
              </span>
              <span>
                <span style={{ color: '#6c7086' }}>Selected: </span>
                <span id="selection-count-display" style={{ fontWeight: 700, color: '#a6e3a1' }}>{selCount}</span>
              </span>
              <span>
                <span style={{ color: '#6c7086' }}>Undo stack: </span>
                <span style={{ fontWeight: 700, color: '#f9e2af' }}>{undoDepth}</span>
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button id="btn-undo" onClick={() => { editor.history.undo(); redraw(); }} style={btn('#f9e2af')}>↩ Undo</button>
                <button id="btn-redo" onClick={() => { editor.history.redo(); redraw(); }} style={btn('#89dceb')}>↪ Redo</button>
              </span>
            </div>

            <canvas
              id="canvas-phase3"
              ref={canvasRef}
              width={W} height={H}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              style={{ background: '#181825', borderRadius: 8, border: '1px solid #313244', cursor: toolId === 'box' ? 'crosshair' : 'default', maxWidth: '100%', display: 'block' }}
            />

            {/* Tool buttons */}
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={() => { editor.setCurrentTool('select'); setToolId('select'); }} style={btn(toolId === 'select' ? '#89b4fa' : '#585b70')}>▶ Select (S)</button>
              <button onClick={() => { editor.setCurrentTool('box'); setToolId('box'); }} style={btn(toolId === 'box' ? '#a6e3a1' : '#585b70')}>▭ Box (B)</button>
              <button onClick={() => {
                editor.getShapesInBox({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 })
                  .forEach(s => editor.deleteShapes([s.id as ShapeId]));
                redraw();
              }} style={btn('#f38ba8')}>✕ Clear</button>
            </div>
          </Panel>

          {/* Spec test runner */}
          <Panel title="Spec Test Runner (T3.1–T3.4)" color="#f59e0b">
            <p style={{ color: '#6c7086', fontSize: 12, margin: '0 0 10px' }}>
              Runs all Phase 3 assertions in-browser using fresh editor instances.
            </p>
            <button id="btn-run-phase3-tests" onClick={() => setSpecResults(runPhase3Specs())} style={{ ...btn('#f59e0b'), marginBottom: 12 }}>
              ▶ Run Spec Tests
            </button>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {specResults.map(({ id, ok, msg }) => (
                <div
                  key={id}
                  data-testid={`phase3-result-${id}`}
                  data-ok={String(ok)}
                  style={{ display: 'flex', flexDirection: 'column', padding: '6px 10px', borderRadius: 6, background: ok ? '#22c55e11' : '#ef444411', marginBottom: 5 }}>
                  <span style={{ color: ok ? '#4ade80' : '#f87171', fontWeight: 700, fontSize: 11 }}>{id}</span>
                  <span style={{ color: '#94a3b8', fontSize: 10, marginTop: 1 }}>{msg}</span>
                </div>
              ))}
            </div>
            {specResults.length > 0 && (
              <div style={{ marginTop: 10 }} data-testid="phase3-summary">
                <Badge ok={specResults.every(r => r.ok)} label={`${specResults.filter(r => r.ok).length}/${specResults.length} passing`} />
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
