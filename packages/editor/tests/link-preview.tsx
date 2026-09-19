import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '../dist/styles.css';
import { Editor } from '../dist/index.mjs';

let failedCalls = 0;
let viewCalls = 0;
let edit: any;
let view: any;
let race: any;
let failRefresh = false;
let finishOld: (() => void) | undefined;
const raceHandler = { getLinkMetadata: async (url: string) => {
  if (failRefresh) throw new Error("refresh failed");
  if (url.endsWith('/new')) return { url, title: 'New URL preview' };
  return new Promise<{url: string; title: string}>(resolve => { finishOld = () => resolve({ url, title: 'Old URL preview' }); });
} };
const failure = { getLinkMetadata: async () => { failedCalls++; throw new Error('fixture failure'); } };
const success = { getLinkMetadata: async (url: string) => { viewCalls++; return { url, title: 'Resolved locally', siteName: 'Example' }; } };
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'externalLinkInline', attrs: { href: 'https://example.com' } },
  { type: 'text', text: ' ' },
  { type: 'externalLinkInline', attrs: { href: 'https://example.com' } },
] }] };
function App() {
  const [key, remount] = useState(0);
  const [expectedCalls, setExpectedCalls] = useState(1);
  const [result, setResult] = useState('Not checked');
  return <Theme><main style={{ padding: 30 }}>
    <h1>External link regression</h1>
    <button onClick={() => setExpectedCalls(2)}>Expect one manual retry</button>
    <button onClick={() => remount(key + 1)}>Remount editors</button>
    <button onClick={() => { edit.commands.setNodeSelection(1); }}>Select failed link</button>
    <button onClick={() => {
      const attrs = view.getJSON().content[0].content[0].attrs;
      setResult(JSON.stringify({ failedCalls, viewCalls, readonlyTitle: attrs.title, readonlyResolved: attrs.metadataResolved,
        passed: failedCalls === expectedCalls && viewCalls === 1 && !attrs.title && !attrs.metadataResolved }, null, 2));
    }}>Check requests and readonly data</button>
    <button onClick={() => race.commands.command(({tr, dispatch}: any) => {
      if (dispatch) dispatch(tr.setNodeMarkup(1, undefined, { ...tr.doc.nodeAt(1).attrs, href: 'https://example.com/new' }));
      return true;
    })}>Change pending URL</button>
    <button onClick={() => { failRefresh = true; race.commands.setNodeSelection(1); }}>Select resolved link and fail refresh</button>
    <button onClick={() => finishOld?.()}>Finish old request</button>
    <button onClick={() => {
      const attrs = race.getJSON().content[0].content[0].attrs;
      setResult(JSON.stringify({ title: attrs.title, metadataHref: attrs.metadataHref, passed: attrs.title === 'New URL preview' && attrs.metadataHref === 'https://example.com/new' }, null, 2));
    }}>Check stale response</button>
    <pre>{result}</pre>
    <h2>Editable failure (two duplicate URLs)</h2>
    <Editor key={'e'+key} initialContent={doc} externalLinkHandler={failure} onReady={e => edit = e} />
    <h2>Read-only success (two duplicate URLs)</h2>
    <Editor key={'v'+key} initialContent={doc} editable={false} externalLinkHandler={success} onReady={e => view = e} />
    <h2>URL change during pending request</h2>
    <Editor initialContent={doc} externalLinkHandler={raceHandler} onReady={e => race = e} />
  </main></Theme>;
}
createRoot(document.getElementById('root')!).render(<App />);
