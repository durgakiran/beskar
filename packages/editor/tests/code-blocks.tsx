import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '../dist/styles.css';
import '../dist/index.css';
import { Editor } from '../dist/index.mjs';
const code = (text: string, attrs = {}) => ({ type: 'codeBlock', attrs: { language: 'javascript', ...attrs }, content: [{ type: 'text', text }] });
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const sample = { type: 'doc', content: [p('Code block regression document'), code('const greeting = "Hello";\nconsole.log(greeting);', { caption: 'greeting.js' }), code(Array.from({ length: 24 }, (_, i) => `const value${i} = "${'long text '.repeat(i === 1 ? 25 : 2)}";`).join('\n'), { lineNumbers: true }), code('<h2>Hello preview</h2>\n<p>Static HTML example.</p>', { language: 'xml' }), { type: 'columns', content: [ { type: 'column', content: [code('const nested = true;'), p('Column one')] }, { type: 'column', content: [p('Column two')] } ] }, { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [code('const cell = true;')] }, { type: 'tableCell', content: [p('Other cell')] }] }] }, p('After code') ] };
function App() {
  const [dark, setDark] = useState(false);
  const [editable, setEditable] = useState(true);
  return <Theme appearance={dark ? 'dark' : 'light'}>
    <style>{`body{margin:0} main{padding:24px;max-width:1000px;margin:auto} section{min-width:0;padding:16px;border:1px solid var(--gray-6);margin:16px 0} .fixture-controls{display:flex;gap:12px} h1,h2{font-family:system-ui} .nested-scroll{height:650px;overflow:auto}`}</style>
    <main><h1>Code block regression fixture</h1><div className="fixture-controls"><button onClick={() => setDark(!dark)}>Toggle dark theme</button><button onClick={() => setEditable(!editable)}>Toggle editability</button></div>
      <section data-fixture="edit"><h2>Editable package</h2><div className="nested-scroll"><Editor editable={editable} initialContent={sample} onReady={editor => { (window as any).codeEditor = editor; }} /></div></section>
      <section data-fixture="view"><h2>Read-only package</h2><Editor editable={false} initialContent={sample} onReady={editor => { (window as any).codeReader = editor; }} /></section>
    </main>
  </Theme>;
}
createRoot(document.getElementById('root')!).render(<App />);
