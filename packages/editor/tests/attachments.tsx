import React from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '../dist/styles.css';
import '../dist/index.css';
import { Editor } from '../src/index';
import { attachmentPreview } from '../../../ui/app/core/editor/attachmentPreview';
const ready = { attachmentId: 'test', fileName: 'report.txt', fileSize: 12, fileType: 'text/plain', fileUrl: 'data:text/plain,Hello%20world', uploadStatus: 'success' };
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read ' }, { type: 'attachmentInline', attrs: ready }, { type: 'text', text: ' here.' }] }, { type: 'paragraph', content: [{ type: 'attachmentInline', attrs: { ...ready, fileName: 'failed.txt', fileUrl: '', uploadStatus: 'error', errorMessage: 'Upload rejected by server', placeholderId: 'lost-on-reload' } }] }] };
const win = window as any;
win.downloads = 0;
const handler = {
  uploadAttachment: async (file: File) => {
    await new Promise(r => setTimeout(r, 200));
    if (file.name.includes('fail')) throw new Error('Replacement rejected');
    return { attachmentId: 'new', fileName: file.name, fileSize: file.size, mimeType: file.type || 'text/plain', url: URL.createObjectURL(file) };
  },
  downloadAttachment: async () => { win.downloads++; await new Promise(r => setTimeout(r, 200)); if (win.failDownload) throw new Error('Download unavailable'); },
  previewAttachment: attachmentPreview,
};
createRoot(document.getElementById('root')!).render(<Theme><main style={{ maxWidth: 850, margin: '40px auto', padding: 30 }}><h1>Attachment workflows</h1><label><input type="checkbox" onChange={e => { win.failDownload = e.target.checked; }} />Fail downloads</label><h2>Editing</h2><section data-fixture="edit"><Editor initialContent={content} attachmentHandler={handler} onReady={e => { win.attachmentEditor = e; }} /></section><h2>Reading</h2><section data-fixture="view"><Editor editable={false} initialContent={content} attachmentHandler={handler} /></section></main></Theme>);
