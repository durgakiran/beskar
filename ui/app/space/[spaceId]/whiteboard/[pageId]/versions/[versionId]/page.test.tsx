import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WhiteboardVersionViewPage from './page';

vi.mock('@durgakiran/glideboard', () => ({
  Glideboard: ({ collaboration, readOnly, sessionKey }: any) => React.createElement('div', {
    'data-testid': 'glideboard-version',
    'data-readonly': String(readOnly),
    'data-session-key': sessionKey,
    'data-record-count': String(collaboration.doc.getMap('glideboard-records').size),
  }),
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
});

describe('WhiteboardVersionViewPage', () => {
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
});
