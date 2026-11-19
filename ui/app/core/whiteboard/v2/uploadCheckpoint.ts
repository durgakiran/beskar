import { jsonRequest } from './api';
import { CHECKPOINT_MAX_BYTES } from './encodeCheckpointBatch';

export const MAX_ASSEMBLED_CHECKPOINT_BYTES = 4 * CHECKPOINT_MAX_BYTES;

interface CheckpointReceipt {
    pageId: number;
    sequence: string;
}

interface UploadProgress {
    nextOffset: number;
    receipt?: CheckpointReceipt;
}

export async function uploadCheckpoint(
    base: string,
    requestId: string,
    restoreGeneration: string,
    bytes: Uint8Array,
    digest: string,
    signal: AbortSignal,
): Promise<CheckpointReceipt> {
    const parameters = new URLSearchParams({
        generation: restoreGeneration,
        size: String(bytes.byteLength),
        digest,
    });
    const endpoint = `${base}/checkpoint-uploads/${encodeURIComponent(requestId)}`;
    let progress = await jsonRequest<UploadProgress>(`${endpoint}?${parameters}`, { signal });
    while (!progress.receipt) {
        const offset = progress.nextOffset;
        if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.byteLength || offset % CHECKPOINT_MAX_BYTES !== 0) {
            throw new Error('Checkpoint upload returned an invalid offset.');
        }
        parameters.set('offset', String(offset));
        const chunk = bytes.subarray(offset, offset + CHECKPOINT_MAX_BYTES);
        progress = await jsonRequest<UploadProgress>(`${endpoint}?${parameters}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: chunk as Uint8Array<ArrayBuffer>,
            signal,
        });
        if (progress.nextOffset < offset + chunk.byteLength) {
            // Staging can expire between the status query and the chunk request.
            // The next retry will ask the server for its current offset again.
            throw new Error('Checkpoint upload did not advance.');
        }
    }
    if (progress.nextOffset !== bytes.byteLength) throw new Error('Checkpoint upload returned an incomplete receipt.');
    return progress.receipt;
}
