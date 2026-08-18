// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { createEditor } from './editor';
import {
  ContentIngressError,
  createSanitizedSvgAsset,
  normalizeClipboardText,
  prepareRasterAsset,
  sanitizeSvg,
  validateAssetRecord,
} from './content-ingress';
import { RasterImageUtil, assetDimensionValidator, renderMissingAssetPlaceholder } from './shapes/RasterImageUtil';
import { SanitizedAssetPlugin, SanitizedSvgUtil } from './shapes/SanitizedSvgUtil';
import { AssetPlacementPlugin, AssetPlacementTool, type AssetPlacementSelection } from './tools/AssetPlacementTool';
import { aid, type AnyRecord, type GlideAsset, type GlideShape } from './types';

const HASH = 'a'.repeat(64);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><path d="M-0 0L20 10"/></svg>';

function png(width = 2, height = 3): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function jpeg(width = 7, height = 5): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0xff, 0xd8, 0, 0, 0xff, 0xc0, 0, 7, 8, height >> 8, height, width >> 8, width]);
  return bytes;
}

function webp(width = 9, height = 6): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  bytes.set(new TextEncoder().encode('WEBPVP8X'), 8);
  bytes[24] = width - 1;
  bytes[27] = height - 1;
  return bytes;
}

function svgRecord(overrides: Record<string, unknown> = {}): AnyRecord {
  return {
    id: 'asset:svg', kind: 'asset', type: 'sanitized-svg', schemaVersion: 1, meta: {},
    props: {
      hash: HASH, mimeType: 'image/svg+xml', sanitizerVersion: 1, byteLength: 20,
      width: 10, height: 10, viewBox: [0, 0, 10, 10], paths: [{ d: 'M 0 0 L 10 10' }],
      ...overrides,
    },
  };
}

function rasterRecord(overrides: Record<string, unknown> = {}): AnyRecord {
  return {
    id: 'asset:raster', kind: 'asset', type: 'raster-image', schemaVersion: 1, meta: {},
    props: { hash: HASH, mimeType: 'image/png', byteLength: 20, width: 10, height: 10, ...overrides },
  };
}

describe('Phase 3 ingress boundaries', () => {
  it('accepts all canonical path presentation attributes and numeric dimensions', () => {
    const result = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><g><path d="M-0,+0 L20 10" fill="currentColor" stroke="rgba(1, 2, 3, .5)" stroke-width="2" opacity="1" fill-opacity="0" stroke-opacity=".5" fill-rule="evenodd" stroke-linecap="round" stroke-linejoin="bevel"/></g></svg>`);
    expect(result.viewBox).toEqual([0, 0, 20, 10]);
    expect(result.paths[0]).toMatchObject({
      d: 'M 0 0 L 20 10', fill: 'currentColor', strokeWidth: 2, opacity: 1,
      fillOpacity: 0, strokeOpacity: 0.5, fillRule: 'evenodd', strokeLinecap: 'round', strokeLinejoin: 'bevel',
    });
  });

  it.each([
    ['non SVG root', '<html/>'],
    ['no path', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g/></svg>'],
    ['group attribute', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g id="x"><path d="M0 0"/></g></svg>'],
    ['unsupported root attribute', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" tabindex="0"><path d="M0 0"/></svg>'],
    ['path syntax', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0!1"/></svg>'],
    ['empty path', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path/></svg>'],
    ['wrong first command', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="L0 1"/></svg>'],
    ['bad number', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="zero 0 1 1"><path d="M0 0"/></svg>'],
    ['short viewbox', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1"><path d="M0 0"/></svg>'],
    ['negative viewbox', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -1 1"><path d="M0 0"/></svg>'],
    ['missing dimensions', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'],
    ['negative dimensions', '<svg xmlns="http://www.w3.org/2000/svg" width="-1" height="1"><path d="M0 0"/></svg>'],
    ['bad opacity', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0" opacity="2"/></svg>'],
    ['bad fill rule', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0" fill-rule="inherit"/></svg>'],
    ['bad linecap', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0" stroke-linecap="inherit"/></svg>'],
    ['bad linejoin', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0" stroke-linejoin="inherit"/></svg>'],
  ])('rejects malformed SVG boundary: %s', (_label, source) => {
    expect(() => sanitizeSvg(source)).toThrow(ContentIngressError);
  });

  it('enforces SVG size, element count, nesting, and path size limits', () => {
    expect(() => sanitizeSvg(' '.repeat(1024 * 1024 + 1))).toThrow(/byte limit/);
    expect(() => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${'<g/>'.repeat(2000)}<path d="M0 0"/></svg>`)).toThrow(/element limit/);
    expect(() => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${'<g>'.repeat(33)}<path d="M0 0"/>${'</g>'.repeat(33)}</svg>`)).toThrow(/nesting limit/);
    expect(() => sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M${' 0'.repeat(140_000)}"/></svg>`)).toThrow(/path exceeds/);
  });

  it('normalizes plain clipboard text and rejects oversized or deeply nested HTML', () => {
    expect(normalizeClipboardText({ text: 'a\r\nb\rc' })).toBe('a\nb\nc');
    expect(() => normalizeClipboardText({ text: 'x'.repeat(1024 * 1024 + 1) })).toThrow(/byte limit/);
    expect(() => normalizeClipboardText({ html: `${'<div>'.repeat(33)}x${'</div>'.repeat(33)}` })).toThrow(/nesting limit/);
    expect(() => normalizeClipboardText({ html: `<div>${'<span>x</span>'.repeat(2001)}</div>` })).toThrow(/node limit/);
  });

  it('prepares PNG, JPEG, and extended WebP bytes with optional provenance', async () => {
    for (const [bytes, mime, width, height] of [
      [png(), 'image/png', 2, 3], [jpeg(), 'image/jpeg', 7, 5], [webp(), 'image/webp', 9, 6],
    ] as const) {
      const result = await prepareRasterAsset(bytes, undefined, { ownerId: 'owner-1', source: 'picker' });
      expect(result.asset.props).toMatchObject({ mimeType: mime, width, height });
      expect(result.asset.meta).toEqual({ ownerId: 'owner-1', source: 'picker' });
      expect(result.bytes).not.toBe(bytes);
    }
  });

  it.each([
    ['truncated', new Uint8Array(23), /truncated/],
    ['unsupported', new Uint8Array(30), /Unsupported/],
    ['zero width', png(0, 2), /dimension/],
    ['dimension limit', png(16_385, 1), /dimension/],
    ['pixel limit', png(10_000, 10_000), /dimension/],
  ])('rejects raster boundary: %s', async (_label, bytes, message) => {
    await expect(prepareRasterAsset(bytes)).rejects.toThrow(message);
  });

  it('rejects oversized bytes and provenance', async () => {
    await expect(prepareRasterAsset(new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toThrow(/encoded byte limit/);
    await expect(createSanitizedSvgAsset(SVG, { source: 'x'.repeat(2049) })).rejects.toThrow(/metadata is too long/);
  });

  it('strictly validates canonical SVG records and paths', () => {
    expect(() => validateAssetRecord(svgRecord())).not.toThrow();
    const failures = [
      svgRecord({ extra: true }), svgRecord({ hash: 'bad' }), svgRecord({ viewBox: [0, 0, 0, 1] }),
      svgRecord({ paths: [null] }), svgRecord({ paths: [{ d: 3 }] }),
      svgRecord({ paths: [{ d: 'M0 0', extra: true }] }), svgRecord({ paths: [{ d: 'M0 0', fill: 4 }] }),
      svgRecord({ paths: [{ d: 'M0 0', strokeWidth: '2' }] }), svgRecord({ paths: [{ d: 'M0 0', opacity: 2 }] }),
      svgRecord({ paths: [{ d: 'M0 0', fillRule: 'inherit' }] }),
      svgRecord({ paths: [{ d: 'M0 0', strokeLinecap: 'inherit' }] }),
      svgRecord({ paths: [{ d: 'M0 0', strokeLinejoin: 'inherit' }] }),
    ];
    for (const record of failures) expect(() => validateAssetRecord(record)).toThrow(ContentIngressError);
  });

  it('strictly validates raster records and recursive forbidden keys', () => {
    expect(() => validateAssetRecord(rasterRecord())).not.toThrow();
    for (const record of [
      { ...rasterRecord(), props: null }, rasterRecord({ extra: true }), rasterRecord({ hash: 'BAD' }),
      rasterRecord({ mimeType: 'image/gif' }), rasterRecord({ width: 0 }), rasterRecord({ height: 16_385 }),
      rasterRecord({ width: 10_000, height: 10_000 }), rasterRecord({ byteLength: -1 }),
      rasterRecord({ nested: { sourceUrl: 'https://attacker.test' } }),
    ]) expect(() => validateAssetRecord(record as AnyRecord)).toThrow(ContentIngressError);
  });
});

describe('Phase 3 shape and placement edges', () => {
  it('reuses identical canonical assets and rejects immutable-content substitution', () => {
    const editor = createEditor({ plugins: [SanitizedAssetPlugin] });
    const canonical = svgRecord({ hash: HASH });
    canonical.id = `asset:sha256:${HASH}`;
		const first = editor.importRecords([canonical], { idPolicy: 'reject' });
		expect(first).toMatchObject({ importedRecordCount: 1, idMap: { [canonical.id as string]: canonical.id } });
		expect(editor.store.get(canonical.id as string)).toEqual(canonical);
		const replay = editor.importRecords([canonical], { idPolicy: 'reject' });
		expect(replay).toMatchObject({ importedRecordCount: 0, idMap: { [canonical.id as string]: canonical.id } });
    const substituted = structuredClone(canonical);
    (substituted.props as Record<string, unknown>).byteLength = 21;
    expect(() => editor.importRecords([substituted], { idPolicy: 'reject' })).toThrow(/conflicting content/);
  });

  it('validates shape scalar and accessibility edge cases', () => {
    for (const value of [undefined, Number.NaN, 0]) expect(() => assetDimensionValidator.validate(value)).toThrow();
    expect(assetDimensionValidator.validate(1)).toBe(1);
    expect(renderMissingAssetPlaceholder(8, 4).getAttribute('aria-label')).toBe('Missing asset');
    expect(() => RasterImageUtil.props.crop.validate({ x: 0, y: 0, w: 1, h: 1, extra: 1 })).toThrow(/unsupported/);
    expect(() => RasterImageUtil.props.altText.validate(3)).toThrow(/string/);
    expect(() => RasterImageUtil.props.altText.validate('x'.repeat(2001))).toThrow(/2000/);
    expect(() => SanitizedSvgUtil.props.themeColor.validate(3)).toThrow(/Theme color/);
    expect(() => SanitizedSvgUtil.props.altText.validate('x'.repeat(2001))).toThrow(/Invalid alt/);
  });

  it('renders fallback raster and default canonical SVG presentation branches', () => {
    const raster = new RasterImageUtil();
    raster.editor = {
      store: { get: () => ({ kind: 'asset', type: 'raster-image', props: { width: Number.NaN, height: 2 } }) },
      resolveAssetUrl: () => 'https://assets.test/image',
    } as any;
    const shape = { props: { w: 10, h: 10, assetId: 'asset:r', altText: '' } } as GlideShape<any>;
    expect(raster.toSvg(shape).getAttribute('data-missing-asset')).toBe('true');

    const svg = new SanitizedSvgUtil();
    svg.editor = {
      store: { get: () => ({ kind: 'asset', type: 'sanitized-svg', props: { viewBox: [0, 0, 10, 10], paths: [{ d: 'M0 0' }] } }) },
    } as any;
    const output = svg.toSvg(shape);
    expect(output.getAttribute('aria-hidden')).toBe('true');
    expect(output.querySelector('path')?.getAttribute('fill')).toBe('black');
    expect(output.querySelector('path')?.getAttribute('stroke')).toBe('none');
  });

  it('covers placement validation, cancellation compensation, collisions, and callback isolation', async () => {
    const selection: AssetPlacementSelection = {
      itemId: 'item', mediaType: 'svg', width: 20, height: 10,
      provenance: { providerId: 'p', itemId: 'item', sourceLibraryId: 'l', sourceVersion: '1', license: 'MIT' },
    };
    const editor = createEditor({ plugins: [SanitizedAssetPlugin, AssetPlacementPlugin] });
    editor.setCurrentTool('asset');
    const tool = editor.getCurrentTool() as AssetPlacementTool;
    expect(() => tool.getSelection()).toThrow(/not configured/);
    expect(() => tool.configure({ ...selection, width: 0 }, async () => { throw new Error(); })).toThrow(/positive/);

    const rollback = vi.fn();
    const callbacks = { onPendingChange: vi.fn(() => { throw new Error('host'); }), onError: vi.fn(() => { throw new Error('host'); }) };
    tool.configure(selection, async request => {
      request.signal.dispatchEvent(new Event('abort'));
      return {
        asset: { id: aid(`asset:sha256:${HASH}`), kind: 'asset', type: 'raster-image', schemaVersion: 1, props: {}, meta: {} } as GlideAsset,
        contentHash: HASH, rollback,
      };
    }, callbacks);
    await expect(tool.place({ x: 0, y: 0, w: 20, h: 10 })).resolves.toBeNull();
    expect(rollback).toHaveBeenCalledWith('placement-failed');

    tool.configure(selection, async () => ({
      asset: { id: aid(`asset:sha256:${HASH}`), kind: 'asset', type: 'sanitized-svg', schemaVersion: 1,
        props: { ...(svgRecord().props as AnyRecord), hash: 'b'.repeat(64) }, meta: {} },
      contentHash: HASH, rollback,
    }));
    await expect(tool.place({ x: 0, y: 0, w: 20, h: 10 })).resolves.toBeNull();
  });

  it('places horizontal, vertical, and negative-direction drags', async () => {
    const selection: AssetPlacementSelection = {
      itemId: 'item', mediaType: 'svg', width: 20, height: 10,
      provenance: { providerId: 'p', itemId: 'item', sourceLibraryId: 'l', sourceVersion: '1', license: 'MIT' },
    };
    for (const point of [{ x: 40, y: 0 }, { x: 0, y: 40 }, { x: -40, y: -40 }, { x: 100, y: 10 }]) {
      const editor = createEditor({ plugins: [SanitizedAssetPlugin, AssetPlacementPlugin] });
      editor.setCurrentTool('asset');
      const tool = editor.getCurrentTool() as AssetPlacementTool;
      tool.configure(selection, async () => ({ asset: svgRecord({ hash: HASH }) as GlideAsset, contentHash: HASH, rollback: vi.fn() }));
      editor.dispatchEvent({ type: 'pointerDown', point: { x: 0, y: 0 }, shiftKey: false, target: 'canvas' });
      editor.dispatchEvent({ type: 'pointerMove', point });
      editor.dispatchEvent({ type: 'pointerUp', point });
      await vi.waitFor(() => expect(editor.getSelectedShapeIds()).toHaveLength(1));
    }
  });

  it('handles pointer keyboard cancellation and tool exit states', async () => {
    const selection: AssetPlacementSelection = {
      itemId: 'item', mediaType: 'svg', width: 20, height: 10,
      provenance: { providerId: 'p', itemId: 'item', sourceLibraryId: 'l', sourceVersion: '1', license: 'MIT' },
    };
    const editor = createEditor({ plugins: [SanitizedAssetPlugin, AssetPlacementPlugin] });
    editor.setCurrentTool('asset');
    const tool = editor.getCurrentTool() as AssetPlacementTool;
    tool.configure(selection, async () => ({ asset: svgRecord() as GlideAsset, contentHash: HASH, rollback: vi.fn() }));
    editor.dispatchEvent({ type: 'keyDown', key: 'Enter' });
    editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
    editor.dispatchEvent({ type: 'pointerDown', point: { x: 0, y: 0 }, shiftKey: false, target: 'canvas' });
    editor.dispatchEvent({ type: 'pointerMove', point: { x: 1, y: 1 } });
    editor.dispatchEvent({ type: 'keyDown', key: 'Enter' });
    editor.dispatchEvent({ type: 'keyDown', key: 'Escape' });
    editor.setCurrentTool('select');
  });

  it('compensates a materialization that resolves after cancellation', async () => {
    const selection: AssetPlacementSelection = {
      itemId: 'item', mediaType: 'svg', width: 20, height: 10,
      provenance: { providerId: 'p', itemId: 'item', sourceLibraryId: 'l', sourceVersion: '1', license: 'MIT' },
    };
    const editor = createEditor({ plugins: [SanitizedAssetPlugin, AssetPlacementPlugin] });
    editor.setCurrentTool('asset');
    const tool = editor.getCurrentTool() as AssetPlacementTool;
    const rollback = vi.fn();
    let resolve!: (value: any) => void;
    tool.configure(selection, () => new Promise(value => { resolve = value; }));
    const pending = tool.place({ x: 0, y: 0, w: 20, h: 10 });
    tool.cancel();
    resolve({ asset: svgRecord() as GlideAsset, contentHash: HASH, rollback });
    await expect(pending).resolves.toBeNull();
    expect(rollback).toHaveBeenCalledWith('cancelled');
  });

  it('merges missing metadata, rejects id collisions, and isolates superseded operations', async () => {
    const selection: AssetPlacementSelection = {
      itemId: 'item', mediaType: 'svg', width: 20, height: 10,
      provenance: { providerId: 'p', itemId: 'item', sourceLibraryId: 'l', sourceVersion: '1', license: 'MIT' },
    };
    const editor = createEditor({ plugins: [SanitizedAssetPlugin, AssetPlacementPlugin] });
    editor.importRecords([svgRecord()]);
    editor.setCurrentTool('asset');
    const tool = editor.getCurrentTool() as AssetPlacementTool;
    tool.configure(selection, async () => ({ asset: svgRecord() as GlideAsset, contentHash: HASH, rollback: vi.fn() }));
    await expect(tool.place({ x: 0, y: 0, w: 20, h: 10 })).resolves.not.toBeNull();
    expect(editor.store.get('asset:svg')?.meta).toHaveProperty('assetLibrary.providerId', 'p');

    const collisionRollback = vi.fn();
    tool.configure(selection, async () => ({
      asset: svgRecord({ hash: 'b'.repeat(64) }) as GlideAsset,
      contentHash: 'b'.repeat(64), rollback: collisionRollback,
    }));
    await expect(tool.place({ x: 30, y: 0, w: 20, h: 10 })).resolves.toBeNull();
    expect(collisionRollback).toHaveBeenCalledWith('placement-failed');

    const resolvers: Array<(value: any) => void> = [];
    tool.configure(selection, () => new Promise(value => { resolvers.push(value); }));
    const first = tool.place({ x: 60, y: 0, w: 20, h: 10 });
    const second = tool.place({ x: 90, y: 0, w: 20, h: 10 });
    resolvers[0]!({ asset: svgRecord() as GlideAsset, contentHash: HASH, rollback: vi.fn() });
    await expect(first).resolves.toBeNull();
    tool.cancel();
    resolvers[1]!({ asset: svgRecord() as GlideAsset, contentHash: HASH, rollback: vi.fn() });
    await expect(second).resolves.toBeNull();
  });
});
