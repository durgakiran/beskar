// @vitest-environment happy-dom
/**
 * Unit tests: Built-in Shape Utils — BoxUtil, TextUtil, FrameUtil (Story 2.3)
 * Covers spec test IDs: T2.3-01 through T2.3-06
 *
 * happy-dom environment: needed for document.createElementNS (toSvg tests).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BoxUtil }   from './shapes/BoxUtil';
import { TextUtil }  from './shapes/TextUtil';
import { FrameUtil } from './shapes/FrameUtil';
import { GlideStore }  from './store';
import { GlideSchema } from './schema';
import { sid } from './types';
import type { BoxShape }   from './shapes/BoxUtil';
import type { FrameShape } from './shapes/FrameUtil';

// ─────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────

function makeBox(id: string, x: number, y: number, w: number, h: number): BoxShape {
  return {
    id: sid(id), type: 'box', x, y,
    index: 'a1', rotation: 0, meta: {},
    props: { ...new BoxUtil().getDefaultProps(), w, h, cornerRadius: 0, color: '#6366f1', label: '' },
  };
}

function makeFrame(id: string, x: number, y: number, w: number, h: number): FrameShape {
  return {
    id: sid(id), type: 'frame', x, y,
    index: 'a1', rotation: 0, meta: {},
    props: { ...new FrameUtil().getDefaultProps(), w, h, label: 'Frame', color: '#313244' },
  };
}

// Util instances (editor not needed for these unit tests)
const boxUtil   = new BoxUtil();
const textUtil  = new TextUtil();
const frameUtil = new FrameUtil();

// ─────────────────────────────────────────────────────────────
// T2.3-01: Geometry bounds correct
// ─────────────────────────────────────────────────────────────

describe('T2.3-01: BoxUtil.getGeometry returns correct bounds', () => {
  it('box {x:50,y:100,w:200,h:150} geometry is now local → minX:0, maxX:200, minY:0, maxY:150', () => {
    const shape = makeBox('box:1', 50, 100, 200, 150);
    const geo   = boxUtil.getGeometry(shape).getBounds();
    expect(geo.minX).toBe(0);
    expect(geo.maxX).toBe(200);
    expect(geo.minY).toBe(0);
    expect(geo.maxY).toBe(150);
  });

  it('geometry w and h match props', () => {
    const shape = makeBox('box:2', 0, 0, 300, 200);
    const geo   = boxUtil.getGeometry(shape).getBounds();
    expect(geo.w).toBe(300);
    expect(geo.h).toBe(200);
  });

  it('negative origin works, geometry is still local', () => {
    const shape = makeBox('box:3', -100, -50, 80, 40);
    const geo   = boxUtil.getGeometry(shape).getBounds();
    expect(geo.minX).toBe(0);
    expect(geo.maxX).toBe(80);
    expect(geo.minY).toBe(0);
    expect(geo.maxY).toBe(40);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.3-02: hitTestPoint AABB
// ─────────────────────────────────────────────────────────────

describe('T2.3-02: hitTestPoint AABB', () => {
  it('point (50,50) inside box at (0,0) 100×100 → true', () => {
    const shape = makeBox('box:h1', 0, 0, 100, 100);
    expect(boxUtil.hitTestPoint(shape, { x: 50, y: 50 })).toBe(true);
  });

  it('point (200,0) outside same box → false', () => {
    const shape = makeBox('box:h2', 0, 0, 100, 100);
    expect(boxUtil.hitTestPoint(shape, { x: 200, y: 0 })).toBe(false);
  });

  it('point on exact edge → true (inclusive)', () => {
    const shape = makeBox('box:h3', 0, 0, 100, 100);
    expect(boxUtil.hitTestPoint(shape, { x: 100, y: 100 })).toBe(true);
  });

  it('point just outside edge → false', () => {
    const shape = makeBox('box:h4', 0, 0, 100, 100);
    expect(boxUtil.hitTestPoint(shape, { x: 100.001, y: 50 })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.3-03: canContain
// ─────────────────────────────────────────────────────────────

describe('T2.3-03: canContain', () => {
  it('FrameUtil.canContain(frame) → true', () => {
    const frame = makeFrame('frame:1', 0, 0, 400, 300);
    expect(frameUtil.canContain(frame)).toBe(true);
  });

  it('BoxUtil.canContain(box) → false', () => {
    const box = makeBox('box:c1', 0, 0, 100, 100);
    expect(boxUtil.canContain(box)).toBe(false);
  });

  it('TextUtil.canContain → false (default)', () => {
    const text = {
      id: sid('text:1'), type: 'text', x: 0, y: 0, index: 'a1', rotation: 0, meta: {},
      props: { text: 'hello', fontSize: 16, color: '#fff' },
    };
    expect(textUtil.canContain(text as any)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.3-04: toSvg returns SVGElement with correct dimensions
// ─────────────────────────────────────────────────────────────

describe('T2.3-04: toSvg returns SVGElement', () => {
  it('BoxUtil.toSvg → instanceof SVGElement', () => {
    const shape = makeBox('box:svg1', 10, 20, 200, 150);
    const el    = boxUtil.toSvg(shape);
    expect(el).toBeInstanceOf(SVGElement);
  });

  it('BoxUtil.toSvg rect has correct width and height attributes', () => {
    const shape = makeBox('box:svg2', 0, 0, 200, 150);
    const el    = boxUtil.toSvg(shape) as SVGGElement;
    const rect  = el.querySelector('rect') as SVGRectElement;
    expect(rect.getAttribute('width')).toBe('200');
    expect(rect.getAttribute('height')).toBe('150');
  });

  it('BoxUtil.toSvg rect has correct local x/y attributes (0)', () => {
    const shape = makeBox('box:svg3', 50, 75, 100, 80);
    const el    = boxUtil.toSvg(shape) as SVGGElement;
    const rect  = el.querySelector('rect') as SVGRectElement;
    expect(rect.getAttribute('x')).toBe('0');
    expect(rect.getAttribute('y')).toBe('0');
  });

  it('BoxUtil.toSvg with cornerRadius sets rx', () => {
    const shape: BoxShape = { ...makeBox('box:svg4', 0, 0, 100, 80), props: { ...new BoxUtil().getDefaultProps(), w: 100, h: 80, cornerRadius: 8, color: '#fff', label: '' } };
    const el = boxUtil.toSvg(shape) as SVGGElement;
    const rect  = el.querySelector('rect') as SVGRectElement;
    expect(rect.getAttribute('rx')).toBe('8');
  });

  it('FrameUtil.toSvg → instanceof SVGElement (g element)', () => {
    const frame = makeFrame('frame:svg1', 0, 0, 400, 300);
    const el    = frameUtil.toSvg(frame);
    expect(el).toBeInstanceOf(SVGElement);
    expect(el.tagName.toLowerCase()).toBe('g');
  });

  it('TextUtil.toSvg → instanceof SVGElement', () => {
    const shape = { id: sid('text:svg1'), type: 'text', x: 0, y: 0, index: 'a1', rotation: 0, meta: {}, props: { text: 'hello', fontSize: 16, color: '#fff' } };
    const el = textUtil.toSvg(shape as any);
    expect(el).toBeInstanceOf(SVGElement);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.3-05: Default props
// ─────────────────────────────────────────────────────────────

describe('T2.3-05: getDefaultProps()', () => {
  it('BoxUtil: w===120, h===80, cornerRadius===0', () => {
    const p = boxUtil.getDefaultProps();
    expect(p.w).toBe(120);
    expect(p.h).toBe(80);
    expect(p.cornerRadius).toBe(0);
  });

  it('BoxUtil: color and label exist', () => {
    const p = boxUtil.getDefaultProps();
    expect(typeof p.color).toBe('string');
    expect(typeof p.label).toBe('string');
  });

  it('FrameUtil: w===400, h===300', () => {
    const p = frameUtil.getDefaultProps();
    expect(p.w).toBe(400);
    expect(p.h).toBe(300);
  });

  it('FrameUtil: canContain===true', () => {
    expect(frameUtil.canContain(makeFrame('f', 0, 0, 100, 100))).toBe(true);
  });

  it('TextUtil: fontSize===16, text===empty string', () => {
    const p = textUtil.getDefaultProps();
    expect(p.fontSize).toBe(16);
    expect(p.text).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// T2.3-06: Prop validation on put — store unchanged
// ─────────────────────────────────────────────────────────────

describe('T2.3-06: store.put with invalid props throws; store unchanged', () => {
  let store: GlideStore;

  beforeEach(() => {
    const schema = new GlideSchema();
    schema.registerShapeUtil(BoxUtil as any);
    store = new GlideStore(schema);
  });

  it('put box with w:"bad" throws before write', () => {
    const badShape = {
      id: sid('box:bad'), type: 'box', x: 0, y: 0, w: 100, h: 100,
      index: 'a1', rotation: 0, meta: {},
      props: { ...new BoxUtil().getDefaultProps(), w: 'bad', h: 100, cornerRadius: 0, color: '#fff', label: '' },
    };
    expect(() => store.put([badShape as any])).toThrow(/prop "w"/);
    expect(store.get('box:bad')).toBeUndefined();
  });

  it('put box with h:null throws and store stays empty', () => {
    const badShape = {
      id: sid('box:bad2'), type: 'box', x: 0, y: 0, w: 100, h: 100,
      index: 'a1', rotation: 0, meta: {},
      props: { ...new BoxUtil().getDefaultProps(), w: 100, h: null, cornerRadius: 0, color: '#fff', label: '' },
    };
    expect(() => store.put([badShape as any])).toThrow();
    expect(store.get('box:bad2')).toBeUndefined();
  });

  it('valid box put succeeds after failed put', () => {
    const bad = { id: sid('box:b'), type: 'box', x: 0, y: 0, index: 'a1', rotation: 0, meta: {}, props: { ...new BoxUtil().getDefaultProps(), w: 'x', h: 80, cornerRadius: 0, color: '#fff', label: '' } };
    expect(() => store.put([bad as any])).toThrow();

    const good = { id: sid('box:g'), type: 'box', x: 0, y: 0, w: 100, h: 80, index: 'a1', rotation: 0, meta: {}, props: { ...new BoxUtil().getDefaultProps(), w: 100, h: 80, cornerRadius: 0, color: '#fff', label: '' } };
    store.put([good as any]);
    expect(store.get('box:g')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Additional: migrations currentVersion === 1 on all three
// ─────────────────────────────────────────────────────────────

describe('All three utils have static migrations with currentVersion: Box 2, Text/Frame 1', () => {
  it('BoxUtil.migrations.currentVersion === 2', () => {
    expect(BoxUtil.migrations?.currentVersion).toBe(2);
  });
  it('TextUtil.migrations.currentVersion === 1', () => {
    expect(TextUtil.migrations?.currentVersion).toBe(1);
  });
  it('FrameUtil.migrations.currentVersion === 1', () => {
    expect(FrameUtil.migrations?.currentVersion).toBe(1);
  });
});
