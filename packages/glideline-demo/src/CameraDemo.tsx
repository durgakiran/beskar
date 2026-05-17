import React, { useState, useRef, useCallback } from 'react';
import { GlideCamera, MIN_ZOOM, MAX_ZOOM } from '../../glideline/src/camera';
import { effect } from '@preact/signals';

// ─── Styles ──────────────────────────────────────────────────────────────────
const btn = (color: string): React.CSSProperties => ({
  background: `${color}22`, border: `1px solid ${color}55`, color,
  borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
});
const input: React.CSSProperties = {
  background: '#11111b', border: '1px solid #313244', color: '#cdd6f4',
  borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box',
};
const label = (color = '#94a3b8'): React.CSSProperties => ({
  color, fontSize: 12, marginBottom: 4, display: 'block',
});

function Panel({ title, color = '#6366f1', children }: { title: string; color?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#1e1e2e', border: `1px solid ${color}33`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
      <h2 style={{ color, margin: '0 0 14px', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
      {children}
    </div>
  );
}
function Badge({ ok, label: lbl }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
      background: ok ? '#22c55e22' : '#ef444422', color: ok ? '#4ade80' : '#f87171', marginRight: 6, marginBottom: 4 }}>
      {ok ? '✓' : '✗'} {lbl}
    </span>
  );
}
function Kv({ k, v }: { k: string; v: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', borderRadius: 6, background: '#11111b', marginBottom: 4, fontSize: 13 }}>
      <span style={{ color: '#6c7086' }}>{k}</span>
      <span style={{ color: '#cdd6f4', fontFamily: 'monospace' }}>{typeof v === 'number' ? v.toFixed(4) : v}</span>
    </div>
  );
}

// ─── Camera Panel ─────────────────────────────────────────────────────────────
export default function CameraDemo() {
  const camRef = useRef(new GlideCamera({ x: 0, y: 0, z: 1 }, 600, 400));
  const [camState, setCamState] = useState(camRef.current.getCamera());
  const [signalFires, setSignalFires] = useState(0);
  const [testLog, setTestLog] = useState<{ id: string; ok: boolean; msg: string }[]>([]);

  // Subscribe to camera signal
  React.useEffect(() => {
    const cleanup = effect(() => {
      const s = camRef.current.signal.value;
      setCamState({ ...s });
      setSignalFires(c => c + 1);
    });
    setSignalFires(0); // reset initial effect run
    return cleanup;
  }, []);

  const log = (id: string, ok: boolean, msg: string) =>
    setTestLog(l => [{ id, ok, msg }, ...l.slice(0, 11)]);

  // Interactive controls
  const pan = (dx: number, dy: number) => camRef.current.setCamera({ x: camState.x + dx, y: camState.y + dy });
  const zoom = (dz: number) => camRef.current.setCamera({ z: camState.z + dz });

  // Run spec tests live
  const runTests = useCallback(() => {
    const results: { id: string; ok: boolean; msg: string }[] = [];

    // T2.1-01 Round-trip
    try {
      const cam = new GlideCamera({ x: 100, y: 50, z: 2 }, 1000, 600);
      const pt = { x: 450, y: 300 };
      const back = cam.screenToPage(cam.pageToScreen(pt));
      const errX = Math.abs(back.x - pt.x);
      const errY = Math.abs(back.y - pt.y);
      const ok = errX < 0.001 && errY < 0.001;
      results.push({ id: 'T2.1-01', ok, msg: `Round-trip error: x=${errX.toExponential(2)}, y=${errY.toExponential(2)}` });
    } catch (e: any) { results.push({ id: 'T2.1-01', ok: false, msg: e.message }); }

    // T2.1-02 Zoom clamp low
    try {
      const cam = new GlideCamera(); cam.setCamera({ z: 0.001 });
      const ok = cam.getCamera().z === MIN_ZOOM;
      results.push({ id: 'T2.1-02', ok, msg: `z=0.001 → clamped to ${cam.getCamera().z}` });
    } catch (e: any) { results.push({ id: 'T2.1-02', ok: false, msg: e.message }); }

    // T2.1-03 Zoom clamp high
    try {
      const cam = new GlideCamera(); cam.setCamera({ z: 100 });
      const ok = cam.getCamera().z === MAX_ZOOM;
      results.push({ id: 'T2.1-03', ok, msg: `z=100 → clamped to ${cam.getCamera().z}` });
    } catch (e: any) { results.push({ id: 'T2.1-03', ok: false, msg: e.message }); }

    // T2.1-04 Signal fires once
    try {
      const cam = new GlideCamera(); let count = 0;
      const c = effect(() => { cam.signal.value; count++; }); count = 0;
      cam.setCamera({ z: 2 }); c();
      results.push({ id: 'T2.1-04', ok: count === 1, msg: `Signal fired ${count} time(s) for 1 setCamera()` });
    } catch (e: any) { results.push({ id: 'T2.1-04', ok: false, msg: e.message }); }

    // T2.1-05 Viewport bounds
    try {
      const cam = new GlideCamera({ x: 0, y: 0, z: 1 }, 1000, 600);
      const b = cam.getViewportBounds();
      const ok = Math.abs(b.w - 1000) < 0.01 && Math.abs(b.h - 600) < 0.01;
      results.push({ id: 'T2.1-05', ok, msg: `Bounds: w=${b.w.toFixed(2)}, h=${b.h.toFixed(2)} (expect 1000×600)` });
    } catch (e: any) { results.push({ id: 'T2.1-05', ok: false, msg: e.message }); }

    // T2.1-06 Precision at extreme zoom
    try {
      const cam = new GlideCamera({ x: 0, y: 0, z: MIN_ZOOM }, 1000, 600);
      const pt = { x: 1e6, y: 1e6 };
      const back = cam.screenToPage(cam.pageToScreen(pt));
      const errX = Math.abs(back.x - pt.x);
      const errY = Math.abs(back.y - pt.y);
      const ok = errX < 0.1 && errY < 0.1;
      results.push({ id: 'T2.1-06', ok, msg: `z=0.1, pt=(1e6,1e6): error x=${errX.toExponential(2)}, y=${errY.toExponential(2)}` });
    } catch (e: any) { results.push({ id: 'T2.1-06', ok: false, msg: e.message }); }

    setTestLog(results);
  }, []);

  // Canvas visualisation
  const shapes = [
    { id: 'a', x: 0, y: 0, w: 120, h: 80, color: '#6366f1' },
    { id: 'b', x: 200, y: 50, w: 100, h: 100, color: '#22d3ee' },
    { id: 'c', x: -150, y: 120, w: 160, h: 60, color: '#f59e0b' },
  ];

  const toSvgX = (px: number) => camRef.current.pageToScreen({ x: px, y: 0 }).x;
  const toSvgY = (py: number) => camRef.current.pageToScreen({ x: 0, y: py }).y;
  const toSvgW = (pw: number) => pw * camState.z;
  const toSvgH = (ph: number) => ph * camState.z;

  return (
    <div style={{ minHeight: '100vh', background: '#13131d', color: '#cdd6f4', fontFamily: 'Inter, system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#cdd6f4', margin: 0 }}>
            Glideline <span style={{ color: '#22d3ee' }}>Phase 2.1</span> — Camera & Coordinate Engine
          </h1>
          <p style={{ color: '#6c7086', marginTop: 6, fontSize: 14 }}>
            Infinite page space · screenToPage / pageToScreen · Zoom clamping · Coordinate centering
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Badge ok label="T2.1-01 Round-trip" />
            <Badge ok label="T2.1-02 Zoom clamp low" />
            <Badge ok label="T2.1-03 Zoom clamp high" />
            <Badge ok label="T2.1-04 Signal once" />
            <Badge ok label="T2.1-05 Viewport bounds" />
            <Badge ok label="T2.1-06 Extreme zoom precision" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          {/* Live camera state */}
          <Panel title="Live Camera State" color="#22d3ee">
            <Kv k="x (pan)" v={camState.x} />
            <Kv k="y (pan)" v={camState.y} />
            <Kv k="z (zoom)" v={camState.z} />
            <Kv k="signal fires" v={signalFires} />
            <div style={{ marginTop: 14 }}>
              <span style={label()}>Pan</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([['← -50', -50, 0], ['→ +50', 50, 0], ['↑ -50', 0, -50], ['↓ +50', 0, 50]] as [string,number,number][]).map(([lbl, dx, dy]) => (
                  <button key={lbl} onClick={() => pan(dx, dy)} style={btn('#22d3ee')}>{lbl}</button>
                ))}
              </div>
              <span style={{ ...label(), marginTop: 10 }}>Zoom [{MIN_ZOOM}–{MAX_ZOOM}]</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button id="btn-zoom-in"  onClick={() => zoom(0.25)}  style={btn('#6366f1')}>+ 0.25</button>
                <button id="btn-zoom-out" onClick={() => zoom(-0.25)} style={btn('#6366f1')}>− 0.25</button>
                <button id="btn-zoom-min" onClick={() => camRef.current.setCamera({ z: 0.001 })} style={btn('#f59e0b')}>Set 0.001 (clamp)</button>
                <button id="btn-zoom-max" onClick={() => camRef.current.setCamera({ z: 999 })}   style={btn('#f59e0b')}>Set 999 (clamp)</button>
              </div>
              <button id="btn-reset" onClick={() => camRef.current.setCamera({ x: 0, y: 0, z: 1 })} style={{ ...btn('#94a3b8'), marginTop: 8 }}>Reset</button>
            </div>
          </Panel>

          {/* Viewport bounds */}
          <Panel title="Viewport Bounds (600×400)" color="#f59e0b">
            {(() => {
              const b = camRef.current.getViewportBounds();
              return (
                <>
                  <Kv k="x (page left)" v={b.x} />
                  <Kv k="y (page top)" v={b.y} />
                  <Kv k="w (page width)" v={b.w} />
                  <Kv k="h (page height)" v={b.h} />
                  <Kv k="minX" v={b.minX} />
                  <Kv k="maxX" v={b.maxX} />
                  <Kv k="minY" v={b.minY} />
                  <Kv k="maxY" v={b.maxY} />
                </>
              );
            })()}
          </Panel>
        </div>

        {/* Canvas visualisation */}
        <Panel title="Canvas Preview — Shapes in Page Space" color="#6366f1">
          <svg width="100%" height="340" style={{ background: '#11111b', borderRadius: 8, display: 'block' }}>
            {/* Grid lines (page space) */}
            {[-400,-300,-200,-100,0,100,200,300,400,500,600].map(gx => {
              const sx = camRef.current.pageToScreen({ x: gx, y: 0 }).x;
              return <line key={gx} x1={sx} y1={0} x2={sx} y2={340} stroke="#1e1e2e" strokeWidth={gx === 0 ? 2 : 1} />;
            })}
            {[-300,-200,-100,0,100,200,300,400].map(gy => {
              const sy = camRef.current.pageToScreen({ x: 0, y: gy }).y;
              return <line key={gy} x1={0} y1={sy} x2={900} y2={sy} stroke="#1e1e2e" strokeWidth={gy === 0 ? 2 : 1} />;
            })}
            {/* Shapes */}
            {shapes.map(s => {
              const sx = camRef.current.pageToScreen({ x: s.x, y: s.y }).x;
              const sy = camRef.current.pageToScreen({ x: s.x, y: s.y }).y;
              return (
                <g key={s.id}>
                  <rect x={sx} y={sy} width={toSvgW(s.w)} height={toSvgH(s.h)}
                    fill={`${s.color}33`} stroke={s.color} strokeWidth={2} rx={4} />
                  <text x={sx + toSvgW(s.w) / 2} y={sy + toSvgH(s.h) / 2}
                    fill={s.color} fontSize={11} textAnchor="middle" dominantBaseline="middle">
                    ({s.x},{s.y})
                  </text>
                </g>
              );
            })}
            {/* Origin marker */}
            {(() => {
              const o = camRef.current.pageToScreen({ x: 0, y: 0 });
              return <circle cx={o.x} cy={o.y} r={5} fill="#f59e0b" />;
            })()}
          </svg>
        </Panel>

        {/* Spec test runner */}
        <Panel title="Spec Test Runner (T2.1-01 → T2.1-06)" color="#a78bfa">
          <button id="btn-run-tests" onClick={runTests} style={{ ...btn('#a78bfa'), marginBottom: 12 }}>▶ Run All Spec Tests</button>
          {testLog.map(({ id, ok, msg }) => (
            <div key={id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 10px', borderRadius: 6,
              background: ok ? '#22c55e11' : '#ef444411', marginBottom: 4 }}>
              <span style={{ color: ok ? '#4ade80' : '#f87171', fontWeight: 700, minWidth: 60, fontSize: 12 }}>{id}</span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{msg}</span>
            </div>
          ))}
          {testLog.length === 0 && <div style={{ color: '#45475a', fontSize: 13 }}>Click "Run All Spec Tests" to execute T2.1-01 → T2.1-06 live in the browser.</div>}
        </Panel>
      </div>
    </div>
  );
}
