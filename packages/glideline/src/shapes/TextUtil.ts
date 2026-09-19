/**
 * TextUtil — auto-sizing text block (Story 2.3)
 *
 * Geometry is persisted so rendering, selection, routing, and export agree.
 * toSvg() returns a <text> element inside a <g>.
 */

import { ShapeUtil, type ResizeInfo, type RichTextDescriptor } from './ShapeUtil.js';
import { T } from '../validators.js';
import { defineMigrations } from '../migrations.js';
import {
  FONT_FAMILIES, FONT_SIZES, StyleValidators, resolveColor,
  type LabelProps, type Font, type FontSize, type TextAlign,
} from '../styles.js';
import type { GlideShape, Validator } from '../types.js';
import { Geometry2d, Rectangle2d } from '../geometry/index.js';

export type TextSizeMode = 'auto' | 'fixed-width' | 'fixed';

export interface CanvasRichTextSnapshot extends Record<string, unknown> {
  format: 'beskar-canvas-rich-text';
  version: 1;
  profile: 'text';
  doc: Record<string, unknown>;
}

export interface TextProps {
  [key: string]: unknown;
  text:     string;
  fontSize: FontSize;
  color:    string;
  opacity:  number;
  font:     Font;
  richText?: CanvasRichTextSnapshot;
  w: number;
  h: number;
  sizeMode: TextSizeMode;
  textAlign: TextAlign;
  lineHeight: number;
  scale: number;
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
function estimateBounds(text: string, fontSize: number, fontName: string = 'Inter, system-ui, sans-serif', lineHeight = 1.35): { w: number; h: number } {
  const lines = text.split('\n');
  const h = Math.max(fontSize * lineHeight, lines.length * fontSize * lineHeight);

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

function legacyRichText(text: string): CanvasRichTextSnapshot {
  return {
    format: 'beskar-canvas-rich-text',
    version: 1,
    profile: 'text',
    doc: {
      type: 'doc',
      content: text.split('\n').map(line => ({
        type: 'paragraph',
        ...(line ? { content: [{ type: 'text', text: line }] } : {}),
      })),
    },
  };
}

interface SvgTextRun {
  text: string;
  marks: readonly Record<string, unknown>[];
}

interface SvgTextChar {
  char: string;
  marks: readonly Record<string, unknown>[];
}

function richTextRuns(snapshot: CanvasRichTextSnapshot | undefined, fallback: string): SvgTextRun[][] {
  if (!snapshot) return fallback.split('\n').map(text => [{ text, marks: [] }]);
  const lines: SvgTextRun[][] = [[]];
  const current = () => lines[lines.length - 1]!;
  const newline = () => lines.push([]);
  const inline = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record['type'] === 'text' && typeof record['text'] === 'string') {
      current().push({
        text: record['text'],
        marks: Array.isArray(record['marks'])
          ? record['marks'].filter(mark => Boolean(mark) && typeof mark === 'object') as Record<string, unknown>[]
          : [],
      });
      return;
    }
    if (record['type'] === 'hardBreak') {
      newline();
      return;
    }
    if (Array.isArray(record['content'])) record['content'].forEach(inline);
  };
  const block = (node: unknown, prefix = '') => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const type = record['type'];
    if (type === 'paragraph') {
      if (prefix) current().push({ text: prefix, marks: [] });
      inline(record);
      return;
    }
    if (type === 'bulletList' || type === 'orderedList') {
      const start = type === 'orderedList'
        && record['attrs'] && typeof record['attrs'] === 'object'
        && typeof (record['attrs'] as Record<string, unknown>)['start'] === 'number'
        ? Number((record['attrs'] as Record<string, unknown>)['start'])
        : 1;
      const items = Array.isArray(record['content']) ? record['content'] : [];
      items.forEach((item, index) => {
        if (current().length || lines.length > 1) newline();
        block(item, type === 'bulletList' ? '• ' : `${start + index}. `);
      });
      return;
    }
    if (type === 'listItem') {
      const children = Array.isArray(record['content']) ? record['content'] : [];
      children.forEach((child, index) => {
        if (index > 0) newline();
        block(child, index === 0 ? prefix : '');
      });
      return;
    }
    if (Array.isArray(record['content'])) {
      record['content'].forEach((child, index) => {
        if (index > 0) newline();
        block(child);
      });
    }
  };
  block(snapshot.doc);
  return lines.length ? lines : [[{ text: fallback, marks: [] }]];
}

function measureRunText(text: string, marks: readonly Record<string, unknown>[], fontName: string, fontSize: number): number {
  const markTypes = new Set(marks.map(mark => mark['type']));
  const family = markTypes.has('code') ? FONT_FAMILIES.mono : fontName;
  const weight = markTypes.has('bold') ? '700 ' : '';
  const style = markTypes.has('italic') ? 'italic ' : '';
  const ctx = getMeasurementContext();
  if (!ctx) return text.length * fontSize * (markTypes.has('bold') ? 0.63 : 0.6);
  ctx.font = `${style}${weight}${fontSize}px ${family}`;
  return ctx.measureText(text).width;
}

function charsToRuns(chars: readonly SvgTextChar[]): SvgTextRun[] {
  const runs: SvgTextRun[] = [];
  for (const item of chars) {
    const previous = runs[runs.length - 1];
    if (previous?.marks === item.marks) previous.text += item.char;
    else runs.push({ text: item.char, marks: item.marks });
  }
  return runs;
}

function wrapRichTextRuns(
  lines: readonly SvgTextRun[][],
  maxWidth: number,
  fontName: string,
  fontSize: number,
): SvgTextRun[][] {
  const wrapped: SvgTextRun[][] = [];
  for (const line of lines) {
    let remaining: SvgTextChar[] = line.flatMap(run =>
      Array.from(run.text, char => ({ char, marks: run.marks })),
    );
    if (remaining.length === 0) {
      wrapped.push([]);
      continue;
    }
    while (remaining.length > 0) {
      let fit = 0;
      let width = 0;
      let lastWhitespace = -1;
      for (let index = 0; index < remaining.length; index += 1) {
        const item = remaining[index]!;
        const nextWidth = width + measureRunText(item.char, item.marks, fontName, fontSize);
        if (index > 0 && nextWidth > maxWidth) break;
        width = nextWidth;
        fit = index + 1;
        if (/\s/.test(item.char)) lastWhitespace = index;
      }
      const breakAt = fit < remaining.length && lastWhitespace > 0 ? lastWhitespace : Math.max(1, fit);
      const segment = remaining.slice(0, breakAt);
      wrapped.push(charsToRuns(segment));
      remaining = remaining.slice(breakAt);
      while (remaining[0] && /\s/.test(remaining[0].char)) remaining.shift();
    }
  }
  return wrapped;
}

const richTextValidator: Validator<CanvasRichTextSnapshot | undefined> = {
  validate(value: unknown) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('richText must be an object');
    const record = value as Record<string, unknown>;
    if (
      record.format !== 'beskar-canvas-rich-text'
      || record.version !== 1
      || record.profile !== 'text'
      || !record.doc
      || typeof record.doc !== 'object'
      || Array.isArray(record.doc)
    ) throw new Error('richText must use the supported canvas text schema');
    return value as CanvasRichTextSnapshot;
  },
};

const sizeModeValidator: Validator<TextSizeMode> = {
  validate(value: unknown) {
    if (value !== 'auto' && value !== 'fixed-width' && value !== 'fixed') {
      throw new Error('sizeMode must be auto|fixed-width|fixed');
    }
    return value;
  },
};

const positiveNumber: Validator<number> = {
  validate(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error('Expected a positive finite number');
    }
    return value;
  },
};

export class TextUtil extends ShapeUtil<TextShape> {
  static override readonly type = 'text';

  static override readonly props = {
    text:     T.string,
    fontSize: StyleValidators.fontSize,
    color:    T.string,
    opacity:  T.number,
    font:     StyleValidators.font,
    richText: richTextValidator,
    w: positiveNumber,
    h: positiveNumber,
    sizeMode: sizeModeValidator,
    textAlign: StyleValidators.textAlign,
    lineHeight: positiveNumber,
    scale: positiveNumber,
  };

  static override readonly migrations = defineMigrations({
    currentVersion: 6,
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
      4: {
        up: r => {
          const props = r['props'] as Record<string, unknown>;
          const text = typeof props['text'] === 'string' ? props['text'] : '';
          const fontSize = FONT_SIZES[(props['fontSize'] as FontSize) ?? 'md'] ?? FONT_SIZES.md;
          const font = FONT_FAMILIES[(props['font'] as Font) ?? 'sans'] ?? FONT_FAMILIES.sans;
          const bounds = estimateBounds(text, fontSize, font);
          return {
            ...r,
            props: {
              ...props,
              richText: props['richText'] ?? legacyRichText(text),
              w: typeof props['w'] === 'number' && props['w'] > 0 ? props['w'] : bounds.w,
              h: typeof props['h'] === 'number' && props['h'] > 0 ? props['h'] : bounds.h,
              sizeMode: typeof props['w'] === 'number' ? 'fixed-width' : 'auto',
              textAlign: props['textAlign'] ?? 'left',
              lineHeight: typeof props['lineHeight'] === 'number' ? props['lineHeight'] : 1.35,
            },
          };
        },
        down: r => {
          const props = { ...(r['props'] as Record<string, unknown>) };
          const wasAuto = props['sizeMode'] === 'auto';
          delete props['richText'];
          delete props['h'];
          delete props['sizeMode'];
          delete props['textAlign'];
          delete props['lineHeight'];
          if (wasAuto) delete props['w'];
          return { ...r, props };
        },
      },
      5: {
        up: r => {
          const props = r['props'] as Record<string, unknown>;
          const text = typeof props['text'] === 'string' ? props['text'] : '';
          const fontSize = FONT_SIZES[(props['fontSize'] as FontSize) ?? 'md'] ?? FONT_SIZES.md;
          const font = FONT_FAMILIES[(props['font'] as Font) ?? 'sans'] ?? FONT_FAMILIES.sans;
          const scale = typeof props['scale'] === 'number' && props['scale'] > 0 ? props['scale'] : 1;
          const bounds = estimateBounds(text, fontSize * scale, font);
          return {
            ...r,
            props: {
              ...props,
              scale,
              sizeMode: 'auto',
              w: bounds.w,
              h: bounds.h,
            },
          };
        },
        down: r => {
          const props = { ...(r['props'] as Record<string, unknown>) };
          delete props['scale'];
          return { ...r, props };
        },
      },
      6: {
        up: r => ({
          ...r,
          props: { ...(r['props'] as object), opacity: 1 },
        }),
        down: r => {
          const props = { ...(r['props'] as Record<string, unknown>) };
          delete props['opacity'];
          return { ...r, props };
        },
      },
    },
  });

  getDefaultProps(): TextProps {
    return {
      text: '',
      richText: legacyRichText(''),
      w: 10,
      h: FONT_SIZES.md * 1.35,
      sizeMode: 'auto',
      fontSize: 'md',
      color: 'black',
      opacity: 1,
      font: 'sans',
      textAlign: 'left',
      lineHeight: 1.35,
      scale: 1,
    };
  }

  getGeometry(shape: TextShape): Geometry2d {
    return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
  }

  override onResize(shape: TextShape, info: ResizeInfo<TextShape>): Partial<TextShape> {
    const base = super.onResize(shape, info) as Partial<TextShape>;
    const scaleXDelta = Math.abs(info.scaleX - 1);
    const scaleYDelta = Math.abs(info.scaleY - 1);
    const resizeScale = scaleXDelta >= scaleYDelta ? info.scaleX : info.scaleY;
    return {
      ...base,
      props: {
        ...(base.props as TextProps),
        w: Math.max(1, shape.props.w * resizeScale),
        h: Math.max(1, shape.props.h * resizeScale),
        sizeMode: 'auto',
        scale: Math.max(0.05, (shape.props.scale ?? 1) * resizeScale),
      },
    };
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
      fontSize:      fontSizeNum * (shape.props.scale ?? 1),
      color:         resolveColor(shape.props.color),
      verticalAlign: 'top',
      padding:       0,
      w: shape.props.w,
      h: shape.props.h,
      textAlign: shape.props.textAlign,
      lineHeight: shape.props.lineHeight,
    };
  }

  override getRichTextDescriptor(shape: TextShape): RichTextDescriptor | null {
    return {
      value: shape.props.richText ?? legacyRichText(shape.props.text),
      fallbackText: shape.props.text,
      w: shape.props.w,
      h: shape.props.h,
      sizeMode: shape.props.sizeMode,
      fontFamily: FONT_FAMILIES[shape.props.font] ?? FONT_FAMILIES.sans,
      fontSize: (FONT_SIZES[shape.props.fontSize] ?? FONT_SIZES.md) * (shape.props.scale ?? 1),
      color: resolveColor(shape.props.color),
      textAlign: shape.props.textAlign,
      lineHeight: shape.props.lineHeight,
    };
  }

  override getTextCommitPatch(
    _latestShape: TextShape,
    draft: string,
    pendingProps?: Readonly<Record<string, unknown>>,
  ): Partial<TextShape> {
    return {
      props: {
        text: draft,
        ...(pendingProps?.['richText'] ? { richText: pendingProps['richText'] } : {}),
        ...(typeof pendingProps?.['w'] === 'number' ? { w: Math.max(1, pendingProps['w']) } : {}),
        ...(typeof pendingProps?.['h'] === 'number' ? { h: Math.max(1, pendingProps['h']) } : {}),
        ...(pendingProps?.['sizeMode'] ? { sizeMode: pendingProps['sizeMode'] } : {}),
      },
    } as Partial<TextShape>;
  }

  /** Full SVG export using deterministic text/tspan runs. */
  override toSvgExport(shape: TextShape): SVGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (shape.props.opacity < 1) g.setAttribute('opacity', String(shape.props.opacity));
    const fontName = FONT_FAMILIES[shape.props.font] ?? FONT_FAMILIES.sans;
    const fontSize = (FONT_SIZES[shape.props.fontSize] ?? FONT_SIZES.md) * (shape.props.scale ?? 1);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    const x = shape.props.textAlign === 'left' ? 0 : shape.props.textAlign === 'center' ? shape.props.w / 2 : shape.props.w;
    text.setAttribute('x', String(x));
    text.setAttribute('y', '0');
    text.setAttribute('font-family', fontName);
    text.setAttribute('font-size', String(fontSize));
    text.setAttribute('fill', resolveColor(shape.props.color));
    text.setAttribute('dominant-baseline', 'hanging');
    text.setAttribute('text-anchor', shape.props.textAlign === 'left' ? 'start' : shape.props.textAlign === 'center' ? 'middle' : 'end');
    const sourceRuns = richTextRuns(shape.props.richText, shape.props.text);
    const exportRuns = shape.props.sizeMode === 'auto'
      ? sourceRuns
      : wrapRichTextRuns(sourceRuns, shape.props.w, fontName, fontSize);
    exportRuns.forEach((line, index) => {
      const lineElement = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      lineElement.setAttribute('x', String(x));
      lineElement.setAttribute('dy', index === 0 ? '0' : String(fontSize * shape.props.lineHeight));
      if (line.length === 0) lineElement.textContent = ' ';
      line.forEach(run => {
        const runElement = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        const markTypes = new Set(run.marks.map(mark => mark['type']));
        if (markTypes.has('bold')) runElement.setAttribute('font-weight', '700');
        if (markTypes.has('italic')) runElement.setAttribute('font-style', 'italic');
        if (markTypes.has('code')) runElement.setAttribute('font-family', FONT_FAMILIES.mono);
        if (markTypes.has('link')) runElement.setAttribute('text-decoration', 'underline');
        const highlight = run.marks.find(mark => mark['type'] === 'highlight');
        if (highlight) {
          const attrs = highlight['attrs'] as Record<string, unknown> | undefined;
          runElement.setAttribute('paint-order', 'stroke');
          runElement.setAttribute('stroke', typeof attrs?.['color'] === 'string' ? attrs['color'] : '#fff3a3');
          runElement.setAttribute('stroke-width', String(fontSize * 0.75));
          runElement.setAttribute('stroke-linejoin', 'round');
        }
        runElement.textContent = run.text;
        lineElement.appendChild(runElement);
      });
      text.appendChild(lineElement);
    });
    g.appendChild(text);
    return g;
  }
}
