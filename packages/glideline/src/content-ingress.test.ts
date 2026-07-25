// @vitest-environment happy-dom

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

describe('untrusted content ingress', () => {
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
});
