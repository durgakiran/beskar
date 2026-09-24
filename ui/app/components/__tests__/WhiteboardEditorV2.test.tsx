import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import WhiteboardEditorV2 from '../WhiteboardEditorV2';

const mocks = vi.hoisted(() => ({
    prepareForCapture: vi.fn(),
    getPendingAssetCount: vi.fn(),
    settleActiveEdit: vi.fn(),
    captureProjectionTarget: vi.fn(),
    createPublishPreview: vi.fn(),
    flush: vi.fn(),
    loadDraft: vi.fn(),
    jsonRequest: vi.fn(),
    post: vi.fn(),
    navigate: vi.fn(),
    release: vi.fn(),
    assetConstruct: vi.fn(),
    assetDispose: vi.fn(),
    glideboardProps: vi.fn(),
    digest: vi.fn(),
    providerConstruct: vi.fn(),
    durabilityConstruct: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../WhiteboardHistoryV2', () => ({ default: () => null }));
vi.mock('@durgakiran/glideboard', () => ({
    safeAwarenessEntries: () => [],
    createPublishPreview: mocks.createPublishPreview,
    Glideboard: React.forwardRef(function MockGlideboard(props: { readOnly: boolean; assetStorage: unknown; assetResolutionContext: { documentId: string } }, ref) {
        mocks.glideboardProps(props);
        const handle = React.useMemo(() => ({
            prepareForCapture: mocks.prepareForCapture,
            getPendingAssetCount: mocks.getPendingAssetCount,
            settleActiveEdit: mocks.settleActiveEdit,
            captureProjectionTarget: mocks.captureProjectionTarget,
            checkpoints: {},
        }), []);
        React.useImperativeHandle(ref, () => handle, [handle]);
        return <div data-testid="glideboard" data-readonly={String(props.readOnly)} data-asset-context={props.assetResolutionContext.documentId} />;
    }),
}));
vi.mock('app/core/whiteboard/v2/WhiteboardAssetHttpAdapterV2', () => ({
    WhiteboardAssetHttpAdapterV2: class {
        readonly commitOrder = 'before-document';
        constructor(readonly options: { spaceId: string; pageId: string; signal: AbortSignal }) { mocks.assetConstruct(options); }
        dispose = mocks.assetDispose;
    },
}));
vi.mock('y-webrtc', () => ({
    WebrtcProvider: class {
        constructor() { mocks.providerConstruct(); }
        awareness = { getStates: () => new Map(), setLocalStateField: vi.fn(), on: vi.fn(), off: vi.fn() };
        destroy() {}
        disconnect() {}
        connect() {}
    },
}));
vi.mock('app/core/whiteboard/v2/replay', () => ({ loadDraft: mocks.loadDraft }));
vi.mock('app/core/whiteboard/v2/api', async importOriginal => ({
    ...await importOriginal<Record<string, unknown>>(),
    digest: mocks.digest,
    jsonRequest: mocks.jsonRequest,
    post: mocks.post,
}));
vi.mock('app/core/whiteboard/durability/IndexedDbYjsRecoveryAdapter', () => ({
    IndexedDbYjsRecoveryAdapter: class {
        async hydrate() {}
        async dispose() {}
    },
}));
vi.mock('app/core/whiteboard/durability/YjsDurabilityCoordinator', () => ({
    YjsDurabilityCoordinator: class {
        constructor() { mocks.durabilityConstruct(); }
        flush = mocks.flush;
        getSnapshot() { return { phase: 'clean' }; }
        subscribeStatus() { return () => {}; }
        attach() { return () => {}; }
        async dispose() {}
    },
}));

const target = { storeRevision: 1, yjs: { transactionSequence: 1, stateDigest: 'sha256:state' } };

async function renderEditor() {
    const result = render(<WhiteboardEditorV2 slug={['space-1', 'page-1']} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(false));
    return result;
}

describe('WhiteboardEditorV2 capture preparation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        localStorage.clear();
        const doc = new Y.Doc();
        const state = Y.encodeStateAsUpdate(doc);
        doc.destroy();
        mocks.loadDraft.mockResolvedValue({ state, cache: {}, manifest: { title: 'Board', headSequence: '1', restoreGeneration: '0' } });
        mocks.jsonRequest.mockImplementation(async (url: string) => url.endsWith('/profile/details') ? { id: 'user-1', name: 'Asha' } : {});
        mocks.prepareForCapture.mockResolvedValue({ reason: 'publish', release: mocks.release });
        mocks.getPendingAssetCount.mockReturnValue(0);
        mocks.settleActiveEdit.mockResolvedValue(undefined);
        mocks.captureProjectionTarget.mockResolvedValue(target);
        mocks.createPublishPreview.mockResolvedValue({ svg: '<svg />' });
        mocks.flush.mockResolvedValue(undefined);
        mocks.post.mockResolvedValue({});
        mocks.assetDispose.mockResolvedValue(undefined);
        mocks.digest.mockResolvedValue('sha256:state');
    });

    afterEach(cleanup);

    it('binds asset storage to the board session and preserves it while editing', async () => {
        await renderEditor();
        const props = mocks.glideboardProps.mock.lastCall![0];
        expect(props.assetStorage.commitOrder).toBe('before-document');
        expect(props.assetResolutionContext).toEqual({ documentId: 'v2:space-1:page-1' });
        expect(mocks.assetConstruct).toHaveBeenCalledExactlyOnceWith({ spaceId: 'space-1', pageId: 'page-1', signal: expect.any(AbortSignal) });

        fireEvent.change(screen.getByLabelText('Whiteboard title'), { target: { value: 'New title' } });

        expect(mocks.glideboardProps.mock.lastCall![0].assetStorage).toBe(props.assetStorage);
        expect(mocks.glideboardProps.mock.lastCall![0].assetResolutionContext).toBe(props.assetResolutionContext);
        expect(mocks.assetConstruct).toHaveBeenCalledTimes(1);
    });

    it('aborts and disposes old asset storage before opening another board', async () => {
        const editor = await renderEditor();
        const previousSignal = mocks.assetConstruct.mock.calls[0][0].signal as AbortSignal;
        editor.rerender(<WhiteboardEditorV2 slug={['space-2', 'page-2']} />);
        await waitFor(() => expect(screen.getByTestId('glideboard').getAttribute('data-asset-context')).toBe('v2:space-2:page-2'));

        expect(previousSignal.aborted).toBe(true);
        expect(mocks.assetDispose).toHaveBeenCalledTimes(1);
        expect(mocks.assetConstruct).toHaveBeenLastCalledWith({ spaceId: 'space-2', pageId: 'page-2', signal: expect.any(AbortSignal) });
        const nextSignal = mocks.assetConstruct.mock.lastCall![0].signal as AbortSignal;
        expect(nextSignal.aborted).toBe(false);
        editor.unmount();
        expect(nextSignal.aborted).toBe(true);
        expect(mocks.assetDispose).toHaveBeenCalledTimes(2);
    });

    it.each(['unmount', 'replace'] as const)('does not start a stale session when digest completes after %s', async action => {
        let finishDigest!: (value: string) => void;
        mocks.digest.mockReturnValueOnce(new Promise<string>(resolve => { finishDigest = resolve; }));
        const editor = render(<WhiteboardEditorV2 slug={['space-1', 'page-1']} />);
        await waitFor(() => expect(mocks.digest).toHaveBeenCalledTimes(1));
        expect(mocks.providerConstruct).not.toHaveBeenCalled();

        if (action === 'unmount') editor.unmount();
        else {
            editor.rerender(<WhiteboardEditorV2 slug={['space-2', 'page-2']} />);
            await waitFor(() => expect(screen.getByTestId('glideboard').getAttribute('data-asset-context')).toBe('v2:space-2:page-2'));
        }
        await act(async () => finishDigest('sha256:state'));

        const expectedSessions = action === 'unmount' ? 0 : 1;
        expect(mocks.providerConstruct).toHaveBeenCalledTimes(expectedSessions);
        expect(mocks.durabilityConstruct).toHaveBeenCalledTimes(expectedSessions);
        expect(mocks.assetConstruct).toHaveBeenCalledTimes(expectedSessions);
        expect(mocks.assetConstruct.mock.calls.every(([options]) => options.pageId === 'page-2' && !options.signal.aborted)).toBe(true);
    });

    it('waits for asset insertion before settling, checkpointing, and publishing', async () => {
        let finishUploads!: (fence: { reason: string; release: () => void }) => void;
        mocks.prepareForCapture.mockReturnValueOnce(new Promise(resolve => { finishUploads = resolve; }));
        await renderEditor();

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

        expect(mocks.prepareForCapture).toHaveBeenCalledWith('publish', { signal: expect.any(AbortSignal) });
        expect(screen.getByTestId('glideboard').getAttribute('data-readonly')).toBe('false');
        expect(mocks.settleActiveEdit).not.toHaveBeenCalled();
        expect(mocks.flush).not.toHaveBeenCalled();
        expect(mocks.post).not.toHaveBeenCalled();

        await act(async () => finishUploads({ reason: 'publish', release: mocks.release }));

        await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
        expect(mocks.settleActiveEdit).toHaveBeenCalledWith('commit');
        expect(mocks.flush).toHaveBeenCalledWith(target);
        expect(mocks.createPublishPreview).toHaveBeenCalledWith(expect.anything(), { target });
        expect(mocks.post.mock.calls[0][3]).toBe(mocks.assetConstruct.mock.calls[0][0].signal);
        expect(mocks.release).toHaveBeenCalledTimes(1);
    });

    it('shows a preparation failure and allows close to retry without leaking a fence', async () => {
        mocks.prepareForCapture.mockRejectedValueOnce(new Error('Image upload failed'));
        await renderEditor();

        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Image upload failed'));
        expect(mocks.release).not.toHaveBeenCalled();
        expect(mocks.captureProjectionTarget).not.toHaveBeenCalled();
        expect(mocks.post).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/space/space-1/view/page-1'));
        expect(mocks.prepareForCapture).toHaveBeenLastCalledWith('close', { signal: expect.any(AbortSignal) });
        expect(mocks.release).toHaveBeenCalledTimes(1);
    });

    it('retries the same publish payload without waiting for newer uploads or recapturing', async () => {
        mocks.post.mockRejectedValueOnce(new Error('Publish response lost'));
        await renderEditor();
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Publish response lost'));
        const originalRequest = mocks.post.mock.calls[0];

        fireEvent.click(screen.getByRole('button', { name: 'Retry publish' }));

        await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
        expect(mocks.post.mock.calls[1]).toEqual(originalRequest);
        expect(mocks.post.mock.calls[1][1]).toBe(originalRequest[1]);
        expect(mocks.prepareForCapture).toHaveBeenCalledTimes(1);
        expect(mocks.createPublishPreview).toHaveBeenCalledTimes(1);
        expect(mocks.release).toHaveBeenCalledTimes(1);
    });

    it('aborts the pending asset wait when the editor session unmounts', async () => {
        mocks.prepareForCapture.mockImplementationOnce((_reason, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }));
        const editor = await renderEditor();
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        const signal = mocks.prepareForCapture.mock.calls[0][1].signal as AbortSignal;

        await act(async () => editor.unmount());

        expect(signal.aborted).toBe(true);
        expect(mocks.captureProjectionTarget).not.toHaveBeenCalled();
        expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it('does not publish a preview completed after switching boards', async () => {
        let finishPreview!: (preview: { svg: string }) => void;
        mocks.createPublishPreview.mockReturnValueOnce(new Promise(resolve => { finishPreview = resolve; }));
        const editor = await renderEditor();
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        await waitFor(() => expect(mocks.createPublishPreview).toHaveBeenCalledTimes(1));

        editor.rerender(<WhiteboardEditorV2 slug={['space-2', 'page-2']} />);
        await waitFor(() => expect(screen.getByTestId('glideboard').getAttribute('data-asset-context')).toBe('v2:space-2:page-2'));
        await act(async () => finishPreview({ svg: '<svg />' }));

        expect(mocks.post).not.toHaveBeenCalled();
        expect(mocks.release).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(false);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not carry an ambiguous publication retry into another board', async () => {
        mocks.post.mockRejectedValueOnce(new Error('Publish response lost'));
        const editor = await renderEditor();
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Publish response lost'));
        const originalKey = mocks.post.mock.calls[0][2];

        editor.rerender(<WhiteboardEditorV2 slug={['space-2', 'page-2']} />);
        await waitFor(() => expect(screen.getByTestId('glideboard').getAttribute('data-asset-context')).toBe('v2:space-2:page-2'));
        fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
        await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));

        expect(mocks.post.mock.calls[1][0]).toContain('/space/space-2/whiteboard/page-2/publish');
        expect(mocks.post.mock.calls[1][2]).not.toBe(originalKey);
        expect(mocks.prepareForCapture).toHaveBeenCalledTimes(2);
    });

    it('warns before unloading a clean document while an asset operation is pending', async () => {
        await renderEditor();
        const cleanUnload = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(cleanUnload);
        expect(cleanUnload.defaultPrevented).toBe(false);

        mocks.getPendingAssetCount.mockReturnValue(1);
        const pendingUnload = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(pendingUnload);
        expect(pendingUnload.defaultPrevented).toBe(true);

        mocks.getPendingAssetCount.mockReturnValue(0);
        const finishedUnload = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(finishedUnload);
        expect(finishedUnload.defaultPrevented).toBe(false);
    });
});
