import {
    encodeCheckpointBatch,
    type CheckpointEncodingRequest,
    type CheckpointEncodingResponse,
    type EncodedCheckpointBatch,
} from './encodeCheckpointBatch';

export class CheckpointBatchEncoder {
    private worker: Worker | undefined;
    private useWorker = typeof Worker !== 'undefined';
    private cancel: (() => void) | undefined;

    async encode(updates: Uint8Array[], restoreGeneration: string): Promise<EncodedCheckpointBatch | null> {
        if (this.useWorker) {
            try {
                this.worker ??= new Worker(new URL('./checkpointBatch.worker.ts', import.meta.url), { type: 'module' });
            } catch {
                this.useWorker = false;
            }
        }
        const worker = this.worker;
        if (!worker) return encodeCheckpointBatch(updates, restoreGeneration);

        return new Promise((resolve, reject) => {
            const cleanup = () => {
                worker.removeEventListener('message', onMessage);
                worker.removeEventListener('error', onUnavailable);
                worker.removeEventListener('messageerror', onUnavailable);
                this.cancel = undefined;
            };
            const onMessage = ({ data }: MessageEvent<CheckpointEncodingResponse>) => {
                cleanup();
                if ('error' in data) reject(new Error(data.error));
                else resolve(data.result);
            };
            const onUnavailable = (event?: Event) => {
                event?.preventDefault();
                cleanup();
                worker.terminate();
                this.worker = undefined;
                this.useWorker = false;
                try { resolve(encodeCheckpointBatch(updates, restoreGeneration)); }
                catch (error) { reject(error); }
            };
            this.cancel = () => {
                cleanup();
                reject(new DOMException('Whiteboard session closed', 'AbortError'));
            };
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onUnavailable);
            worker.addEventListener('messageerror', onUnavailable);
            // Keep the queued buffers intact until their recoverable batch is acknowledged.
            const request: CheckpointEncodingRequest = { updates, restoreGeneration };
            try { worker.postMessage(request); }
            catch { onUnavailable(); }
        });
    }

    dispose(): void {
        this.cancel?.();
        this.worker?.terminate();
        this.worker = undefined;
    }
}
