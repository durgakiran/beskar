/** Browser event regressions complement native drag checks in the integrated UI.
 * Build the package, serve packages/editor with Vite, then open this fixture.
 */
import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import type { Editor as TiptapEditor } from '@tiptap/core';
import '@radix-ui/themes/styles.css';
import '../dist/styles.css';
import '../dist/index.css';
import { Editor } from '../dist/index.mjs';
import { Doc } from 'yjs';
import { Collaboration } from '@tiptap/extension-collaboration';

const content = { type: 'doc', content: Array.from({ length: 40 }, (_, i) => ({ type: 'paragraph', attrs: { blockId: `test-${i}` }, content: [{ type: 'text', text: `Paragraph ${i} — stable content` }] })) };
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
function App() {
  const collaboration = useMemo(() => [Collaboration.configure({ document: new Doc() })], []);
  const editor = useRef<TiptapEditor | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const assert = (condition: unknown, name: string) => { if (!condition) throw new Error(name); setResults(old => [...old, `PASS: ${name}`]); };
  const run = async () => {
    const e = editor.current!;
    setRunning(true); setResults([]);
    const reset = async () => {
      e.setEditable(true); e.commands.setContent(content); scroll.current!.scrollTop = 0;
      await nextFrame(); await nextFrame();
    };
    const begin = () => {
      const block = e.view.dom.children[1] as HTMLElement;
      const r = block.getBoundingClientRect();
      block.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + 80, clientY: r.top + r.height / 2 }));
      const handle = document.querySelector<HTMLButtonElement>('.block-drag-handle')!;
      const hr = handle.getBoundingClientRect();
      handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: hr.left + 10, clientY: hr.top + 10 }));
      const transfer = new DataTransfer();
      handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: hr.left + 10, clientY: hr.top + 10 }));
      // This is part of native HTML drag startup, not cancellation of the drag session.
      handle.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
      return transfer;
    };
    const dragEvent = (type: string, transfer: DataTransfer, x: number, y: number) => e.view.dom.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
    try {
      await reset();
      const before = JSON.stringify(e.getJSON());
      e.can().moveBlockDown('test-1');
      assert(JSON.stringify(e.getJSON()) === before, 'can().moveBlockDown is read-only');
      e.commands.setTextSelection(e.state.doc.child(0).nodeSize + 1);
      e.commands.moveBlockDown('test-1');
      await nextFrame();
      const moved = JSON.stringify(e.getJSON());
      e.commands.insertContent(' typed');
      e.commands.undo();
      assert(JSON.stringify(e.getJSON()) === moved, 'collaborative undo separates typing from the move');
      e.commands.undo();
      assert(JSON.stringify(e.getJSON()) === before, 'second collaborative undo restores the original order');
      await reset();
      let transfer = begin();
      assert(!!e.view.dom.querySelector('.block-is-dragging'), 'native pointercancel keeps the drag session active');
      const viewport = scroll.current!.getBoundingClientRect();
      dragEvent('dragover', transfer, viewport.left + 100, viewport.bottom - 10);
      const start = performance.now();
      while (performance.now() - start < 450) await nextFrame();
      assert(scroll.current!.scrollTop > 0, 'holding at the actual scroll edge scrolls the editor');
      assert(!document.querySelector<HTMLElement>('.block-drag-drop-indicator')!.hidden, 'insertion indicator stays visible during auto-scroll');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      assert(!e.view.dom.querySelector('.block-is-dragging') && !document.querySelector('.block-drag-preview'), 'Escape cleans source and preview');
      assert(JSON.stringify(e.getJSON()) === before, 'Escape preserves document content');

      await reset(); transfer = begin();
      const source = e.state.doc.child(0).nodeSize;
      e.commands.insertContentAt(source + 1, 'Edited during drag: ');
      const target = e.view.dom.children[5].getBoundingClientRect();
      dragEvent('dragover', transfer, target.left + 100, target.bottom - 1);
      dragEvent('drop', transfer, target.left + 100, target.bottom - 1);
      assert(e.getJSON().content!.find(n => n.attrs?.blockId === 'test-1')?.content?.[0]?.text?.startsWith('Edited during drag:'), 'drop retains edits received during the drag');
      assert(e.getJSON().content![5].attrs?.blockId === 'test-1', 'preview boundary and committed position agree');

      await reset(); transfer = begin();
      e.commands.deleteRange({ from: e.state.doc.child(0).nodeSize, to: e.state.doc.child(0).nodeSize + e.state.doc.child(1).nodeSize });
      await nextFrame(); await nextFrame();
      assert(!document.querySelector('.block-drag-preview'), 'deleting source during drag cancels cleanly');

      await reset(); begin(); e.setEditable(false);
      await nextFrame(); await nextFrame();
      assert(document.querySelector<HTMLButtonElement>('.block-drag-handle')!.hidden && !document.querySelector('.block-drag-preview'), 'read-only transition cancels and hides controls');
      e.setEditable(true);
      setResults(old => [...old, 'COMPLETE']);
    } catch (error) { setResults(old => [...old, `FAIL: ${String(error)}`]); }
    finally { setRunning(false); }
  };
  return <Theme><main style={{ padding: 24 }}><h1>Block reordering browser regressions</h1>
    <button disabled={running} onClick={run}>Run event regressions</button>
    <pre role="status">{results.join('\n')}</pre>
    <div ref={scroll} style={{ height: 360, overflow: 'auto', border: '1px solid #ccc', padding: 16 }}>
      <Editor extensions={collaboration} initialContent={content} onReady={e => { editor.current = e; }} />
    </div>
  </main></Theme>;
}
createRoot(document.getElementById('root')!).render(<App />);
