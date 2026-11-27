import { GlideboardController } from '@durgakiran/glideboard';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { digest, type PublishedBoard } from './api';
import { downloadPublishedWhiteboard } from './download';

const spaceId = '11111111-1111-4111-8111-111111111111';
const pageId = '42';
const versionId = '22222222-2222-4222-8222-222222222222';
const base = `/api/v2/editor/space/${spaceId}/whiteboard/${pageId}/published/${versionId}`;
const board: PublishedBoard = {
    versionId,
    snapshot: {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'Published diagram',
        throughSequence: '1',
        updateEncoding: 'yjs-update-v1',
        downloadUrl: `${base}/content`,
        byteLength: 0,
        stateDigest: '',
    },
    preview: { url: `${base}/preview` },
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('downloads the stored PNG using its published version URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('preview bytes', { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetcher);
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await downloadPublishedWhiteboard(spaceId, pageId, board, 'png', new AbortController().signal);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`${base}/preview`), expect.objectContaining({ credentials: 'include' }));
    expect(createURL.mock.calls[0][0]).toMatchObject({ type: 'image/png', size: 13 });
    expect(click.mock.contexts[0]).toMatchObject({ download: 'Published diagram.png' });
});

it('renders real SVG vector shapes from the published snapshot', async () => {
    const doc = new Y.Doc();
    const writer = new GlideboardController({ sessionKey: 'export-fixture' });
    let bytes: Uint8Array<ArrayBuffer>;
    try {
        writer.attachCollaboration({ doc, boardIdentity: `v2:${spaceId}:${pageId}` });
        writer.editor.createShape({
            id: 'shape:box', type: 'box', x: 10, y: 20, index: 'a0001',
            props: { w: 120, h: 80, label: 'Exported vector box' },
        });
        bytes = Uint8Array.from(Y.encodeStateAsUpdate(doc));
    } finally {
        await writer.dispose();
        doc.destroy();
    }

    const publication: PublishedBoard = {
        ...board, snapshot: { ...board.snapshot, byteLength: bytes.length, stateDigest: await digest(bytes) },
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal('fetch', fetcher);
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await downloadPublishedWhiteboard(spaceId, pageId, publication, 'svg', new AbortController().signal);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`${base}/content`), expect.anything());
    const blob = createURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/svg+xml');
    const svg = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
    expect(svg.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.querySelector('rect, path')).toBeTruthy();
    expect(svg.querySelector('image')).toBeNull();
    expect(click.mock.contexts[0]).toMatchObject({ download: 'Published diagram.svg' });
});
