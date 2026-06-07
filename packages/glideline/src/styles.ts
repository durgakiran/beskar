/**
 * Glideline — Style system (Phase A)
 *
 * Shared style constants and types used by all shape utilities.
 * ShapeStyleProps is the union of every styleable property a shape can expose.
 * Each ShapeUtil only uses the subset it understands; the StylePanel reads the
 * intersection of supported props for the current selection.
 */

// ─────────────────────────────────────────────────────────────
// Color palette (14 tldraw colours)
// ─────────────────────────────────────────────────────────────

export const TLDRAW_COLORS = {
  black:    '#1e1e1e',
  white:    '#f8f9fa',
  slate:    '#868e96',
  silver:   '#ced4da',
  tomato:   '#e03131',
  salmon:   '#f03e3e',
  orange:   '#fd7e14',
  yellow:   '#f59f00',
  banana:   '#f8f08d',
  grass:    '#37b24d',
  teal:     '#0c8599',
  blue:     '#1971c2',
  violet:   '#7048e8',
  grape:    '#ae3ec9',
} as const;

export type TldrawColor = keyof typeof TLDRAW_COLORS;

/** Fallback hex for a color key (returns the hex or the key itself if it's already a hex). */
export function resolveColor(color: string): string {
  return (TLDRAW_COLORS as Record<string, string>)[color] ?? color;
}

// ─────────────────────────────────────────────────────────────
// Enum types
// ─────────────────────────────────────────────────────────────

export type FillStyle   = 'none' | 'semi' | 'solid' | 'pattern' | 'lined';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type SizeStyle   = 'thin' | 'medium' | 'thick' | 'xl';
export type FontSize    = 'sm' | 'md' | 'lg' | 'xl';
export type TextAlign   = 'left' | 'center' | 'right';
export type Font        = 'draw' | 'sans' | 'serif' | 'mono';

// ─────────────────────────────────────────────────────────────
// Pixel-value lookup tables
// ─────────────────────────────────────────────────────────────

export const STROKE_WIDTHS: Record<SizeStyle, number> = {
  thin:   1.5,
  medium: 2.5,
  thick:  3.5,
  xl:     5,
};

export const FONT_SIZES: Record<FontSize, number> = {
  sm: 12,
  md: 16,
  lg: 22,
  xl: 32,
};

export const FONT_FAMILIES: Record<Font, string> = {
  draw:  '"Shantell Sans", cursive',
  sans:  'Inter, system-ui, sans-serif',
  serif: 'Georgia, serif',
  mono:  '"Fira Code", monospace',
};

/** Dash-array for dashed/dotted strokes as [dashLen, gapLen]. */
export const STROKE_DASH_ARRAYS: Record<StrokeStyle, string> = {
  solid:  'none',
  dashed: '8 4',
  dotted: '1 6',
};

/** Opacity per FillStyle (applied to fill colour). */
export const FILL_OPACITIES: Record<FillStyle, number> = {
  none:    0,
  semi:    0.3,
  solid:   1,
  pattern: 1,   // pattern is rendered separately
  lined:   1,   // lined pattern is rendered separately
};

// ─────────────────────────────────────────────────────────────
// Validators for ShapeUtils
// ─────────────────────────────────────────────────────────────

export const StyleValidators = {
  fillStyle: {
    validate(v: unknown): FillStyle {
      if (!['none', 'semi', 'solid', 'pattern', 'lined'].includes(v as string)) throw new Error(`fillStyle must be none|semi|solid|pattern|lined, got "${v}"`);
      return v as FillStyle;
    },
  },
  strokeStyle: {
    validate(v: unknown): StrokeStyle {
      if (!['solid', 'dashed', 'dotted'].includes(v as string)) throw new Error(`strokeStyle must be solid|dashed|dotted, got "${v}"`);
      return v as StrokeStyle;
    },
  },
  strokeWidth: {
    validate(v: unknown): SizeStyle {
      if (!['thin', 'medium', 'thick', 'xl'].includes(v as string)) throw new Error(`strokeWidth must be thin|medium|thick|xl, got "${v}"`);
      return v as SizeStyle;
    },
  },
  fontSize: {
    validate(v: unknown): FontSize {
      if (!['sm', 'md', 'lg', 'xl'].includes(v as string)) throw new Error(`fontSize must be sm|md|lg|xl, got "${v}"`);
      return v as FontSize;
    },
  },
  textAlign: {
    validate(v: unknown): TextAlign {
      if (!['left', 'center', 'right'].includes(v as string)) throw new Error(`textAlign must be left|center|right, got "${v}"`);
      return v as TextAlign;
    },
  },
  font: {
    validate(v: unknown): Font {
      if (!['draw', 'sans', 'serif', 'mono'].includes(v as string)) throw new Error(`font must be draw|sans|serif|mono, got "${v}"`);
      return v as Font;
    },
  },
};

// ─────────────────────────────────────────────────────────────
// ShapeStyleProps — superset of all style properties
// ─────────────────────────────────────────────────────────────

/**
 * Every styleable property in the system.
 * ShapeUtils only declare props they support; the StylePanel
 * computes the intersection across the selection.
 */
export interface ShapeStyleProps {
  /** Primary colour (fill for closed shapes, stroke for lines). */
  color?: string;
  /** 0–1 overall shape opacity. */
  opacity?: number;
  /** Fill rendering style. */
  fillStyle?: FillStyle;
  /** Stroke rendering style. */
  strokeStyle?: StrokeStyle;
  /** Stroke width token. */
  strokeWidth?: SizeStyle;
  /** Text color */
  labelColor?: string;
  /** Font size token (text / sticky). */
  fontSize?: FontSize;
  /** Text alignment (text / sticky). */
  textAlign?: TextAlign;
  /** Typeface (text / sticky). */
  font?: Font;
}

// ─────────────────────────────────────────────────────────────
// Helpers for SVG rendering
// ─────────────────────────────────────────────────────────────

/**
 * Converts a hex color + opacity into an rgba string.
 * Used for semi-transparent fills.
 */
export function hexWithOpacity(hex: string, opacity: number): string {
  if (opacity <= 0) return 'none';
  if (opacity >= 1) return hex;
  // Parse #rrggbb or #rgb
  let r = 0, g = 0, b = 0;
  const h = hex.replace('#', '');
  if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else if (h.length === 3) {
    const c0 = h.charAt(0); const c1 = h.charAt(1); const c2 = h.charAt(2);
    r = parseInt(c0 + c0, 16);
    g = parseInt(c1 + c1, 16);
    b = parseInt(c2 + c2, 16);
  }
  return `rgba(${r},${g},${b},${opacity})`;
}

/**
 * Given a FillStyle and color, return the SVG fill attribute value.
 * Pattern fills return a reference string — the caller must render the
 * <pattern> element separately with id = patternId.
 */
export function getPatternId(type: 'dot' | 'lined', color: string): string {
  const cleanColor = color.replace('#', '');
  return `pattern-${type}-${cleanColor}`;
}

export function svgFill(
  fillStyle: FillStyle,
  color: string,
): string {
  const colorHex = resolveColor(color);
  switch (fillStyle) {
    case 'none':    return 'none';
    case 'semi':    return hexWithOpacity(colorHex, FILL_OPACITIES.semi);
    case 'solid':   return colorHex;
    case 'pattern': return `url(#${getPatternId('dot', color)})`;
    case 'lined':   return `url(#${getPatternId('lined', color)})`;
  }
}

// ─────────────────────────────────────────────────────────────
// HTML Text rendering (WYSIWYG identical to InlineEditor)
// ─────────────────────────────────────────────────────────────

export function createTextForeignObject(opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  font: Font | string;
  fontSize: FontSize | number;
  textAlign: TextAlign | string;
  color: string;
  verticalAlign?: 'top' | 'center';
  padding?: number;
}): SVGForeignObjectElement {
  const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
  fo.setAttribute('x', String(opts.x));
  fo.setAttribute('y', String(opts.y));
  fo.setAttribute('width', String(opts.w));
  fo.setAttribute('height', String(opts.h));
  fo.setAttribute('pointer-events', 'none');

  const div = document.createElement('div');
  div.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  div.style.width = '100%';
  div.style.height = '100%';
  div.style.display = 'flex';
  div.style.alignItems = opts.verticalAlign === 'top' ? 'flex-start' : 'center';
  div.style.justifyContent = opts.textAlign === 'left' ? 'flex-start' : opts.textAlign === 'right' ? 'flex-end' : 'center';
  div.style.fontSize = typeof opts.fontSize === 'number' ? `${opts.fontSize}px` : `${FONT_SIZES[opts.fontSize as FontSize]}px`;
  div.style.fontFamily = (FONT_FAMILIES as any)[opts.font] || opts.font;
  div.style.color = resolveColor(opts.color) ?? opts.color;
  div.style.textAlign = opts.textAlign;
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordBreak = 'break-word';
  div.style.lineHeight = 'normal';
  div.style.margin = '0';
  div.style.padding = opts.padding ? `${opts.padding}px` : '0';
  div.style.boxSizing = 'border-box';
  div.textContent = opts.text;

  fo.appendChild(div);
  return fo;
}
