import { encodeCheckpointBatch, type CheckpointEncodingRequest, type CheckpointEncodingResponse } from './encodeCheckpointBatch';

self.onmessage = ({ data }: MessageEvent<CheckpointEncodingRequest>) => {
    try {
        const result = encodeCheckpointBatch(data.updates, data.restoreGeneration);
        const response: CheckpointEncodingResponse = { result };
        self.postMessage(response, { transfer: result ? [result.bytes.buffer as ArrayBuffer] : [] });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies CheckpointEncodingResponse);
    }
};
