/**
 * TextUtil — auto-sizing text block (Story 2.3)
 *
 * Geometry is computed from fontSize + line count.
 * No fixed w/h in props; bounding box estimated from content.
 * toSvg() returns a <text> element inside a <g>.
 */

import { ShapeUtil, type ResizeInfo } from './ShapeUtil';
import { T } from '../validators';
import { defineMigrations } from '../migrations';
import { makeBox } from '../types';
import {
  createTextForeignObjectForExport, estimateTextHeight, FONT_FAMILIES, FONT_SIZES,
  StyleValidators, resolveColor, type LabelProps, type Font, type FontSize,
} from '../styles';
import type { GlideShape, Vec2 } from '../types';
import { Geometry2d, Rectangle2d } from '../geometry';

export interface TextProps {
  [key: string]: unknown;
  text:     string;
  fontSize: FontSize;
  color:    string;
  font:     Font;
}

export type TextShape = GlideShape<TextProps>;

let measurementContext: CanvasRenderingContext2D | null = null;
function getMeasurementContext() {
  if (typeof document === 'undefined') return null;
  if (!measurementContext) {
    const canvas = document.createElement('canvas');
    measurementContext = canvas.getContext('2d');
  }
  return measurementContext;
}

/** Estimate text bounding box from exact font metrics. */
function estimateBounds(text: string, fontSize: number, fontName: string = 'Inter, system-ui, sans-serif'): { w: number; h: number } {
  const lines = text.split('\n');
  const h = lines.length * fontSize * 1.4; // line-height ≈ 1.4×

  const ctx = getMeasurementContext();
  if (!ctx) {
    // Fallback if no DOM
    const longestLine = lines.reduce((max, l) => Math.max(max, l.length), 0);
    const w = Math.max(longestLine * fontSize * 0.6, fontSize * 0.6);
    return { w, h };
  }

  ctx.font = `${fontSize}px ${fontName}`;
  let maxW = fontSize * 0.6; // minimum 1 character width
  for (const line of lines) {
    const metrics = ctx.measureText(line);
    if (metrics.width > maxW) maxW = metrics.width;
  }
  return { w: maxW, h };
}

export class TextUtil extends ShapeUtil<TextShape> {
  static override readonly type = 'text';

  static override readonly props = {
    text:     T.string,
    fontSize: StyleValidators.fontSize,
    color:    T.string,
    font:     StyleValidators.font,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 3,
    migrators: {
      1: {
        up:   r => ({ ...r, props: { fontSize: 16, color: 'black', ...(r['props'] as object) } }),
        down: r => r,
      },
      2: {
        up:   r => ({ ...r, props: { font: 'sans', ...(r['props'] as object) } }),
        down: r => r,
      },
      3: {
        up:   r => {
          const props = r['props'] as Record<string, unknown>;
          let fs = props['fontSize'];
          if (typeof fs === 'number') {
            if (fs <= 12) fs = 'sm';
            else if (fs <= 16) fs = 'md';
            else if (fs <= 22) fs = 'lg';
            else fs = 'xl';
          }
          return {
            ...r,
            props: {
              ...props,
              fontSize: fs ?? 'md',
            }
          };
        },
        down: r => r,
      },
    },
  });

  getDefaultProps(): TextProps {
    return { text: '', fontSize: 'md', color: 'black', font: 'sans' };
  }

  getGeometry(shape: TextShape): Geometry2d {
    const wProp = (shape.props as any).w;
    const fontName = FONT_FAMILIES[shape.props.font] ?? FONT_FAMILIES.sans;
    const fontSizeNum = typeof shape.props.fontSize === 'number'
      ? shape.props.fontSize
      : FONT_SIZES[shape.props.fontSize as FontSize] ?? 16;
    if (typeof wProp === 'number') {
      const h = estimateTextHeight({
        text: shape.props.text,
        w: wProp,
        font: fontName,
        fontSize: fontSizeNum,
      });
      return new Rectangle2d(0, 0, wProp, h);
    } else {
      const { w, h } = estimateBounds(shape.props.text, fontSizeNum, fontName);
      return new Rectangle2d(0, 0, w, h);
    }
  }

  override onResize(shape: TextShape, info: ResizeInfo<TextShape>): Partial<TextShape> {
    const base = super.onResize(shape, info) as any;
    delete base.props?.h;
    return base;
  }

  /** Text shapes have no SVG geometry — all content is in the HTML label div. */
  toSvg(_shape: TextShape): SVGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'g');
  }

  /** CSS label properties for the HTML label overlay div. */
  override getLabelProps(shape: TextShape): LabelProps | null {
    const fontSizeNum = typeof shape.props.fontSize === 'number'
      ? shape.props.fontSize
      : FONT_SIZES[shape.props.fontSize as FontSize] ?? 16;
    return {
      text:          shape.props.text,
      fontFamily:    FONT_FAMILIES[shape.props.font] ?? FONT_FAMILIES.sans,
      fontSize:      fontSizeNum,
      color:         resolveColor(shape.props.color),
      textAlign:     'left',
      verticalAlign: 'top',
      padding:       0,
    };
  }

  /** Full SVG for export — foreignObject text. */
  override toSvgExport(shape: TextShape): SVGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const bounds = this.getGeometry(shape).getBounds();
    const fontName = FONT_FAMILIES[shape.props.font] ?? FONT_FAMILIES.sans;
    const fontSizeNum = typeof shape.props.fontSize === 'number'
      ? shape.props.fontSize
      : FONT_SIZES[shape.props.fontSize as FontSize] ?? 16;
    const fo = createTextForeignObjectForExport({
      x: 0, y: 0, w: bounds.w, h: bounds.h,
      text: shape.props.text,
      font: fontName,
      fontSize: fontSizeNum,
      textAlign: 'left',
      color: resolveColor(shape.props.color),
      verticalAlign: 'top',
    });
    g.appendChild(fo);
    return g;
  }
}
