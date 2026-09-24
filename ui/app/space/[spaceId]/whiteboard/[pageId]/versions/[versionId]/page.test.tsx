import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WhiteboardVersionViewPage from './page';

const glideboardCapture = vi.hoisted(() => ({ assetStorage: null as any, assetResolutionContext: null as any }));

vi.mock('@durgakiran/glideboard', () => ({
  Glideboard: ({ collaboration, readOnly, sessionKey, assetStorage, assetResolutionContext }: any) => {
    glideboardCapture.assetStorage = assetStorage;
    glideboardCapture.assetResolutionContext = assetResolutionContext;
    return React.createElement('div', {
    'data-testid': 'glideboard-version',
    'data-readonly': String(readOnly),
    'data-session-key': sessionKey,
    'data-record-count': String(collaboration.doc.getMap('glideboard-records').size),
    'data-has-asset-storage': String(Boolean(assetStorage)),
    'data-asset-document': assetResolutionContext?.documentId,
    'data-asset-version': assetResolutionContext?.versionId,
    });
  },
}));

function encodeDocument(): string {
  const doc = new Y.Doc();
  doc.getMap('glideboard-records').set('shape:one', { id: 'shape:one', type: 'box' });
  const encoded = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  doc.destroy();
  return encoded;
}

afterEach(() => {
  vi.unstubAllGlobals();
  glideboardCapture.assetStorage = null;
  glideboardCapture.assetResolutionContext = null;
});

describe('WhiteboardVersionViewPage', () => {
  const renderRoute = (entry: string, path = '/space/:spaceId/whiteboard/:pageId/versions/:versionId') => render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path={path} element={<WhiteboardVersionViewPage />} /></Routes>
    </MemoryRouter>,
  );

  it('loads the requested version into an isolated read-only board session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          docId: 7,
          data: encodeDocument(),
          pageId: 2,
          spaceId: 'space-1',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/space/space-1/whiteboard/2/versions/7']}>
        <Routes>
          <Route
            path="/space/:spaceId/whiteboard/:pageId/versions/:versionId"
            element={<WhiteboardVersionViewPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('glideboard-version')).not.toBeNull());

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/editor/space/space-1/whiteboard/2/versions/7',
      expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }),
    );
    const board = screen.getByTestId('glideboard-version');
    expect(board.getAttribute('data-session-key')).toBe('space-1:2:version:7');
    expect(board.getAttribute('data-readonly')).toBe('true');
    expect(board.getAttribute('data-record-count')).toBe('1');
    expect(board.getAttribute('data-has-asset-storage')).toBe('true');
    expect(board.getAttribute('data-asset-version')).toBe('7');
    expect(board.getAttribute('data-asset-document')).toBe('7');

    const hash = 'a'.repeat(64);
    expect(glideboardCapture.assetStorage.resolve({ props: { hash } }))
      .toBe(`/api/v1/media/whiteboard-asset/2/${hash}`);
    expect(glideboardCapture.assetStorage.resolve({ props: { hash: 'INVALID' } })).toBeNull();
    await expect(glideboardCapture.assetStorage.prepare()).rejects.toThrow(/read-only/);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'image/png; charset=binary' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    await expect(glideboardCapture.assetStorage.download({ props: { hash } }, new AbortController().signal))
      .resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' });
    await expect(glideboardCapture.assetStorage.download({ props: { hash: 'bad' } }, new AbortController().signal))
      .rejects.toThrow(/Invalid historical/);
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(glideboardCapture.assetStorage.download({ props: { hash } }, new AbortController().signal))
      .rejects.toThrow(/403/);
  });

  it('shows request failure and returns to the live whiteboard', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(
      <MemoryRouter initialEntries={['/space/space-1/whiteboard/2/versions/7']}>
        <Routes>
          <Route path="/space/:spaceId/whiteboard/:pageId/versions/:versionId" element={<WhiteboardVersionViewPage />} />
          <Route path="/space/:spaceId/whiteboard/:pageId" element={<div>live board</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Failed to load whiteboard data.')).not.toBeNull());
    screen.getByRole('button', { name: /Back to whiteboard/ }).click();
    expect(await screen.findByText('live board')).not.toBeNull();
  });

  it('rejects non-canonical historical document and version route ids before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/space/space-1/whiteboard/02/versions/07']}>
        <Routes>
          <Route path="/space/:spaceId/whiteboard/:pageId/versions/:versionId" element={<WhiteboardVersionViewPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Failed to load whiteboard data.')).not.toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a response whose validated historical document id does not match the version route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { docId: 8, data: encodeDocument(), pageId: 2, spaceId: 'space-1' } }),
    }));

    render(
      <MemoryRouter initialEntries={['/space/space-1/whiteboard/2/versions/7']}>
        <Routes>
          <Route path="/space/:spaceId/whiteboard/:pageId/versions/:versionId" element={<WhiteboardVersionViewPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Failed to load whiteboard data.')).not.toBeNull());
    expect(screen.queryByTestId('glideboard-version')).toBeNull();
  });

  it('shows a typed corrupt-version state for invalid Yjs data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          docId: 7,
          data: Buffer.from('not-a-yjs-update').toString('base64'),
          pageId: 2,
          spaceId: 'space-1',
        },
      }),
    }));

    render(
      <MemoryRouter initialEntries={['/space/space-1/whiteboard/2/versions/7']}>
        <Routes>
          <Route
            path="/space/:spaceId/whiteboard/:pageId/versions/:versionId"
            element={<WhiteboardVersionViewPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(
      'This historical whiteboard version is corrupt and cannot be opened.',
    )).not.toBeNull());
    expect(screen.queryByTestId('glideboard-version')).toBeNull();
  });

  it.each([
    ['/space/space-1/whiteboard/0/versions/7'],
    ['/space/space-1/whiteboard/9007199254740992/versions/7'],
    ['/space/space-1/whiteboard/2/versions/0'],
    ['/space/space-1/whiteboard/2/versions/9007199254740992'],
  ])('rejects missing or unsafe route identity %s', async (entry) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(entry);
    await screen.findByText('Failed to load whiteboard data.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses fallback context values when route parameters are absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/versions', '*');
    await screen.findByText('Failed to load whiteboard data.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [null],
    [{}],
    [{ docId: 7, data: '', pageId: 2, spaceId: 'space-1' }],
    [{ docId: 7, data: encodeDocument(), pageId: Number.NaN, spaceId: 'space-1' }],
    [{ docId: Number.MAX_SAFE_INTEGER + 1, data: encodeDocument(), pageId: 2, spaceId: 'space-1' }],
    [{ docId: 7, data: encodeDocument(), pageId: 2, spaceId: 'wrong-space' }],
    [{ docId: 7, data: encodeDocument(), pageId: 3, spaceId: 'space-1' }],
  ])('rejects a mismatched historical response %#', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data }),
    }));
    renderRoute('/space/space-1/whiteboard/2/versions/7');
    await screen.findByText('Failed to load whiteboard data.');
    expect(screen.queryByTestId('glideboard-version')).toBeNull();
  });

  it('returns an empty MIME type when historical asset metadata omits content-type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { docId: 7, data: encodeDocument(), pageId: 2, spaceId: 'space-1' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/space/space-1/whiteboard/2/versions/7');
    await screen.findByTestId('glideboard-version');
    fetchMock.mockResolvedValueOnce({
      ok: true, headers: new Headers(), arrayBuffer: async () => new Uint8Array([9]).buffer,
    });
    await expect(glideboardCapture.assetStorage.download(
      { props: { hash: 'b'.repeat(64) } }, new AbortController().signal,
    )).resolves.toEqual({ bytes: new Uint8Array([9]), mimeType: '' });
  });

  it('aborts an in-flight version request on unmount and ignores its rejection', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      requestSignal = init?.signal;
      requestSignal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = renderRoute('/space/space-1/whiteboard/2/versions/7');
    await waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
    view.unmount();
    expect(requestSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
