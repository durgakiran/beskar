export const CANVAS_RICH_TEXT_FORMAT = 'beskar-canvas-rich-text' as const;
export const CANVAS_RICH_TEXT_VERSION = 1 as const;

export type CanvasRichTextNodeType =
  | 'doc'
  | 'paragraph'
  | 'bulletList'
  | 'orderedList'
  | 'listItem'
  | 'text'
  | 'hardBreak';

export type CanvasRichTextMarkType = 'bold' | 'italic' | 'code' | 'highlight' | 'link';

export interface CanvasRichTextMark {
  type: CanvasRichTextMarkType;
  attrs?: Record<string, string>;
}

export interface CanvasRichTextNode {
  type: CanvasRichTextNodeType;
  attrs?: Record<string, string | number>;
  content?: CanvasRichTextNode[];
  marks?: CanvasRichTextMark[];
  text?: string;
}

export interface CanvasRichTextDocument {
  format: typeof CANVAS_RICH_TEXT_FORMAT;
  version: typeof CANVAS_RICH_TEXT_VERSION;
  profile: 'text';
  doc: CanvasRichTextNode;
}

export type CanvasTextValue = CanvasRichTextDocument | CanvasRichTextNode;

export interface CanvasRichTextLimits {
  maxDepth?: number;
  maxNodes?: number;
  maxTextLength?: number;
}

export class CanvasRichTextValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanvasRichTextValidationError';
  }
}

const DEFAULT_LIMITS: Required<CanvasRichTextLimits> = {
  maxDepth: 16,
  maxNodes: 10_000,
  maxTextLength: 100_000,
};

const ALLOWED_NODES = new Set<CanvasRichTextNodeType>([
  'doc',
  'paragraph',
  'bulletList',
  'orderedList',
  'listItem',
  'text',
  'hardBreak',
]);
const ALLOWED_MARKS = new Set<CanvasRichTextMarkType>(['bold', 'italic', 'code', 'highlight', 'link']);
const MARK_ORDER: Readonly<Record<CanvasRichTextMarkType, number>> = Object.freeze({
  bold: 0,
  italic: 1,
  code: 2,
  highlight: 3,
  link: 4,
});
const SAFE_HIGHLIGHT = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanvasRichTextValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function normalizeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function normalizeMark(input: unknown): CanvasRichTextMark {
  const mark = asRecord(input, 'Mark');
  if (typeof mark.type !== 'string' || !ALLOWED_MARKS.has(mark.type as CanvasRichTextMarkType)) {
    throw new CanvasRichTextValidationError(`Unsupported mark type: ${String(mark.type)}.`);
  }
  const type = mark.type as CanvasRichTextMarkType;
  if (type === 'link') {
    const attrs = asRecord(mark.attrs, 'Link attributes');
    const href = normalizeExternalUrl(attrs.href);
    if (!href) throw new CanvasRichTextValidationError('Link uses an unsafe or unsupported URL.');
    return { type, attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } };
  }
  if (type === 'highlight') {
    const attrs = mark.attrs && typeof mark.attrs === 'object' && !Array.isArray(mark.attrs)
      ? mark.attrs as Record<string, unknown>
      : {};
    const color = typeof attrs.color === 'string' && SAFE_HIGHLIGHT.test(attrs.color) ? attrs.color : '#fff3a3';
    return { type, attrs: { color } };
  }
  return { type };
}

function normalizeNode(
  input: unknown,
  depth: number,
  state: { nodes: number; textLength: number },
  limits: Required<CanvasRichTextLimits>,
): CanvasRichTextNode {
  if (depth > limits.maxDepth) throw new CanvasRichTextValidationError('Document nesting is too deep.');
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) throw new CanvasRichTextValidationError('Document contains too many nodes.');

  const node = asRecord(input, 'Node');
  if (typeof node.type !== 'string' || !ALLOWED_NODES.has(node.type as CanvasRichTextNodeType)) {
    throw new CanvasRichTextValidationError(`Unsupported node type: ${String(node.type)}.`);
  }
  const type = node.type as CanvasRichTextNodeType;

  if (type === 'text') {
    if (typeof node.text !== 'string') throw new CanvasRichTextValidationError('Text nodes require text.');
    state.textLength += node.text.length;
    if (state.textLength > limits.maxTextLength) throw new CanvasRichTextValidationError('Document text is too long.');
    const marks = Array.isArray(node.marks)
      ? node.marks.map(normalizeMark)
        .sort((left, right) => MARK_ORDER[left.type] - MARK_ORDER[right.type])
        .filter((mark, index, all) => index === 0 || JSON.stringify(mark) !== JSON.stringify(all[index - 1]))
      : undefined;
    return { type, text: node.text, ...(marks?.length ? { marks } : {}) };
  }

  if (type === 'hardBreak') return { type };
  const content = Array.isArray(node.content)
    ? node.content.map(child => normalizeNode(child, depth + 1, state, limits))
    : [];

  if (type === 'doc' && content.some(child => !['paragraph', 'bulletList', 'orderedList'].includes(child.type))) {
    throw new CanvasRichTextValidationError('Document contains an invalid top-level node.');
  }
  if ((type === 'bulletList' || type === 'orderedList') && content.some(child => child.type !== 'listItem')) {
    throw new CanvasRichTextValidationError('Lists may only contain list items.');
  }
  if (type === 'listItem' && content.some(child => !['paragraph', 'bulletList', 'orderedList'].includes(child.type))) {
    throw new CanvasRichTextValidationError('List items contain an invalid child.');
  }
  if (type === 'paragraph' && content.some(child => !['text', 'hardBreak'].includes(child.type))) {
    throw new CanvasRichTextValidationError('Paragraphs may only contain inline content.');
  }

  const attrs = type === 'orderedList' && node.attrs && typeof node.attrs === 'object'
    ? node.attrs as Record<string, unknown>
    : null;
  const start = attrs && Number.isSafeInteger(attrs.start) && Number(attrs.start) > 0
    ? Math.min(Number(attrs.start), 1_000_000)
    : undefined;
  return { type, ...(start ? { attrs: { start } } : {}), ...(content.length ? { content } : {}) };
}

export function normalizeCanvasRichText(
  input: unknown,
  limits: CanvasRichTextLimits = {},
): CanvasRichTextDocument {
  const resolvedLimits = { ...DEFAULT_LIMITS, ...limits };
  const candidate = asRecord(input, 'Canvas rich-text value');
  let rawDoc: unknown = candidate;

  if ('format' in candidate || 'version' in candidate || 'profile' in candidate || 'doc' in candidate) {
    if (candidate.format !== CANVAS_RICH_TEXT_FORMAT || candidate.version !== CANVAS_RICH_TEXT_VERSION || candidate.profile !== 'text') {
      throw new CanvasRichTextValidationError('Unsupported canvas rich-text format, version, or profile.');
    }
    rawDoc = candidate.doc;
  }

  const doc = normalizeNode(rawDoc, 0, { nodes: 0, textLength: 0 }, resolvedLimits);
  if (doc.type !== 'doc') throw new CanvasRichTextValidationError('The root node must be a document.');
  if (!doc.content?.length) doc.content = [{ type: 'paragraph' }];
  return { format: CANVAS_RICH_TEXT_FORMAT, version: CANVAS_RICH_TEXT_VERSION, profile: 'text', doc };
}

export function createCanvasRichTextDocument(text = ''): CanvasRichTextDocument {
  const paragraphs = text.split('\n').map(line => ({
    type: 'paragraph' as const,
    ...(line ? { content: [{ type: 'text' as const, text: line }] } : {}),
  }));
  return normalizeCanvasRichText({
    type: 'doc',
    content: paragraphs,
  });
}

export function serializeCanvasRichText(input: unknown): string {
  return JSON.stringify(normalizeCanvasRichText(input));
}

export function normalizeCanvasRichTextOrFallback(
  input: unknown,
  fallbackText = '',
): CanvasRichTextDocument {
  try {
    return normalizeCanvasRichText(input);
  } catch {
    return createCanvasRichTextDocument(fallbackText);
  }
}

function projectNode(node: CanvasRichTextNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const children = (node.content ?? []).map(projectNode);
  if (node.type === 'doc') return children.join('\n');
  if (node.type === 'paragraph') return children.join('');
  if (node.type === 'listItem') return children.join('\n');
  if (node.type === 'bulletList') return children.map(value => `- ${value}`).join('\n');
  if (node.type === 'orderedList') {
    const start = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
    return children.map((value, index) => `${start + index}. ${value}`).join('\n');
  }
  return '';
}

export function projectCanvasRichTextToPlainText(input: unknown): string {
  return projectNode(normalizeCanvasRichText(input).doc);
}
