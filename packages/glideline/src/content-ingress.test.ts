// @vitest-environment happy-dom

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ContentIngressError,
  createEditor,
  createSanitizedSvgAsset,
  normalizeClipboardText,
  prepareRasterAsset,
  sanitizeSvg,
  SanitizedAssetPlugin,
} from './index';

const SAFE_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">
    <g>
      <path d="M 0,0 L120 0 L120 80 L0 80 Z" fill="#abc" stroke="black" stroke-width="2"/>
    </g>
  </svg>
`;

function webpFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/webp', name)));
}

function webpContainer(chunks: readonly { type: string; bytes: Uint8Array }[]): Uint8Array {
  const bytes = new Uint8Array(12 + chunks.reduce((size, chunk) => size + 8 + chunk.bytes.length + (chunk.bytes.length & 1), 0));
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode('WEBP'), 8);
  let offset = 12;
  for (const chunk of chunks) {
    bytes.set(new TextEncoder().encode(chunk.type), offset);
    view.setUint32(offset + 4, chunk.bytes.length, true);
    bytes.set(chunk.bytes, offset + 8);
    offset += 8 + chunk.bytes.length + (chunk.bytes.length & 1);
  }
  return bytes;
}

describe('untrusted content ingress', () => {
  it('accepts inert accessibility metadata on the SVG root', () => {
    expect(() => sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="Chart" aria-hidden="false" focusable="false" class="icon" id="chart" preserveAspectRatio="xMidYMid meet" version="1.1" viewBox="0 0 10 10"><path d="M0 0 L10 10"/></svg>',
    )).not.toThrow();
  });

  it('normalizes supported SVG into path data without preserving markup', () => {
    const result = sanitizeSvg(SAFE_SVG);
    expect(result).toEqual({
      viewBox: [0, 0, 120, 80],
      width: 120,
      height: 80,
      paths: [{
        d: 'M 0 0 L 120 0 L 120 80 L 0 80 Z',
        fill: '#abc',
        stroke: 'black',
        strokeWidth: 2,
      }],
    });
  });

  it.each([
    ['script', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>'],
    ['event handler', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0L1 1" onload="alert(1)"/></svg>'],
    ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><foreignObject/></svg>'],
    ['external URL', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0L1 1" fill="url(https://example.com/x)"/></svg>'],
    ['data URL', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image href="data:image/png;base64,AA=="/></svg>'],
    ['DTD', '<!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>'],
    ['transform', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path transform="scale(2)" d="M0 0L1 1"/></svg>'],
    ['extreme coordinate', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0L999999999 1"/></svg>'],
  ])('rejects unsafe SVG: %s', (_label, source) => {
    expect(() => sanitizeSvg(source)).toThrow(ContentIngressError);
  });

  it('hashes the canonical result and renders only engine-owned SVG nodes', async () => {
    const prepared = await createSanitizedSvgAsset(SAFE_SVG);
    expect(prepared.asset.id).toMatch(/^asset:sha256:[a-f0-9]{64}$/);
    expect(prepared.canonical).not.toContain('<svg');

    const editor = createEditor({ plugins: [SanitizedAssetPlugin] });
    const report = editor.importRecords([
      prepared.asset as unknown as Record<string, unknown>,
      {
        id: 'shape:source',
        kind: 'shape',
        type: 'sanitized-svg',
        schemaVersion: 0,
        x: 0,
        y: 0,
        rotation: 0,
        index: 'a1',
        props: { w: 240, h: 160, assetId: prepared.asset.id },
        meta: {},
      },
    ]);
    const shape = editor.getShape(report.idMap['shape:source']! as any)!;
    const element = editor.getShapeUtil(shape).toSvg(shape);
    expect(element.querySelectorAll('path')).toHaveLength(1);
    expect(element.querySelector('script,foreignObject,image,style')).toBeNull();
    expect(element.innerHTML).not.toContain('onload');
  });

  it('rejects active content and arbitrary URLs at the asset store boundary', () => {
    const editor = createEditor();
    expect(() => editor.importRecords([{
      id: 'asset:unsafe',
      kind: 'asset',
      type: 'image',
      schemaVersion: 0,
      props: { src: 'javascript:alert(1)' },
      meta: {},
    }])).toThrow(/property "src" is not allowed/);
  });

  it('revalidates forged canonical SVG records at the store boundary', async () => {
    const prepared = await createSanitizedSvgAsset(SAFE_SVG);
    const forged = JSON.parse(JSON.stringify(prepared.asset));
    forged.props.paths[0].fill = 'url(https://attacker.test/paint)';
    const editor = createEditor();
    expect(() => editor.importRecords([forged])).toThrow(/fill is unsafe/);
  });

  it('reduces clipboard HTML to plain text and removes active/embed content', () => {
    const text = normalizeClipboardText({
      html: '<p>Hello <strong>world</strong><img src="https://example.com/pixel"><script>alert(1)</script></p><div>Next</div>',
      text: 'fallback',
    });
    expect(text).toBe('Hello world\nNext');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('example.com');
  });

  it('sniffs raster bytes and rejects declared MIME mismatch and pixel bombs', async () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(png.buffer).setUint32(16, 16);
    new DataView(png.buffer).setUint32(20, 8);
    await expect(prepareRasterAsset(png, 'image/jpeg')).rejects.toThrow(/MIME type/);

    new DataView(png.buffer).setUint32(16, 16_384);
    new DataView(png.buffer).setUint32(20, 16_384);
    await expect(prepareRasterAsset(png, 'image/png')).rejects.toThrow(/pixel limits/);
  });

  it.each([
    ['VP8 lossy', 'blue-purple-pink.lossy.webp', 150, 100],
    ['VP8L lossless', 'blue-purple-pink.lossless.webp', 150, 100],
    ['VP8X with alpha', 'yellow_rose.lossy-with-alpha.webp', 400, 301],
  ])('prepares a real %s WebP without changing its bytes', async (_label, name, width, height) => {
    const bytes = webpFixture(name);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const prepared = await prepareRasterAsset(bytes, 'image/webp');
    expect(prepared.bytes).toEqual(bytes);
    expect(prepared.bytes).not.toBe(bytes);
    expect(prepared.asset.id).toBe(`asset:sha256:${hash}`);
    expect(prepared.asset.props).toEqual({ hash, mimeType: 'image/webp', byteLength: bytes.length, width, height });
    await expect(prepareRasterAsset(bytes, 'image/png')).rejects.toThrow(/MIME type/);
  });

  it('checks every WebP chunk boundary, including metadata after the image', async () => {
    const source = webpFixture('blue-purple-pink.lossy.webp');
    await expect(prepareRasterAsset(source.subarray(0, source.length - 1))).rejects.toThrow(/RIFF length/);
    const wrongLength = source.slice();
    new DataView(wrongLength.buffer).setUint32(4, source.length - 10, true);
    await expect(prepareRasterAsset(wrongLength)).rejects.toThrow(/RIFF length/);

    const oversizedChunk = source.slice();
    new DataView(oversizedChunk.buffer).setUint32(16, 0xffff_ffff, true);
    await expect(prepareRasterAsset(oversizedChunk)).rejects.toThrow(/chunk is truncated/);

    const trailingChunk = new Uint8Array(source.length + 4);
    trailingChunk.set(source);
    new DataView(trailingChunk.buffer).setUint32(4, trailingChunk.length - 8, true);
    await expect(prepareRasterAsset(trailingChunk)).rejects.toThrow(/chunk header is truncated/);

    const missingPadding = webpContainer([{ type: 'VP8L', bytes: new Uint8Array([0x2f, 0, 0, 0, 0]) }]).slice(0, -1);
    new DataView(missingPadding.buffer).setUint32(4, missingPadding.length - 8, true);
    await expect(prepareRasterAsset(missingPadding)).rejects.toThrow(/chunk is truncated/);
    const invalidPadding = webpFixture('yellow_rose.lossy-with-alpha.webp');
    invalidPadding[3849] = 1;
    await expect(prepareRasterAsset(invalidPadding)).rejects.toThrow(/padding is invalid/);
  });

  it.each([
    ['VP8 ', 8, /lossy frame header is truncated/],
    ['VP8L', 3, /lossless frame header is truncated/],
    ['VP8X', 9, /extended header is invalid/],
  ])('rejects a truncated or invalid %s header', async (type, size, message) => {
    await expect(prepareRasterAsset(webpContainer([{ type, bytes: new Uint8Array(size) }]))).rejects.toThrow(message);
  });

  it('rejects invalid lossy and lossless frame signatures and versions', async () => {
    const interframe = webpFixture('blue-purple-pink.lossy.webp');
    interframe[20] = interframe[20]! | 1;
    await expect(prepareRasterAsset(interframe)).rejects.toThrow(/lossy frame header is invalid/);
    const lossySignature = webpFixture('blue-purple-pink.lossy.webp');
    lossySignature[23] = 0;
    await expect(prepareRasterAsset(lossySignature)).rejects.toThrow(/lossy frame header is invalid/);
    const losslessSignature = webpFixture('blue-purple-pink.lossless.webp');
    losslessSignature[20] = 0;
    await expect(prepareRasterAsset(losslessSignature)).rejects.toThrow(/lossless frame header is invalid/);
    const losslessVersion = webpFixture('blue-purple-pink.lossless.webp');
    losslessVersion[24] = losslessVersion[24]! | 0x20;
    await expect(prepareRasterAsset(losslessVersion)).rejects.toThrow(/lossless frame header is invalid/);
  });

  it('requires one static WebP image with matching canvas and frame dimensions', async () => {
    const extended = webpFixture('yellow_rose.lossy-with-alpha.webp');
    const noImage = extended.slice(0, 30);
    new DataView(noImage.buffer).setUint32(4, noImage.length - 8, true);
    await expect(prepareRasterAsset(noImage)).rejects.toThrow(/frame is missing/);
    const mismatched = extended.slice();
    mismatched[24] = mismatched[24]! ^ 1;
    await expect(prepareRasterAsset(mismatched)).rejects.toThrow(/dimensions do not match/);
    const animated = extended.slice();
    animated[20] = animated[20]! | 2;
    await expect(prepareRasterAsset(animated)).rejects.toThrow(/Animated WebP/);
    const reservedFlag = extended.slice();
    reservedFlag[20] = reservedFlag[20]! | 0x80;
    await expect(prepareRasterAsset(reservedFlag)).rejects.toThrow(/unsupported flags/);
    const reservedByte = extended.slice();
    reservedByte[21] = 1;
    await expect(prepareRasterAsset(reservedByte)).rejects.toThrow(/unsupported flags/);

    const frame = { type: 'VP8 ', bytes: webpFixture('blue-purple-pink.lossy.webp').subarray(20) };
    await expect(prepareRasterAsset(webpContainer([frame, frame]))).rejects.toThrow(/multiple image frames/);
    await expect(prepareRasterAsset(webpContainer([frame, { type: 'ANMF', bytes: new Uint8Array(0) }]))).rejects.toThrow(/Animated WebP/);
  });

  it('applies the raster pixel limits to both lossy and lossless WebP headers', async () => {
    const zeroWidth = webpFixture('blue-purple-pink.lossy.webp');
    new DataView(zeroWidth.buffer).setUint16(26, 0, true);
    await expect(prepareRasterAsset(zeroWidth)).rejects.toThrow(/dimension or pixel limits/);
    const lossyBomb = webpFixture('blue-purple-pink.lossy.webp');
    new DataView(lossyBomb.buffer).setUint16(26, 10_000, true);
    new DataView(lossyBomb.buffer).setUint16(28, 10_000, true);
    await expect(prepareRasterAsset(lossyBomb)).rejects.toThrow(/dimension or pixel limits/);
    const losslessBomb = webpFixture('blue-purple-pink.lossless.webp');
    new DataView(losslessBomb.buffer).setUint32(21, 9999 | (9999 << 14), true);
    await expect(prepareRasterAsset(losslessBomb)).rejects.toThrow(/dimension or pixel limits/);
  });
});
