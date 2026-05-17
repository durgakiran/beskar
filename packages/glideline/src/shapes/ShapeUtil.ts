/**
 * Glideline — ShapeUtil abstract class (Phase 1)
 *
 * Extend this class to register a new shape type with the engine.
 * Static members (type, props, migrations) are read at editor init.
 * Instance methods are called at runtime by the rendering pipeline.
 */

import type { GlideShape, GlideBinding, Box2d, Vec2, GlideProps, GlideMigrations, ShapeId } from '../types';

// Re-export for convenience
export type { GlideProps, GlideMigrations };

/** Minimal editor interface needed by ShapeUtil (grows in Phase 3). */
export interface ShapeUtilEditor {
  getShape<S extends GlideShape>(id: S['id']): S | undefined;
  getSelectedShapeIds(): ShapeId[];
}

export abstract class ShapeUtil<S extends GlideShape = GlideShape> {
  /** Unique type string — must match shape.type. */
  static readonly type: string;

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

  /** Injected by the editor after registration. */
  editor!: ShapeUtilEditor;

  /** Return default props when creating a new shape. */
  abstract getDefaultProps(): S['props'];

  /**
   * Axis-aligned bounding box in page space.
   * Used by the RBush spatial index, selection handles, and hit testing.
   */
  abstract getGeometry(shape: S): Box2d;

  /** Override for non-rectangular shapes. Default: AABB check. */
  hitTestPoint(shape: S, point: Vec2): boolean {
    const b = this.getGeometry(shape);
    return point.x >= b.minX && point.x <= b.maxX &&
           point.y >= b.minY && point.y <= b.maxY;
  }

  /** Can this shape contain other shapes? (frames, groups) */
  canContain(_shape: S): boolean { return false; }

  /** Return false to block deletion. */
  onBeforeDelete(_shape: S): boolean | void { return true; }
}

// ─────────────────────────────────────────────────────────────
// BindingUtil — abstract class for relation types
// ─────────────────────────────────────────────────────────────

export abstract class BindingUtil<B extends GlideBinding = GlideBinding> {
  static readonly type: string;
  static readonly props: GlideProps<Record<string, unknown>>;
  static readonly migrations?: GlideMigrations;

  editor!: ShapeUtilEditor;

  abstract getDefaultProps(): B['props'];

  onAfterChangeToShape?(binding: B): void;
  onAfterChangeFromShape?(binding: B): void;
  onBeforeDeleteToShape?(binding: B): void;
  onBeforeDeleteFromShape?(binding: B): void;
}
