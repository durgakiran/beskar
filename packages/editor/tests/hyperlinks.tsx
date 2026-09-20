import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import type { Editor as TiptapEditor } from '@tiptap/core';
import '@radix-ui/themes/styles.css';
import '../src/styles/theme.css';
import '../src/styles/editor.css';
import { Editor, TextFormattingMenu } from '../src/index';

const content = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'Select this text', marks: [{ type: 'bold' }] },
  { type: 'text', text: ' and add a hyperlink.' },
] }] };

function App() {
  const [editor, setEditor] = useState<TiptapEditor>();
  return <Theme><main style={{ maxWidth: 800, margin: '60px auto' }}>
    <h1>Hyperlink editing</h1>
    <p>Select text and press Cmd/Ctrl+K or use the link button. Try editing, removing, canceling, undoing, and pasting a URL over text.</p>
    <Editor initialContent={content} onReady={setEditor}
      externalLinkHandler={{ getLinkMetadata: async (url) => ({ url, title: 'Preview' }) }} />
    {editor && <TextFormattingMenu editor={editor} />}
    <h2>Read only</h2><Editor initialContent={content} editable={false} />
    <h2>Links disabled</h2><Editor initialContent={content} features={{ links: false }} />
  </main></Theme>;
}
createRoot(document.getElementById('root')!).render(<App />);
