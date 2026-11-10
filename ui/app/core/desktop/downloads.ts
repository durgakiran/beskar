/** Browser download links in the native webview need a native save dialog. */
export function setupDesktopDownloads(download: (url: string, name: string) => Promise<void>) {
    let busy = false;
    const onClick = (event: MouseEvent) => {
        const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[download]') : null;
        if (!anchor) return;
        const url = new URL(anchor.href, window.location.href);
        const page = new URL(window.location.href);
        if (url.protocol !== page.protocol || url.host !== page.host || !/^\/api\/v1\/attachments\/[\da-f-]{36}$/i.test(url.pathname)) return;
        event.preventDefault();
        if (busy) return;
        busy = true;
        void download(url.pathname, anchor.download || anchor.textContent?.trim() || 'attachment')
            .catch(error => {
                console.error('Attachment download failed', error);
                window.alert('The attachment could not be saved. Please try again.');
            })
            .finally(() => { busy = false; });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
}
