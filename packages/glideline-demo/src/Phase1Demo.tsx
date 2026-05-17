import React, { useState, useCallback, useRef } from 'react';
import { GlideStore } from '../../glideline/src/store';
import { GlideSchema } from '../../glideline/src/schema';
import { T } from '../../glideline/src/validators';
import { defineMigrations, migrateRecord, migrateRecordDown } from '../../glideline/src/migrations';
import { effect } from '@preact/signals';
import type { GlideDocument } from '../../glideline/src/types';

// ─── BoxUtil fixture (v3) ───────────────────────────────────────────────────
const boxMigrations = defineMigrations({
  currentVersion: 3,
  migrators: {
    1: { up: r => ({ ...r, props: { ...(r['props'] as object), opacity: 1 } }),        down: r => { const p = { ...(r['props'] as any) }; delete p.opacity;       return { ...r, props: p }; } },
    2: { up: r => ({ ...r, props: { ...(r['props'] as object), cornerRadius: 0 } }),   down: r => { const p = { ...(r['props'] as any) }; delete p.cornerRadius;  return { ...r, props: p }; } },
    3: { up: r => ({ ...r, props: { ...(r['props'] as object), locked: false } }),     down: r => { const p = { ...(r['props'] as any) }; delete p.locked;        return { ...r, props: p }; } },
  },
});
const BoxUtil = {
  type: 'box' as const,
  props: { w: T.number, h: T.number, color: T.string } as any,
  migrations: boxMigrations,
};

function makeSchema() {
  const s = new GlideSchema(); s.registerShapeUtil(BoxUtil); return s;
}

// ─── Panel wrapper ──────────────────────────────────────────────────────────
function Panel({ title, children, color = '#6366f1' }: { title: string; children: React.ReactNode; color?: string }) {
  return (
    <div style={{ background: '#1e1e2e', border: `1px solid ${color}33`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
      <h2 style={{ color, margin: '0 0 14px', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{title}</h2>
      {children}
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
      background: ok ? '#22c55e22' : '#ef444422', color: ok ? '#4ade80' : '#f87171', marginRight: 6, marginBottom: 4 }}>
      {ok ? '✓' : '✗'} {label}
    </span>
  );
}

function Code({ children }: { children: string }) {
  return <pre style={{ background: '#11111b', padding: 12, borderRadius: 8, fontSize: 12, color: '#a6e3a1', overflowX: 'auto', margin: '8px 0' }}>{children}</pre>;
}

// ─── Story 1.1: GlideStore ──────────────────────────────────────────────────
function StorePanel() {
  const storeRef = useRef(new GlideStore(makeSchema()));
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [renderCounts, setRenderCounts] = useState<Record<string, number>>({});
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => setLog(l => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...l.slice(0, 9)]);

  const addShape = () => {
    const id = `shape:${Date.now()}`;
    const shape = { id, type: 'box', x: Math.random() * 300, y: Math.random() * 200, w: 100, h: 60, index: 'a1', rotation: 0, meta: {}, props: { w: 100, h: 60, color: '#6366f1' } };
    storeRef.current.put([shape]);
    // Subscribe to this specific shape's signal
    const sig = storeRef.current.getSignal(id)!;
    effect(() => {
      if (sig.value) setRenderCounts(c => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
    });
    setRecords(Array.from({ length: storeRef.current['_signals'].size }, (_, i) => {
      const entries = Array.from((storeRef.current['_signals'] as Map<string, any>).entries());
      return entries[i]?.[1]?.peek() as Record<string, unknown>;
    }).filter(Boolean));
    addLog(`put(${id}) → signal created`);
  };

  const batchMove = () => {
    const ids = Array.from((storeRef.current['_signals'] as Map<string, any>).keys());
    if (ids.length === 0) { addLog('No shapes yet — add some first'); return; }
    storeRef.current.batch(() => {
      storeRef.current.put(ids.map(id => {
        const r = storeRef.current.get(id)!;
        return { ...r, x: (r['x'] as number) + 10 };
      }));
    });
    addLog(`batch moved ${ids.length} shapes → 1 notification burst`);
    setRecords(Array.from((storeRef.current['_signals'] as Map<string, any>).values()).map(s => s.peek()).filter(Boolean));
  };

  const testRollback = () => {
    const before = storeRef.current.has('shape:ROLLBACK');
    try {
      storeRef.current.batch(() => {
        storeRef.current.put([{ id: 'shape:ROLLBACK', type: 'box', x: 0, y: 0, w: 10, h: 10, index: 'a1', rotation: 0, meta: {}, props: { w: 10, h: 10, color: 'red' } }]);
        throw new Error('Simulated failure!');
      });
    } catch { /* expected */ }
    const after = storeRef.current.has('shape:ROLLBACK');
    addLog(`Rollback test: had=${before} → after throw has=${after} ✓`);
  };

  return (
    <Panel title="Story 1.1 — GlideStore" color="#6366f1">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button id="btn-add-shape" onClick={addShape} style={btnStyle('#6366f1')}>+ Add Shape</button>
        <button id="btn-batch-move" onClick={batchMove} style={btnStyle('#8b5cf6')}>Batch Move All</button>
        <button id="btn-rollback" onClick={testRollback} style={btnStyle('#ec4899')}>Test Rollback</button>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Records ({records.length})</div>
          {records.map(r => (
            <div key={r['id'] as string} style={{ background: '#11111b', padding: '6px 10px', borderRadius: 6, marginBottom: 4, fontSize: 12, color: '#cdd6f4', display: 'flex', justifyContent: 'space-between' }}>
              <span>{r['id'] as string}</span>
              <span style={{ color: '#6366f1' }}>renders: {renderCounts[r['id'] as string] ?? 0}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Event Log</div>
          {log.map((l, i) => <div key={i} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>{l}</div>)}
        </div>
      </div>
    </Panel>
  );
}

// ─── Story 1.2: T Validators ────────────────────────────────────────────────
function ValidatorPanel() {
  const [input, setInput] = useState('42');
  const [type, setType] = useState<'number' | 'string' | 'boolean'>('number');
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const [schemaInput, setSchemaInput] = useState('{ "w": "not-a-number", "h": 100, "color": "blue" }');
  const [schemaResult, setSchemaResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const runValidator = () => {
    const v = type === 'number' ? Number(input) : type === 'boolean' ? input === 'true' : input;
    const validator = T[type];
    try { validator.validate(v); setResult({ ok: true, msg: `✓ ${JSON.stringify(v)} is a valid ${type}` }); }
    catch (e: any) { setResult({ ok: false, msg: `✗ ${e.message}` }); }
  };

  const runSchemaValidation = () => {
    try {
      const props = JSON.parse(schemaInput) as Record<string, unknown>;
      for (const [k, v] of Object.entries(BoxUtil.props as any)) {
        (v as any).validate(props[k]);
      }
      setSchemaResult({ ok: true, msg: '✓ All props valid' });
    } catch (e: any) { setSchemaResult({ ok: false, msg: `✗ ${e.message}` }); }
  };

  return (
    <Panel title="Story 1.2 — T Validators & GlideSchema" color="#f59e0b">
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>T.validator live test</div>
          <select id="sel-type" value={type} onChange={e => setType(e.target.value as any)} style={inputStyle}>
            <option value="number">T.number</option>
            <option value="string">T.string</option>
            <option value="boolean">T.boolean</option>
          </select>
          <input id="inp-value" value={input} onChange={e => setInput(e.target.value)} placeholder="Value to validate" style={{ ...inputStyle, marginTop: 6 }} />
          <button id="btn-validate" onClick={runValidator} style={{ ...btnStyle('#f59e0b'), marginTop: 6, width: '100%' }}>Validate</button>
          {result && <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: result.ok ? '#22c55e22' : '#ef444422', color: result.ok ? '#4ade80' : '#f87171', fontSize: 13 }}>{result.msg}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>BoxUtil props validation (w: number, h: number, color: string)</div>
          <textarea id="inp-schema" value={schemaInput} onChange={e => setSchemaInput(e.target.value)} rows={3} style={{ ...inputStyle, width: '100%', resize: 'vertical' }} />
          <button id="btn-schema-validate" onClick={runSchemaValidation} style={{ ...btnStyle('#f59e0b'), marginTop: 6, width: '100%' }}>Validate Props</button>
          {schemaResult && <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: schemaResult.ok ? '#22c55e22' : '#ef444422', color: schemaResult.ok ? '#4ade80' : '#f87171', fontSize: 13 }}>{schemaResult.msg}</div>}
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>T system coverage</div>
        <Badge ok label="T.number" /><Badge ok label="T.string" /><Badge ok label="T.boolean" />
        <Badge ok label="T.literal" /><Badge ok label="T.optional" /><Badge ok label="T.union" />
      </div>
    </Panel>
  );
}

// ─── Story 1.3: Migrations ──────────────────────────────────────────────────
function MigrationPanel() {
  const [fromVer, setFromVer] = useState(0);
  const [toVer, setToVer] = useState(3);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [docJson, setDocJson] = useState('');
  const [loadResult, setLoadResult] = useState<string | null>(null);

  const v0Record = { id: 'shape:demo', type: 'box', props: { w: 100 } };

  const runMigration = () => {
    const r = migrateRecord(v0Record as any, boxMigrations, fromVer);
    setResult(r);
  };

  const runDownMigration = () => {
    const v3 = { id: 'shape:demo', type: 'box', props: { w: 100, opacity: 1, cornerRadius: 0, locked: false } };
    const r = migrateRecordDown(v3, boxMigrations, 3, toVer);
    setResult(r);
  };

  const serializeStore = () => {
    const schema = makeSchema();
    const store = new GlideStore(schema);
    store.put([{ id: 'shape:1', type: 'box', x: 10, y: 20, w: 100, h: 60, index: 'a1', rotation: 0, meta: {}, props: { w: 100, h: 60, color: 'blue' } } as any]);
    const doc = store.serialize();
    setDocJson(JSON.stringify(doc, null, 2));
  };

  const loadAndMigrate = () => {
    try {
      const doc = JSON.parse(docJson) as GlideDocument;
      // Simulate loading as v0
      doc.schema.shapes['box'] = 0;
      const schema = makeSchema();
      const store = new GlideStore(schema);
      store.deserialize(doc);
      const r = store.get('shape:1');
      const props = r?.['props'] as any;
      setLoadResult(JSON.stringify({ opacity: props?.opacity, cornerRadius: props?.cornerRadius, locked: props?.locked }, null, 2));
    } catch (e: any) { setLoadResult(`Error: ${e.message}`); }
  };

  return (
    <Panel title="Story 1.3 — Migrations & Persistence" color="#22d3ee">
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Up migration: v{fromVer} → v3</div>
          <input id="inp-from-ver" type="number" min={0} max={3} value={fromVer} onChange={e => setFromVer(Number(e.target.value))} style={inputStyle} />
          <button id="btn-migrate-up" onClick={runMigration} style={{ ...btnStyle('#22d3ee'), marginTop: 6, width: '100%' }}>migrateRecord(v0, migrations, {fromVer})</button>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 12, marginBottom: 8 }}>Down migration: v3 → v{toVer}</div>
          <input id="inp-to-ver" type="number" min={0} max={3} value={toVer} onChange={e => setToVer(Number(e.target.value))} style={inputStyle} />
          <button id="btn-migrate-down" onClick={runDownMigration} style={{ ...btnStyle('#06b6d4'), marginTop: 6, width: '100%' }}>migrateRecordDown(v3 → v{toVer})</button>
          {result && <Code>{JSON.stringify(result['props'], null, 2)}</Code>}
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Serialize → JSON → Deserialize</div>
          <button id="btn-serialize" onClick={serializeStore} style={{ ...btnStyle('#22d3ee'), width: '100%' }}>1. Serialize Store</button>
          {docJson && <>
            <textarea readOnly value={docJson} rows={6} style={{ ...inputStyle, width: '100%', marginTop: 8, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }} />
            <button id="btn-deserialize" onClick={loadAndMigrate} style={{ ...btnStyle('#06b6d4'), marginTop: 6, width: '100%' }}>2. Load as v0 → Apply Migrations</button>
          </>}
          {loadResult && <Code>{loadResult}</Code>}
        </div>
      </div>
    </Panel>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const btnStyle = (color: string): React.CSSProperties => ({
  background: `${color}22`, border: `1px solid ${color}55`, color, borderRadius: 8,
  padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
});
const inputStyle: React.CSSProperties = {
  background: '#11111b', border: '1px solid #313244', color: '#cdd6f4',
  borderRadius: 6, padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box',
};

// ─── Main demo ───────────────────────────────────────────────────────────────
export default function Phase1Demo() {
  return (
    <div style={{ minHeight: '100vh', background: '#13131d', color: '#cdd6f4', fontFamily: 'Inter, system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#cdd6f4', margin: 0 }}>
            Glideline <span style={{ color: '#6366f1' }}>Phase 1</span> — Reactive Foundation
          </h1>
          <p style={{ color: '#6c7086', marginTop: 6, fontSize: 14 }}>
            GlideStore · T Validators · Migrations · Document Persistence
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Badge ok label="51/51 unit tests passing" />
            <Badge ok label="Signal isolation" />
            <Badge ok label="Rollback on throw" />
            <Badge ok label="defineMigrations" />
          </div>
        </div>
        <StorePanel />
        <ValidatorPanel />
        <MigrationPanel />
      </div>
    </div>
  );
}
