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
import { createTextForeignObject } from '../styles';
import type { GlideShape, Vec2 } from '../types';
import { Geometry2d, Rectangle2d } from '../geometry';

export interface TextProps {
  [key: string]: unknown;
  text:     string;
  fontSize: number;
  color:    string;
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
function estimateBounds(text: string, fontSize: number): { w: number; h: number } {
  const lines = text.split('\n');
  const h = lines.length * fontSize * 1.4; // line-height ≈ 1.4×

  const ctx = getMeasurementContext();
  if (!ctx) {
    // Fallback if no DOM
    const longestLine = lines.reduce((max, l) => Math.max(max, l.length), 0);
    const w = Math.max(longestLine * fontSize * 0.6, fontSize * 0.6);
    return { w, h };
  }

  ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
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
    fontSize: T.number,
    color:    T.string,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 1,
    migrators: {
      1: {
        up:   r => ({ ...r, props: { fontSize: 16, color: '#cdd6f4', ...(r['props'] as object) } }),
        down: r => r,
      },
    },
  });

  getDefaultProps(): TextProps {
    return { text: '', fontSize: 16, color: '#cdd6f4' };
  }

  getGeometry(shape: TextShape): Geometry2d {
    const { w, h } = estimateBounds(shape.props.text, shape.props.fontSize);
    return new Rectangle2d(0, 0, (shape.props as any).w ?? w, h);
  }

  override onResize(shape: TextShape, info: ResizeInfo<TextShape>): Partial<TextShape> {
    const base = super.onResize(shape, info) as any;
    delete base.props?.h;
    return base;
  }

  toSvg(shape: TextShape): SVGElement {
    const { props } = shape;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const bounds = this.getGeometry(shape).getBounds();
    const w = bounds.w;
    const h = bounds.h;

    const fo = createTextForeignObject({
      x: 0, y: 0, w, h,
      text: props.text,
      font: 'Inter, system-ui, sans-serif',
      fontSize: props.fontSize,
      textAlign: 'left',
      color: props.color,
      verticalAlign: 'top',
    });

    g.appendChild(fo);
    return g;
  }
}
