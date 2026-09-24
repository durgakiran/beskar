/** App-owned viewer. Only these passive formats are supported; other files remain downloadable. */
const previewTypes = new Set(['application/pdf', 'text/plain', 'text/csv', 'application/json', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export const attachmentPreview = {
    supports: (attachment: { fileType: string }) => previewTypes.has(attachment.fileType.toLowerCase()),
    async open(attachment: { fileUrl: string; fileName: string; fileType: string }): Promise<void> {
        if (!attachmentPreview.supports(attachment)) throw new Error('Preview is unavailable for this file type.');
        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-label', attachment.fileName);
        dialog.style.cssText = 'width:min(900px,90vw);height:80vh;padding:16px;border:1px solid #bbb;border-radius:8px;';
        const title = document.createElement('h2');
        title.textContent = attachment.fileName;
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close preview';
        const content = document.createElement('div');
        content.textContent = 'Loading preview…';
        content.style.cssText = 'height:calc(100% - 100px);overflow:auto;margin-top:12px;';
        dialog.append(close, title, content);
        const controller = new AbortController();
        let objectUrl: string | undefined;
        let closed = false;
        let resolveClosed!: () => void;
        const dismissed = new Promise<void>(resolve => { resolveClosed = resolve; });
        const cleanup = () => {
            closed = true;
            controller.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            dialog.remove();
            resolveClosed();
        };
        dialog.addEventListener('close', cleanup, { once: true });
        close.onclick = () => dialog.close();
        document.body.appendChild(dialog);
        dialog.showModal();
        close.focus();
        try {
            const response = await fetch(attachment.fileUrl, { credentials: 'include', signal: controller.signal });
            if (!response.ok) throw new Error(`Preview failed (${response.status})`);
            const blob = await response.blob();
            if (closed) return;
            const type = attachment.fileType.toLowerCase();
            if (type.startsWith('text/') || type === 'application/json') {
                const text = await blob.text();
                if (closed) return;
                const pre = document.createElement('pre');
                pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;';
                pre.textContent = text;
                content.replaceChildren(pre);
            } else {
                objectUrl = URL.createObjectURL(new Blob([blob], { type }));
                if (type.startsWith('image/')) {
                    const image = document.createElement('img');
                    image.alt = attachment.fileName;
                    image.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
                    image.src = objectUrl;
                    content.replaceChildren(image);
                } else {
                    const frame = document.createElement('iframe');
                    frame.title = attachment.fileName;
                    frame.setAttribute('sandbox', 'allow-same-origin');
                    frame.style.cssText = 'width:100%;height:100%;border:0;';
                    frame.src = objectUrl;
                    content.replaceChildren(frame);
                }
            }
            await dismissed;
        } catch (error) {
            if (closed) return;
            dialog.close();
            throw error;
        }
    },
};
