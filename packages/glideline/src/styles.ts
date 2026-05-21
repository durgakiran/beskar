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

export type FillStyle   = 'none' | 'semi' | 'solid' | 'pattern';
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
export function svgFill(
  fillStyle: FillStyle,
  color: string,
  patternId?: string,
): string {
  switch (fillStyle) {
    case 'none':    return 'none';
    case 'semi':    return hexWithOpacity(resolveColor(color), FILL_OPACITIES.semi);
    case 'solid':   return resolveColor(color);
    case 'pattern': return patternId ? `url(#${patternId})` : resolveColor(color);
  }
}
