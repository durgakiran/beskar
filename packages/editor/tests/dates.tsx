import React from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '../dist/styles.css';
import '../dist/index.css';
import { Editor } from '../dist/index.mjs';
const content = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'Due ' }, { type: 'dateInline', attrs: { value: '2030-10-10' } }, { type: 'text', text: ' next.' },
] }] };
createRoot(document.getElementById('root')!).render(<Theme><main style={{ maxWidth: 850, margin: '160px auto', padding: 30 }}>
  <section data-fixture="edit"><Editor initialContent={content} onReady={e => { (window as any).dateEditor = e; }} /></section>
  <section data-fixture="view"><Editor editable={false} initialContent={content} onReady={e => { (window as any).dateReader = e; }} /></section>
</main></Theme>);
