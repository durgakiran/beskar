import { beforeEach, expect, it, vi } from 'vitest';
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@wailsio/runtime', () => ({ Call: { ByName: call } }));
beforeEach(() => { vi.resetModules(); call.mockReset(); });
it('leaves browser embeds in use when native inline playback is unsupported', async () => {
    call.mockResolvedValue(false);
    const api = await import('./youtube');
    await api.setupDesktopYouTube();
    expect(api.getDesktopYouTubeHandler()).toBeUndefined();
});
it('serializes frame updates and removal so pending work cannot recreate a closed player', async () => {
    let finish!: () => void;
    call.mockImplementation((name: string) => name.endsWith('.Supported') ? Promise.resolve(true)
        : name.endsWith('.Show') ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve());
    const api = await import('./youtube');
    await api.setupDesktopYouTube();
    const handler = api.getDesktopYouTubeHandler()!;
    const show = handler.show('player', 'dQw4w9WgXcQ', { x:0,y:0,width:640,height:360,clipX:0,clipY:0,clipWidth:640,clipHeight:360,viewportWidth:1000,viewportHeight:800 });
    const close = handler.close('player');
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('beskar/desktop/player.Service.Show', 'player', 'dQw4w9WgXcQ', expect.any(Object)));
    expect(call).not.toHaveBeenCalledWith('beskar/desktop/player.Service.Close', 'player');
    finish(); await show; await close;
    expect(call.mock.calls.at(-1)).toEqual(['beskar/desktop/player.Service.Close', 'player']);
});
