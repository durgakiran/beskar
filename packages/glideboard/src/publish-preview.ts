import type { GlideboardHandle, GlideboardExportSvgOptions } from './types.js';
import type { ProjectionTarget } from './durability/types.js';

export interface WhiteboardPublishPreview {
  contentType: 'image/png';
  /** Base64 bytes, without a data URL prefix. Retain this exact payload for retries. */
  data: string;
}

/** Export a fixed projection for the v2 publish request; throws if that projection changed. */
export async function createPublishPreview(
  board: Pick<GlideboardHandle, 'exportSvg'>,
  options: GlideboardExportSvgOptions & { target: ProjectionTarget },
): Promise<WhiteboardPublishPreview> {
  await document.fonts?.ready;
  const svg = await board.exportSvg(options);
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('Invalid exported SVG');
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const width = box?.[2] ?? Number(root.getAttribute('width') || 1);
  const height = box?.[3] ?? Number(root.getAttribute('height') || 1);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid preview dimensions');
  }
  // Keep previews lightweight even for very large diagrams.
  const scale = Math.min(2, 2048 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  root.setAttribute('width', String(canvas.width));
  root.setAttribute('height', String(canvas.height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { image.src = ''; reject(new Error('Preview rendering timed out')); }, 15000);
      image.onload = () => { clearTimeout(timeout); resolve(); };
      image.onerror = () => { clearTimeout(timeout); reject(new Error('Preview rendering failed')); };
      image.src = url;
    });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png');
    });
    if (png.size > 4 * 1024 * 1024) throw new Error('Preview exceeds 4 MiB');
    const bytes = new Uint8Array(await png.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return { contentType: 'image/png', data: btoa(binary) };
  } finally { URL.revokeObjectURL(url); }
}
