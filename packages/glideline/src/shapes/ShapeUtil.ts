/**
 * Glideline — ShapeUtil abstract class (Phase 1)
 *
 * Extend this class to register a new shape type with the engine.
 * Static members (type, props, migrations) are read at editor init.
 * Instance methods are called at runtime by the rendering pipeline.
 */

import type {
  GlideShape, GlideBinding, Box2d, Vec2, GlideProps, GlideMigrations, ShapeId,
  RecordReferenceDescriptor,
} from '../types.js';
import type { Geometry2d } from '../geometry/index.js';
import { getMinHeightForShape, type LabelProps } from '../styles.js';
import type { EditableTextValue } from '../text-edit.js';

// Re-export LabelProps so consumers can import from ShapeUtil directly
export type { LabelProps };

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ResizeInfo<S extends GlideShape<object> = GlideShape> {
  handle: ResizeHandle;
  scaleX: number;
  scaleY: number;
  initialShape: S;
  initialBounds: Box2d;
  newBounds: Box2d;
}

export interface RichTextDescriptor {
  readonly value: unknown;
  readonly fallbackText: string;
  readonly w: number;
  readonly h: number;
  readonly sizeMode: 'auto' | 'fixed-width' | 'fixed';
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly color: string;
  readonly textAlign: 'left' | 'center' | 'right';
  readonly lineHeight: number;
}

// Re-export for convenience
export type { GlideProps, GlideMigrations };

/** Minimal editor interface needed by ShapeUtil (grows in Phase 3). */
export interface ShapeUtilEditor {
  getShape<S extends GlideShape<object>>(id: S['id']): S | undefined;
  getSelectedShapeIds(): ShapeId[];
  updateShape<S extends GlideShape<object>>(id: S['id'], patch: Partial<S>): void;
  getChildren(parentId: string): GlideShape[];
  getShapeLocalBounds(id: ShapeId): Box2d;
  getShapeLocalOutline(id: ShapeId): readonly Vec2[];
  getShapeWorldBounds(id: ShapeId): Box2d;
  localToPage(id: ShapeId, point: Vec2): Vec2;
  pageToLocal(id: ShapeId, point: Vec2): Vec2;
}

export abstract class ShapeUtil<S extends GlideShape<object> = GlideShape> {
  /** Unique type string — must match shape.type. */
  static readonly type: string;

  /** Schema-level capability used to validate shape parents. */
  static readonly canContainChildren: boolean = false;

  /**
   * Runtime prop validators. Validated on every store.put().
   * Must cover every key in S['props'].
   *
   * Example:
   *   static props = { w: T.number, h: T.number };
   */
  static readonly props: GlideProps<Record<string, unknown>>;

  /**
   * Migration sequence. Use defineMigrations() to construct.
   *
   * Example:
   *   static migrations = defineMigrations({ currentVersion: 2, migrators: { ... } });
   */
  static readonly migrations?: GlideMigrations;
  static readonly references?: readonly RecordReferenceDescriptor[];

  /** Injected by the editor after registration. */
  editor!: ShapeUtilEditor;

  /** Return default props when creating a new shape. */
  abstract getDefaultProps(): S['props'];

  /** Intrinsic geometry in shape-local space. Page geometry comes from TransformService. */
  abstract getGeometry(shape: S): Geometry2d;

  /** Override for non-rectangular shapes. Default: AABB check. */
  hitTestPoint(shape: S, point: Vec2): boolean {
    if (this.getGeometry(shape).hitTestPoint(point)) return true;
    const label = this.getLabelProps(shape);
    return Boolean(
      label?.text
      && label.x !== undefined
      && label.y !== undefined
      && label.w !== undefined
      && label.h !== undefined
      && point.x >= label.x
      && point.x <= label.x + label.w
      && point.y >= label.y
      && point.y <= label.y + label.h,
    );
  }

  /** Local bounds used by culling/export. Override when content extends past geometry. */
  getVisualBounds(shape: S): Box2d {
    return this.getGeometry(shape).getBounds();
  }

  /** Can this shape contain other shapes? (frames, groups) */
  canContain(_shape: S): boolean { return false; }

  /** Return false to block deletion. */
  onBeforeDelete(_shape: S): boolean | void { return true; }

  /**
   * Return true to suppress the 8-point resize handles for this shape.
   * Arrows return true — they are resized via terminal handle drags instead.
   */
  hideResizeHandles(_shape: S): boolean { return false; }

  /** Return the resize handles supported by this shape. */
  getResizeHandles(_shape: S): readonly ResizeHandle[] {
    return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  }

  /**
   * Return true to suppress the circular rotate handle for this shape.
   * Arrows return true — rotation is handled by orbiting shape.x/y in DraggingRotation.
   */
  hideRotateHandle(_shape: S): boolean { return false; }

  /**
   * Called when the shape is resized.
   * Default implementation performs proportional scaling.
   */
  onResize(shape: S, info: ResizeInfo<S>): Partial<S> {
    const { initialBounds, newBounds, initialShape } = info;
    const { minX: bx, minY: by, w: bw, h: bh } = newBounds;

    const relX = (initialShape.x - initialBounds.minX) / initialBounds.w;
    const relY = (initialShape.y - initialBounds.minY) / initialBounds.h;
    const relW = ((initialShape.props as any).w ?? initialBounds.w) / initialBounds.w;
    const relH = ((initialShape.props as any).h ?? initialBounds.h) / initialBounds.h;

    const newX = bx + relX * bw;
    let newY = by + relY * bh;
    const newW = Math.max(1, relW * bw);
    let newH = Math.max(1, relH * bh);

    // Calculate minimum height required for text label
    const minH = getMinHeightForShape(initialShape as any, newW);
    if (newH < minH) {
      if (info.handle.includes('n')) {
        // Top edge is moving; keep bottom edge anchored
        const oldBottom = initialShape.y + ((initialShape.props as any).h ?? initialBounds.h);
        newY = oldBottom - minH;
      }
      newH = minH;
    }

    return {
      x: newX,
      y: newY,
      props: {
        ...(initialShape.props as any),
        w: newW,
        h: newH,
      },
    } as Partial<S>;
  }

  /**
   * Return SVG elements for interactive canvas rendering.
   * Geometry ONLY — no text labels, no foreignObject.
   * Output goes into a per-shape <svg overflow:visible> in the HTML div layer.
   * Default: returns an empty <g> (for shapes that have no visible SVG geometry).
   */
  toSvg(_shape: S): SVGElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'g');
  }

  /**
   * Return CSS label properties for the HTML label overlay div.
   * Return null if this shape has no text label.
   * Default: null.
   */
  getLabelProps(_shape: S): LabelProps | null { return null; }

  /** Renderer-neutral rich-text data. React/TipTap remain owned by Glideboard. */
  getRichTextDescriptor(_shape: S): RichTextDescriptor | null { return null; }

  /** Hit-test the rendered text itself rather than the shape geometry. */
  hitTestLabel(shape: S, point: Vec2): boolean {
    const label = this.getLabelProps(shape);
    if (!label?.text) return false;
    const geometry = this.getGeometry(shape).getBounds();
    const areaX = label.x ?? geometry.minX + label.padding;
    const areaY = label.y ?? geometry.minY + label.padding;
    const areaW = label.w ?? Math.max(0, geometry.w - label.padding * 2);
    const areaH = label.h ?? Math.max(0, geometry.h - label.padding * 2);
    if (
      label.x !== undefined
      || label.y !== undefined
      || label.w !== undefined
      || label.h !== undefined
    ) {
      return point.x >= areaX && point.x <= areaX + areaW
        && point.y >= areaY && point.y <= areaY + areaH;
    }

    const lines = label.text.split('\n');
    const textW = Math.min(
      areaW,
      Math.max(label.fontSize * 0.6, ...lines.map(line => line.length * label.fontSize * 0.6)),
    );
    const textH = Math.min(areaH, Math.max(label.fontSize * 1.35, lines.length * label.fontSize * 1.35));
    const textX = label.textAlign === 'left'
      ? areaX
      : label.textAlign === 'right'
        ? areaX + areaW - textW
        : areaX + (areaW - textW) / 2;
    const textY = label.verticalAlign === 'center'
      ? areaY + (areaH - textH) / 2
      : areaY;
    return point.x >= textX && point.x <= textX + textW
      && point.y >= textY && point.y <= textY + textH;
  }

  canEditLabel(shape: S): boolean {
    return this.getEditableText(shape) !== null && this.getLabelProps(shape) !== null;
  }

  getEditableText(shape: S): EditableTextValue | null {
    const props = shape.props as Record<string, unknown>;
    if (typeof props['label'] === 'string') return { field: 'label', value: props['label'] };
    if (typeof props['text'] === 'string') return { field: 'text', value: props['text'] };
    return null;
  }

  /**
   * Return shape-owned props to preview and commit when text editing starts at
   * a page point. Default labels do not need positional edit props.
   */
  getTextEditProps(_shape: S, _pagePoint: Vec2): Readonly<Record<string, unknown>> | null {
    return null;
  }

  /** Return only the edit-owned field so concurrent style changes survive. */
  getTextCommitPatch(
    latestShape: S,
    draft: string,
    _pendingProps?: Readonly<Record<string, unknown>>,
  ): Partial<S> {
    const editable = this.getEditableText(latestShape);
    if (!editable) throw new Error(`Shape "${latestShape.id}" does not support text editing.`);
    return { props: { [editable.field]: draft } as S['props'] } as Partial<S>;
  }

  /**
   * Return SVG elements for SVG/PNG export.
   * May include foreignObject for text labels.
   * Default: delegates to toSvg() — shapes without labels get identical output.
   */
  toSvgExport(shape: S): SVGElement { return this.toSvg(shape); }
}

// ─────────────────────────────────────────────────────────────
// BindingUtil — abstract class for relation types
// ─────────────────────────────────────────────────────────────

export abstract class BindingUtil<B extends GlideBinding<object> = GlideBinding> {
  static readonly type: string;
  static readonly props: GlideProps<Record<string, unknown>>;
  static readonly migrations?: GlideMigrations;
  static readonly references?: readonly RecordReferenceDescriptor[];

  editor!: ShapeUtilEditor;

  abstract getDefaultProps(): B['props'];

  onAfterChangeToShape?(binding: B): void;
  onAfterChangeFromShape?(binding: B): void;
  onBeforeDeleteToShape?(binding: B): void;
  onBeforeDeleteFromShape?(binding: B): void;
}
