import { isDesktop } from '../desktop/isDesktop';
/** Uses the same media proxy as the editor, including desktop's fetch interceptor. */
export async function resolvePdfImage(source: string): Promise<string> {
    const normalized = source.replace(/^[^?#]*?\/api\/v1\/media\//, '/api/v1/media/');
    const url = new URL(normalized, window.location.href);
    if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) throw new Error('Unsupported image URL');
    const response = await fetch(url.href, {
        credentials: url.origin === window.location.origin ? 'same-origin' : 'omit',
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Image download failed');
    const blob = await response.blob();
    if (blob.size > 20 * 1024 * 1024) throw new Error('Image exceeds export limit');
    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        // Rasterize SVG/WebP/GIF as PNG, bounded to avoid enormous PDF files.
        const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image conversion unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(objectUrl); }
}

export async function downloadPdf(blob: Blob, fileName: string): Promise<boolean> {
    if (isDesktop) {
        const { Call } = await import('@wailsio/runtime');
        const encoded = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('Could not read PDF'));
            reader.readAsDataURL(blob);
        });
        return Call.ByName('beskar/desktop/pdfexport.Service.SavePDF', fileName, encoded);
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Keep the URL alive while the browser starts the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
}
