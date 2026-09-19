import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { createPublishPreview } from './publish-preview.js';
const target = { storeRevision: 1, yjs: { transactionSequence: 1, stateDigest: 'sha256:test' } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('publish preview', () => {
 it('exports the fixed target, bounds pixels, encodes PNG, and releases the SVG URL', async () => {
  const board = { exportSvg: vi.fn().mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 5000"/>') };
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage } as any);
  let size: number[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
   size = [this.width, this.height]; callback(new NodeBlob(['png']) as unknown as Blob);
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.stubGlobal('Image', class { onload?: () => void; set src(_: string) { queueMicrotask(() => this.onload?.()); } });
  const result = await createPublishPreview(board, { target });
  expect(board.exportSvg).toHaveBeenCalledWith({ target });
  expect(size).toEqual([2048, 1024]);
  expect(result).toEqual({ contentType: 'image/png', data: btoa('png') });
  expect(drawImage).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledWith('blob:preview');
 });
 it('propagates projection changes instead of submitting a mismatched image', async () => {
  const board = { exportSvg: vi.fn().mockRejectedValue(new Error('Projection changed')) };
  await expect(createPublishPreview(board, { target })).rejects.toThrow('Projection changed');
 });
 it('rejects invalid bounds before allocating a canvas', async () => {
  const board = { exportSvg: vi.fn().mockResolvedValue('<svg viewBox="0 0 NaN 10"/>') };
  await expect(createPublishPreview(board, { target })).rejects.toThrow('Invalid preview dimensions');
 });
});
