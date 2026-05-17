/**
 * Glideline — Canonical type definitions (Phase 1)
 *
 * Branded ID types prevent mixing shape/binding/page IDs at compile time.
 * All record interfaces follow the LLD §2 schema.
 */

// ─────────────────────────────────────────────────────────────
// Branded IDs
// ─────────────────────────────────────────────────────────────

declare const _brand: unique symbol;
type Brand<T, B> = T & { [_brand]: B };

export type ShapeId   = Brand<string, 'Shape'>;
export type BindingId = Brand<string, 'Binding'>;
export type PageId    = Brand<string, 'Page'>;

export const sid = (id: string): ShapeId     => id as ShapeId;
export const bid = (id: string): BindingId   => id as BindingId;
export const pid = (id: string): PageId      => id as PageId;

// ─────────────────────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────────────────────

export interface Vec2 { x: number; y: number; }

export interface Box2d {
  x: number; y: number;
  w: number; h: number;
  minX: number; minY: number;
  maxX: number; maxY: number;
}

export type EdgeName = 'top' | 'right' | 'bottom' | 'left';

/** Construct a Box2d from origin + dimensions. */
export function makeBox(x: number, y: number, w: number, h: number): Box2d {
  return { x, y, w, h, minX: x, minY: y, maxX: x + w, maxY: y + h };
}

// ─────────────────────────────────────────────────────────────
// Record interfaces
// ─────────────────────────────────────────────────────────────

export interface BaseRecord {
  readonly id: string;
  readonly type: string;
}

/** Every shape record in the store. `props` is typed per-shape via ShapeUtil<S>. */
export interface GlideShape<Props extends Record<string, unknown> = Record<string, unknown>>
  extends BaseRecord {
  readonly id: ShapeId;
  x: number;
  y: number;
  /** Fractional index for z-ordering (e.g. "a1", "a2") */
  index: string;
  /** Rotation in radians */
  rotation: number;
  props: Props;
  meta: Record<string, unknown>;
}

/** Every binding record in the store (e.g. arrow → box). */
export interface GlideBinding<Props extends Record<string, unknown> = Record<string, unknown>>
  extends BaseRecord {
  readonly id: BindingId;
  readonly fromId: ShapeId;
  readonly toId: ShapeId;
  props: Props;
  meta: Record<string, unknown>;
}

/** Convenience alias used internally. */
export type AnyRecord = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────
// Validator types (used by T system in validators.ts)
// ─────────────────────────────────────────────────────────────

export interface Validator<T> {
  validate(value: unknown): T;
}

/** Maps every key in Props to a matching Validator. */
export type GlideProps<Props extends Record<string, unknown>> = {
  [K in keyof Props]: Validator<Props[K]>;
};

// ─────────────────────────────────────────────────────────────
// Migration types (used by defineMigrations in migrations.ts)
// ─────────────────────────────────────────────────────────────

export interface GlideMigrator {
  up(record: AnyRecord): AnyRecord;
  down(record: AnyRecord): AnyRecord;
}

export interface GlideMigrations {
  currentVersion: number;
  /** Key = the version produced by up(). Contiguous from 1..currentVersion. */
  migrators: Record<number, GlideMigrator>;
}

// ─────────────────────────────────────────────────────────────
// Document envelope (serialised format)
// ─────────────────────────────────────────────────────────────

export interface GlideDocument {
  schema: {
    storeVersion: number;
    shapes: Record<string, number>;
    bindings: Record<string, number>;
  };
  records: Array<GlideShape | GlideBinding | AnyRecord>;
}

// ─────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────

export function isGlideBinding(record: AnyRecord): boolean {
  return typeof record['fromId'] === 'string' && typeof record['toId'] === 'string';
}
