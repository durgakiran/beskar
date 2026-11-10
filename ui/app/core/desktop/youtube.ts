import type { YouTubeHandler } from '@durgakiran/editor';
let handler: YouTubeHandler | undefined;
export function getDesktopYouTubeHandler() { return handler; }
export async function setupDesktopYouTube() {
    const { Call } = await import('@wailsio/runtime');
    if (!await Call.ByName('beskar/desktop/player.Service.Supported')) return;
    // Serialize geometry/cleanup so a late update cannot resurrect an unmounted player.
    let pending = Promise.resolve();
    const run = (method: string, ...args: unknown[]) => {
        const result = pending.catch(() => {}).then(() => Call.ByName(`beskar/desktop/player.Service.${method}`, ...args));
        pending = result;
        return result;
    };
    handler = {
        show: (id, video, frame) => run('Show', id, video, frame),
        hide: id => run('Hide', id),
        close: id => run('Close', id),
    };
}
