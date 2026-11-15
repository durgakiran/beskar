import { BOARD_FONT_ASSETS } from './board-font-assets.js';

export type Font = 'draw' | 'sans' | 'serif' | 'mono';

const BOARD_FONT_FACES = {
  sans: 'Geist',
  draw: 'Shantell Sans',
  mono: 'JetBrains Mono',
} as const;

export const FONT_FAMILIES: Record<Font, string> = {
  sans: `${BOARD_FONT_FACES.sans}, system-ui, sans-serif`,
  draw: `"${BOARD_FONT_FACES.draw}", cursive`,
  serif: 'Georgia, serif',
  mono: `"${BOARD_FONT_FACES.mono}", ui-monospace, monospace`,
};

export const BOARD_MONO_FEATURES = '"calt" 0, "liga" 0, "clig" 0';
export function boardFontStyle(fontFamily: string) {
  return fontFamily === FONT_FAMILIES.mono
    ? { fontFamily, fontVariantLigatures: 'none', fontFeatureSettings: BOARD_MONO_FEATURES }
    : { fontFamily };
}

const fontLoads = new WeakMap<Document, Promise<void>>();

/** Load packaged faces before laying out a board for the first time. */
export function loadBoardFonts(doc = typeof document === 'undefined' ? undefined : document): Promise<void> {
  const FontFaceClass = doc?.defaultView?.FontFace;
  if (!doc?.fonts || !FontFaceClass) return Promise.resolve();
  const existing = fontLoads.get(doc);
  if (existing) return existing;

  const faces = BOARD_FONT_ASSETS.map(({ family, weight, src, unicodeRange }) => {
    const face = new FontFaceClass(family, `url(${src}) format("woff2")`, { weight, unicodeRange });
    return face.load().then(loaded => { doc.fonts.add(loaded); });
  });
  const ready = Promise.allSettled(faces).then(() => {});
  fontLoads.set(doc, ready);
  return ready;
}

/** Embed the same faces in standalone SVG. Only families used by the export are included. */
export function boardFontSvgStyles(families: ReadonlySet<string>): string {
  return BOARD_FONT_ASSETS.filter(({ family }) => families.has(family))
    .map(({ family, weight, src, unicodeRange }) =>
      `@font-face{font-family:"${family}";font-weight:${weight};src:url(${src}) format("woff2");unicode-range:${unicodeRange};}`)
    .join('\n');
}

export function applyBoardSvgFont(element: SVGElement, families: Set<string>): void {
  const stack = element.getAttribute('font-family');
  if (!stack) return;
  const family = stack.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
  families.add(family);
  if (family === BOARD_FONT_FACES.mono) {
    element.style.fontVariantLigatures = 'none';
    element.style.fontFeatureSettings = BOARD_MONO_FEATURES;
  }
}
