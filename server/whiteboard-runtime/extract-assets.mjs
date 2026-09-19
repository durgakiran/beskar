import * as Y from 'yjs';
import { createHash } from 'node:crypto';

// This version describes the inspected record model, not the storage inspector.
// Change it whenever supported record semantics or extraction rules change.
export const assetExtractorVersion = 'glideboard-assets-v1';
const rootNames = ['glideboard-meta', 'glideboard-records', 'glideboard-records-v2', 'glideboard-rich-text-fragments-v1'];
const sharedKeys = new Set(['$generation', '$tombstone', '$opaque']);
const hashPattern = /^[a-f0-9]{64}$/;
const assetError = message => Object.assign(new Error(message), { code: 'assets' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
const finiteCoordinate = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
const rasterProps = new Set(['hash', 'mimeType', 'byteLength', 'width', 'height']);
const recordKeys = new Set(['id', 'kind', 'type', 'schemaVersion', 'props', 'meta']);
const vectorShapes = new Set(['box', 'ellipse', 'freehand', 'arrow', 'text', 'sticky-note', 'frame', 'group',
  'triangle', 'diamond', 'hexagon', 'star', 'rounded-rect', 'parallelogram', 'chevron', 'document', 'cylinder', 'note', 'callout']);
const vectorProps = new Set([...rasterProps, 'sanitizerVersion', 'viewBox', 'paths']);
const pathKeys = ['d', 'fill', 'stroke', 'strokeWidth', 'opacity', 'fillOpacity', 'strokeOpacity', 'fillRule', 'strokeLinecap', 'strokeLinejoin'];
const safePaint = /^(?:none|currentColor|#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+(?:\.\d+)?%?(?:\s*,\s*\d+(?:\.\d+)?%?){2}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|[a-zA-Z]+)$/;
const pathToken = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;

export function initializeAssetRoots(doc) {
  for (const name of rootNames) doc.getMap(name);
}

function onlyKeys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.has(key))) throw assetError('Unsupported asset properties');
}

function canonicalPath(path) {
  onlyKeys(path, new Set(pathKeys));
  if (typeof path.d !== 'string' || Buffer.byteLength(path.d) > 256 * 1024) throw assetError('Unsupported vector path');
  const tokens = []; let cursor = 0;
  for (const match of path.d.matchAll(pathToken)) {
    if (tokens.length >= 20_000 || !/^[\s,]*$/.test(path.d.slice(cursor, match.index))) throw assetError('Unsupported vector path');
    const token = match[0];
    if (/^[A-Za-z]$/.test(token)) tokens.push(token);
    else {
      const number = Number(token);
      if (!finiteCoordinate(number)) throw assetError('Unsupported vector coordinate');
      tokens.push(Object.is(number, -0) ? '0' : String(number));
    }
    cursor = match.index + token.length;
  }
  if (!/^[Mm]$/.test(tokens[0] ?? '') || !/^[\s,]*$/.test(path.d.slice(cursor))) throw assetError('Malformed vector path');
  const result = { d: tokens.join(' ') };
  for (const key of ['fill', 'stroke']) {
    if (path[key] === undefined) continue;
    if (typeof path[key] !== 'string' || !safePaint.test(path[key]) || /url\s*\(/i.test(path[key])) throw assetError('External vector paint');
    result[key] = path[key];
  }
  for (const key of ['strokeWidth', 'opacity', 'fillOpacity', 'strokeOpacity']) {
    if (path[key] === undefined) continue;
    if (!finiteCoordinate(path[key]) || (key !== 'strokeWidth' && (path[key] < 0 || path[key] > 1))) throw assetError('Invalid vector paint');
    result[key] = path[key];
  }
  for (const [key, allowed] of [
    ['fillRule', ['nonzero', 'evenodd']], ['strokeLinecap', ['butt', 'round', 'square']], ['strokeLinejoin', ['miter', 'round', 'bevel']],
  ]) {
    if (path[key] === undefined) continue;
    if (!allowed.includes(path[key])) throw assetError('Invalid vector paint');
    result[key] = path[key];
  }
  return result;
}

function validateVector(props) {
  onlyKeys(props, vectorProps);
  if (props.mimeType !== 'image/svg+xml' || props.sanitizerVersion !== 1
    || !Array.isArray(props.viewBox) || props.viewBox.length !== 4 || !props.viewBox.every(finiteCoordinate)
    || props.viewBox[2] <= 0 || props.viewBox[3] <= 0 || props.width !== props.viewBox[2] || props.height !== props.viewBox[3]
    || !Array.isArray(props.paths) || !props.paths.length || props.paths.length > 2000
    || !positiveInteger(props.byteLength, 1024 * 1024)) throw assetError('Invalid self-contained vector asset');
  const canonical = JSON.stringify({ viewBox: props.viewBox, width: props.width, height: props.height, paths: props.paths.map(canonicalPath) });
  if (Buffer.byteLength(canonical) !== props.byteLength || createHash('sha256').update(canonical).digest('hex') !== props.hash) {
    throw assetError('Vector asset content identity mismatch');
  }
}

// Reference fields are reserved for supported asset shapes. Inert user text and
// hyperlink text remain ordinary strings, including text that mentions an asset ID.
function rejectHiddenReferences(value, depth = 0, budget = { nodes: 0 }) {
  if (depth > 64 || ++budget.nodes > 1_000_000) throw assetError('Asset inspection complexity limit');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(assetId|assetIds|src|imageUrl|sourceUrl|mimeType)$/i.test(key)
      && child != null && child !== '' && !(Array.isArray(child) && child.length === 0)) throw assetError('Unsupported external asset reference');
    if (typeof child === 'string' && (/^(data:image\/|blob:)/i.test(child) || /<image\b/i.test(child))) throw assetError('Unsupported embedded asset reference');
    rejectHiddenReferences(child, depth + 1, budget);
  }
}

function sharedValue(value, depth = 0, budget = { nodes: 0 }) {
  if (depth > 64 || ++budget.nodes > 1_000_000) throw assetError('Asset inspection complexity limit');
  if (value instanceof Y.Text) return value.toString();
  if (value instanceof Y.Array) return value.toArray().map(item => sharedValue(item, depth + 1, budget));
  if (value instanceof Y.Map) return Object.fromEntries([...value].filter(([key]) => !sharedKeys.has(key)).map(([key, item]) => [key, sharedValue(item, depth + 1, budget)]));
  if (Array.isArray(value)) return value.map(item => sharedValue(item, depth + 1, budget));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sharedValue(item, depth + 1, budget)]));
  return value;
}

export function extractAssetManifest(doc) {
  for (const name of doc.share.keys()) if (!rootNames.includes(name)) throw assetError('Unsupported document root');
  for (const name of rootNames) if (doc.getMap(name)._start) throw assetError('Expected map document root');
  const metadata = doc.getMap('glideboard-meta');
  if (metadata.has('schemaVersion') && metadata.get('schemaVersion') !== 2) throw assetError('Unsupported collaborative schema');
  const current = doc.getMap('glideboard-records-v2');
  const legacy = doc.getMap('glideboard-records');
  // Tombstones keep the v2 root nonempty. Once adopted, an obsolete legacy map
  // is never an additional live document. An empty adopted root with legacy
  // records is ambiguous: current clients would seed it from the legacy map.
  // Do not certify an empty manifest for bytes that reopen with legacy assets.
  const adopted = current.size > 0 || metadata.get('schemaVersion') === 2 || metadata.get('recordModel') === 'nested-map-tombstone-v1';
  if (adopted && current.size === 0 && legacy.size > 0) throw assetError('Ambiguous legacy record migration');
  const records = adopted ? current : legacy;
  const legacyStoreVersion = metadata.get('documentSchema')?.storeVersion ?? 1;
  if (records.size > 100_000) throw assetError('Too many document records');
  const assets = new Map(), refs = [];
  const budget = { nodes: 0 };
  for (const [id, entry] of records) {
    if (adopted && !(entry instanceof Y.Map)) throw assetError('Unsupported collaborative record');
    if (entry instanceof Y.Map && entry.get('$tombstone') === true) continue;
    // Opaque schemas cannot promise that arbitrary fields are asset-free.
    if (entry instanceof Y.Map && entry.has('$opaque')) throw assetError('Unsupported opaque record');
    const record = sharedValue(entry, 0, budget);
    if (!object(record) || record.id !== id || record.kind === 'opaque' || record.$opaque !== undefined) throw assetError('Unsupported record envelope');
    // GlideSchema's store-v1 migration infers only registered shapes/bindings.
    // Classify those same legacy records without rewriting the snapshot bytes;
    // absent kind is never enough to declare an unknown record asset-free.
    if (!adopted && legacyStoreVersion === 1 && record.kind === undefined) {
      const binding = typeof record.fromId === 'string' && typeof record.toId === 'string';
      if (binding && record.type === 'arrow') record.kind = 'binding';
      else if (!binding && (vectorShapes.has(record.type) || ['raster-image', 'sanitized-svg'].includes(record.type))
        && typeof record.x === 'number' && typeof record.y === 'number' && typeof record.rotation === 'number'
        && typeof record.index === 'string') record.kind = 'shape';
    }
    if (record.kind === 'asset' || String(id).startsWith('asset:')) {
      onlyKeys(record, recordKeys);
      if (record.kind !== 'asset' || record.schemaVersion !== 1 || !object(record.props)
        || !hashPattern.test(record.props.hash) || id !== `asset:sha256:${record.props.hash}`) throw assetError('Invalid asset identity');
      const props = record.props;
      rejectHiddenReferences(record.meta, 0, budget);
      if (record.type === 'raster-image') {
        onlyKeys(props, rasterProps);
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(props.mimeType)
          || !positiveInteger(props.byteLength, 20 * 1024 * 1024) || !positiveInteger(props.width, 16384)
          || !positiveInteger(props.height, 16384) || props.width * props.height > 64_000_000) throw assetError('Invalid raster metadata');
        assets.set(id, { type: record.type, contentHash: props.hash, mimeType: props.mimeType, byteLength: props.byteLength, width: props.width, height: props.height });
      } else if (record.type === 'sanitized-svg') {
        validateVector(props);
        assets.set(id, { type: record.type });
      } else throw assetError('Unsupported asset type');
      if (assets.size > 10_000) throw assetError('Too many document assets');
      continue;
    }
    if (record.kind === 'shape' && ['raster-image', 'sanitized-svg'].includes(record.type)) {
      const props = record.props;
      if (!object(props) || typeof props.assetId !== 'string') throw assetError('Missing shape asset reference');
      refs.push({ id: props.assetId, type: record.type });
      const { assetId: _, ...otherProps } = props;
      rejectHiddenReferences({ ...record, props: otherProps }, 0, budget);
    } else {
      if (!['page', 'shape', 'binding'].includes(record.kind)) throw assetError('Unsupported record kind');
      rejectHiddenReferences(record, 0, budget);
      if ((record.kind === 'shape' && !vectorShapes.has(record.type))
        || (record.kind === 'binding' && record.type !== 'arrow')
        || (record.kind === 'page' && record.type !== 'page')) throw assetError('Unsupported record type');
    }
  }
  for (const ref of refs) if (assets.get(ref.id)?.type !== ref.type) throw assetError('Missing or mismatched shape asset');
  rejectHiddenReferences(doc.getMap('glideboard-rich-text-fragments-v1').toJSON(), 0, budget);
  return {
    assetIds: [...assets.keys()].sort(),
    assets: [...assets.values()].filter(asset => asset.type === 'raster-image').map(({ type: _, ...asset }) => asset)
      .sort((a, b) => a.contentHash.localeCompare(b.contentHash)),
  };
}

export function extractAssets(doc) { return extractAssetManifest(doc).assets; }
