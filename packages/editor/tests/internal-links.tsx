import React from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import '../dist/styles.css';
import { Editor } from '../src/index';

const state = { calls: 0, navigations: [] as unknown[], failure: true, searchFailure: false, status: 500, title: 'Current title', requests: [] as unknown[] };
const handler = {
  appBaseUrl: window.location.origin,
  getResourceUrl: (id: string, type: string, context: any) => `${window.location.origin}/space/${context?.spaceId || 'home'}/view/${id}`,
  searchResources: async (query: string, type: string) => {
    if (state.searchFailure) throw new Error('Search failed');
    if (query === 'slow') await new Promise(resolve => setTimeout(resolve, 800));
    return Array.from({ length: 9 }, (_, i) => ({ resourceId: String(i + 1), resourceType: type, title: `${query || 'Result'} ${type} ${i + 1}`, spaceId: 'home' }));
  },
  getResourceMetadata: async (id: string, type: string, context: any) => {
    state.calls++; state.requests.push({ id, type, context });
    if (state.failure) throw Object.assign(new Error('Fixture failure'), { status: state.status });
    return { resourceId: id, resourceType: type, title: state.title };
  },
  navigateToResource: (...args: unknown[]) => { state.navigations.push(args); },
};
const attrs = { resourceId: '42', resourceType: 'document', resourceTitle: 'Old cached title', href: `${window.location.origin}/space/other/view/42?mode=x#section` };
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before ' }, { type: 'internalDocInline', attrs }, { type: 'text', text: ' after' }] }, { type: 'internalLinkBlock', attrs }, { type: 'paragraph' }] };
const empty = { type: 'doc', content: [{ type: 'internalLinkBlock' }, { type: 'paragraph' }] };
(window as any).internalFixture = { state, editors: {} };
createRoot(document.getElementById('root')!).render(<Theme><main style={{ padding: 50 }}>
  <section data-fixture="edit"><h2>Editing</h2><Editor initialContent={doc} internalResourceHandler={handler} onReady={editor => (window as any).internalFixture.editors.edit = editor} /></section>
  <section data-fixture="view"><h2>Reading</h2><Editor initialContent={doc} editable={false} internalResourceHandler={handler} onReady={editor => (window as any).internalFixture.editors.view = editor} /></section>
  <section data-fixture="empty"><h2>Empty readonly</h2><Editor initialContent={empty} editable={false} internalResourceHandler={handler} onReady={editor => (window as any).internalFixture.editors.empty = editor} /></section>
</main></Theme>);
