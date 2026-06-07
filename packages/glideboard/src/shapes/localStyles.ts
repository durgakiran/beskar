import {
  FONT_FAMILIES,
  FONT_SIZES,
  resolveColor,
  type FillStyle,
  type Font,
  type FontSize,
  type StrokeStyle,
  type TextAlign,
  type SizeStyle,
} from '@durgakiran/glideline';

export const StyleValidators = {
  fillStyle: {
    validate(value: unknown): FillStyle {
      if (!['none', 'semi', 'solid', 'pattern', 'lined'].includes(value as string)) {
        throw new Error(`fillStyle must be none|semi|solid|pattern|lined, got "${value}"`);
      }
      return value as FillStyle;
    },
  },
  strokeStyle: {
    validate(value: unknown): StrokeStyle {
      if (!['solid', 'dashed', 'dotted'].includes(value as string)) {
        throw new Error(`strokeStyle must be solid|dashed|dotted, got "${value}"`);
      }
      return value as StrokeStyle;
    },
  },
  strokeWidth: {
    validate(value: unknown): SizeStyle {
      if (!['thin', 'medium', 'thick', 'xl'].includes(value as string)) {
        throw new Error(`strokeWidth must be thin|medium|thick|xl, got "${value}"`);
      }
      return value as SizeStyle;
    },
  },
  fontSize: {
    validate(value: unknown): FontSize {
      if (!['sm', 'md', 'lg', 'xl'].includes(value as string)) {
        throw new Error(`fontSize must be sm|md|lg|xl, got "${value}"`);
      }
      return value as FontSize;
    },
  },
  textAlign: {
    validate(value: unknown): TextAlign {
      if (!['left', 'center', 'right'].includes(value as string)) {
        throw new Error(`textAlign must be left|center|right, got "${value}"`);
      }
      return value as TextAlign;
    },
  },
  font: {
    validate(value: unknown): Font {
      if (!['draw', 'sans', 'serif', 'mono'].includes(value as string)) {
        throw new Error(`font must be draw|sans|serif|mono, got "${value}"`);
      }
      return value as Font;
    },
  },
};

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
  div.style.justifyContent =
    opts.textAlign === 'left'
      ? 'flex-start'
      : opts.textAlign === 'right'
        ? 'flex-end'
        : 'center';
  div.style.fontSize =
    typeof opts.fontSize === 'number'
      ? `${opts.fontSize}px`
      : `${FONT_SIZES[opts.fontSize as FontSize]}px`;
  div.style.fontFamily = (FONT_FAMILIES as Record<string, string>)[opts.font] || String(opts.font);
  div.style.color = resolveColor(opts.color) ?? opts.color;
  div.style.textAlign = String(opts.textAlign);
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
