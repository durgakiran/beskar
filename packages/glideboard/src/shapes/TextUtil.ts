import {
  ShapeUtil,
  T,
  defineMigrations,
  type GlideShape,
  type ResizeInfo,
} from '@durgakiran/glideline';
import { RectangleGeometry } from './localGeometry';
import { createTextForeignObject } from './localStyles';

export interface TextProps {
  [key: string]: unknown;
  text: string;
  fontSize: number;
  color: string;
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

function estimateBounds(text: string, fontSize: number): { w: number; h: number } {
  const lines = text.split('\n');
  const h = lines.length * fontSize * 1.4;
  const ctx = getMeasurementContext();

  if (!ctx) {
    const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
    return { w: Math.max(longestLine * fontSize * 0.6, fontSize * 0.6), h };
  }

  ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
  let maxW = fontSize * 0.6;
  for (const line of lines) {
    const metrics = ctx.measureText(line);
    if (metrics.width > maxW) maxW = metrics.width;
  }
  return { w: maxW, h };
}

export class TextUtil extends ShapeUtil<TextShape> {
  static override readonly type = 'text';

  static override readonly props = {
    text: T.string,
    fontSize: T.number,
    color: T.string,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 1,
    migrators: {
      1: {
        up: record => ({ ...record, props: { fontSize: 16, color: '#cdd6f4', ...(record['props'] as object) } }),
        down: record => record,
      },
    },
  });

  getDefaultProps(): TextProps {
    return { text: '', fontSize: 16, color: '#cdd6f4' };
  }

  getGeometry(shape: TextShape) {
    const { w, h } = estimateBounds(shape.props.text, shape.props.fontSize);
    return new RectangleGeometry(0, 0, (shape.props as { w?: number }).w ?? w, h);
  }

  override onResize(shape: TextShape, info: ResizeInfo<TextShape>): Partial<TextShape> {
    const base = super.onResize(shape, info) as Partial<TextShape> & {
      props?: Record<string, unknown>;
    };
    if (base.props) {
      delete base.props.h;
    }
    return base;
  }

  toSvg(shape: TextShape): SVGElement {
    const bounds = this.getGeometry(shape).getBounds();
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.appendChild(
      createTextForeignObject({
        x: 0,
        y: 0,
        w: bounds.w,
        h: bounds.h,
        text: shape.props.text,
        font: 'Inter, system-ui, sans-serif',
        fontSize: shape.props.fontSize,
        textAlign: 'left',
        color: shape.props.color,
        verticalAlign: 'top',
      }),
    );
    return g;
  }
}
