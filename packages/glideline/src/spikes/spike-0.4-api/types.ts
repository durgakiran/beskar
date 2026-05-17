/**
 * Spike 0.4 — Plugin API Core Types (revised)
 *
 * Key changes from initial design:
 *  - ShapeUtil is now an ABSTRACT CLASS (not interface) with static `props` + `migrations`
 *  - Runtime prop validators live ON the ShapeUtil class (tldraw-inspired)
 *  - `defineMigrations()` helper — co-located, versioned, up/down per step
 *  - Document envelope type for save/load with schema version header
 *  - Unknown-type preservation on load guaranteed by GlideDocument contract
 */

import type { ReactNode } from "react";

// ─────────────────────────────────────────────────────────────
// Branded ID types — prevent mixing shape/binding/page IDs
// ─────────────────────────────────────────────────────────────

declare const _brand: unique symbol;
type Brand<T, B> = T & { [_brand]: B };

export type ShapeId   = Brand<string, "Shape">;
export type BindingId = Brand<string, "Binding">;
export type PageId    = Brand<string, "Page">;

export function sid(id: string): ShapeId     { return id as ShapeId; }
export function bid(id: string): BindingId   { return id as BindingId; }

// ─────────────────────────────────────────────────────────────
// Base Records
// ─────────────────────────────────────────────────────────────

export interface BaseRecord {
  readonly id: string;
  readonly type: string;
}

/**
 * Every shape record in the store.
 * `props` is typed per-shape via ShapeUtil<T>.
 */
export interface GlideShape<Props extends Record<string, unknown> = Record<string, unknown>> extends BaseRecord {
  readonly id: ShapeId;
  readonly type: string;
  /** Page-space position */
  x: number;
  y: number;
  /** Fractional index for z-ordering (e.g. "a1", "a2") */
  index: string;
  /** Rotation in radians */
  rotation: number;
  /** Shape-specific data */
  props: Props;
  /** Arbitrary metadata for plugins */
  meta: Record<string, unknown>;
}

/**
 * Every binding record in the store.
 * Bindings relate two shapes (e.g. arrow → box).
 */
export interface GlideBinding<Props extends Record<string, unknown> = Record<string, unknown>> extends BaseRecord {
  readonly id: BindingId;
  readonly type: string;
  readonly fromId: ShapeId;
  readonly toId: ShapeId;
  props: Props;
  meta: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Geometry primitives
// ─────────────────────────────────────────────────────────────

export interface Box2d {
  x: number; y: number;
  w: number; h: number;
  /** Derived */
  readonly minX: number; readonly minY: number;
  readonly maxX: number; readonly maxY: number;
}

export interface Vec2 { x: number; y: number; }

export type EdgeName = "top" | "right" | "bottom" | "left";

// ─────────────────────────────────────────────────────────────
// Runtime prop validators (T system — tldraw-inspired)
// Lightweight O(1) checks run on every store put().
// Replaces Zod for store-internal validation.
// ─────────────────────────────────────────────────────────────

export interface Validator<T> {
  validate(value: unknown): T;
}

/** Validator factory — mirrors tldraw's `T` object */
export const T = {
  number: { validate: (v: unknown) => {
    if (typeof v !== "number") throw new Error(`Expected number, got ${typeof v}`);
    return v as number;
  }} as Validator<number>,

  string: { validate: (v: unknown) => {
    if (typeof v !== "string") throw new Error(`Expected string, got ${typeof v}`);
    return v as string;
  }} as Validator<string>,

  boolean: { validate: (v: unknown) => {
    if (typeof v !== "boolean") throw new Error(`Expected boolean, got ${typeof v}`);
    return v as boolean;
  }} as Validator<boolean>,

  literal<V extends string | number | boolean>(expected: V): Validator<V> {
    return { validate: (v) => {
      if (v !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(v)}`);
      return v as V;
    }};
  },

  optional<T>(inner: Validator<T>): Validator<T | undefined> {
    return { validate: (v) => v === undefined ? undefined : inner.validate(v) };
  },

  union<T>(...validators: Validator<T>[]): Validator<T> {
    return { validate: (v) => {
      for (const val of validators) {
        try { return val.validate(v); } catch { /* try next */ }
      }
      throw new Error(`Value did not match any union member: ${JSON.stringify(v)}`);
    }};
  },
};

/** Map of field names to validators — defines the shape's props schema */
export type GlideProps<Props extends Record<string, unknown>> = {
  [K in keyof Props]: Validator<Props[K]>;
};

// ─────────────────────────────────────────────────────────────
// Migrations — co-located on ShapeUtil (tldraw-inspired)
// ─────────────────────────────────────────────────────────────

export interface GlideMigrator {
  /** Transform an older record up to this version */
  up(record: Record<string, unknown>): Record<string, unknown>;
  /** Transform a newer record down to the previous version (for older peers) */
  down(record: Record<string, unknown>): Record<string, unknown>;
}

export interface GlideMigrations {
  /** The latest version this ShapeUtil produces */
  currentVersion: number;
  /** One entry per version step. Key = the version number produced by `up()`. */
  migrators: Record<number, GlideMigrator>;
}

/**
 * Helper to define migrations for a ShapeUtil.
 * Validates that the version sequence is contiguous at definition time.
 */
export function defineMigrations(def: GlideMigrations): GlideMigrations {
  const keys = Object.keys(def.migrators).map(Number).sort((a, b) => a - b);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== i + 1) {
      throw new Error(
        `defineMigrations: version sequence must be contiguous starting at 1. ` +
        `Got ${JSON.stringify(keys)}`
      );
    }
  }
  if (keys.length > 0 && keys[keys.length - 1] !== def.currentVersion) {
    throw new Error(
      `defineMigrations: last migrator version (${keys[keys.length - 1]}) ` +
      `must equal currentVersion (${def.currentVersion})`
    );
  }
  return def;
}

// ─────────────────────────────────────────────────────────────
// Document envelope — serialised format for save/load
// ─────────────────────────────────────────────────────────────

/**
 * The on-disk / over-the-wire format for a Glideline document.
 *
 * The `schema` header lets the loader know what version each shape type
 * was at when the document was saved, so it can run the correct migrators.
 */
export interface GlideDocument {
  schema: {
    /** Global store schema version (incremented when record types are added/removed) */
    storeVersion: number;
    /** Per-shape-type version at save time. Key = shape type string. */
    shapes: Record<string, number>;
    /** Per-binding-type version at save time. */
    bindings: Record<string, number>;
  };
  /** All records in the document. Unknown types preserved as-is. */
  records: Array<GlideShape | GlideBinding | Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────
// ShapeUtil — abstract class (tldraw-inspired)
// ─────────────────────────────────────────────────────────────

/**
 * Extend this class to define a new shape type.
 *
 * Static properties are read at editor init time:
 *   - `type`       — must be unique across all registered plugins
 *   - `props`      — runtime validator map, run on every store put()
 *   - `migrations` — versioned up/down functions for data evolution
 *
 * Instance methods are called at runtime:
 *   - `getDefaultProps()` — called when user creates a new shape
 *   - `getGeometry()`     — bounding box, used by RBush + hit testing
 *   - `component()`       — React render, called every frame shape is visible
 *   - `indicator()`       — React render, only when selected
 */
export abstract class ShapeUtil<S extends GlideShape = GlideShape> {
  /** Must match `shape.type` — unique across all registered plugins */
  static readonly type: string;

  /**
   * Runtime prop validators. Validated on every `store.put()`.
   * Must cover every field in `S['props']`.
   *
   * Example:
   *   static props = { w: T.number, h: T.number, label: T.string };
   */
  static readonly props: GlideProps<Record<string, unknown>>;

  /**
   * Migration sequence for this shape type.
   * Use `defineMigrations()` to construct — validates sequence at init.
   *
   * Example:
   *   static migrations = defineMigrations({
   *     currentVersion: 2,
   *     migrators: {
   *       1: { up: (r) => ({ ...r, props: { ...r.props, opacity: 1 } }), down: (r) => r },
   *       2: { up: (r) => ({ ...r, props: { ...r.props, cornerRadius: 0 } }), down: (r) => r },
   *     }
   *   });
   */
  static readonly migrations?: GlideMigrations;

  /** Injected by editor after registration */
  editor!: GlideEditor;

  /** Return default props for a new shape. Called when tool creates a shape. */
  abstract getDefaultProps(): S["props"];

  /**
   * Axis-aligned bounding box in page space.
   * Used by: RBush spatial index, selection handles, hit testing.
   */
  abstract getGeometry(shape: S): Box2d;

  /**
   * React element to render the shape.
   * Runs inside an SVG `<g>` transformed to page space.
   * Must be fast — called on every frame the shape is visible.
   */
  abstract component(shape: S): ReactNode;

  /**
   * React element rendered ONLY when the shape is selected.
   * `null` = no selection indicator.
   */
  abstract indicator(shape: S): ReactNode | null;

  /** Override for non-rectangular shapes. Default: AABB check via getGeometry(). */
  hitTestPoint(shape: S, point: Vec2): boolean {
    const b = this.getGeometry(shape);
    return point.x >= b.minX && point.x <= b.maxX && point.y >= b.minY && point.y <= b.maxY;
  }

  /** Can this shape contain other shapes? (frames, groups) */
  canContain(_shape: S): boolean { return false; }

  /** Return false to block deletion. */
  onBeforeDelete(_shape: S): boolean | void { return true; }
}

// ─────────────────────────────────────────────────────────────
// BindingUtil — the plugin contract for a relation type
// ─────────────────────────────────────────────────────────────

export interface BindingUtil<B extends GlideBinding = GlideBinding> {
  /** Must match `binding.type` */
  readonly type: string;

  defaultProps(): B["props"];

  /**
   * Called after EITHER the `from` or `to` shape changes (moves/resizes).
   * Use this to recompute the arrow's terminal point.
   * Update the arrow shape via `editor.updateShape(...)`.
   */
  onAfterChangeToShape?(binding: B, editor: GlideEditor): void;
  onAfterChangeFromShape?(binding: B, editor: GlideEditor): void;

  /**
   * Called before the `to` shape is deleted.
   * Typically: delete the binding and detach the arrow.
   */
  onBeforeDeleteToShape?(binding: B, editor: GlideEditor): void;
  onBeforeDeleteFromShape?(binding: B, editor: GlideEditor): void;
}

// ─────────────────────────────────────────────────────────────
// Tool / StateNode — hierarchical interaction FSM
// ─────────────────────────────────────────────────────────────

export interface PointerInfo {
  point: Vec2;          // Page-space
  shapeId?: ShapeId;   // Shape under cursor (if any)
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export abstract class StateNode {
  static readonly id: string;
  /** Child state classes. Active child handles events first. */
  static readonly children?: () => (typeof StateNode)[];
  static readonly initial?: string;

  /** Injected by the editor on registration */
  editor!: GlideEditor;
  parent!: StateNode;

  /** Active child state */
  protected _current?: StateNode;

  get current(): StateNode | undefined { return this._current; }

  transition(id: string, info?: unknown): void {
    const ChildClass = (this.constructor as typeof StateNode).children?.()
      .find(C => C.id === id);
    if (!ChildClass) throw new Error(`StateNode: unknown child "${id}"`);
    const child = new (ChildClass as any)();
    child.editor = this.editor;
    child.parent = this;
    this._current?.onExit?.();
    this._current = child;
    child.onEnter?.(info);
  }

  onEnter?(info?: unknown): void;
  onExit?(): void;

  onPointerDown?(info: PointerInfo): void;
  onPointerMove?(info: PointerInfo): void;
  onPointerUp?(info: PointerInfo): void;
  onKeyDown?(key: string, info: KeyboardEvent): void;
  onKeyUp?(key: string, info: KeyboardEvent): void;
}

// ─────────────────────────────────────────────────────────────
// GlidePlugin — the registration unit
// ─────────────────────────────────────────────────────────────

export interface GlidePlugin {
  /** Unique plugin identifier */
  id: string;
  /** Shape util CLASSES (not instances) this plugin provides */
  shapes?: (typeof ShapeUtil<any>)[];
  /** Binding util CLASSES this plugin provides */
  bindings?: (typeof BindingUtil<any>)[];
  /** Tool state machine classes */
  tools?: (typeof StateNode)[];
  /** Called once when plugin is installed into an editor */
  onInstall?(editor: GlideEditor): void;
}

// ─────────────────────────────────────────────────────────────
// GlideEditor — the runtime API available to plugins + consumers
// ─────────────────────────────────────────────────────────────

export interface GlideEditor {
  // ── Shape queries ──────────────────────────────────────────
  getShape<S extends GlideShape>(id: ShapeId): S | undefined;
  getShapeUtil<S extends GlideShape>(shape: S): ShapeUtil<S>;
  getShapesAtPoint(point: Vec2): GlideShape[];
  getShapesInBox(box: Box2d): GlideShape[];

  // ── Shape mutations ────────────────────────────────────────
  createShape(partial: Omit<GlideShape, "index"> & Partial<Pick<GlideShape, "index">>): ShapeId;
  updateShape<S extends GlideShape>(id: ShapeId, partial: Partial<Omit<S, "id" | "type">>): void;
  deleteShapes(ids: ShapeId[]): void;

  // ── Binding queries ────────────────────────────────────────
  getBinding<B extends GlideBinding>(id: BindingId): B | undefined;
  getBindingsFromShape(shapeId: ShapeId): GlideBinding[];
  getBindingsToShape(shapeId: ShapeId): GlideBinding[];

  // ── Binding mutations ──────────────────────────────────────
  createBinding(partial: Omit<GlideBinding, "id">): BindingId;
  updateBinding<B extends GlideBinding>(id: BindingId, partial: Partial<B["props"]>): void;
  deleteBindings(ids: BindingId[]): void;

  // ── Selection ──────────────────────────────────────────────
  getSelectedShapeIds(): ShapeId[];
  setSelectedShapeIds(ids: ShapeId[]): void;
  selectAll(): void;

  // ── Tool ──────────────────────────────────────────────────
  setCurrentTool(id: string, info?: unknown): void;
  getCurrentTool(): StateNode;

  // ── History ───────────────────────────────────────────────
  undo(): void;
  redo(): void;
  /**
   * Wrap mutations in a named history entry.
   * `{ history: 'ignore' }` — changes bypass undo stack (for AI/MCP actions).
   */
  batch(label: string, fn: () => void, opts?: { history?: "record" | "ignore" }): void;

  // ── Camera ────────────────────────────────────────────────
  screenToPage(point: Vec2): Vec2;
  pageToScreen(point: Vec2): Vec2;

  // ── Plugin installation (internal — call via createEditor) ─
  _installPlugin(plugin: GlidePlugin): void;
}
