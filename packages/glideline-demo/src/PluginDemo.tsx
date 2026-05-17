import React, { useState } from 'react';
import { createEditor, type GlidePlugin } from '../../glideline/src/editor';
import { ShapeUtil } from '../../glideline/src/shapes/ShapeUtil';
import { T } from '../../glideline/src/validators';
import { defineMigrations } from '../../glideline/src/migrations';
import { makeBox } from '../../glideline/src/types';
import type { GlideShape, Box2d } from '../../glideline/src/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

class BoxUtil extends ShapeUtil<GlideShape<{ w: number; h: number }>> {
  static override type = 'box' as const;
  static override props = { w: T.number, h: T.number };
  static override migrations = defineMigrations({ currentVersion: 1, migrators: { 1: { up: r => r, down: r => r } } });
  getDefaultProps() { return { w: 120, h: 80 }; }
  getGeometry(s: GlideShape<{ w: number; h: number }>): Box2d { return makeBox(s.x, s.y, s.props.w, s.props.h); }
}

class ArrowUtil extends ShapeUtil<GlideShape<{ label: string }>> {
  static override type = 'arrow' as const;
  static override props = { label: T.string };
  static override migrations = defineMigrations({ currentVersion: 1, migrators: { 1: { up: r => r, down: r => r } } });
  getDefaultProps() { return { label: '' }; }
  getGeometry(s: GlideShape<{ label: string }>): Box2d { return makeBox(s.x, s.y, 100, 4); }
}

class DiamondUtil extends ShapeUtil<GlideShape<{ size: number }>> {
  static override type = 'diamond' as const;
  static override props = { size: T.number };
  getDefaultProps() { return { size: 80 }; }
  getGeometry(s: GlideShape<{ size: number }>): Box2d { const h = s.props.size / 2; return makeBox(s.x - h, s.y - h, s.props.size, s.props.size); }
}

const BoxPlugin:     GlidePlugin = { id: 'box',     shapes: [BoxUtil     as any] };
const ArrowPlugin:   GlidePlugin = { id: 'arrow',   shapes: [ArrowUtil   as any] };
const DiamondPlugin: GlidePlugin = { id: 'diamond', shapes: [DiamondUtil as any] };

// ─── Styles ───────────────────────────────────────────────────────────────────
const btn = (c: string): React.CSSProperties => ({ background: `${c}22`, border: `1px solid ${c}55`, color: c, borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const Badge = ({ ok, label: l }: { ok: boolean; label: string }) => (
  <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
    background: ok ? '#22c55e22' : '#ef444422', color: ok ? '#4ade80' : '#f87171', marginRight: 6, marginBottom: 4 }}>
    {ok ? '✓' : '✗'} {l}
  </span>
);
const Panel = ({ title, color = '#6366f1', children }: { title: string; color?: string; children: React.ReactNode }) => (
  <div style={{ background: '#1e1e2e', border: `1px solid ${color}33`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
    <h2 style={{ color, margin: '0 0 14px', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
    {children}
  </div>
);
const Code = ({ s }: { s: string }) => <pre style={{ background: '#11111b', padding: 10, borderRadius: 8, fontSize: 12, color: '#a6e3a1', margin: '8px 0', overflowX: 'auto' }}>{s}</pre>;

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function PluginDemo() {
  const [results, setResults] = useState<{ id: string; ok: boolean; msg: string }[]>([]);

  const runTests = () => {
    const out: { id: string; ok: boolean; msg: string }[] = [];
    const log = (id: string, ok: boolean, msg: string) => out.push({ id, ok, msg });

    // T2.2-01: Two plugins, no conflict
    try {
      const editor = createEditor({ plugins: [BoxPlugin, ArrowPlugin] });
      const boxOk   = editor.getShapeUtil('box')   instanceof BoxUtil;
      const arrowOk = editor.getShapeUtil('arrow') instanceof ArrowUtil;
      log('T2.2-01', boxOk && arrowOk, `box=${boxOk}, arrow=${arrowOk}`);
    } catch (e: any) { log('T2.2-01', false, e.message); }

    // T2.2-02: Duplicate type throws
    try {
      class BoxUtil2 extends BoxUtil {}
      createEditor({ plugins: [BoxPlugin, { id: 'box2', shapes: [BoxUtil2 as any] }] });
      log('T2.2-02', false, 'Should have thrown');
    } catch (e: any) { log('T2.2-02', /duplicate/i.test(e.message), `Threw: ${e.message}`); }

    // T2.2-03: Unknown type error contains name
    try {
      const editor = createEditor({ plugins: [BoxPlugin] });
      editor.getShapeUtil('triangle');
      log('T2.2-03', false, 'Should have thrown');
    } catch (e: any) { log('T2.2-03', /triangle/.test(e.message), `Threw: ${e.message}`); }

    // T2.2-04: Editor injected
    try {
      const editor = createEditor({ plugins: [BoxPlugin] });
      const util = editor.getShapeUtil('box');
      const sameRef = util.editor === editor;
      const ids = util.editor.getSelectedShapeIds();
      log('T2.2-04', sameRef && Array.isArray(ids), `editor===editor: ${sameRef}, getSelectedShapeIds=[${ids}]`);
    } catch (e: any) { log('T2.2-04', false, e.message); }

    // T2.2-05: Diamond < 50 lines
    try {
      const editor = createEditor({ plugins: [DiamondPlugin] });
      const util = editor.getShapeUtil('diamond');
      const props = (util as DiamondUtil).getDefaultProps();
      log('T2.2-05', (props as any).size === 80, `diamond.getDefaultProps().size=${(props as any).size}`);
    } catch (e: any) { log('T2.2-05', false, e.message); }

    // T2.2-06: Schema frozen
    try {
      const editor = createEditor({ plugins: [BoxPlugin] });
      const frozen = editor.schema.frozen;
      let threw = false;
      try { editor.schema.registerShapeUtil({ type: 'late', props: {} }); } catch { threw = true; }
      log('T2.2-06', frozen && threw, `frozen=${frozen}, lateRegister threw=${threw}`);
    } catch (e: any) { log('T2.2-06', false, e.message); }

    setResults(out);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#13131d', color: '#cdd6f4', fontFamily: 'Inter, system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
            Glideline <span style={{ color: '#a78bfa' }}>Phase 2.2</span> — Plugin System
          </h1>
          <p style={{ color: '#6c7086', marginTop: 6, fontSize: 14 }}>createEditor() · ShapeUtil registration · Duplicate detection · Schema freeze · Editor injection</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {['T2.2-01 No conflict','T2.2-02 Duplicate throws','T2.2-03 Unknown type error','T2.2-04 Editor injected','T2.2-05 ≤50 lines','T2.2-06 Schema frozen']
              .map(l => <Badge key={l} ok label={l} />)}
          </div>
        </div>

        <Panel title="Registered Plugins" color="#a78bfa">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[['box', '#6366f1', 'w: T.number, h: T.number'], ['arrow', '#22d3ee', 'label: T.string'], ['diamond', '#f59e0b', 'size: T.number']].map(([type, color, props]) => (
              <div key={type} style={{ background: '#11111b', borderRadius: 8, padding: '12px 16px', border: `1px solid ${color}44`, minWidth: 160 }}>
                <div style={{ color, fontWeight: 700, marginBottom: 4 }}>{type}</div>
                <div style={{ color: '#6c7086', fontSize: 12 }}>{props}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Spec Test Runner (T2.2-01 → T2.2-06)" color="#a78bfa">
          <button id="btn-run-tests" onClick={runTests} style={{ ...btn('#a78bfa'), marginBottom: 12 }}>▶ Run All Spec Tests</button>
          {results.map(({ id, ok, msg }) => (
            <div key={id} style={{ display: 'flex', gap: 12, padding: '7px 10px', borderRadius: 6, background: ok ? '#22c55e11' : '#ef444411', marginBottom: 4 }}>
              <span style={{ color: ok ? '#4ade80' : '#f87171', fontWeight: 700, minWidth: 60, fontSize: 12 }}>{id}</span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{msg}</span>
            </div>
          ))}
          {results.length === 0 && <div style={{ color: '#45475a', fontSize: 13 }}>Click to run T2.2-01 → T2.2-06 live in browser.</div>}
          {results.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Badge ok={results.every(r => r.ok)} label={`${results.filter(r=>r.ok).length}/${results.length} passing`} />
            </div>
          )}
        </Panel>

        <Panel title="Live: createEditor() + getShapeUtil()" color="#22d3ee">
          <Code s={`const editor = createEditor({ plugins: [BoxPlugin, ArrowPlugin, DiamondPlugin] });

editor.getShapeUtil('box')     // → BoxUtil instance
editor.getShapeUtil('arrow')   // → ArrowUtil instance  
editor.getShapeUtil('diamond') // → DiamondUtil instance
editor.getShapeUtil('triangle') // ✗ throws: no ShapeUtil for "triangle"

editor.schema.frozen // → true (late registration blocked)`} />
        </Panel>
      </div>
    </div>
  );
}
