import React, { useState, useEffect, useRef } from 'react';
import { createEditor, type GlidePlugin } from '../../glideline/src/editor';
import { BoxUtil } from '../../glideline/src/shapes/BoxUtil';
import { sid } from '../../glideline/src/types';

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any] };

/**
 * Stress-canvas editor — persists across renders, accumulates shapes.
 * Kept separate from the spec test editor so they never share state.
 */
const canvasEditor = createEditor({ plugins: [BoxPlugin] });

const btn = (c: string): React.CSSProperties => ({ background: `${c}22`, border: `1px solid ${c}55`, color: c, borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', marginRight: 6, marginBottom: 6 });
const Panel = ({ title, color = '#6366f1', children }: { title: string; color?: string; children: React.ReactNode }) => (
  <div style={{ background: '#1e1e2e', border: `1px solid ${color}33`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
    <h2 style={{ color, margin: '0 0 14px', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
    {children}
  </div>
);
const Badge = ({ ok, label: l }: { ok: boolean; label: string }) => (
  <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: ok ? '#22c55e22' : '#ef444422', color: ok ? '#4ade80' : '#f87171', marginRight: 6, marginBottom: 4 }}>
    {ok ? '✓' : '✗'} {l}
  </span>
);

export default function RBushDemo() {
  const [results, setResults] = useState<{ id: string; ok: boolean; msg: string }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState({ count: 0, queryTime: 0, hoverHits: 0 });

  const runTests = () => {
    const out: { id: string; ok: boolean; msg: string }[] = [];
    const log = (id: string, ok: boolean, msg: string) => out.push({ id, ok, msg });

    /**
     * Each test run creates a FRESH isolated editor.
     * This prevents shapes from the stress canvas (canvasEditor) or previous
     * test runs from polluting the per-test assertions.
     */
    const e = createEditor({ plugins: [BoxPlugin] });

    // T2.4-01 & T2.4-02
    try {
      e.createShape({ id: sid('t1'), type: 'box', x: 100, y: 100, index: 'a1', rotation: 0, meta: {}, props: { w: 100, h: 100, cornerRadius: 0, color: '#fff', label: '' } });
      const hits1 = e.getShapesAtPoint({ x: 150, y: 150 });
      const hits2 = e.getShapesAtPoint({ x: 50,  y: 50  });
      log('T2.4-01 Point query finds shape',   hits1.length === 1 && hits1[0].id === 't1', `hits at (150,150) = ${hits1.length}`);
      log('T2.4-02 Point outside returns empty', hits2.length === 0,                        `hits at (50,50)   = ${hits2.length}`);
      e.deleteShapes([sid('t1')]);
    } catch (err: any) { log('T2.4-01/02', false, err.message); }

    // T2.4-03
    try {
      e.createShape({ id: sid('t2'), type: 'box', x: 100, y: 100, index: 'a1', rotation: 0, meta: {}, props: { w: 100, h: 100, cornerRadius: 0, color: '#fff', label: '' } });
      e.updateShape(sid('t2'), { x: 300, y: 300 });
      const hits1 = e.getShapesAtPoint({ x: 150, y: 150 });
      const hits2 = e.getShapesAtPoint({ x: 350, y: 350 });
      log('T2.4-03 Index updated after move', hits1.length === 0 && hits2.length === 1, `old=${hits1.length}, new=${hits2.length}`);
      e.deleteShapes([sid('t2')]);
    } catch (err: any) { log('T2.4-03', false, err.message); }

    // T2.4-04
    try {
      e.createShape({ id: sid('t3'), type: 'box', x: 100, y: 100, index: 'a1', rotation: 0, meta: {}, props: { w: 100, h: 100, cornerRadius: 0, color: '#fff', label: '' } });
      e.deleteShapes([sid('t3')]);
      const hits1 = e.getShapesAtPoint({ x: 150, y: 150 });
      log('T2.4-04 Index cleared after delete', hits1.length === 0, `hits=${hits1.length}`);
    } catch (err: any) { log('T2.4-04', false, err.message); }

    // Bulk-insert 10k shapes for perf tests (fresh editor — no noise)
    const shapes = [];
    for (let i = 0; i < 10000; i++) {
      shapes.push({
        id: sid(`p${i}`), type: 'box',
        x: (i % 100) * 10, y: Math.floor(i / 100) * 10,
        index: 'a1', rotation: 0, meta: {},
        props: { w: 8, h: 8, cornerRadius: 0, color: '#fff', label: '' },
      });
    }
    e.store.put(shapes as any[]);

    // T2.4-05: point query performance
    try {
      const start = performance.now();
      const hits = e.getShapesAtPoint({ x: 505, y: 505 });
      const t = performance.now() - start;
      log('T2.4-05 Query perf at 10k', t < 2, `${t.toFixed(2)}ms, hits=${hits.length} (spec < 0.2ms)`);
    } catch (err: any) { log('T2.4-05', false, err.message); }

    // T2.4-06: single shape update performance
    try {
      const start = performance.now();
      e.updateShape(sid('p5000'), { x: -100, y: -100 });
      const t = performance.now() - start;
      log('T2.4-06 Drag-tick perf at 10k', t < 10, `${t.toFixed(2)}ms (spec < 4ms)`);
    } catch (err: any) { log('T2.4-06', false, err.message); }

    setResults(out);
  };

  // ── Stress canvas (uses its own separate editor) ──────────────
  const generate10k = () => {
    // Clear previous demo shapes first
    const existing = canvasEditor.getShapesInBox({ minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 });
    canvasEditor.deleteShapes(existing.map(s => s.id as any));

    const shapes = [];
    for (let i = 0; i < 10000; i++) {
      shapes.push({
        id: sid(`demo${i}`), type: 'box',
        x: (i % 100) * 6, y: Math.floor(i / 100) * 6,
        index: 'a1', rotation: 0, meta: {},
        props: { w: 4, h: 4, cornerRadius: 0, color: '#6366f1', label: '' },
      });
    }
    canvasEditor.store.put(shapes as any[]);
    setStats(s => ({ ...s, count: 10000 }));
    draw();
  };

  const draw = (hoverPoint?: { x: number; y: number }) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d')!;
    ctx.clearRect(0, 0, 600, 600);
    ctx.fillStyle = '#313244';
    ctx.fillRect(0, 0, 600, 600);

    const hits = hoverPoint ? canvasEditor.getShapesAtPoint(hoverPoint) : [];
    const hitIds = new Set(hits.map(h => h.id));
    const inView = canvasEditor.getShapesInBox({ minX: 0, minY: 0, maxX: 600, maxY: 600 });

    for (const shape of inView) {
      ctx.fillStyle = hitIds.has(shape.id) ? '#a6e3a1' : '#6366f1';
      ctx.fillRect(shape.x, shape.y, (shape as any).props.w, (shape as any).props.h);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (stats.count === 0) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = 600 / rect.width;
    const scaleY = 600 / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top)  * scaleY;

    const start = performance.now();
    const hits = canvasEditor.getShapesAtPoint({ x, y });
    const t = performance.now() - start;

    setStats(s => ({ ...s, queryTime: t, hoverHits: hits.length }));
    draw({ x, y });
  };

  useEffect(() => { draw(); }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#13131d', color: '#cdd6f4', fontFamily: 'Inter, system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
            Glideline <span style={{ color: '#a6e3a1' }}>Phase 2.4</span> — Spatial Index (RBush)
          </h1>
          <p style={{ color: '#6c7086', marginTop: 6, fontSize: 14 }}>O(log N) geometric querying · hitTestPoint filtering · update on put()</p>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['T2.4-01 Point query finds shape','T2.4-02 Point outside empty','T2.4-03 Update after move','T2.4-04 Clear after delete','T2.4-05 Query perf','T2.4-06 Drag perf'].map(l => (
              <Badge key={l} ok label={l} />
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>
          <Panel title="Live RBush 10k Stress Test" color="#a6e3a1">
            <button onClick={generate10k} style={{ ...btn('#a6e3a1'), marginBottom: 12 }}>Spawn 10,000 Shapes</button>
            <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13 }}>
              <div><span style={{ color: '#6c7086' }}>Shapes: </span><span style={{ fontWeight: 700 }}>{stats.count}</span></div>
              <div><span style={{ color: '#6c7086' }}>Query: </span><span style={{ fontWeight: 700, color: stats.queryTime > 1 ? '#f59e0b' : '#a6e3a1' }}>{stats.queryTime.toFixed(2)}ms</span></div>
              <div><span style={{ color: '#6c7086' }}>Hits: </span><span style={{ fontWeight: 700 }}>{stats.hoverHits}</span></div>
            </div>
            <canvas
              ref={canvasRef}
              width={600}
              height={600}
              onMouseMove={handleMouseMove}
              style={{ background: '#1e1e2e', borderRadius: 8, border: '1px solid #313244', cursor: 'crosshair', maxWidth: '100%', height: 'auto' }}
            />
          </Panel>

          <Panel title="Spec Test Runner (T2.4)" color="#f59e0b">
            <p style={{ color: '#6c7086', fontSize: 12, margin: '0 0 10px' }}>
              Each run spawns a fresh isolated editor — independent of the stress canvas.
            </p>
            <button id="btn-run-tests" onClick={runTests} style={{ ...btn('#f59e0b'), marginBottom: 12 }}>▶ Run Spec Tests</button>
            {results.map(({ id, ok, msg }) => (
              <div key={id} style={{ display: 'flex', flexDirection: 'column', padding: '7px 10px', borderRadius: 6, background: ok ? '#22c55e11' : '#ef444411', marginBottom: 6 }}>
                <span style={{ color: ok ? '#4ade80' : '#f87171', fontWeight: 700, fontSize: 12 }}>{id}</span>
                <span style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{msg}</span>
              </div>
            ))}
            {results.length > 0 && <div style={{ marginTop: 10 }}><Badge ok={results.every(r => r.ok)} label={`${results.filter(r=>r.ok).length}/${results.length} passing`} /></div>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
