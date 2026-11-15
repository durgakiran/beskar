import { useRef, useState } from 'react';
import { Glideboard, type GlideboardHandle } from '@durgakiran/glideboard';
import {
  buildArrowBindingRecord, buildArrowShapeRecord, resolveConnectionTerminal, sid,
  type GlideEditor, type GlidePlugin, type ShapeId, type Vec2,
} from '@durgakiran/glideline';
import { sketchStrokesPlugin, type SketchRenderer } from './sketch-strokes';
import './sketch-comparison.css';

function seedDiagram(editor: GlideEditor, renderer: SketchRenderer): void {
  const strokeStyle = renderer === 'seeded' ? 'sketch' : 'solid';
  const prepare = editor.createShape({
    id: sid('shape:sketch-prepare'), type: 'box', x: 52, y: 70,
    props: { strokeStyle, w: 148, h: 62, cornerRadius: 0, fillStyle: 'semi', color: 'blue', label: 'Prepare\nrelease notes' },
  });
  const review = editor.createShape({
    id: sid('shape:sketch-review'), type: 'ellipse', x: 268, y: 195,
    props: { strokeStyle, w: 148, h: 78, fillStyle: 'semi', color: 'teal', label: 'Review' },
  });
  const approved = editor.createShape({
    id: sid('shape:sketch-approved'), type: 'diamond', x: 65, y: 335,
    props: { strokeStyle, w: 148, h: 84, fillStyle: 'semi', color: 'orange', label: 'Approved?' },
  });

  function connect(id: string, label: string, from: ShapeId, to: ShapeId, start: Vec2, end: Vec2): void {
    const fromAnchor = resolveConnectionTerminal(editor, from, start)!;
    const toAnchor = resolveConnectionTerminal(editor, to, end)!;
    const record = buildArrowShapeRecord({
      id: sid(id), startWorld: fromAnchor.point, endWorld: toAnchor.point, parentId: editor.getActivePageId(),
    });
    const arrow = editor.createShape({ ...record, props: { ...record.props, strokeStyle, label, fontSize: 'sm' } });
    editor.createBinding(buildArrowBindingRecord({ ...fromAnchor, fromId: arrow, toId: from, terminal: 'start' }));
    editor.createBinding(buildArrowBindingRecord({ ...toAnchor, fromId: arrow, toId: to, terminal: 'end' }));
  }

  connect('shape:sketch-send', 'Send for review', prepare, review, { x: 126, y: 132 }, { x: 342, y: 195 });
  connect('shape:sketch-accept', 'If approved', review, approved, { x: 342, y: 273 }, { x: 139, y: 335 });
}

const variants: { id: SketchRenderer; title: string; detail: string }[] = [
  { id: 'seeded', title: 'tldraw-style', detail: 'Two outline passes and a subtle connector stroke' },
  { id: 'rough', title: 'Rough.js', detail: 'Rough.js outlines and a single connector stroke' },
];

const plugins = new Map(variants.map(({ id }) => [id, [
  ...(id === 'rough' ? [sketchStrokesPlugin()] : []),
  {
    id: 'sketch-demo-diagram',
    onInstall: editor => editor.batch('Seed sketch diagram', () => seedDiagram(editor, id), { history: 'ignore' }),
  },
] satisfies GlidePlugin[]]));

function SketchBoard({ id, title, detail, revision }: (typeof variants)[number] & { revision: number }) {
  const board = useRef<GlideboardHandle>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  async function downloadSvg() {
    if (!board.current) return;
    setExporting(true);
    setError('');
    try {
      const svg = await board.current.exportSvg();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `sketch-${id}.svg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('SVG export failed. Try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="sketch-comparison-panel" aria-label={title}>
      <header>
        <div><h2>{title}</h2><p>{detail}</p></div>
        <button type="button" disabled={exporting} onClick={downloadSvg}>Export SVG</button>
        {error && <p role="alert">{error}</p>}
      </header>
      <div className="sketch-comparison-board">
        <Glideboard ref={board} sessionKey={`sketch-${id}-${revision}`} customShapes={plugins.get(id)!} />
      </div>
    </section>
  );
}

export default function SketchComparisonDemo() {
  const [revision, setRevision] = useState(0);
  return (
    <main className="sketch-comparison">
      <div className="sketch-comparison-heading">
        <div>
          <h1>Sketch stroke comparison</h1>
          <p>Drag or resize a shape in either board to see its Ortho connectors follow.</p>
        </div>
        <button type="button" onClick={() => setRevision(value => value + 1)}>Reset diagrams</button>
      </div>
      <div className="sketch-comparison-grid">
        {variants.map(variant => (
          <SketchBoard key={variant.id} {...variant} revision={revision} />
        ))}
      </div>
    </main>
  );
}
