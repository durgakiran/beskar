/**
 * StickyNoteUtil — coloured sticky-note shape (Phase A)
 *
 * Props:
 *   w, h        — dimensions (resizable)
 *   color       — background fill colour key or hex
 *   opacity     — 0–1 overall opacity
 *   text        — note body text (may contain newlines)
 *   font        — draw | sans | serif | mono
 *   fontSize    — sm | md | lg | xl
 *   textAlign   — left | center | right
 *   textColor   — text colour
 *
 * getGeometry  → AABB
 * hitTestPoint → AABB (default)
 * toSvg        → <rect> background + <text> with <tspan> line wrapping
 *
 * Note: toSvg produces pure SVG so it is export-safe (no foreignObject).
 * Inline editing is handled by InlineEditor.tsx in the demo layer via a
 * positioned <textarea>; during editing the SVG text is hidden.
 */

import { ShapeUtil } from './ShapeUtil.js';
import { T } from '../validators.js';
import { defineMigrations } from '../migrations.js';
import { makeBox } from '../types.js';
import type { GlideShape, GlideProps } from '../types.js';
import { Geometry2d, Rectangle2d } from '../geometry/index.js';
import {
  FONT_SIZES, FONT_FAMILIES,
  resolveColor, createTextForeignObjectForExport,
  type FontSize, type TextAlign, type Font, type LabelProps,
} from '../styles.js';

// ─────────────────────────────────────────────────────────────
// Sticky-note background colours (warm palette)
// ─────────────────────────────────────────────────────────────

export const STICKY_COLORS: Record<string, string> = {
  yellow:  '#fef08a',
  orange:  '#fed7aa',
  pink:    '#fda4af',
  blue:    '#93c5fd',
  teal:    '#99f6e4',
  green:   '#bbf7d0',
  purple:  '#d8b4fe',
  white:   '#f8fafc',
};

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

export interface StickyNoteProps {
  [key: string]: unknown;
  w:         number;
  h:         number;
  color:     string;
  opacity:   number;
  text:      string;
  font:      Font;
  fontSize:  FontSize;
  textAlign: TextAlign;
  textColor: string;
}

export type StickyNoteShape = GlideShape<StickyNoteProps>;

// ─────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────

const fontSizeValidator = {
  validate(v: unknown): FontSize {
    if (!['sm', 'md', 'lg', 'xl'].includes(v as string)) {
      throw new Error(`fontSize must be sm|md|lg|xl, got "${v}"`);
    }
    return v as FontSize;
  },
};

const textAlignValidator = {
  validate(v: unknown): TextAlign {
    if (!['left', 'center', 'right'].includes(v as string)) {
      throw new Error(`textAlign must be left|center|right, got "${v}"`);
    }
    return v as TextAlign;
  },
};

const fontValidator = {
  validate(v: unknown): Font {
    if (!['draw', 'sans', 'serif', 'mono'].includes(v as string)) {
      throw new Error(`font must be draw|sans|serif|mono, got "${v}"`);
    }
    return v as Font;
  },
};

// ─────────────────────────────────────────────────────────────
// Text-wrap helper (SVG tspan-based)
// ─────────────────────────────────────────────────────────────

/** Approximate number of chars that fit in `maxWidth` pixels. */
function charsPerLine(maxWidth: number, fontSize: number): number {
  // Average char width ≈ fontSize * 0.52 (Inter, normal weight)
  return Math.max(1, Math.floor(maxWidth / (fontSize * 0.52)));
}

/**
 * Wrap `text` into lines that fit within `maxWidth` px.
 * Preserves explicit newlines. Returns array of strings.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const cpl = charsPerLine(maxWidth, fontSize);
  const rawLines = text.split('\n');
  const wrapped: string[] = [];

  for (const rawLine of rawLines) {
    if (rawLine.length === 0) {
      wrapped.push('');
      continue;
    }
    let pos = 0;
    while (pos < rawLine.length) {
      // Try to break at a word boundary
      let end = Math.min(pos + cpl, rawLine.length);
      if (end < rawLine.length) {
        const lastSpace = rawLine.lastIndexOf(' ', end);
        if (lastSpace > pos) end = lastSpace + 1;
      }
      wrapped.push(rawLine.slice(pos, end).trimEnd());
      pos = end;
    }
  }

  return wrapped;
}

// ─────────────────────────────────────────────────────────────
// StickyNoteUtil
// ─────────────────────────────────────────────────────────────

/** Inner padding (px) between the sticky-note border and text. */
const PAD = 12;

export class StickyNoteUtil extends ShapeUtil<StickyNoteShape> {
  static override readonly type = 'sticky-note';

  static override readonly props: GlideProps<StickyNoteProps> = {
    w:         T.number,
    h:         T.number,
    color:     T.string,
    opacity:   T.number,
    text:      T.string,
    font:      fontValidator,
    fontSize:  fontSizeValidator,
    textAlign: textAlignValidator,
    textColor: T.string,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 1,
    migrators: {
      1: {
        up: r => ({
          ...r,
          props: {
            w:         200,
            h:         200,
            color:     'yellow',
            opacity:   1,
            text:      '',
            font:      'sans',
            fontSize:  'md',
            textAlign: 'left',
            textColor: '#1e1e1e',
            ...(r['props'] as object),
          },
        }),
        down: r => r,
      },
    },
  });

  getDefaultProps(): StickyNoteProps {
    return {
      w:         200,
      h:         200,
      color:     'yellow',
      opacity:   1,
      text:      '',
      font:      'sans',
      fontSize:  'md',
      textAlign: 'left',
      textColor: '#1e1e1e',
    };
  }

  getGeometry(shape: StickyNoteShape): Geometry2d {
    return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
  }

  /** Geometry-only SVG — background rect only, no text. For interactive canvas rendering. */
  toSvg(shape: StickyNoteShape): SVGElement {
    const { props } = shape;
    const bgColor = STICKY_COLORS[props.color] ?? resolveColor(props.color);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x',      '0');
    rect.setAttribute('y',      '0');
    rect.setAttribute('width',  String(props.w));
    rect.setAttribute('height', String(props.h));
    rect.setAttribute('fill',   bgColor);
    rect.setAttribute('rx',     '4');
    rect.setAttribute('stroke', 'rgba(0,0,0,0.08)');
    rect.setAttribute('stroke-width', '1');
    g.appendChild(rect);
    return g;
  }

  /** CSS label properties for the HTML overlay div — includes sticky background color. */
  override getLabelProps(shape: StickyNoteShape): LabelProps | null {
    const { props } = shape;
    const bgColor = STICKY_COLORS[props.color] ?? resolveColor(props.color);
    return {
      text:          props.text,
      fontFamily:    FONT_FAMILIES[props.font] ?? FONT_FAMILIES.sans,
      fontSize:      FONT_SIZES[props.fontSize] ?? FONT_SIZES.md,
      color:         resolveColor(props.textColor),
      textAlign:     props.textAlign,
      verticalAlign: 'top',
      padding:       PAD,
      background:    bgColor,
    };
  }

  /** Full SVG for export — includes foreignObject text. */
  override toSvgExport(shape: StickyNoteShape): SVGElement {
    const g = this.toSvg(shape) as SVGGElement;
    const { props } = shape;
    if (props.text) {
      const fo = createTextForeignObjectForExport({
        x: 0, y: 0, w: props.w, h: props.h,
        text: props.text,
        font: props.font,
        fontSize: props.fontSize,
        textAlign: props.textAlign,
        color: props.textColor,
        verticalAlign: 'top',
        padding: PAD,
      });
      g.appendChild(fo);
    }
    return g;
  }
}

// ─────────────────────────────────────────────────────────────
// Plugin export
// ─────────────────────────────────────────────────────────────

import type { GlidePlugin } from '../editor.js';

export const StickyNotePlugin: GlidePlugin = {
  id: 'sticky-note',
  shapes: [StickyNoteUtil as any],
};
