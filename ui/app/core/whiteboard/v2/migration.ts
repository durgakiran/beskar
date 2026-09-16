import * as Y from 'yjs';
import { createPublishPreview, type GlideboardHandle } from '@durgakiran/glideboard';
import { validateAssetRecord } from '@durgakiran/glideline';
import { digest } from './api';
import { base64ToUint8Array, uint8ArrayToBase64 } from 'app/core/utils/base64';
import { IndexedDbYjsRecoveryAdapter } from '../durability/IndexedDbYjsRecoveryAdapter';

export interface MigrationSource {
    contentApiVersion: number;
    sourceDocId: string;
    sourceFingerprint: string;
    state: string;
    stateDigest: string;
    title: string;
    updateEncoding: string;
}
export async function loadMigrationDocument(source: MigrationSource, space: string, page: string, signal?: AbortSignal): Promise<Y.Doc> {
    signal?.throwIfAborted();
    if (source.updateEncoding !== 'yjs-update-v1' || !/^[1-9]\d*$/.test(source.sourceDocId)) throw new Error('Invalid migration source.');
    const state = base64ToUint8Array(source.state);
    if (await digest(state) !== source.stateDigest) throw new Error('Migration source checksum mismatch.');
    signal?.throwIfAborted();
    const doc = new Y.Doc();
    try {
        Y.applyUpdate(doc, state);
        doc.getMap('glideboard-meta').set('boardIdentity', `v2:${space}:${page}`);
        return doc;
    } catch (error) { doc.destroy(); throw error; }
}

// Inspect without clearing or merging recovery into the migration snapshot.
// Opening the legacy editor lets its normal durability flow save these edits.
export async function hasLegacyRecovery(space: string, page: string, sourceDocId: string): Promise<boolean> {
    const origin = (import.meta.env.VITE_USER_SERVER_URL || '').replace(/\/+$/, '');
    const recovery = new IndexedDbYjsRecoveryAdapter(`${origin}:${space}:${page}:${sourceDocId}`, sourceDocId);
    const doc = new Y.Doc();
    try { return Boolean(await recovery.hydrate(doc)); }
    finally { doc.destroy(); await recovery.dispose(); }
}

export async function prepareMigration(board: GlideboardHandle, doc: Y.Doc, source: MigrationSource, signal?: AbortSignal) {
    signal?.throwIfAborted();
    // Drain imports and projection work before capturing the detached, read-only source.
    const fence = await board.prepareForCapture('publish', { signal });
    try {
        signal?.throwIfAborted();
        const target = await board.captureProjectionTarget();
        if (board.checkpoints.status.value !== 'healthy') throw new Error('The whiteboard cannot be safely migrated.');
        const records = board.serialize().records as unknown as Array<Record<string, unknown>>;
        if (records.some(record => record.kind === 'opaque')) throw new Error('Some whiteboard records cannot be rendered. Migration was stopped.');
        const assets = new Map<string, Record<string, unknown>>();
        for (const record of records.filter(record => record.kind === 'asset')) {
            const props = record.props as Record<string, unknown> | undefined;
            if (!['raster-image', 'sanitized-svg'].includes(String(record.type)) || record.schemaVersion !== 1 || !props || record.id !== `asset:sha256:${props.hash}` || Number(props.byteLength) <= 0) throw new Error('A whiteboard asset is invalid. Migration was stopped.');
            validateAssetRecord(record);
            if (record.type === 'sanitized-svg') {
                const canonical = new TextEncoder().encode(JSON.stringify({ viewBox: props.viewBox, width: props.width, height: props.height, paths: props.paths }));
                if (canonical.byteLength !== props.byteLength || await digest(canonical) !== `sha256:${props.hash}`) throw new Error('A vector image does not match its recorded content. Migration was stopped.');
            }
            assets.set(String(record.id), record);
            if (assets.size > 10_000) throw new Error('This whiteboard exceeds the migration limit of 10,000 assets.');
        }
        for (const record of records.filter(record => record.kind !== 'asset')) {
            const assetId = (record.props as Record<string, unknown> | undefined)?.assetId;
            if (assetId !== undefined || ['raster-image', 'sanitized-svg'].includes(String(record.type))) {
                const asset = assets.get(String(assetId));
                if (!asset || asset.type !== record.type) throw new Error('A whiteboard image is missing its asset record. Migration was stopped.');
            }
        }
        const original = new Y.Doc();
        try {
            Y.applyUpdate(original, base64ToUint8Array(source.state));
            const nested = original.getMap('glideboard-records-v2');
            const legacy = original.getMap('glideboard-records');
            const metadata = original.getMap('glideboard-meta');
            const adopted = nested.size > 0 || metadata.get('schemaVersion') === 2 || metadata.get('recordModel') === 'nested-map-tombstone-v1';
            if (adopted && !nested.size && legacy.size) throw new Error('The whiteboard source is ambiguous. Migration was stopped.');
            const sourceRecords = adopted ? nested : legacy;
            const projectedIds = new Set(records.map(record => record.id));
            for (const [id, value] of sourceRecords) {
                if (adopted && !(value instanceof Y.Map)) throw new Error('Some whiteboard records cannot be rendered. Migration was stopped.');
                if (value instanceof Y.Map && value.get('$tombstone') === true) continue;
                if (value instanceof Y.Map && value.has('$opaque')) throw new Error('Some whiteboard records cannot be rendered. Migration was stopped.');
                if (!projectedIds.has(id)) throw new Error('Some whiteboard records were not loaded. Migration was stopped.');
            }
        } finally { original.destroy(); }
        const rasterAssets = [...assets.values()].filter(asset => asset.type === 'raster-image');
        // Validate even unreferenced/off-page originals; the server preserves every live asset.
        for (const asset of rasterAssets) {
            signal?.throwIfAborted();
            await board.downloadAsset(String(asset.id), signal, { documentId: source.sourceDocId });
        }
        signal?.throwIfAborted();
        const state = Y.encodeStateAsUpdate(doc);
        if (await digest(state) !== target.yjs.stateDigest) throw new Error('The whiteboard changed during migration preparation.');
        const preview = await createPublishPreview(board, { target });
        signal?.throwIfAborted();
        const after = await board.captureProjectionTarget();
        if (after.storeRevision !== target.storeRevision || after.yjs.stateDigest !== target.yjs.stateDigest || await digest(Y.encodeStateAsUpdate(doc)) !== target.yjs.stateDigest) throw new Error('The whiteboard changed during preview generation.');
        signal?.throwIfAborted();
        return { sourceDocId: source.sourceDocId, sourceFingerprint: source.sourceFingerprint,
            updateEncoding: 'yjs-update-v1', state: uint8ArrayToBase64(state), title: source.title.trim(), preview };
    } finally { fence.release(); }
}

export type MigrationRequest = Awaited<ReturnType<typeof prepareMigration>>;
