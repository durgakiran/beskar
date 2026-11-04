import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import { Editor } from '@durgakiran/editor';
import '@durgakiran/editor/styles.css';
import '@radix-ui/themes/styles.css';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { DocumentRealtimeRelay } from '../../app/core/editor/DocumentRealtimeRelay';
import { htmlPreview } from '../../../packages/editor/src/components/codeblock/codeBlockUtils';

const fixture = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'SEC-09 editable document fixture.' }] },
    { type: 'embedBlock', attrs: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embedUrl: 'https://evil.example/', provider: 'forged' } },
    { type: 'imageBlock', attrs: { src: '/api/v1/security-fixture/image', alt: 'SEC-09 image', uploadStatus: 'idle' } },
    { type: 'paragraph', content: [{ type: 'attachmentInline', attrs: { fileUrl: '/api/v1/security-fixture/attachment', fileName: 'security-fixture.txt', fileSize: 30, fileType: 'text/plain', uploadStatus: 'success' } }] },
    { type: 'embedBlock', attrs: { src: 'https://evil.example/framer.com/', embedUrl: 'https://evil.example/', provider: 'framer' } },
    { type: 'embedBlock', attrs: { src: 'https://excalidraw.com/', embedUrl: 'https://evil.example/', provider: 'forged' } },
] };
function Smoke() {
    const [results, setResults] = useState<string[]>([]);
    const add = (message: string) => setResults(previous => [...previous, message]);
    async function test() {
        setResults([]);
        try {
            // Actual DOM insertion, so browser CSP—not a string assertion—must stop it.
            (window as any).sec09Executed = false;
            const script = document.createElement('script');
            script.textContent = 'window.sec09Executed=true';
            document.head.append(script);
            add((window as any).sec09Executed ? 'FAIL: inline script executed' : 'PASS: inline script blocked');
            script.remove();
            const response = await fetch('/api/v1/security-fixture/attachment');
            add((await response.text()).includes('Synthetic attachment') ? 'PASS: attachment fetch' : 'FAIL: attachment fetch');
            const worker = new Worker('/fixture-worker.js');
            worker.onmessage = e => { add(e.data === 'ready' ? 'PASS: worker' : 'FAIL: worker'); worker.terminate(); };
            const bytes = new Uint8Array([0,97,115,109,1,0,0,0]);
            await WebAssembly.compile(bytes);
            add('PASS: WebAssembly compilation');
            const docs = [new Y.Doc(), new Y.Doc()];
            const awareness = docs.map(doc => new Awareness(doc));
            const relays = docs.map((doc, i) => new DocumentRealtimeRelay(doc, awareness[i], 'sec09-fixture', `ws://${location.host}/ws`));
            await new Promise(resolve => setTimeout(resolve, 500));
            docs[0].getText('body').insert(0, 'web to desktop');
            await new Promise(resolve => setTimeout(resolve, 200));
            docs[1].getText('body').insert(docs[1].getText('body').length, ' and back');
            await new Promise(resolve => setTimeout(resolve, 200));
            add(docs.every(doc => doc.getText('body').toString() === 'web to desktop and back') ? 'PASS: two independent Yjs sessions over WebSocket' : 'FAIL: collaboration');
            relays.forEach(relay => relay.destroy()); awareness.forEach(state => state.destroy()); docs.forEach(doc => doc.destroy());
        } catch (error) { add(`FAIL: ${String(error)}`); }
    }
    return <Theme><h1>SEC-09 production-policy smoke</h1><button onClick={() => void test()}>Run policy and transport checks</button><ul>{results.map((line,i) => <li key={i}>{line}</li>)}</ul>
        <Editor initialContent={fixture} onUpdate={() => add('PASS: document edit')} />
        <iframe title="Sanitized HTML preview" sandbox="" srcDoc={htmlPreview('<h2>Passive preview works</h2><script>parent.sec09Executed=true</script><meta http-equiv="refresh" content="0;url=https://evil.example">')} />
    </Theme>;
}
createRoot(document.getElementById('root')!).render(<Smoke />);
