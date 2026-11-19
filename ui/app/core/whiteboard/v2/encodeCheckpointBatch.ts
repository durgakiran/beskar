import { mergeUpdates } from 'yjs';
import { uint8ArrayToBase64 } from '../../utils/base64';

export const CHECKPOINT_MAX_BYTES = 1024 * 1024;

export interface EncodedCheckpointBatch {
    readonly bytes: Uint8Array;
    readonly body: string;
}

export function encodeCheckpointBatch(updates: Uint8Array[], restoreGeneration: string): EncodedCheckpointBatch | null {
    const bytes = updates.length === 1 ? updates[0]! : mergeUpdates(updates);
    if (bytes.byteLength > CHECKPOINT_MAX_BYTES) return null;
    const body = JSON.stringify({
        update: uint8ArrayToBase64(bytes),
        updateEncoding: 'yjs-update-v1',
        restoreGeneration,
    });
    return { bytes, body };
}

export type CheckpointEncodingRequest = {
    updates: Uint8Array[];
    restoreGeneration: string;
};

export type CheckpointEncodingResponse =
    | { result: EncodedCheckpointBatch | null }
    | { error: string };
