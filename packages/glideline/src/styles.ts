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

/** Returns the pattern fill id scoped to a specific shape (avoids cross-shape SVG collisions). */
export function getShapePatternId(type: 'dot' | 'lined', shapeId: string): string {
  const safeId = shapeId.replace(/:/g, '_');
  return `pattern-${type}-${safeId}`;
}

export function svgFill(
  fillStyle: FillStyle,
  color: string,
  shapeId?: string,
): string {
  const colorHex = resolveColor(color);
  switch (fillStyle) {
    case 'none':    return 'none';
    case 'semi':    return hexWithOpacity(colorHex, FILL_OPACITIES.semi);
    case 'solid':   return colorHex;
    case 'pattern': return shapeId ? `url(#${getShapePatternId('dot', shapeId)})` : `url(#${getPatternId('dot', color)})`;
    case 'lined':   return shapeId ? `url(#${getShapePatternId('lined', shapeId)})` : `url(#${getPatternId('lined', color)})`;
  }
}

/**
 * Inlines SVG <pattern> definitions for dot/lined fills into a <defs> element
 * scoped to this shape's own <svg>. Each pattern id is suffixed with shapeId
 * to prevent collisions when multiple shapes use the same pattern.
 *
 * Usage: prepend the returned <defs> to the shape's root <g> before setting
 * fill="url(#...)" on geometry elements.
 */
export function inlinePatternDefs(
  fillStyle: FillStyle,
  color: string,
  shapeId: string,
): SVGDefsElement | null {
  if (fillStyle !== 'pattern' && fillStyle !== 'lined') return null;

  const colorHex = resolveColor(color);
  const type = fillStyle === 'pattern' ? 'dot' : 'lined';
  const patternId = getShapePatternId(type, shapeId);

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
  pattern.setAttribute('id', patternId);
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');

  if (type === 'dot') {
    pattern.setAttribute('width', '12');
    pattern.setAttribute('height', '12');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', '6');
    dot.setAttribute('cy', '6');
    dot.setAttribute('r', '1.5');
    dot.setAttribute('fill', colorHex);
    pattern.appendChild(dot);
  } else {
    pattern.setAttribute('width', '8');
    pattern.setAttribute('height', '8');
    pattern.setAttribute('patternTransform', 'rotate(45)');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '0'); line.setAttribute('y1', '0');
    line.setAttribute('x2', '0'); line.setAttribute('y2', '8');
    line.setAttribute('stroke', colorHex);
    line.setAttribute('stroke-width', '1.2');
    pattern.appendChild(line);
  }

  defs.appendChild(pattern);
  return defs;
}

// ─────────────────────────────────────────────────────────────
// Label props — for HTML overlay divs in the hybrid rendering model
// ─────────────────────────────────────────────────────────────

/**
 * CSS properties for a shape's HTML label overlay div.
 * Returned by ShapeUtil.getLabelProps(); consumed by ShapeLayer in Canvas.tsx.
 */
export interface LabelProps {
  text:          string;
  fontFamily:    string;
  /** Font size in page-space px (Canvas.tsx multiplies by camera.z for screen space). */
  fontSize:      number;
  color:         string;
  textAlign:     'left' | 'center' | 'right';
  verticalAlign: 'top' | 'center';
  /** Inner padding in page-space px. */
  padding:       number;
  /** Optional background color (used by sticky-note to match shape fill on label div). */
  background?:   string;
  /** Optional positioned label box in shape-local coordinates. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

// ─────────────────────────────────────────────────────────────
// SVG export text rendering (with foreignObject — for PNG/SVG export only)
// ─────────────────────────────────────────────────────────────

export function createTextForeignObjectForExport(opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  font: Font | string;
  fontSize: FontSize | number;
  textAlign: TextAlign | string;
  color: string;
  background?: string;
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
  if (opts.background) div.style.background = resolveColor(opts.background) ?? opts.background;
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

/** @deprecated Use createTextForeignObjectForExport (export path only). */
export const createTextForeignObject = createTextForeignObjectForExport;

let measurementContext: CanvasRenderingContext2D | null = null;
function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measurementContext) {
    const canvas = document.createElement('canvas');
    measurementContext = canvas.getContext('2d');
  }
  return measurementContext;
}

/**
 * Estimate the wrapped height of a text block given a width, font, and font size.
 */
export function estimateTextHeight(opts: {
  text: string;
  w: number;
  font: Font | string;
  fontSize: FontSize | number;
  padding?: number;
}): number {
  const text = opts.text;
  if (!text) return 0;

  const fontName = (FONT_FAMILIES as any)[opts.font] || opts.font;
  const size = typeof opts.fontSize === 'number' ? opts.fontSize : FONT_SIZES[opts.fontSize as FontSize];
  const padding = opts.padding || 0;
  const usableWidth = Math.max(1, opts.w - padding * 2);

  const ctx = getMeasurementContext();
  const lineHeight = size * 1.4; // normal line-height ≈ 1.4×

  if (!ctx) {
    // Fallback if no DOM/Canvas (e.g. tests running in non-browser env)
    const avgCharWidth = size * 0.6;
    const charsPerLine = Math.max(1, Math.floor(usableWidth / avgCharWidth));
    let totalLines = 0;
    for (const rawLine of text.split('\n')) {
      totalLines += Math.max(1, Math.ceil(rawLine.length / charsPerLine));
    }
    return totalLines * lineHeight + padding * 2;
  }

  ctx.font = `${size}px ${fontName}`;
  const lines = text.split('\n');
  let totalLines = 0;

  for (const line of lines) {
    if (line === '') {
      totalLines += 1;
      continue;
    }

    const words = line.split(' ');
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const testWidth = ctx.measureText(testLine).width;

      if (testWidth <= usableWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          totalLines += 1;
        }
        // Handle breaking a single very long word
        let wordRest = word;
        while (ctx.measureText(wordRest).width > usableWidth) {
          let l = 1;
          while (l < wordRest.length && ctx.measureText(wordRest.slice(0, l + 1)).width <= usableWidth) {
            l++;
          }
          totalLines += 1;
          wordRest = wordRest.slice(l);
        }
        currentLine = wordRest;
      }
    }
    if (currentLine) {
      totalLines += 1;
    }
  }

  return totalLines * lineHeight + padding * 2;
}

/**
 * Calculates the minimum height for a shape to display all its text content.
 */
export function getMinHeightForShape(shape: { type: string; props: Record<string, any> }, w?: number): number {
  if (shape.type === 'text') {
    return 0; // text shapes are fully auto-sized dynamically
  }

  let text = '';
  let font = 'sans';
  let fontSize: any = 'md';
  let padding = 0;

  if (shape.type === 'sticky-note') {
    text = shape.props.text ?? '';
    font = shape.props.font ?? 'sans';
    fontSize = shape.props.fontSize ?? 'md';
    padding = 12; // Sticky note PAD is 12
  } else if (['box', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star'].includes(shape.type)) {
    text = shape.props.label ?? '';
    font = shape.props.font ?? 'sans';
    fontSize = shape.props.fontSize ?? 'md';
    padding = 8; // Usable padding for textarea editing buffer is 4 on each side = 8 total
  } else {
    return 0;
  }

  const width = w ?? shape.props.w ?? 100;
  return estimateTextHeight({ text, w: width, font, fontSize, padding });
}
