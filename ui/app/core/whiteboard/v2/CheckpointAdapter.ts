import * as Y from 'yjs';
import { uint8ArrayToBase64 } from 'app/core/utils/base64';
import type { YjsPersistenceAdapter, YjsSaveRequest, YjsSaveResult } from '../durability/types';
import { post, sequence } from './api';

/** The coordinator supplies verified full projections; only their incremental difference is sent. */
export class CheckpointAdapter implements YjsPersistenceAdapter {
    private vector: Uint8Array;
    private pending = new Map<string, { update: string }>();
    constructor(private base: string, initialState: Uint8Array, private restoreGeneration = '0') {
        this.vector = Y.encodeStateVectorFromUpdate(initialState);
    }
    async save(request: YjsSaveRequest): Promise<YjsSaveResult> {
        let body = this.pending.get(request.requestId);
        if (!body) {
            const update = Y.diffUpdate(request.encodedState, this.vector);
            if (update.length > 1024 * 1024) throw Object.assign(new Error('This edit exceeds the 1 MiB checkpoint limit. Your changes remain in local recovery.'), { retryable: false });
            body = { update: uint8ArrayToBase64(update) };
            this.pending.set(request.requestId, body);
        }
        const receipt = await post<{ pageId: number; sequence: string }>(`${this.base}/checkpoint`, { updateEncoding: 'yjs-update-v1', ...body, restoreGeneration: this.restoreGeneration }, request.requestId, request.signal);
        if (String(receipt.pageId) !== request.draftId) throw new Error('Checkpoint acknowledgement belongs to another board');
        sequence(receipt.sequence);
        this.vector = Y.encodeStateVectorFromUpdate(request.encodedState);
        this.pending.delete(request.requestId);
        return { draftId: request.draftId, durableRevision: receipt.sequence, acknowledgedCheckpoint: { ...request.target.yjs } };
    }
}
