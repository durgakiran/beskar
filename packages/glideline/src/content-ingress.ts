import type { AnyRecord, GlideAsset } from './types.js';
import { aid } from './types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const MAX_SVG_BYTES = 1024 * 1024;
const MAX_SVG_ELEMENTS = 2_000;
const MAX_SVG_DEPTH = 32;
const MAX_PATH_BYTES = 256 * 1024;
const MAX_PATH_COMMANDS = 20_000;
const MAX_COORDINATE = 1_000_000;
const MAX_PASTE_BYTES = 1024 * 1024;
const MAX_RASTER_BYTES = 20 * 1024 * 1024;
const MAX_RASTER_DIMENSION = 16_384;
const MAX_RASTER_PIXELS = 64_000_000;

const SAFE_PAINT = /^(?:none|currentColor|#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+(?:\.\d+)?%?(?:\s*,\s*\d+(?:\.\d+)?%?){2}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|[a-zA-Z]+)$/;
const PATH_TOKEN = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
const PATH_SEPARATORS = /^[\s,]*$/;
const SAFE_PATH_ATTRIBUTES = new Set([
  'd', 'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity',
  'stroke-opacity', 'fill-rule', 'stroke-linecap', 'stroke-linejoin',
]);
const SAFE_CONTAINER_ATTRIBUTES = new Set([
  'xmlns', 'viewBox', 'width', 'height',
  // Accessibility metadata is inert and is not copied into the sanitized path model.
  'role', 'aria-label', 'aria-hidden', 'focusable',
  // Common exporter metadata is also discarded after validation.
  'class', 'id', 'preserveAspectRatio', 'version',
]);

export interface SanitizedSvgPath {
  readonly d: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly fillOpacity?: number;
  readonly strokeOpacity?: number;
  readonly fillRule?: 'nonzero' | 'evenodd';
  readonly strokeLinecap?: 'butt' | 'round' | 'square';
  readonly strokeLinejoin?: 'miter' | 'round' | 'bevel';
}

type MutableSanitizedSvgPath = {
  -readonly [Key in keyof SanitizedSvgPath]: SanitizedSvgPath[Key];
};

export interface SanitizedSvg {
  readonly viewBox: readonly [number, number, number, number];
  readonly width: number;
  readonly height: number;
  readonly paths: readonly SanitizedSvgPath[];
}

export interface SanitizedSvgAssetProps extends Record<string, unknown> {
  readonly hash: string;
  readonly mimeType: 'image/svg+xml';
  readonly sanitizerVersion: 1;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly viewBox: readonly [number, number, number, number];
  readonly paths: readonly SanitizedSvgPath[];
}

export interface AssetProvenance {
  readonly ownerId?: string;
  readonly source?: string;
  readonly license?: string;
  readonly createdAt?: string;
}

export interface PreparedSanitizedSvgAsset {
  readonly asset: GlideAsset;
  readonly canonical: string;
}

export interface RasterMetadata {
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly width: number;
  readonly height: number;
}

export interface PreparedRasterAsset {
  readonly asset: GlideAsset;
  readonly bytes: Uint8Array;
}

export class ContentIngressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentIngressError';
  }
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertFiniteRange(value: number, label: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new ContentIngressError(`${label} is outside the supported coordinate range`);
  }
  return value;
}

function parseBoundedNumber(value: string, label: string): number {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    throw new ContentIngressError(`${label} must be a plain number`);
  }
  return assertFiniteRange(Number(value), label);
}

function parseUnitInterval(value: string, label: string): number {
  const parsed = parseBoundedNumber(value, label);
  if (parsed < 0 || parsed > 1) throw new ContentIngressError(`${label} must be between 0 and 1`);
  return parsed;
}

function canonicalNumber(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

function sanitizePathData(source: string): string {
  if (utf8Bytes(source) > MAX_PATH_BYTES) throw new ContentIngressError('SVG path exceeds the byte limit');
  const tokens: string[] = [];
  let cursor = 0;
  let commands = 0;
  for (const match of source.matchAll(PATH_TOKEN)) {
    if (tokens.length >= MAX_PATH_COMMANDS) {
      throw new ContentIngressError('SVG path exceeds the command/parameter limit');
    }
    if (!PATH_SEPARATORS.test(source.slice(cursor, match.index))) {
      throw new ContentIngressError('SVG path contains unsupported syntax');
    }
    const token = match[0];
    if (/^[A-Za-z]$/.test(token)) {
      commands += 1;
      if (commands > MAX_PATH_COMMANDS) throw new ContentIngressError('SVG path exceeds the command limit');
      tokens.push(token);
    } else {
      tokens.push(canonicalNumber(assertFiniteRange(Number(token), 'SVG path coordinate')));
    }
    cursor = (match.index ?? 0) + token.length;
  }
  if (!PATH_SEPARATORS.test(source.slice(cursor)) || tokens.length === 0 || !/^[Mm]$/.test(tokens[0]!)) {
    throw new ContentIngressError('SVG path is malformed');
  }
  return tokens.join(' ');
}

function readPaint(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name);
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (!SAFE_PAINT.test(trimmed) || /url\s*\(/i.test(trimmed)) {
    throw new ContentIngressError(`SVG ${name} contains an unsafe paint value`);
  }
  return trimmed;
}

function parseViewBox(root: Element): readonly [number, number, number, number] {
  const raw = root.getAttribute('viewBox');
  if (raw) {
    const values = raw.trim().split(/[\s,]+/).map((value, index) => parseBoundedNumber(value, `viewBox[${index}]`));
    if (values.length !== 4 || values[2]! <= 0 || values[3]! <= 0) {
      throw new ContentIngressError('SVG viewBox must contain four numbers with positive dimensions');
    }
    return [values[0]!, values[1]!, values[2]!, values[3]!];
  }
  const width = root.getAttribute('width');
  const height = root.getAttribute('height');
  if (!width || !height) throw new ContentIngressError('SVG requires a viewBox or numeric width and height');
  const w = parseBoundedNumber(width, 'SVG width');
  const h = parseBoundedNumber(height, 'SVG height');
  if (w <= 0 || h <= 0) throw new ContentIngressError('SVG dimensions must be positive');
  return [0, 0, w, h];
}

function rejectUnsafeAttribute(attribute: Attr, allowed: ReadonlySet<string>): void {
  const isSvgNamespaceDeclaration = attribute.name === 'xmlns' && attribute.value === SVG_NS;
  const isXlinkNamespaceDeclaration = attribute.name === 'xmlns:xlink' && attribute.value === XLINK_NS;
  if (isSvgNamespaceDeclaration || isXlinkNamespaceDeclaration) return;
  if (
    attribute.namespaceURI
    || /^on/i.test(attribute.name)
    || !allowed.has(attribute.name)
    || /(?:url\s*\(|javascript:|data:|https?:|file:)/i.test(attribute.value)
  ) {
    throw new ContentIngressError(`Unsupported or unsafe SVG attribute "${attribute.name}"`);
  }
}

/** Convert an active SVG document into a small, inert, engine-owned path model. */
export function sanitizeSvg(source: string): SanitizedSvg {
  if (utf8Bytes(source) > MAX_SVG_BYTES) throw new ContentIngressError('SVG exceeds the byte limit');
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new ContentIngressError('SVG DTDs and entities are not supported');
  if (typeof DOMParser === 'undefined') throw new ContentIngressError('SVG parsing is unavailable in this environment');

  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror')) throw new ContentIngressError('SVG is malformed');
  const root = document.documentElement;
  if (root.namespaceURI !== SVG_NS || root.localName !== 'svg') {
    throw new ContentIngressError('Input is not an SVG document');
  }

  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  if (all.length > MAX_SVG_ELEMENTS) throw new ContentIngressError('SVG exceeds the element limit');
  const paths: SanitizedSvgPath[] = [];
  for (const element of all) {
    let depth = 0;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) depth += 1;
    if (depth > MAX_SVG_DEPTH) throw new ContentIngressError('SVG exceeds the nesting limit');
    if (element.namespaceURI !== SVG_NS) throw new ContentIngressError('Unsupported SVG namespace');

    if (element === root) {
      for (const attribute of Array.from(element.attributes)) rejectUnsafeAttribute(attribute, SAFE_CONTAINER_ATTRIBUTES);
      continue;
    }
    if (element.localName === 'g') {
      if (element.attributes.length > 0) throw new ContentIngressError('SVG groups with attributes are not supported');
      continue;
    }
    if (element.localName !== 'path') throw new ContentIngressError(`Unsupported SVG element <${element.localName}>`);
    for (const attribute of Array.from(element.attributes)) rejectUnsafeAttribute(attribute, SAFE_PATH_ATTRIBUTES);

    const path: MutableSanitizedSvgPath = { d: sanitizePathData(element.getAttribute('d') ?? '') };
    const fill = readPaint(element, 'fill');
    const stroke = readPaint(element, 'stroke');
    if (fill !== undefined) path.fill = fill;
    if (stroke !== undefined) path.stroke = stroke;
    const numberAttributes = [
      ['stroke-width', 'strokeWidth', false],
      ['opacity', 'opacity', true],
      ['fill-opacity', 'fillOpacity', true],
      ['stroke-opacity', 'strokeOpacity', true],
    ] as const;
    for (const [attribute, property, interval] of numberAttributes) {
      const raw = element.getAttribute(attribute);
      if (raw !== null) path[property] = interval
        ? parseUnitInterval(raw, attribute)
        : parseBoundedNumber(raw, attribute);
    }
    const fillRule = element.getAttribute('fill-rule');
    if (fillRule !== null) {
      if (fillRule !== 'nonzero' && fillRule !== 'evenodd') throw new ContentIngressError('Unsupported fill-rule');
      path.fillRule = fillRule;
    }
    const linecap = element.getAttribute('stroke-linecap');
    if (linecap !== null) {
      if (linecap !== 'butt' && linecap !== 'round' && linecap !== 'square') throw new ContentIngressError('Unsupported stroke-linecap');
      path.strokeLinecap = linecap;
    }
    const linejoin = element.getAttribute('stroke-linejoin');
    if (linejoin !== null) {
      if (linejoin !== 'miter' && linejoin !== 'round' && linejoin !== 'bevel') throw new ContentIngressError('Unsupported stroke-linejoin');
      path.strokeLinejoin = linejoin;
    }
    paths.push(Object.freeze(path));
  }
  if (paths.length === 0) throw new ContentIngressError('SVG contains no supported paths');
  const viewBox = parseViewBox(root);
  return Object.freeze({
    viewBox,
    width: viewBox[2],
    height: viewBox[3],
    paths: Object.freeze(paths),
  });
}

async function sha256(value: string | Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new ContentIngressError('SHA-256 is unavailable in this environment');
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput.buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeProvenance(provenance: AssetProvenance): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(provenance)) {
    if (typeof value !== 'string') continue;
    if (value.length > 2048) throw new ContentIngressError(`Asset ${key} metadata is too long`);
    metadata[key] = value;
  }
  return metadata;
}

export async function createSanitizedSvgAsset(
  source: string,
  provenance: AssetProvenance = {},
): Promise<PreparedSanitizedSvgAsset> {
  const sanitized = sanitizeSvg(source);
  const canonical = JSON.stringify(sanitized);
  const hash = await sha256(canonical);
  const props: SanitizedSvgAssetProps = {
    hash,
    mimeType: 'image/svg+xml',
    sanitizerVersion: 1,
    byteLength: utf8Bytes(canonical),
    width: sanitized.width,
    height: sanitized.height,
    viewBox: sanitized.viewBox,
    paths: sanitized.paths,
  };
  return {
    canonical,
    asset: {
      id: aid(`asset:sha256:${hash}`),
      kind: 'asset',
      type: 'sanitized-svg',
      schemaVersion: 1,
      props,
      meta: safeProvenance(provenance),
    },
  };
}

/** Rich HTML is deliberately reduced to plain text until a structured rich-text model exists. */
export function normalizeClipboardText(input: { html?: string; text?: string }): string {
  const html = input.html ?? '';
  const text = input.text ?? '';
  if (utf8Bytes(html) > MAX_PASTE_BYTES || utf8Bytes(text) > MAX_PASTE_BYTES) {
    throw new ContentIngressError('Clipboard content exceeds the byte limit');
  }
  if (!html) return text.replace(/\r\n?/g, '\n');
  if (typeof DOMParser === 'undefined') throw new ContentIngressError('HTML parsing is unavailable in this environment');
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const node of Array.from(document.querySelectorAll(
    'script,style,link,meta,iframe,object,embed,img,svg,math,video,audio,source,form',
  ))) node.remove();
  const blocks = new Set(['P', 'DIV', 'BR', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const output: string[] = [];
  let nodeCount = 0;
  const visit = (node: Node, depth: number): void => {
    nodeCount += 1;
    if (nodeCount > MAX_SVG_ELEMENTS) throw new ContentIngressError('Clipboard HTML exceeds the node limit');
    if (depth > MAX_SVG_DEPTH) throw new ContentIngressError('Clipboard HTML exceeds the nesting limit');
    if (node.nodeType === Node.TEXT_NODE) output.push(node.textContent ?? '');
    for (const child of Array.from(node.childNodes)) visit(child, depth + 1);
    if (node instanceof Element && blocks.has(node.tagName)) output.push('\n');
  };
  visit(document.body, 0);
  return output.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function readRasterMetadata(bytes: Uint8Array): RasterMetadata {
  if (bytes.length < 24) throw new ContentIngressError('Raster image is truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    && String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR'
  ) {
    return { mimeType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!;
      const length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { mimeType: 'image/jpeg', height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  if (
    bytes.length >= 30
    &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    && String.fromCharCode(...bytes.slice(12, 16)) === 'VP8X'
  ) {
    const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
    const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    return { mimeType: 'image/webp', width, height };
  }
  throw new ContentIngressError('Unsupported or mismatched raster image format');
}

export async function prepareRasterAsset(
  input: Uint8Array,
  declaredMimeType?: string,
  provenance: AssetProvenance = {},
): Promise<PreparedRasterAsset> {
  if (input.byteLength > MAX_RASTER_BYTES) throw new ContentIngressError('Raster image exceeds the encoded byte limit');
  const bytes = new Uint8Array(input);
  const metadata = readRasterMetadata(bytes);
  if (declaredMimeType && declaredMimeType !== metadata.mimeType) {
    throw new ContentIngressError('Raster MIME type does not match its encoded bytes');
  }
  if (
    metadata.width <= 0 || metadata.height <= 0
    || metadata.width > MAX_RASTER_DIMENSION || metadata.height > MAX_RASTER_DIMENSION
    || metadata.width * metadata.height > MAX_RASTER_PIXELS
  ) throw new ContentIngressError('Raster image exceeds decoded dimension or pixel limits');
  const hash = await sha256(bytes);
  return {
    bytes,
    asset: {
      id: aid(`asset:sha256:${hash}`),
      kind: 'asset',
      type: 'raster-image',
      schemaVersion: 1,
      props: {
        hash,
        mimeType: metadata.mimeType,
        byteLength: bytes.byteLength,
        width: metadata.width,
        height: metadata.height,
      },
      meta: safeProvenance(provenance),
    },
  };
}

const FORBIDDEN_ASSET_KEYS = /^(?:src|url|href|html|svg|data|bytes|sourceUrl)$/i;
const SANITIZED_SVG_PROP_KEYS = new Set([
  'hash', 'mimeType', 'sanitizerVersion', 'byteLength', 'width', 'height', 'viewBox', 'paths',
]);
const SANITIZED_PATH_KEYS = new Set([
  'd', 'fill', 'stroke', 'strokeWidth', 'opacity', 'fillOpacity', 'strokeOpacity',
  'fillRule', 'strokeLinecap', 'strokeLinejoin',
]);
const RASTER_PROP_KEYS = new Set(['hash', 'mimeType', 'byteLength', 'width', 'height']);

function assertOnlyKeys(value: AnyRecord, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ContentIngressError(`${label} property "${key}" is not allowed`);
  }
}

function validateCanonicalPath(value: AnyRecord): void {
  assertOnlyKeys(value, SANITIZED_PATH_KEYS, 'sanitized SVG path');
  if (typeof value['d'] !== 'string') throw new ContentIngressError('sanitized SVG path is malformed');
  sanitizePathData(value['d']);
  for (const key of ['fill', 'stroke'] as const) {
    const paint = value[key];
    if (paint !== undefined && (
      typeof paint !== 'string' || !SAFE_PAINT.test(paint) || /url\s*\(/i.test(paint)
    )) throw new ContentIngressError(`sanitized SVG ${key} is unsafe`);
  }
  for (const key of ['strokeWidth', 'opacity', 'fillOpacity', 'strokeOpacity'] as const) {
    const number = value[key];
    if (number === undefined) continue;
    if (typeof number !== 'number') throw new ContentIngressError(`sanitized SVG ${key} must be numeric`);
    assertFiniteRange(number, key);
    if (key !== 'strokeWidth' && (number < 0 || number > 1)) {
      throw new ContentIngressError(`sanitized SVG ${key} must be between 0 and 1`);
    }
  }
  if (value['fillRule'] !== undefined && !['nonzero', 'evenodd'].includes(String(value['fillRule']))) {
    throw new ContentIngressError('sanitized SVG fillRule is invalid');
  }
  if (value['strokeLinecap'] !== undefined && !['butt', 'round', 'square'].includes(String(value['strokeLinecap']))) {
    throw new ContentIngressError('sanitized SVG strokeLinecap is invalid');
  }
  if (value['strokeLinejoin'] !== undefined && !['miter', 'round', 'bevel'].includes(String(value['strokeLinejoin']))) {
    throw new ContentIngressError('sanitized SVG strokeLinejoin is invalid');
  }
}

/** Store boundary: asset records may contain identity/metadata, never executable content or URLs. */
export function validateAssetRecord(record: AnyRecord): void {
  const rawProps = record['props'];
  if (!rawProps || typeof rawProps !== 'object' || Array.isArray(rawProps)) {
    throw new ContentIngressError('asset props must be a plain object');
  }
  const props = rawProps as AnyRecord;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_ASSET_KEYS.test(key)) throw new ContentIngressError(`asset property "${key}" is not allowed`);
      visit(child);
    }
  };
  visit(props);
  if (record['type'] === 'sanitized-svg') {
    assertOnlyKeys(props, SANITIZED_SVG_PROP_KEYS, 'sanitized SVG asset');
    if (
      typeof props['hash'] !== 'string' || !/^[a-f0-9]{64}$/.test(props['hash'])
      || props['mimeType'] !== 'image/svg+xml'
      || props['sanitizerVersion'] !== 1
      || !Array.isArray(props['viewBox'])
      || !Array.isArray(props['paths'])
      || typeof props['width'] !== 'number' || typeof props['height'] !== 'number'
      || !Number.isInteger(props['byteLength'])
    ) throw new ContentIngressError('sanitized SVG asset is malformed');
    if (
      props['viewBox'].length !== 4
      || !(props['viewBox'] as unknown[]).every(value => typeof value === 'number' && Number.isFinite(value))
      || props['viewBox'][2] <= 0 || props['viewBox'][3] <= 0
      || props['width'] <= 0 || props['height'] <= 0
      || props['paths'].length > MAX_SVG_ELEMENTS
      || (props['byteLength'] as number) < 0 || (props['byteLength'] as number) > MAX_SVG_BYTES
    ) throw new ContentIngressError('sanitized SVG asset exceeds geometry or complexity limits');
    for (const path of props['paths']) {
      if (!path || typeof path !== 'object' || Array.isArray(path)) {
        throw new ContentIngressError('sanitized SVG path is malformed');
      }
      validateCanonicalPath(path as AnyRecord);
    }
  } else if (record['type'] === 'raster-image') {
    assertOnlyKeys(props, RASTER_PROP_KEYS, 'raster image asset');
    if (
      typeof props['hash'] !== 'string' || !/^[a-f0-9]{64}$/.test(props['hash'])
      || !['image/png', 'image/jpeg', 'image/webp'].includes(String(props['mimeType']))
      || !Number.isInteger(props['width']) || !Number.isInteger(props['height'])
      || !Number.isInteger(props['byteLength'])
    ) throw new ContentIngressError('raster image asset is malformed');
    if (
      (props['width'] as number) <= 0 || (props['height'] as number) <= 0
      || (props['width'] as number) > MAX_RASTER_DIMENSION
      || (props['height'] as number) > MAX_RASTER_DIMENSION
      || (props['width'] as number) * (props['height'] as number) > MAX_RASTER_PIXELS
      || (props['byteLength'] as number) < 0 || (props['byteLength'] as number) > MAX_RASTER_BYTES
    ) throw new ContentIngressError('raster image asset exceeds dimension or size limits');
  }
}
