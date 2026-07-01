/**
 * EllipseUtil — circle / oval shape (Phase A)
 *
 * Props:
 *   w, h          — bounding box dimensions (= 2*rx, 2*ry)
 *   color         — fill colour key or hex
 *   opacity       — 0–1 overall opacity
 *   fillStyle     — none | semi | solid | pattern
 *   strokeStyle   — solid | dashed | dotted
 *   strokeWidth   — thin | medium | thick | xl
 *   label         — centre text label
 *   labelColor    — text colour (defaults to black or white by contrast)
 *   font          — draw | sans | serif | mono
 *   fontSize      — sm | md | lg | xl
 *   textAlign     — left | center | right
 *
 * getGeometry   → AABB of the bounding box (x, y, w, h)
 * hitTestPoint  → point-in-ellipse formula (exact, not AABB)
 * toSvg         → <ellipse> + optional <text> label centred inside
 */

import { ShapeUtil } from './ShapeUtil';
import { T } from '../validators';
import { defineMigrations } from '../migrations';
import { makeBox } from '../types';
import type { GlideShape, Vec2, GlideProps } from '../types';
import { Geometry2d, Ellipse2d } from '../geometry';
import {
  STROKE_WIDTHS, STROKE_DASH_ARRAYS,
  svgFill, resolveColor, inlinePatternDefs, createTextForeignObjectForExport,
  FONT_FAMILIES, FONT_SIZES,
  type FillStyle, type StrokeStyle, type SizeStyle, type FontSize,
  type TextAlign, type Font, type LabelProps,
} from '../styles';

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

export interface EllipseProps {
  [key: string]: unknown;
  w:           number;
  h:           number;
  color:       string;
  opacity:     number;
  fillStyle:   FillStyle;
  strokeStyle: StrokeStyle;
  strokeWidth: SizeStyle;
  label:       string;
  labelColor:  string;
  font:        Font;
  fontSize:    FontSize;
  textAlign:   TextAlign;
}

export type EllipseShape = GlideShape<EllipseProps>;

// ─────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────

const fillStyleValidator = {
  validate(v: unknown): FillStyle {
    if (!['none', 'semi', 'solid', 'pattern', 'lined'].includes(v as string)) {
      throw new Error(`fillStyle must be none|semi|solid|pattern|lined, got "${v}"`);
    }
    return v as FillStyle;
  },
};

const strokeStyleValidator = {
  validate(v: unknown): StrokeStyle {
    if (!['solid', 'dashed', 'dotted'].includes(v as string)) {
      throw new Error(`strokeStyle must be solid|dashed|dotted, got "${v}"`);
    }
    return v as StrokeStyle;
  },
};

const sizeStyleValidator = {
  validate(v: unknown): SizeStyle {
    if (!['thin', 'medium', 'thick', 'xl'].includes(v as string)) {
      throw new Error(`strokeWidth must be thin|medium|thick|xl, got "${v}"`);
    }
    return v as SizeStyle;
  },
};

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
// EllipseUtil
// ─────────────────────────────────────────────────────────────

export class EllipseUtil extends ShapeUtil<EllipseShape> {
  static override readonly type = 'ellipse';

  static override readonly props: GlideProps<EllipseProps> = {
    w:           T.number,
    h:           T.number,
    color:       T.string,
    opacity:     T.number,
    fillStyle:   fillStyleValidator,
    strokeStyle: strokeStyleValidator,
    strokeWidth: sizeStyleValidator,
    label:       T.string,
    labelColor:  T.string,
    font:        fontValidator,
    fontSize:    fontSizeValidator,
    textAlign:   textAlignValidator,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 1,
    migrators: {
      1: {
        up: r => ({
          ...r,
          props: {
            w:           120,
            h:           80,
            color:       'violet',
            opacity:     1,
            fillStyle:   'solid',
            strokeStyle: 'solid',
            strokeWidth: 'medium',
            label:       '',
            labelColor:  'black',
            font:        'sans',
            fontSize:    'md',
            textAlign:   'center',
            ...(r['props'] as object),
          },
        }),
        down: r => r,
      },
    },
  });

  getDefaultProps(): EllipseProps {
    return {
      w:           120,
      h:           80,
      color:       'black',
      opacity:     1,
      fillStyle:   'none',
      strokeStyle: 'solid',
      strokeWidth: 'medium',
      label:       '',
      labelColor:  'black',
      font:        'sans',
      fontSize:    'md',
      textAlign:   'center',
    };
  }

  /** AABB in LOCAL space (origin at 0,0). */
  getGeometry(shape: EllipseShape): Geometry2d {
    const rx = shape.props.w / 2;
    const ry = shape.props.h / 2;
    return new Ellipse2d(rx, ry, rx, ry);
  }

  /** Geometry-only SVG — no text labels. For interactive canvas rendering. */
  toSvg(shape: EllipseShape): SVGElement {
    const { props } = shape;
    const rx = props.w / 2;
    const ry = props.h / 2;
    const cx = rx;
    const cy = ry;
    const strokeW = STROKE_WIDTHS[props.strokeWidth];
    const fillColor = svgFill(props.fillStyle, resolveColor(props.color), shape.id);
    const strokeColor = resolveColor(props.color);
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));

    const defs = inlinePatternDefs(props.fillStyle, props.color, shape.id);
    if (defs) g.appendChild(defs);

    const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    ellipse.setAttribute('cx', String(cx));
    ellipse.setAttribute('cy', String(cy));
    ellipse.setAttribute('rx', String(rx));
    ellipse.setAttribute('ry', String(ry));
    ellipse.setAttribute('fill', fillColor);
    ellipse.setAttribute('stroke', strokeColor);
    ellipse.setAttribute('stroke-width', String(strokeW));
    if (dashArray !== 'none') {
      ellipse.setAttribute('stroke-dasharray', dashArray);
      if (props.strokeStyle === 'dotted') {
        ellipse.setAttribute('stroke-linecap', 'round');
      }
    }
    g.appendChild(ellipse);
    return g;
  }

  /** CSS label properties for the HTML overlay div. */
  override getLabelProps(shape: EllipseShape): LabelProps | null {
    const { props } = shape;
    return {
      text:          props.label || '',
      fontFamily:    FONT_FAMILIES[props.font] ?? FONT_FAMILIES.sans,
      fontSize:      FONT_SIZES[props.fontSize] ?? FONT_SIZES.md,
      color:         resolveColor(props.labelColor),
      textAlign:     props.textAlign,
      verticalAlign: 'center',
      padding:       8,
    };
  }

  /** Full SVG for export — includes foreignObject text label. */
  override toSvgExport(shape: EllipseShape): SVGElement {
    const g = this.toSvg(shape) as SVGGElement;
    const { props } = shape;
    if (props.label) {
      const fo = createTextForeignObjectForExport({
        x: 0, y: 0, w: props.w, h: props.h,
        text: props.label,
        font: props.font,
        fontSize: props.fontSize,
        textAlign: props.textAlign,
        color: props.labelColor,
        verticalAlign: 'center',
      });
      g.appendChild(fo);
    }
    return g;
  }
}

// ─────────────────────────────────────────────────────────────
// Plugin export
// ─────────────────────────────────────────────────────────────

import type { GlidePlugin } from '../editor';

export const EllipsePlugin: GlidePlugin = {
  id: 'ellipse',
  shapes: [EllipseUtil as any],
};
