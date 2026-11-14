import { boundsAnchors, MIDPOINT } from '../connection-anchors.js';
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
import { makeBox, type GlideShape, type Validator } from '../types.js';
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

interface SvgTextLine {
  runs: SvgTextRun[];
  depth: number;
  marker?: string;
}

function richTextLines(snapshot: CanvasRichTextSnapshot | undefined, fallback: string): SvgTextLine[] {
  if (!snapshot) return fallback.split('\n').map(text => ({ runs: [{ text, marks: [] }], depth: 0 }));
  const lines: SvgTextLine[] = [];
  const children = (node: Record<string, unknown>) =>
    Array.isArray(node.content) ? node.content.filter((child): child is Record<string, unknown> =>
      !!child && typeof child === 'object') : [];
  const paragraph = (node: Record<string, unknown>, depth: number, marker?: string) => {
    let line: SvgTextLine = { depth, runs: [], ...(marker ? { marker } : {}) };
    lines.push(line);
    for (const child of children(node)) {
      if (child.type === 'hardBreak') {
        line = { depth, runs: [] };
        lines.push(line);
      } else if (child.type === 'text' && typeof child.text === 'string') {
        const marks = Array.isArray(child.marks) ? child.marks.filter(mark => !!mark && typeof mark === 'object') : [];
        line.runs.push({ text: child.text, marks });
      }
    }
  };
  const block = (node: Record<string, unknown>, depth = 0): void => {
    if (node.type === 'paragraph') {
      paragraph(node, depth);
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      const start = (node.attrs as { start?: number } | undefined)?.start;
      children(node).forEach((item, index) => {
        const marker = node.type === 'orderedList' ? `${(Number.isFinite(start) ? start! : 1) + index}.`
          : ['•', '◦', '▪'][depth % 3]!;
        children(item).forEach((child, childIndex) => {
          if (child.type === 'paragraph') paragraph(child, depth + 1, childIndex === 0 ? marker : undefined);
          else block(child, depth + 1);
        });
      });
    } else if (node.type === 'doc') {
      children(node).forEach(child => block(child, depth));
    }
  };
  block(snapshot.doc);
  return lines.length ? lines : richTextLines(undefined, fallback);
}

const CODE_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

function measureRunText(text: string, marks: readonly Record<string, unknown>[], fontName: string, fontSize: number): number {
  const markTypes = new Set(marks.map(mark => mark.type));
  const code = markTypes.has('code');
  const padding = code ? fontSize * 0.36 : 0;
  const family = code ? CODE_FONT : fontName;
  const weight = markTypes.has('bold') ? '700 ' : '';
  const style = markTypes.has('italic') ? 'italic ' : '';
  const ctx = getMeasurementContext();
  if (!ctx) return text.length * fontSize * (markTypes.has('bold') ? 0.63 : 0.6) + padding;
  ctx.font = `${style}${weight}${fontSize}px ${family}`;
  return ctx.measureText(text).width + padding;
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
      let runText = '';
      let runWidth = 0;
      let runMarks: SvgTextRun['marks'] | undefined;
      let lastBreak = -1;
      for (let index = 0; index < remaining.length; index += 1) {
        const item = remaining[index]!;
        if (item.marks !== runMarks) {
          runMarks = item.marks;
          runText = '';
          runWidth = 0;
        }
        runText += item.char;
        const measured = measureRunText(runText, item.marks, fontName, fontSize);
        const nextWidth = width - runWidth + measured;
        if (index > 0 && nextWidth > maxWidth) break;
        width = nextWidth;
        runWidth = measured;
        fit = index + 1;
        if (/\s/.test(item.char)) lastBreak = index;
        else if (item.char === '-') lastBreak = index + 1;
      }
      const atWordBoundary = fit < remaining.length && /\s/.test(remaining[fit]!.char);
      const breakAt = !atWordBoundary && fit < remaining.length && lastBreak > 0
        ? lastBreak : Math.max(1, fit);
      const segment = remaining.slice(0, breakAt);
      wrapped.push(charsToRuns(segment));
      remaining = remaining.slice(breakAt);
      while (remaining[0] && /\s/.test(remaining[0].char)) remaining.shift();
    }
  }
  return wrapped;
}

export function wrapPlainTextLines(text: string, width: number, fontName: string, fontSize: number): string[] {
  const lines = text.split('\n').map(line => [{ text: line, marks: [] }]);
  return wrapRichTextRuns(lines, width, fontName, fontSize).map(line => line.map(run => run.text).join(''));
}

function getExportTextLayout(shape: TextShape) {
  const { props } = shape;
  const fontFamily = FONT_FAMILIES[props.font] ?? FONT_FAMILIES.sans;
  const fontSize = (FONT_SIZES[props.fontSize] ?? FONT_SIZES.md) * (props.scale ?? 1);
  const lines = richTextLines(props.richText, props.text).flatMap(line => {
    if (props.sizeMode === 'auto') return [line];
    const width = Math.max(1, props.w - line.depth * fontSize * 1.5);
    return wrapRichTextRuns([line.runs], width, fontFamily, fontSize).map((runs, index) =>
      index === 0 ? { ...line, runs } : { runs, depth: line.depth });
  });
  return { fontFamily, fontSize, lines };
}

function markAttribute(mark: Record<string, unknown>, name: string): string | undefined {
  const value = (mark.attrs as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : undefined;
}

function safeTextLink(value: string | undefined): string | undefined {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href;
  } catch {
    return;
  }
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K, attrs: Record<string, string | number> = {}, text?: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'xml:space') element.setAttributeNS('http://www.w3.org/XML/1998/namespace', key, String(value));
    else element.setAttribute(key, String(value));
  }
  if (text !== undefined) element.textContent = text;
  return element;
}

let labelClipId = 0;

function clipSvgText(content: SVGElement, x: number, y: number, width: number, height: number): SVGElement {
  const id = `glideline-label-clip-${++labelClipId}`;
  const clip = svgElement('clipPath', { id });
  clip.append(svgElement('rect', { x, y, width, height }));
  const group = svgElement('g');
  content.setAttribute('clip-path', `url(#${id})`);
  group.append(clip, content);
  return group;
}

export function createSvgLabel(label: LabelProps, bounds: { w: number; h: number }): SVGElement {
  const x = label.x ?? label.padding;
  const y = label.y ?? label.padding;
  const w = label.w ?? Math.max(0, bounds.w - label.padding * 2);
  const h = label.h ?? Math.max(0, bounds.h - label.padding * 2);
  const lineHeight = label.fontSize * (label.lineHeight ?? 1.35);
  const lines = wrapPlainTextLines(label.text, Math.max(1, w), label.fontFamily, label.fontSize);
  const text = svgElement('text', {
    'font-family': label.fontFamily, 'font-size': label.fontSize, fill: label.color,
    'dominant-baseline': 'central', 'xml:space': 'preserve',
    'text-anchor': label.textAlign === 'center' ? 'middle' : label.textAlign === 'right' ? 'end' : 'start',
  });
  const anchor = x + (label.textAlign === 'center' ? w / 2 : label.textAlign === 'right' ? w : 0);
  const top = y + (label.verticalAlign === 'center' ? (h - lines.length * lineHeight) / 2 : 0);
  lines.forEach((line, index) => {
    text.append(svgElement('tspan', { x: anchor, y: top + (index + 0.5) * lineHeight }, line));
  });
  return lines.length * lineHeight <= h ? text : clipSvgText(text, x, y, w, h);
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

  override getConnectionAnchors() {
    return boundsAnchors(MIDPOINT, false);
  }

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

  override getVisualBounds(shape: TextShape) {
    const bounds = this.getGeometry(shape).getBounds();
    if (shape.props.sizeMode === 'fixed') return bounds;
    const { lines, fontSize } = getExportTextLayout(shape);
    const lineHeight = fontSize * shape.props.lineHeight;
    return makeBox(bounds.x, bounds.y, bounds.w, Math.max(bounds.h, lines.length * lineHeight));
  }

  /** Export editable SVG text, preserving the board's list and inline formatting. */
  override toSvgExport(shape: TextShape): SVGElement {
    const g = svgElement('g');
    if (shape.props.opacity < 1) g.setAttribute('opacity', String(shape.props.opacity));
    const { fontFamily, fontSize, lines } = getExportTextLayout(shape);
    const lineHeight = fontSize * shape.props.lineHeight;
    const text = svgElement('text', {
      'font-family': fontFamily,
      'font-size': fontSize,
      fill: resolveColor(shape.props.color),
      'dominant-baseline': 'central',
      'xml:space': 'preserve',
    });

    lines.forEach(({ runs, depth, marker }, index) => {
      const y = (index + 0.5) * lineHeight;
      const indent = depth * fontSize * 1.5;
      const widths = runs.map(run => measureRunText(run.text, run.marks, fontFamily, fontSize));
      const available = shape.props.w - indent;
      const remaining = Math.max(0, available - widths.reduce((sum, width) => sum + width, 0));
      let x = indent + (shape.props.textAlign === 'right' ? remaining : shape.props.textAlign === 'center' ? remaining / 2 : 0);
      const line = svgElement('tspan', { x, y });
      if (marker) {
        line.append(svgElement('tspan', { x: indent - fontSize * 0.35, 'text-anchor': 'end' }, marker));
      }
      runs.forEach((run, runIndex) => {
        const types = new Set(run.marks.map(mark => mark.type));
        const code = types.has('code');
        const width = widths[runIndex]!;
        if (code) {
          g.append(svgElement('rect', { x, y: y - fontSize / 2, width, height: fontSize, rx: 3, fill: '#000', 'fill-opacity': 0.07 }));
        }
        const highlight = run.marks.find(mark => mark.type === 'highlight');
        if (highlight) {
          const color = markAttribute(highlight, 'color');
          g.append(svgElement('rect', {
            x, y: y - fontSize / 2, width, height: fontSize,
            fill: color && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color) ? color : '#fff3a3',
          }));
        }
        const span = svgElement('tspan', { x: x + (code ? fontSize * 0.18 : 0) }, run.text);
        if (types.has('bold')) span.setAttribute('font-weight', '700');
        if (types.has('italic')) span.setAttribute('font-style', 'italic');
        if (code) span.setAttribute('font-family', CODE_FONT);
        const link = run.marks.find(mark => mark.type === 'link');
        const href = link && safeTextLink(markAttribute(link, 'href'));
        if (href) {
          span.setAttribute('fill', '#175cd3');
          span.setAttribute('text-decoration', 'underline');
          const anchor = svgElement('a', { href, target: '_blank', rel: 'noopener noreferrer' });
          anchor.append(span);
          line.append(anchor);
        } else {
          line.append(span);
        }
        x += width;
      });
      text.append(line);
    });
    g.append(text);
    return shape.props.sizeMode === 'fixed' ? clipSvgText(g, 0, 0, shape.props.w, shape.props.h) : g;
  }
}
