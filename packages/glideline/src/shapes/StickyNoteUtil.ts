import { createSvgLabel } from './TextUtil.js';
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
 * toSvg        → paper silhouette and curled corner
 * toSvgExport  → paper and wrapped SVG text
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
  resolveColor,
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
const SHADOW_BLUR = 3;
const SHADOW_OFFSET_Y = 3;
const SHADOW_PADDING = SHADOW_BLUR * 3;
const SVG_NS = 'http://www.w3.org/2000/svg';

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

  override getVisualBounds(shape: StickyNoteShape) {
    const { w, h } = shape.props;
    return makeBox(
      -SHADOW_PADDING,
      SHADOW_OFFSET_Y - SHADOW_PADDING,
      w + SHADOW_PADDING * 2,
      h + SHADOW_PADDING * 2,
    );
  }

  /** Paint the paper separately from the canvas text overlay. */
  toSvg(shape: StickyNoteShape): SVGElement {
    const { w, h, color, opacity } = shape.props;
    const curlDepth = Math.min(24, h / 4, w / 8);
    const curlWidth = curlDepth * 1.75;
    const curlTop = h - curlDepth;
    const curlLeft = w - curlWidth;
    const curledEdge = `Q ${w - curlDepth / 2} ${h} ${curlLeft} ${h}`;

    const g = document.createElementNS(SVG_NS, 'g');
    if (opacity < 1) g.setAttribute('opacity', String(opacity));

    const paper = document.createElementNS(SVG_NS, 'path');
    paper.setAttribute('d', `M 0 0 H ${w} V ${curlTop} ${curledEdge} H 0 Z`);
    paper.setAttribute('fill', STICKY_COLORS[color] ?? resolveColor(color));
    paper.setAttribute('filter', `drop-shadow(0px ${SHADOW_OFFSET_Y}px ${SHADOW_BLUR}px rgba(15,23,42,0.24))`);

    const curl = document.createElementNS(SVG_NS, 'path');
    curl.setAttribute('d', `M ${w} ${curlTop} ${curledEdge} Q ${curlLeft + curlDepth / 2} ${h - curlDepth} ${w} ${curlTop} Z`);
    curl.setAttribute('fill', '#fff');
    curl.setAttribute('fill-opacity', '0.65');
    curl.setAttribute('stroke', '#0f172a');
    curl.setAttribute('stroke-opacity', '0.22');
    curl.setAttribute('stroke-width', String(curlDepth / 20));

    g.append(paper, curl);
    return g;
  }

  /** CSS label properties for the transparent HTML overlay. */
  override getLabelProps(shape: StickyNoteShape): LabelProps | null {
    const { props } = shape;
    return {
      text:          props.text,
      fontFamily:    FONT_FAMILIES[props.font] ?? FONT_FAMILIES.sans,
      fontSize:      FONT_SIZES[props.fontSize] ?? FONT_SIZES.md,
      color:         resolveColor(props.textColor),
      textAlign:     props.textAlign,
      verticalAlign: 'top',
      padding:       PAD,
    };
  }

  /** Full SVG for export — includes the sticky note text. */
  override toSvgExport(shape: StickyNoteShape): SVGElement {
    const geometry = this.toSvg(shape);
    const label = this.getLabelProps(shape);
    if (label?.text) geometry.appendChild(createSvgLabel(label, this.getGeometry(shape).getBounds()));
    return geometry;
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
