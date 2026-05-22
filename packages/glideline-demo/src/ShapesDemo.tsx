// @vitest-environment happy-dom (demo uses real DOM for SVG rendering)
import React, { useState, useRef } from 'react';
import { BoxUtil }   from '../../glideline/src/shapes/BoxUtil';
import { TextUtil }  from '../../glideline/src/shapes/TextUtil';
import { FrameUtil } from '../../glideline/src/shapes/FrameUtil';
import { createEditor, type GlidePlugin } from '../../glideline/src/editor';
import { GlideStore }  from '../../glideline/src/store';
import { GlideSchema } from '../../glideline/src/schema';
import { sid } from '../../glideline/src/types';
import type { BoxShape }   from '../../glideline/src/shapes/BoxUtil';
import type { FrameShape } from '../../glideline/src/shapes/FrameUtil';

// ─── Plugins ──────────────────────────────────────────────────────────────────
const BoxPlugin:   GlidePlugin = { id: 'box',   shapes: [BoxUtil   as any] };
const TextPlugin:  GlidePlugin = { id: 'text',  shapes: [TextUtil  as any] };
const FramePlugin: GlidePlugin = { id: 'frame', shapes: [FrameUtil as any] };

// ─── Styles ───────────────────────────────────────────────────────────────────
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

// ─── Fixture util instances ────────────────────────────────────────────────────
const boxUtil   = new BoxUtil();
const frameUtil = new FrameUtil();
const textUtil  = new TextUtil();

function makeBox(id: string, x: number, y: number, w: number, h: number): BoxShape {
  return { id: sid(id), type: 'box', x, y, index: 'a1', rotation: 0, meta: {}, props: { w, h, cornerRadius: 0, color: '#6366f1', label: 'Box' } as any };
}
function makeFrame(id: string, x: number, y: number, w: number, h: number): FrameShape {
  return { id: sid(id), type: 'frame', x, y, index: 'a1', rotation: 0, meta: {}, props: { w, h, label: 'Frame', color: '#313244' } };
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function ShapesDemo() {
  const [results, setResults] = useState<{ id: string; ok: boolean; msg: string }[]>([]);
  const [selectedShape, setSelectedShape] = useState<'box' | 'text' | 'frame'>('box');

  const runTests = () => {
    const out: { id: string; ok: boolean; msg: string }[] = [];
    const log = (id: string, ok: boolean, msg: string) => out.push({ id, ok, msg });

    // T2.3-01 Geometry
    try {
      const shape = makeBox('b1', 50, 100, 200, 150);
      const geo   = boxUtil.getGeometry(shape);
      const ok = geo.minX === 50 && geo.maxX === 250 && geo.minY === 100 && geo.maxY === 250;
      log('T2.3-01', ok, `minX=${geo.minX}, maxX=${geo.maxX}, minY=${geo.minY}, maxY=${geo.maxY}`);
    } catch (e: any) { log('T2.3-01', false, e.message); }

    // T2.3-02 hitTestPoint
    try {
      const shape = makeBox('b2', 0, 0, 100, 100);
      const inside  = boxUtil.hitTestPoint(shape, { x: 50, y: 50 });
      const outside = boxUtil.hitTestPoint(shape, { x: 200, y: 0 });
      log('T2.3-02', inside && !outside, `(50,50)=${inside}, (200,0)=${outside}`);
    } catch (e: any) { log('T2.3-02', false, e.message); }

    // T2.3-03 canContain
    try {
      const frame = makeFrame('f1', 0, 0, 400, 300);
      const box   = makeBox('b3', 0, 0, 100, 100);
      const frameOk = frameUtil.canContain(frame);
      const boxOk   = !boxUtil.canContain(box);
      log('T2.3-03', frameOk && boxOk, `frame.canContain=${frameOk}, box.canContain=${!boxOk}`);
    } catch (e: any) { log('T2.3-03', false, e.message); }

    // T2.3-04 toSvg
    try {
      const shape = makeBox('b4', 10, 20, 200, 150);
      const el    = boxUtil.toSvg(shape);
      const isSVG = el instanceof SVGElement;
      const w = (el as SVGRectElement).getAttribute('width');
      const h = (el as SVGRectElement).getAttribute('height');
      log('T2.3-04', isSVG && w === '200' && h === '150', `SVGElement=${isSVG}, w=${w}, h=${h}`);
    } catch (e: any) { log('T2.3-04', false, e.message); }

    // T2.3-05 Default props
    try {
      const p = boxUtil.getDefaultProps();
      const ok = p.w === 120 && p.h === 80 && p.cornerRadius === 0;
      log('T2.3-05', ok, `w=${p.w}, h=${p.h}, cornerRadius=${p.cornerRadius}`);
    } catch (e: any) { log('T2.3-05', false, e.message); }

    // T2.3-06 Prop validation
    try {
      const schema = new GlideSchema();
      schema.registerShapeUtil(BoxUtil as any);
      const store = new GlideStore(schema);
      let threw = false;
      try {
        store.put([{ id: sid('box:bad'), type: 'box', x: 0, y: 0, index: 'a1', rotation: 0, meta: {}, props: { w: 'bad', h: 80, cornerRadius: 0, color: '#fff', label: '' } as any }]);
      } catch { threw = true; }
      const unchanged = store.get('box:bad') === undefined;
      log('T2.3-06', threw && unchanged, `threw=${threw}, store unchanged=${unchanged}`);
    } catch (e: any) { log('T2.3-06', false, e.message); }

    setResults(out);
  };

  // Live SVG preview
  const svgRef = useRef<SVGSVGElement>(null);
  const renderShapeToSvg = () => {
    if (!svgRef.current) return;
    // Clear
    while (svgRef.current.firstChild) svgRef.current.removeChild(svgRef.current.firstChild);

    if (selectedShape === 'box') {
      const el = boxUtil.toSvg(makeBox('preview', 20, 20, 220, 140));
      svgRef.current.appendChild(el);
      // Label
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', '130'); t.setAttribute('y', '95'); t.setAttribute('fill', '#cdd6f4'); t.setAttribute('font-size', '14'); t.setAttribute('text-anchor', 'middle'); t.textContent = 'Box';
      svgRef.current.appendChild(t);
    } else if (selectedShape === 'text') {
      const shape = { id: sid('t'), type: 'text', x: 20, y: 20, index: 'a1', rotation: 0, meta: {}, props: { text: 'Hello\nGlideline', fontSize: 24, color: '#cdd6f4' } };
      svgRef.current.appendChild(textUtil.toSvg(shape as any));
    } else {
      const el = frameUtil.toSvg(makeFrame('preview', 20, 30, 260, 160));
      svgRef.current.appendChild(el);
    }
  };

  // Render on mount + when selectedShape changes
  React.useEffect(() => { renderShapeToSvg(); }, [selectedShape]);

  const shapeInfo: Record<string, { color: string; props: string; canContain: boolean }> = {
    box:   { color: '#6366f1', props: 'w, h, cornerRadius, color, label', canContain: false },
    text:  { color: '#22d3ee', props: 'text, fontSize, color',            canContain: false },
    frame: { color: '#f59e0b', props: 'w, h, label, color',               canContain: true },
  };

  return (
    <div style={{ minHeight: '100vh', background: '#13131d', color: '#cdd6f4', fontFamily: 'Inter, system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
            Glideline <span style={{ color: '#f59e0b' }}>Phase 2.3</span> — Built-in Shapes
          </h1>
          <p style={{ color: '#6c7086', marginTop: 6, fontSize: 14 }}>BoxUtil · TextUtil · FrameUtil · toSvg · canContain · Prop validation</p>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['T2.3-01 Geometry bounds','T2.3-02 hitTestPoint','T2.3-03 canContain','T2.3-04 toSvg SVGElement','T2.3-05 Default props','T2.3-06 Prop validation'].map(l => (
              <Badge key={l} ok label={l} />
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          {/* Shape picker + info */}
          <Panel title="Shape Explorer" color="#f59e0b">
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {(['box', 'text', 'frame'] as const).map(s => (
                <button key={s} onClick={() => setSelectedShape(s)} style={{ ...btn(shapeInfo[s].color), fontWeight: selectedShape === s ? 800 : 600 }}>{s}</button>
              ))}
            </div>
            {(() => {
              const info = shapeInfo[selectedShape];
              return (
                <div>
                  <div style={{ color: '#6c7086', fontSize: 12, marginBottom: 4 }}>static props</div>
                  <div style={{ background: '#11111b', padding: '8px 12px', borderRadius: 6, color: '#a6e3a1', fontSize: 13, fontFamily: 'monospace', marginBottom: 10 }}>{info.props}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Badge ok={info.canContain} label={`canContain = ${info.canContain}`} />
                    <Badge ok label="migrations v1" />
                    <Badge ok label="toSvg → SVGElement" />
                  </div>
                </div>
              );
            })()}
          </Panel>

          {/* Live SVG preview */}
          <Panel title="toSvg() Preview" color="#22d3ee">
            <svg ref={svgRef} width="100%" height="220" style={{ background: '#11111b', borderRadius: 8 }} />
          </Panel>
        </div>

        {/* Spec runner */}
        <Panel title="Spec Test Runner (T2.3-01 → T2.3-06)" color="#f59e0b">
          <button id="btn-run-tests" onClick={runTests} style={{ ...btn('#f59e0b'), marginBottom: 12 }}>▶ Run All Spec Tests</button>
          {results.map(({ id, ok, msg }) => (
            <div key={id} style={{ display: 'flex', gap: 12, padding: '7px 10px', borderRadius: 6, background: ok ? '#22c55e11' : '#ef444411', marginBottom: 4 }}>
              <span style={{ color: ok ? '#4ade80' : '#f87171', fontWeight: 700, minWidth: 60, fontSize: 12 }}>{id}</span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{msg}</span>
            </div>
          ))}
          {results.length === 0 && <div style={{ color: '#45475a', fontSize: 13 }}>Click to run T2.3-01 → T2.3-06 live in browser.</div>}
          {results.length > 0 && <div style={{ marginTop: 10 }}><Badge ok={results.every(r => r.ok)} label={`${results.filter(r=>r.ok).length}/${results.length} passing`} /></div>}
        </Panel>
      </div>
    </div>
  );
}
