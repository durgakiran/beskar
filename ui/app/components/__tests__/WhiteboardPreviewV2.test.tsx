import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import WhiteboardPreviewV2 from '../WhiteboardPreviewV2';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('renders the version-pinned preview and published title', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { snapshot: { title: 'Published diagram' }, preview: { url: '/api/v2/editor/space/s/whiteboard/42/published/v/preview' } } }))));
    const onTitle = vi.fn();
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" onTitle={onTitle} />);
    const img = await screen.findByAltText('Published diagram');
    expect(img.getAttribute('src')).toContain('/published/v/preview');
    expect(onTitle).toHaveBeenCalledWith('Published diagram');
    fireEvent.error(img);
    expect(screen.getByText('Unable to load the published preview.')).toBeTruthy();
});
it('shows an unpublished state instead of loading a draft canvas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'WHITEBOARD_NOT_PUBLISHED', message: 'Unpublished' } }), { status: 404 })));
    render(<WhiteboardPreviewV2 spaceId="s" pageId="42" />);
    await screen.findByText('This whiteboard has not been published yet.');
    expect(screen.queryByRole('img')).toBeNull();
});
