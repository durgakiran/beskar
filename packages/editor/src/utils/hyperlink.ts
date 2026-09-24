/** Normalize user-entered destinations without permitting executable URL schemes. */
export function normalizeHyperlink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /[\s\\\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (/^(\/|#|\?)/.test(trimmed)) return trimmed;
  const href = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(href);
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return null;
    if (!url.hostname && !url.pathname) return null;
    return href;
  } catch {
    return null;
  }
}
