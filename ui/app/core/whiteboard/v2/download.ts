import { checkedFetch, contentUrl, digest, type PublishedBoard } from './api';

export type WhiteboardDownloadFormat = 'svg' | 'png';

async function exportPublishedSvg(spaceId: string, pageId: string, board: PublishedBoard, signal: AbortSignal): Promise<Blob> {
    const { snapshot, versionId } = board;
    if (snapshot.updateEncoding !== 'yjs-update-v1') throw new Error('Unsupported snapshot encoding');
    const response = await checkedFetch(contentUrl(snapshot.downloadUrl), { signal });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== snapshot.byteLength || await digest(bytes) !== snapshot.stateDigest) {
        throw new Error('Whiteboard snapshot verification failed');
    }

    const [{ GlideboardController }, Y, { WhiteboardAssetHttpAdapterV2 }] = await Promise.all([
        import('@durgakiran/glideboard'),
        import('yjs'),
        import('./WhiteboardAssetHttpAdapterV2'),
    ]);
    signal.throwIfAborted();
    const doc = new Y.Doc();
    try {
        Y.applyUpdate(doc, bytes);
        if (doc.store.pendingStructs || doc.store.pendingDs) throw new Error('Incomplete published snapshot');
        const documentId = `v2:${spaceId.toLowerCase()}:${pageId}`;
        const assetStorage = new WhiteboardAssetHttpAdapterV2({ spaceId, pageId, signal });
        try {
            const controller = new GlideboardController({
                sessionKey: `${documentId}:${versionId}`,
                readOnly: true,
                assetStorage,
                assetResolutionContext: { documentId, versionId, snapshotId: snapshot.id },
            });
            try {
                // Project the published snapshot in memory without attaching a provider.
                controller.attachCollaboration({ doc, boardIdentity: documentId });
                const target = await controller.captureProjectionTarget();
                const svg = await controller.exportSvgAtTarget({ target });
                const content = svg === '<svg></svg>' ? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' : svg;
                return new Blob([content], { type: 'image/svg+xml' });
            } finally {
                await controller.dispose();
            }
        } finally {
            await assetStorage.dispose();
        }
    } finally {
        doc.destroy();
    }
}

async function getPublishedPng(board: PublishedBoard, signal: AbortSignal): Promise<Blob> {
    if (!board.preview) throw new Error('No published PNG preview');
    const image = await (await checkedFetch(contentUrl(board.preview.url), { signal })).blob();
    if (image.type !== 'image/png') throw new Error('Invalid published PNG preview');
    return image;
}

export async function downloadPublishedWhiteboard(spaceId: string, pageId: string, board: PublishedBoard, format: WhiteboardDownloadFormat, signal: AbortSignal): Promise<void> {
    const image = format === 'svg' ? await exportPublishedSvg(spaceId, pageId, board, signal) : await getPublishedPng(board, signal);
    signal.throwIfAborted();
    const name = board.snapshot.title.replace(/[<>:"/\\|?*]/g, '-').trim() || 'whiteboard';
    const url = URL.createObjectURL(image);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.${format}`;
    document.body.appendChild(link);
    try {
        link.click();
    } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
}
