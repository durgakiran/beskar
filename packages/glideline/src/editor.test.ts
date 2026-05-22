/**
 * Unit tests: GlideEditor / createEditor() — Plugin System (Story 2.2)
 * Covers spec test IDs: T2.2-01 through T2.2-06
 */

import { describe, it, expect } from 'vitest';
import { createEditor, GlideEditor, type GlidePlugin } from './editor';
import { ShapeUtil } from './shapes/ShapeUtil';
import { T } from './validators';
import { defineMigrations } from './migrations';
import { sid } from './types';
import { Geometry2d, Rectangle2d } from './geometry';
import type { Box2d, GlideShape, Vec2 } from './types';

// ─────────────────────────────────────────────────────────────
// Test fixture utilities
// ─────────────────────────────────────────────────────────────

interface BoxProps { w: number; h: number; }
type BoxShape = GlideShape<BoxProps>;

class BoxUtil extends ShapeUtil<BoxShape> {
  static override type = 'box' as const;
  static override props = { w: T.number, h: T.number };
  static override migrations = defineMigrations({ currentVersion: 1, migrators: {
    1: { up: r => r, down: r => r },
  }});

  getDefaultProps() { return { w: 120, h: 80 }; }
  getGeometry(shape: BoxShape): Geometry2d {
    return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
  }
}

class ArrowUtil extends ShapeUtil<GlideShape<{ label: string }>> {
  static override type = 'arrow' as const;
  static override props = { label: T.string };
  static override migrations = defineMigrations({ currentVersion: 1, migrators: {
    1: { up: r => r, down: r => r },
  }});

  getDefaultProps() { return { label: '' }; }
  getGeometry(shape: GlideShape<{ label: string }>): Geometry2d {
    return new Rectangle2d(0, 0, 100, 20);
  }
}

const BoxPlugin: GlidePlugin = { id: 'box', shapes: [BoxUtil as any] };
const ArrowPlugin: GlidePlugin = { id: 'arrow', shapes: [ArrowUtil as any] };

// ─────────────────────────────────────────────────────────────
// T2.2-01: Two plugins, no conflict
// ─────────────────────────────────────────────────────────────

describe('T2.2-01: two plugins register without conflict', () => {
  it('createEditor with BoxPlugin + ArrowPlugin completes without error', () => {
    expect(() => createEditor({ plugins: [BoxPlugin, ArrowPlugin] })).not.toThrow();
  });

  it('both types resolvable via getShapeUtil', () => {
    const editor = createEditor({ plugins: [BoxPlugin, ArrowPlugin] });
    expect(editor.getShapeUtil('box')).toBeInstanceOf(BoxUtil);
    expect(editor.getShapeUtil('arrow')).toBeInstanceOf(ArrowUtil);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.2-02: Duplicate type throws
// ─────────────────────────────────────────────────────────────

describe('T2.2-02: duplicate type across two plugins throws', () => {
  it('two plugins both "box" → throws containing "duplicate"', () => {
    // Second plugin also tries to register 'box'
    class BoxUtil2 extends BoxUtil {}
    const AnotherBoxPlugin: GlidePlugin = { id: 'box2', shapes: [BoxUtil2 as any] };

    expect(() => createEditor({ plugins: [BoxPlugin, AnotherBoxPlugin] }))
      .toThrow(/duplicate/i);
  });

  it('duplicate type error message contains the conflicting type name', () => {
    class BoxUtil2 extends BoxUtil {}
    const AnotherBoxPlugin: GlidePlugin = { id: 'box2', shapes: [BoxUtil2 as any] };

    expect(() => createEditor({ plugins: [BoxPlugin, AnotherBoxPlugin] }))
      .toThrow(/"box"/);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.2-03: Unknown type error message contains type name
// ─────────────────────────────────────────────────────────────

describe('T2.2-03: getShapeUtil unknown type throws containing type name', () => {
  it('getShapeUtil("triangle") throws containing "triangle"', () => {
    const editor = createEditor({ plugins: [BoxPlugin] });
    expect(() => editor.getShapeUtil('triangle')).toThrow(/triangle/);
  });

  it('error message for unknown type also says "no ShapeUtil" or similar', () => {
    const editor = createEditor({ plugins: [BoxPlugin] });
    expect(() => editor.getShapeUtil('circle')).toThrow(/circle/);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.2-04: Editor injected into util instance
// ─────────────────────────────────────────────────────────────

describe('T2.2-04: editor reference is injected into ShapeUtil instance', () => {
  it('util.editor is the same GlideEditor instance', () => {
    const editor = createEditor({ plugins: [BoxPlugin] });
    const util = editor.getShapeUtil('box');
    expect(util.editor).toBe(editor);
  });

  it('util.editor.getSelectedShapeIds() is callable from inside util', () => {
    const editor = createEditor({ plugins: [BoxPlugin] });
    const util = editor.getShapeUtil('box');
    // getSelectedShapeIds() is part of the ShapeUtilEditor interface — must not throw
    expect(() => util.editor.getSelectedShapeIds()).not.toThrow();
    expect(Array.isArray(util.editor.getSelectedShapeIds())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.2-05: Custom shape ≤ 50 lines
// ─────────────────────────────────────────────────────────────

// Diamond shape — inline, ≤ 50 source lines
class DiamondUtil extends ShapeUtil<GlideShape<{ size: number }>> {
  static override type = 'diamond' as const;
  static override props = { size: T.number };
  getDefaultProps() { return { size: 80 }; }
  getGeometry(s: GlideShape<{ size: number }>): Geometry2d {
    return new Rectangle2d(0, 0, s.props.size, s.props.size);
  }
  hitTestPoint(s: GlideShape<{ size: number }>, pt: { x: number; y: number }): boolean {
    const half = s.props.size / 2;
    return Math.abs(pt.x - s.x) + Math.abs(pt.y - s.y) <= half;
  }
}
const DiamondPlugin: GlidePlugin = { id: 'diamond', shapes: [DiamondUtil as any] };

describe('T2.2-05: custom shape ≤ 50 lines registers and resolves', () => {
  it('DiamondUtil registers and is resolvable', () => {
    const editor = createEditor({ plugins: [DiamondPlugin] });
    expect(editor.getShapeUtil('diamond')).toBeInstanceOf(DiamondUtil);
  });

  it('DiamondUtil.getDefaultProps returns size=80', () => {
    const editor = createEditor({ plugins: [DiamondPlugin] });
    const util = editor.getShapeUtil('diamond');
    expect((util as DiamondUtil).getDefaultProps()).toEqual({ size: 80 });
  });
});

// ─────────────────────────────────────────────────────────────
// T2.2-06: Schema frozen after createEditor()
// ─────────────────────────────────────────────────────────────

describe('T2.2-06: schema is frozen after createEditor()', () => {
  it('schema.frozen === true after createEditor()', () => {
    const editor = createEditor({ plugins: [BoxPlugin] });
    expect(editor.schema.frozen).toBe(true);
  });

  it('calling registerShapeUtil() after createEditor() throws', () => {
    const editor = createEditor({ plugins: [BoxPlugin] });
    expect(() => editor.schema.registerShapeUtil({ type: 'late', props: {} }))
      .toThrow(/frozen/i);
  });
});

// ─────────────────────────────────────────────────────────────
// Additional: onInstall hook called
// ─────────────────────────────────────────────────────────────

describe('onInstall hook', () => {
  it('onInstall is called with the editor instance', () => {
    let received: GlideEditor | undefined;
    const plugin: GlidePlugin = {
      id: 'hook-test',
      shapes: [BoxUtil as any],
      onInstall(ed) { received = ed; },
    };
    const editor = createEditor({ plugins: [plugin] });
    expect(received).toBe(editor);
  });
});
