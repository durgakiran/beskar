import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { NativeYouTube } from '../../../../packages/editor/src/components/embed/NativeYouTube';

const rect = { x:0,y:100,left:0,top:100,right:640,bottom:460,width:640,height:360,toJSON(){} };
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList);
    Object.defineProperty(document, 'elementFromPoint', { configurable:true, value:vi.fn(() => document.querySelector('[aria-label="YouTube video player"]')) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('mounts only the video ID and viewport geometry, hides under dialogs and closes on unmount', async () => {
    const handler = { show:vi.fn().mockResolvedValue(undefined), hide:vi.fn().mockResolvedValue(undefined), close:vi.fn().mockResolvedValue(undefined) };
    const view = render(<NativeYouTube videoID="dQw4w9WgXcQ" handler={handler} onError={vi.fn()} onReady={vi.fn()} />);
    await waitFor(() => expect(handler.show).toHaveBeenCalled());
    expect(handler.show.mock.calls[0]).toEqual([expect.stringMatching(/^youtube-/), 'dQw4w9WgXcQ', expect.objectContaining({ width:640,height:360,clipY:100,clipHeight:360 })]);
    const dialog = document.createElement('div'); dialog.setAttribute('role','dialog'); document.body.append(dialog);
    await waitFor(() => expect(handler.hide).toHaveBeenCalled());
    dialog.remove();
    await waitFor(() => expect(handler.show.mock.calls.length).toBeGreaterThan(1));
    const id = handler.show.mock.calls[0][0];
    view.unmount();
    await waitFor(() => expect(handler.close).toHaveBeenCalledWith(id));
});
