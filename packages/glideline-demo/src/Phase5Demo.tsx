import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createEditor } from '../../glideline/src/editor';
import { BoxUtil } from '../../glideline/src/shapes/BoxUtil';
import { TextUtil } from '../../glideline/src/shapes/TextUtil';
import { FrameUtil } from '../../glideline/src/shapes/FrameUtil';
import { ArrowPlugin } from '../../glideline/src/shapes/ArrowUtil';
import { SelectTool } from '../../glideline/src/tools/SelectTool';
import { BoxTool } from '../../glideline/src/tools/BoxTool';
import { ArrowTool } from '../../glideline/src/tools/ArrowTool';
import { sid } from '../../glideline/src/types';
import type { ShapeId, GlideShape, AnyRecord } from '../../glideline/src/types';
import { useSignalValue } from './useSignalValue';
import { effect, signal } from '@preact/signals';

// ── Editor Setup ────────────────────────────────────────────────────────────

const CorePlugin = { id: 'core', shapes: [BoxUtil as any, TextUtil as any, FrameUtil as any] };

const editor = createEditor({
  plugins: [CorePlugin, ArrowPlugin],
  tools: [SelectTool, BoxTool, ArrowTool],
});

editor.createShape({
  id: sid('box1'), type: 'box', x: 200, y: 200, index: 'a1', rotation: 0, meta: {},
  props: { w: 120, h: 80, cornerRadius: 8, color: '#cba6f7', label: 'Start' }
});
editor.createShape({
  id: sid('box2'), type: 'box', x: 500, y: 200, index: 'a2', rotation: 0, meta: {},
  props: { w: 120, h: 80, cornerRadius: 8, color: '#89b4fa', label: 'End' }
});

const isInteracting = signal(false);

// ── Style Helpers ────────────────────────────────────────────────────────────

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

// ── React Components ─────────────────────────────────────────────────────────

const ShapeWrapper = memo(({ id }: { id: ShapeId }) => {
  const sig = editor.store.getSignal(id);
  const shape = useSignalValue(sig as any) as GlideShape | null;
  const gRef = useRef<SVGGElement>(null);
  const contentRef = useRef<SVGGElement>(null);

  useEffect(() => {
    return effect(() => {
      if (!shape) return;
      
      const util = editor.getShapeUtil(shape.type);
      const bounds = util.getGeometry(shape as any);
      const viewport = editor.getViewportBounds();
      
      const isVisible = bounds.maxX >= viewport.minX && bounds.minX <= viewport.maxX &&
                        bounds.maxY >= viewport.minY && bounds.minY <= viewport.maxY;

      if (gRef.current) {
        gRef.current.style.display = isVisible ? 'block' : 'none';
      }
    });
  }, [shape?.id]);

  useEffect(() => {
    if (contentRef.current && shape) {
      const util = editor.getShapeUtil(shape.type);
      if ((util as any).toSvg) {
        const svgEl = (util as any).toSvg(shape);
        contentRef.current.innerHTML = '';
        if (svgEl) contentRef.current.appendChild(svgEl);
      }
    }
  });

  if (!shape) return null;

  return (
    <g ref={gRef} id={`shape-${shape.id}`}>
      <g ref={contentRef} />
    </g>
  );
});

const SvgCanvas = () => {
  const shapeIds = useSignalValue(editor.getShapeIdsSignal());
  const camera = useSignalValue(editor.camera.signal);
  const transform = `scale(${camera.z}) translate(${-camera.x}, ${-camera.y})`;

  return (
    <svg id="glideline-svg" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <g id="glideline-root" transform={transform}>
        {shapeIds.map((id: ShapeId) => <ShapeWrapper key={id} id={id} />)}
      </g>
    </svg>
  );
};

const CanvasOverlay = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frameId: number;
    let lastEventTime = Date.now();

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        editor.camera.setViewportSize(rect.width, rect.height);
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const now = Date.now();
      const active = isInteracting.value || (now - lastEventTime < 500);

      if (active) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const cam = editor.camera.signal.peek();

        // Draw hover / selection
        const selected = editor.getSelectedShapeIds();
        for (const id of selected) {
          const shape = editor.getShape(id);
          if (shape) {
            const util = editor.getShapeUtil(shape.type);
            const box = util.getGeometry(shape as any);
            const p = editor.pageToScreen({ x: box.minX, y: box.minY });
            
            ctx.strokeStyle = '#89b4fa';
            ctx.lineWidth = 1;
            ctx.strokeRect(p.x, p.y, box.w * cam.z, box.h * cam.z);

            let pts: {x: number, y: number}[] = [];
            
            if (shape.type === 'arrow') {
               const { start, end } = shape.props as any;
               pts.push(editor.pageToScreen(start.point));
               pts.push(editor.pageToScreen(end.point));
            } else {
              // 8 handles
              const hw = box.w * cam.z;
              const hh = box.h * cam.z;
              pts = [
                {x: p.x, y: p.y}, {x: p.x + hw/2, y: p.y}, {x: p.x + hw, y: p.y},
                {x: p.x + hw, y: p.y + hh/2}, {x: p.x + hw, y: p.y + hh},
                {x: p.x + hw/2, y: p.y + hh}, {x: p.x, y: p.y + hh},
                {x: p.x, y: p.y + hh/2}
              ];
            }

            for (const pt of pts) {
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
              ctx.fillStyle = '#1e1e2e';
              ctx.fill();
              ctx.stroke();
            }
          }
        }
      }

      if (isInteracting.value) {
        lastEventTime = Date.now();
      }

      frameId = requestAnimationFrame(draw);
    };

    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
};

// ── Main Component ──────────────────────────────────────────────────────────

export default function Phase5Demo() {
  const [activeTool, setActiveTool] = useState('select');
  const [status, setStatus] = useState('');
  const camera = useSignalValue(editor.camera.signal);

  useEffect(() => {
    return effect(() => {
      const tool = editor.getCurrentTool();
      setActiveTool((tool.constructor as any).id || 'select');
    });
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    isInteracting.value = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const pagePt = editor.screenToPage(pt);
    
    const hits = editor.getShapesAtPoint(pagePt);
    const shapeId = hits.length > 0 ? hits[hits.length - 1].id : undefined;
    const target = shapeId ? 'shape' : 'canvas';
    
    editor.dispatchEvent({ type: 'pointerDown', point: pt, shiftKey: e.shiftKey, target, shapeId } as any);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    editor.dispatchEvent({ type: 'pointerMove', point: pt, shiftKey: e.shiftKey } as any);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isInteracting.value = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    editor.dispatchEvent({ type: 'pointerUp', point: pt, shiftKey: e.shiftKey } as any);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' || e.key === 'Delete') {
      editor.deleteSelectedShapes();
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      if (e.shiftKey) editor.history.redo();
      else editor.history.undo();
    } else {
      editor.dispatchEvent({ type: 'keyDown', key: e.key } as any);
    }
  };

  const addShapes = () => {
    const records: AnyRecord[] = [];
    for (let i = 0; i < 1000; i++) {
      records.push({
        id: sid(`bulk-${Date.now()}-${i}`),
        type: 'box',
        x: Math.random() * 5000,
        y: Math.random() * 5000,
        index: 'a1',
        rotation: 0,
        meta: {},
        props: { w: 40, h: 40, cornerRadius: 4, color: '#f9e2af', label: '' }
      });
    }
    for (const r of records) editor.createShape(r);
    setStatus('Added 1000 shapes');
  };

  const runSpecTests = async () => {
    setStatus('Running Spec Tests...');
    
    // T5.1-02
    editor.createShape({
      id: sid('out-of-bounds'), type: 'box', x: 10000, y: 10000, index: 'a1', rotation: 0, meta: {},
      props: { w: 100, h: 100, cornerRadius: 0, color: '#ff0000', label: '' }
    });
    
    // allow render
    await new Promise(r => setTimeout(r, 50));
    const el = document.getElementById('shape-out-of-bounds');
    const displayNone = el?.style.display === 'none';
    
    // T5.3-01 SVG
    const svgStr = editor.exportToSvg([sid('box1')]);
    const validSvg = svgStr.startsWith('<svg') && svgStr.endsWith('</svg>');
    
    // T5.3-03 PNG
    let pngOk = false;
    try {
      const blob = await editor.exportToPng([sid('box1')], { scale: 1 });
      pngOk = blob.type === 'image/png';
    } catch(e) {
      console.error(e);
    }
    
    setStatus(`Tests complete. Display None: ${displayNone}, SVG Valid: ${validSvg}, PNG Valid: ${pngOk}`);
  };

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', padding: 20 }}>
      {/* Sidebar */}
      <div style={{ width: 280, flexShrink: 0 }}>
        <Panel title="Tools" color="#cba6f7">
          <div>
            <button style={btn(activeTool === 'select' ? '#cba6f7' : '#a6adc8')} onClick={() => editor.setCurrentTool('select')}>Select (V)</button>
            <button style={btn(activeTool === 'box' ? '#cba6f7' : '#a6adc8')} onClick={() => editor.setCurrentTool('box')}>Box (R)</button>
            <button style={btn(activeTool === 'arrow' ? '#cba6f7' : '#a6adc8')} onClick={() => editor.setCurrentTool('arrow')}>Arrow (A)</button>
          </div>
          <div style={{ marginTop: 12 }}>
            <button style={btn('#a6adc8')} onClick={() => { editor.history.undo(); }}>Undo</button>
            <button style={btn('#a6adc8')} onClick={() => { editor.history.redo(); }}>Redo</button>
          </div>
        </Panel>

        <Panel title="Performance & Export" color="#a6e3a1">
          <button style={btn('#a6e3a1')} onClick={addShapes}>+1000 Shapes</button>
          <button style={btn('#f9e2af')} onClick={runSpecTests}>Run Spec Tests</button>
          <button style={btn('#89b4fa')} onClick={() => {
            let ids = editor.getSelectedShapeIds();
            if (ids.length === 0) ids = editor.getShapeIdsSignal().peek();
            const svg = editor.exportToSvg(ids);
            const blob = new Blob([svg], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'export.svg';
            a.click();
            URL.revokeObjectURL(url);
            setStatus('SVG exported');
          }}>Export SVG</button>
          <button style={btn('#89b4fa')} onClick={async () => {
            try {
              let ids = editor.getSelectedShapeIds();
              if (ids.length === 0) ids = editor.getShapeIdsSignal().peek();
              const blob = await editor.exportToPng(ids, { scale: 2 });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'export.png';
              a.click();
              URL.revokeObjectURL(url);
              setStatus('PNG exported');
            } catch (e: any) {
              setStatus(`Export failed: ${e.message}`);
            }
          }}>Export PNG</button>
        </Panel>
        
        <div style={{ color: '#a6adc8', fontSize: 13, background: '#1e1e2e', padding: 12, borderRadius: 8 }}>
          {status || 'Ready'}
          <br/><br/>
          Shapes: {editor.getShapeIdsSignal().value.length}
          <br/>
          Camera: x={Math.round(camera.x)} y={Math.round(camera.y)} z={camera.z.toFixed(2)}
        </div>
      </div>

      {/* Canvas */}
      <div 
        tabIndex={0}
        style={{ flex: 1, position: 'relative', background: '#181825', borderRadius: 12, overflow: 'hidden', touchAction: 'none', outline: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <SvgCanvas />
        <CanvasOverlay />
      </div>
    </div>
  );
}
