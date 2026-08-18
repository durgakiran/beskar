// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createEditor, getMutableStoreForTesting } from './editor';
import { SanitizedAssetPlugin } from './shapes/SanitizedSvgUtil';
import { SelectTool } from './tools/SelectTool';
import type { AnyRecord, GlideShape, ShapeId } from './types';

const HASH = 'a'.repeat(64);

function rasterAsset(id = 'asset:raster'): AnyRecord {
  return {
    id,
    kind: 'asset',
    type: 'raster-image',
    schemaVersion: 1,
    props: { hash: HASH, mimeType: 'image/png', byteLength: 128, width: 400, height: 200 },
    meta: {},
  };
}

function svgAsset(id = 'asset:svg'): AnyRecord {
  return {
    id,
    kind: 'asset',
    type: 'sanitized-svg',
    schemaVersion: 1,
    props: {
      hash: HASH,
      mimeType: 'image/svg+xml',
      sanitizerVersion: 1,
      byteLength: 128,
      width: 100,
      height: 50,
      viewBox: [0, 0, 100, 50],
      paths: [
        { d: 'M 0 0 L 100 0 L 100 50 Z', fill: '#abcdef', stroke: '#123456' },
        { d: 'M 10 10 L 20 10 L 20 20 Z', fill: 'none', stroke: 'none' },
      ],
    },
    meta: {},
  };
}

function makeEditor(resolve = true) {
  return createEditor({
    plugins: [SanitizedAssetPlugin],
    tools: [SelectTool],
    assetResolver: resolve ? asset => `https://assets.test/${asset.id}` : () => null,
  });
}

function importAsset(editor: ReturnType<typeof makeEditor>, asset: AnyRecord): string {
  const report = editor.importRecords([asset]);
  return report.idMap[String(asset['id'])] ?? String(asset['id']);
}

describe('P3-C1 asset shape model and rendering', () => {
  it('renders a nondestructive normalized raster crop with accessible export output', () => {
    const editor = makeEditor();
    const assetId = importAsset(editor, rasterAsset());
    const id = editor.createShape({
      type: 'raster-image',
      x: 0,
      y: 0,
      props: {
        w: 300,
        h: 100,
        assetId,
        crop: { x: 0.25, y: 0.1, w: 0.5, h: 0.5 },
        altText: 'Quarterly chart',
      },
    });
    const shape = editor.getShape(id)!;
    const element = editor.getShapeUtil(shape).toSvgExport(shape);
    const viewport = element.querySelector('svg')!;
    const image = element.querySelector('image')!;

    expect(element.getAttribute('role')).toBe('img');
    expect(element.getAttribute('aria-label')).toBe('Quarterly chart');
    expect(viewport.getAttribute('viewBox')).toBe('100 20 200 100');
    expect(viewport.getAttribute('width')).toBe('300');
    expect(viewport.getAttribute('height')).toBe('100');
    expect(viewport.getAttribute('overflow')).toBe('hidden');
    expect(image.getAttribute('width')).toBe('400');
    expect(image.getAttribute('height')).toBe('200');
    expect(image.getAttribute('href')).toContain(assetId);
    expect((editor.store.get(assetId) as AnyRecord)['props']).toEqual(rasterAsset()['props']);
  });

  it('rejects invalid crop, alt text, color mode, and theme color values', () => {
    const editor = makeEditor();
    expect(() => editor.createShape({
      type: 'raster-image', x: 0, y: 0, props: { crop: { x: 0.8, y: 0, w: 0.3, h: 1 } },
    })).toThrow(/crop/i);
    expect(() => editor.createShape({
      type: 'raster-image', x: 0, y: 0, props: { crop: { x: 0, y: 0, w: Number.NaN, h: 1 } },
    })).toThrow(/crop/i);
    expect(() => editor.createShape({
      type: 'raster-image', x: 0, y: 0, props: { altText: 'bad\u0000text' },
    })).toThrow(/alt text/i);
    expect(() => editor.createShape({
      type: 'sanitized-svg', x: 0, y: 0, props: { colorMode: 'duotone' },
    })).toThrow(/colorMode|union/i);
    expect(() => editor.createShape({
      type: 'sanitized-svg', x: 0, y: 0, props: { themeColor: 'url(https://attacker.test)' },
    })).toThrow(/theme color/i);
  });

  it('renders native and monochrome SVG paint modes without changing none paints', () => {
    const editor = makeEditor();
    const assetId = importAsset(editor, svgAsset());
    const nativeId = editor.createShape({
      type: 'sanitized-svg', x: 0, y: 0, props: { w: 200, h: 100, assetId, altText: 'Native logo' },
    });
    const monoId = editor.createShape({
      type: 'sanitized-svg',
      x: 0,
      y: 0,
      props: { w: 200, h: 100, assetId, colorMode: 'monochrome', themeColor: '#ff00aa' },
    });
    const native = editor.getShape(nativeId)!;
    const mono = editor.getShape(monoId)!;
    const nativeOutput = editor.getShapeUtil(native).toSvg(native);
    const monoOutput = editor.getShapeUtil(mono).toSvgExport(mono);

    expect(nativeOutput.querySelector('path')?.getAttribute('fill')).toBe('#abcdef');
    expect(nativeOutput.querySelector('path')?.getAttribute('stroke')).toBe('#123456');
    expect(nativeOutput.getAttribute('aria-label')).toBe('Native logo');
    expect(monoOutput.querySelector('path')?.getAttribute('fill')).toBe('#ff00aa');
    expect(monoOutput.querySelector('path')?.getAttribute('stroke')).toBe('#ff00aa');
    expect(monoOutput.querySelectorAll('path')[1]?.getAttribute('fill')).toBe('none');
    expect(monoOutput.querySelectorAll('path')[1]?.getAttribute('stroke')).toBe('none');
    expect(monoOutput.getAttribute('aria-hidden')).toBe('true');
  });

  it.each(['raster-image', 'sanitized-svg'])('renders a bounded selectable placeholder for missing %s assets', type => {
    const editor = makeEditor(false);
    const util = editor.getShapeUtil(type);
    const shape = type === 'raster-image'
      ? editor.getShape(editor.createShape({
        type,
        x: 10,
        y: 20,
        props: {
          w: 120,
          h: 60,
          assetId: importAsset(editor, rasterAsset()),
          altText: 'Company mark',
        },
      }))!
      : {
        id: 'shape:missing-svg',
        kind: 'shape',
        type,
        schemaVersion: 0,
        x: 10,
        y: 20,
        rotation: 0,
        index: 'a1',
        parentId: 'page:default',
        isLocked: false,
        isHidden: false,
        props: { w: 120, h: 60, assetId: 'asset:missing', altText: 'Company mark' },
        meta: {},
      } as GlideShape;
    const output = util.toSvgExport(shape);
    const rect = output.querySelector('rect')!;

    expect(output.getAttribute('data-missing-asset')).toBe('true');
    expect(output.getAttribute('aria-label')).toBe('Missing asset: Company mark');
    expect(rect.getAttribute('width')).toBe('120');
    expect(rect.getAttribute('height')).toBe('60');
    expect(output.querySelectorAll('line')).toHaveLength(2);
    expect(util.getGeometry(shape).getBounds().w).toBe(120);
    expect(util.getGeometry(shape).getBounds().h).toBe(60);
  });

  it('keeps optional asset props through serialization, duplicate, and document transfer', () => {
    const editor = makeEditor();
    const assetId = importAsset(editor, rasterAsset());
    const id = editor.createShape({
      type: 'raster-image',
      x: 0,
      y: 0,
      props: {
        w: 240,
        h: 120,
        assetId,
        crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.6 },
        altText: 'Launch photo',
        aspectLocked: false,
      },
    });
    const [duplicateId] = editor.duplicateShapes([id], { x: 30, y: 20 });
    const expectedProps = editor.getShape(id)!.props;
    const duplicateProps = editor.getShape(duplicateId!)!.props as Record<string, unknown>;
    expect({ ...duplicateProps, assetId: expectedProps.assetId }).toEqual(expectedProps);
    expect((editor.store.get(duplicateProps.assetId as string) as AnyRecord)['props'])
      .toEqual((editor.store.get(assetId) as AnyRecord)['props']);

    const serialized = JSON.parse(JSON.stringify(editor.serialize()));
    const transferred = makeEditor();
    transferred.replaceDocument(serialized);
    expect(transferred.getShape(id)!.props).toEqual(expectedProps);
    expect(transferred.getShape(duplicateId!)!.props).toEqual(duplicateProps);
    expect(transferred.store.get(assetId)).toBeDefined();
  });

  it('copies and pastes raster attachment, crop, alt text, and aspect lock', () => {
    const editor = makeEditor();
    const assetId = importAsset(editor, rasterAsset());
    const id = editor.createShape({
      type: 'raster-image',
      x: 10,
      y: 20,
      props: {
        w: 240,
        h: 120,
        assetId,
        crop: { x: 0.15, y: 0.2, w: 0.7, h: 0.6 },
        altText: 'Release screenshot',
        aspectLocked: false,
      },
    });

    editor.copy([id]);
    const [pastedId] = editor.paste({ x: 400, y: 300 });
    const pasted = editor.getShape(pastedId!)!;
    const pastedAssetId = pasted.props.assetId as string;

    expect(pasted.props).toMatchObject({
      w: 240,
      h: 120,
      crop: { x: 0.15, y: 0.2, w: 0.7, h: 0.6 },
      altText: 'Release screenshot',
      aspectLocked: false,
    });
    expect(pastedAssetId).toBeTruthy();
    expect((editor.store.get(pastedAssetId) as AnyRecord)['props']).toEqual(rasterAsset()['props']);
  });

  it('copies and pastes SVG attachment, alt text, color mode, theme, and aspect lock', () => {
    const editor = makeEditor();
    const assetId = importAsset(editor, svgAsset());
    const id = editor.createShape({
      type: 'sanitized-svg',
      x: 10,
      y: 20,
      props: {
        w: 200,
        h: 100,
        assetId,
        colorMode: 'monochrome',
        themeColor: '#3366cc',
        altText: 'Platform logo',
        aspectLocked: false,
      },
    });

    editor.copy([id]);
    const [pastedId] = editor.paste({ x: 400, y: 300 });
    const pasted = editor.getShape(pastedId!)!;
    const pastedAssetId = pasted.props.assetId as string;

    expect(pasted.props).toMatchObject({
      w: 200,
      h: 100,
      colorMode: 'monochrome',
      themeColor: '#3366cc',
      altText: 'Platform logo',
      aspectLocked: false,
    });
    expect(pastedAssetId).toBeTruthy();
    expect((editor.store.get(pastedAssetId) as AnyRecord)['props']).toEqual(svgAsset()['props']);
  });

  it('accepts legacy records with omitted optional props and applies rendering defaults', () => {
    const source = makeEditor();
    const assetId = importAsset(source, svgAsset());
    const id = source.createShape({
      id: 'shape:legacy-svg', type: 'sanitized-svg', x: 0, y: 0, props: { w: 100, h: 50, assetId },
    });
    const document = JSON.parse(JSON.stringify(source.serialize()));
    const record = document.records.find((item: AnyRecord) => item.id === id);
    delete record.props.colorMode;
    delete record.props.themeColor;
    delete record.props.altText;
    delete record.props.aspectLocked;

    const editor = makeEditor();
    editor.replaceDocument(document);
    const shape = editor.getShape(id as ShapeId)!;
    const output = editor.getShapeUtil(shape).toSvg(shape);
    expect(output.querySelector('path')?.getAttribute('fill')).toBe('#abcdef');
    expect(output.getAttribute('aria-hidden')).toBe('true');
  });

  it('validates and renders collaboration updates to asset presentation props', () => {
    const editor = makeEditor();
    const assetId = importAsset(editor, svgAsset());
    const id = editor.createShape({
      type: 'sanitized-svg', x: 0, y: 0, props: { w: 100, h: 50, assetId },
    });
    getMutableStoreForTesting(editor).transact({ origin: 'remote', history: 'ignore' }, tx => {
      tx.update(id, record => ({
        ...record,
        props: {
          ...(record['props'] as Record<string, unknown>),
          colorMode: 'monochrome',
          themeColor: '#00cc88',
          altText: 'Remote logo',
        },
      }));
    });

    const shape = editor.getShape(id)!;
    const output = editor.getShapeUtil(shape).toSvgExport(shape);
    expect(output.getAttribute('aria-label')).toBe('Remote logo');
    expect(output.querySelector('path')?.getAttribute('fill')).toBe('#00cc88');
  });
});

describe('P3-C1 asset aspect-safe resize', () => {
  function resize(
    props: Record<string, unknown>,
    point: { x: number; y: number },
    shiftKey = false,
    type: 'raster-image' | 'sanitized-svg' = 'raster-image',
    handleId = 'se',
  ): GlideShape {
    const editor = makeEditor();
    editor.setCurrentTool('select');
    const assetId = importAsset(editor, type === 'raster-image' ? rasterAsset() : svgAsset());
    const id = editor.createShape({
      type,
      x: 0,
      y: 0,
      props: { w: 200, h: 100, assetId, ...props },
    });
    editor.setSelectedShapeIds([id]);
    editor.dispatchEvent({
      type: 'pointerDown', point: { x: 200, y: 100 }, shiftKey: false, target: 'handle', handleId,
    });
    editor.dispatchEvent({ type: 'pointerMove', point, shiftKey });
    editor.dispatchEvent({ type: 'pointerUp', point, shiftKey });
    return editor.getShape(id)!;
  }

  it.each(['raster-image', 'sanitized-svg'] as const)('preserves %s aspect ratio by default', type => {
    const shape = resize({}, { x: 300, y: 120 }, false, type);
    expect(shape.props.w).toBe(300);
    expect(shape.props.h).toBe(150);
  });

  it('allows persisted and gesture-level explicit unlocks', () => {
    const persistedUnlock = resize({ aspectLocked: false }, { x: 300, y: 120 });
    expect(persistedUnlock.props.w).toBe(300);
    expect(persistedUnlock.props.h).toBe(120);

    const temporaryUnlock = resize({}, { x: 300, y: 120 }, true);
    expect(temporaryUnlock.props.w).toBe(300);
    expect(temporaryUnlock.props.h).toBe(120);
  });

  it('preserves aspect ratio for horizontal, vertical, and both diagonal outcomes', () => {
    expect(resize({}, { x: 300, y: 100 }, false, 'raster-image', 'e').props).toMatchObject({ w: 300, h: 150 });
    expect(resize({}, { x: 200, y: 160 }, false, 'raster-image', 's').props).toMatchObject({ w: 320, h: 160 });
    expect(resize({}, { x: 240, y: 200 }, false, 'raster-image', 'se').props).toMatchObject({ w: 400, h: 200 });
  });
});
