import React from 'react';
import { signal } from '@preact/signals';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlideboardProvider } from './GlideboardContext';
import type { GlideboardController } from './GlideboardController';
import type { GlideboardAssetImportJob } from './types';
import {
  ASSET_IMPORT_FAILURE_DISMISS_MS,
  ASSET_IMPORT_SUCCESS_DISMISS_MS,
  AssetImportPanel,
  getAssetFileError,
  readAssetImportRequest,
  type AssetImportNotice,
} from './AssetImportPanel';

const limits = {
  maxSvgBytes: 100,
  maxRasterBytes: 1_000,
  supportedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
};

afterEach(cleanup);

describe('asset file preparation', () => {
  it('rejects unsupported, empty, and oversized files before reading bytes', () => {
    expect(getAssetFileError({ name: 'photo.gif', type: 'image/gif', size: 20 }, limits)?.category)
      .toBe('unsupported-format');
    expect(getAssetFileError({ name: 'empty.png', type: 'image/png', size: 0 }, limits)?.category)
      .toBe('invalid-content');
    expect(getAssetFileError({ name: 'large.svg', type: 'image/svg+xml', size: 101 }, limits)?.category)
      .toBe('limit-exceeded');
    expect(getAssetFileError({ name: 'large.png', type: 'image/png', size: 1_001 }, limits)?.category)
      .toBe('limit-exceeded');
  });

  it('reads supported SVG and raster files into controller requests with the supplied point', async () => {
    const svg = new File(['<svg/>'], 'mark.svg', { type: 'image/svg+xml' });
    const png = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });

    await expect(readAssetImportRequest(svg, { x: 10, y: 20 }, limits, 'correlation-svg')).resolves.toEqual({
      kind: 'svg', source: '<svg/>', name: 'mark.svg', point: { x: 10, y: 20 }, correlationToken: 'correlation-svg',
    });
    const raster = await readAssetImportRequest(png, { x: 34, y: 44 }, limits, 'correlation-raster');
    expect(raster).toMatchObject({
      kind: 'raster', declaredMimeType: 'image/png', name: 'photo.png', point: { x: 34, y: 44 }, correlationToken: 'correlation-raster',
    });
    expect(raster.kind === 'raster' ? [...raster.bytes] : []).toEqual([1, 2, 3]);
  });
});

describe('AssetImportPanel', () => {
  function setup(jobs: readonly GlideboardAssetImportJob[], notices: readonly AssetImportNotice[] = []) {
    const jobsSignal = signal(jobs);
    const cancelAssetImport = vi.fn(() => true);
    const retryAssetImport = vi.fn(() => ({ id: 'job:error', result: Promise.resolve('shape:1') }));
    const dismissAssetImport = vi.fn(() => true);
    const onDismissNotice = vi.fn();
    const controller = {
      assetImportJobsSignal: jobsSignal,
      cancelAssetImport,
      retryAssetImport,
      dismissAssetImport,
      domId: (suffix: string) => `test-${suffix}`,
    } as unknown as GlideboardController;

    render(
      <GlideboardProvider controller={controller}>
        <AssetImportPanel notices={notices} onDismissNotice={onDismissNotice} />
      </GlideboardProvider>,
    );
    return { jobsSignal, cancelAssetImport, retryAssetImport, dismissAssetImport, onDismissNotice };
  }

  it('shows progress and exposes cancel, retry, and dismiss actions', () => {
    const jobs: GlideboardAssetImportJob[] = [
      { id: 'job:upload', kind: 'raster', name: 'upload.png', status: 'uploading', progress: 0.42, attempt: 1 },
      { id: 'job:error', kind: 'raster', name: 'failed.png', status: 'error', progress: 0.5, attempt: 1,
        error: { category: 'network', message: 'Upload interrupted.', retryable: true } },
      { id: 'job:complete', kind: 'svg', name: 'done.svg', status: 'complete', progress: 1, attempt: 1 },
    ];
    const actions = setup(jobs);

    expect(screen.getByText('Uploading 42%')).toBeTruthy();
    expect(screen.getByText(/Check your connection, then retry/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry import' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss import' })[1]!);

    expect(actions.cancelAssetImport).toHaveBeenCalledWith('job:upload');
    expect(actions.retryAssetImport).toHaveBeenCalledWith('job:error');
    expect(actions.dismissAssetImport).toHaveBeenCalledWith('job:complete');
  });

  it('announces status changes and renders dismissible preflight errors', () => {
    const notice: AssetImportNotice = {
      id: 'notice:1', name: 'huge.png', category: 'limit-exceeded', message: 'huge.png exceeds the 20 MB limit.',
      correlationToken: 'notice-correlation-1',
    };
    const actions = setup([], [notice]);
    expect(screen.getByRole('alert').textContent).toContain('Choose a smaller image and try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(actions.onDismissNotice).toHaveBeenCalledWith('notice:1');

    act(() => {
      actions.jobsSignal.value = [{
        id: 'job:new', kind: 'svg', name: 'new.svg', status: 'queued', progress: 0, attempt: 1,
      }];
    });
    expect(screen.getByText('new.svg: Queued')).toBeTruthy();
  });

  it('gives conflict failures an actionable recovery message', () => {
    setup([], [{
      id: 'notice:conflict',
      name: 'diagram.svg',
      category: 'conflict',
      message: 'The board changed while the asset was being imported.',
      correlationToken: 'notice-correlation-conflict',
    }]);

    expect(screen.getByText(/Refresh the board before retrying this import/)).toBeTruthy();
  });

  it('closes manually without cancelling work and reopens for a status change', () => {
    const actions = setup([{
      id: 'job:upload', kind: 'raster', name: 'upload.png', status: 'uploading', progress: 0.2, attempt: 1,
    }]);

    fireEvent.click(screen.getByRole('button', { name: 'Close image imports' }));
    expect(screen.queryByLabelText('Image imports')).toBeNull();
    expect(actions.cancelAssetImport).not.toHaveBeenCalled();

    act(() => {
      actions.jobsSignal.value = [{
        id: 'job:upload', kind: 'raster', name: 'upload.png', status: 'complete', progress: 1, attempt: 1,
      }];
    });
    expect(screen.getByLabelText('Image imports')).toBeTruthy();
  });

  it('expires successful imports sooner than failures and rejected notices', () => {
    vi.useFakeTimers();
    try {
      const actions = setup([
        { id: 'job:complete', kind: 'svg', name: 'done.svg', status: 'complete', progress: 1, attempt: 1 },
        { id: 'job:error', kind: 'raster', name: 'failed.png', status: 'error', progress: 0.5, attempt: 1,
          error: { category: 'network', message: 'Upload interrupted.', retryable: true } },
      ], [{
        id: 'notice:error', name: 'bad.svg', category: 'invalid-content', message: 'Invalid SVG.',
        correlationToken: 'notice-error',
      }]);

      act(() => vi.advanceTimersByTime(ASSET_IMPORT_SUCCESS_DISMISS_MS));
      expect(actions.dismissAssetImport).toHaveBeenCalledWith('job:complete');
      expect(actions.dismissAssetImport).not.toHaveBeenCalledWith('job:error');
      expect(actions.onDismissNotice).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(ASSET_IMPORT_FAILURE_DISMISS_MS - ASSET_IMPORT_SUCCESS_DISMISS_MS));
      expect(actions.dismissAssetImport).toHaveBeenCalledWith('job:error');
      expect(actions.onDismissNotice).toHaveBeenCalledWith('notice:error');
    } finally {
      vi.useRealTimers();
    }
  });
});
