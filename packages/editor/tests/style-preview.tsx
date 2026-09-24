/** Manual regression fixture: actual built editors, equal-width edit/view content. */
import { checkEditorStyles } from './style-checks';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '../dist/styles.css?consistency=3';
import '../dist/index.css';
import { Editor } from '../dist/index.mjs';
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const heading = (level: number) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: `Heading ${level}` }] });
const sample = { type: 'doc', content: [
  p('Paragraph above the divider.'), { type: 'horizontalRule' }, p('Paragraph below the divider.'),
  ...[1, 2, 3, 4, 5, 6].map(heading), p('Ordinary paragraph with the shared line height.'),
  { type: 'bulletList', content: [{ type: 'listItem', content: [p('A document list item'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('Nested list item')] }] }] }] },
  { type: 'tableOfContents' }, { type: 'childPagesList' },
  { type: 'codeBlock', attrs: { language: 'javascript' }, content: [{ type: 'text', text: 'const spacing = "shared";' }] },
  { type: 'blockquote', content: [p('A quote'), p('Another quote paragraph')] },
  { type: 'details', attrs: { open: true }, content: [{ type: 'detailsSummary', content: [{ type: 'text', text: 'Details' }] }, { type: 'detailsContent', content: [heading(2), p('Details content')] }] },
  { type: 'noteBlock', content: [{ type: 'text', text: 'A note with inline content.' }] },
  { type: 'columns', content: [{ type: 'column', content: [heading(2), p('Column one'), { type: 'horizontalRule' }, p('After divider')] }, { type: 'column', content: [heading(2), p('Column two')] }] },
  { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('Cell A')] }, { type: 'tableCell', content: [p('Cell B')] }] }] },
  { type: 'imageBlock', attrs: { src: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="80"%3E%3Crect width="320" height="80" fill="%2394a3b8"/%3E%3C/svg%3E', width: 320, height: 80, caption: 'A long image caption that should wrap identically in editing and viewing, including when the image width changes.' } },
] };
const childPagesHandler = { getPageHierarchy: async () => [{ pageId: 'test-child', title: 'Child page navigation', children: [] }], navigateToChildPage: () => {} };
function App() {
  const [result, setResult] = useState<ReturnType<typeof checkEditorStyles> | null>(null);
  const [dark, setDark] = useState(false);
  const [mobile, setMobile] = useState(false);
  return <Theme appearance={dark ? 'dark' : 'light'}>
    <style>{`body{margin:0} main{padding:24px} .fixtures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:32px} section{min-width:0;border:1px solid var(--gray-6);padding:16px} .fixture-label{font:600 16px system-ui;margin:0 0 24px} .document-editor-surface{--editor-font-family:var(--default-font-family);--editor-line-height:1.625;--editor-font-size:1rem} main > button{margin:0 12px 24px 0} @media(max-width:800px){.fixtures{grid-template-columns:1fr}}`}</style>
    <main><h1>Editor style consistency fixture</h1><button onClick={() => setDark(!dark)}>Toggle dark theme</button><button onClick={() => setMobile(!mobile)}>Toggle narrow content</button>
      <button onClick={() => setResult(checkEditorStyles())}>Run layout checks</button><pre data-test-results>{result ? JSON.stringify(result, null, 2) : 'Checks not run'}</pre>
      <div className="fixtures">{['Package edit', 'Package view', 'UI edit', 'Published view'].map((label, i) => <section key={label} data-fixture={label} style={{ maxWidth: mobile ? 340 : undefined }}>
        <h2 className="fixture-label">{label}</h2><div className={i >= 2 ? 'document-editor-surface' : ''}>
          <Editor initialContent={sample} editable={i % 2 === 0} childPagesHandler={childPagesHandler} />
        </div>
      </section>)}</div>
    </main>
  </Theme>;
}
createRoot(document.getElementById('root')!).render(<App />);
