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
export type AssetId   = Brand<string, 'Asset'>;

export const sid = (id: string): ShapeId     => id as ShapeId;
export const bid = (id: string): BindingId   => id as BindingId;
export const pid = (id: string): PageId      => id as PageId;
export const aid = (id: string): AssetId     => id as AssetId;

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

export type KnownRecordKind = 'shape' | 'binding' | 'page' | 'asset';
export type RecordKind = KnownRecordKind | 'opaque' | (string & {});

export interface RecordReferenceDescriptor {
  /** JSON Pointer to an ID-valued field, for example /props/start/boundShapeId. */
  readonly path: string;
  readonly targetKind?: KnownRecordKind;
  readonly onDetach?: 'delete' | 'null';
}

export interface BaseRecord {
  readonly id: string;
  /** Required in persisted/store-v2 records; optional on legacy creation input. */
  readonly kind?: RecordKind;
  readonly type: string;
  /** Required in persisted/store-v2 records; inferred for legacy creation input. */
  readonly schemaVersion?: number;
}

/** Every shape record in the store. `props` is typed per-shape via ShapeUtil<S>. */
export interface GlideShape<Props extends object = Record<string, unknown>>
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
export interface GlideBinding<Props extends object = Record<string, unknown>>
  extends BaseRecord {
  readonly id: BindingId;
  readonly fromId: ShapeId;
  readonly toId: ShapeId;
  props: Props;
  meta: Record<string, unknown>;
}

export interface GlidePage extends BaseRecord {
  readonly id: PageId;
  readonly kind?: 'page';
  name: string;
  meta: Record<string, unknown>;
}

export interface GlideAsset extends BaseRecord {
  readonly id: AssetId;
  readonly kind?: 'asset';
  props: Record<string, unknown>;
  meta: Record<string, unknown>;
}

/** Convenience alias used internally. */
export type AnyRecord = Record<string, unknown>;

/** Recursively read-only JSON-compatible data exposed by the store. */
export type DeepReadonly<T> =
  T extends string | number | boolean | null ? T
    : T extends readonly (infer U)[] ? readonly DeepReadonly<U>[]
      : T extends Record<string, unknown> ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

// ─────────────────────────────────────────────────────────────
// Validator types (used by T system in validators.ts)
// ─────────────────────────────────────────────────────────────

export interface Validator<T> {
  validate(value: unknown): T;
}

/** Maps every key in Props to a matching Validator. */
export type GlideProps<Props extends object> = {
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
  records: Array<GlideShape | GlideBinding | GlidePage | GlideAsset | AnyRecord>;
}

// ─────────────────────────────────────────────────────────────
// Type guards
// ─────────────────────────────────────────────────────────────

export function isGlideBinding(record: AnyRecord): boolean {
  if (record['kind'] !== undefined) return record['kind'] === 'binding';
  return typeof record['fromId'] === 'string' && typeof record['toId'] === 'string';
}

export function isGlideShape(record: AnyRecord): boolean {
  if (record['kind'] !== undefined) return record['kind'] === 'shape';
  return !isGlideBinding(record)
    && typeof record['x'] === 'number'
    && typeof record['y'] === 'number'
    && typeof record['rotation'] === 'number'
    && typeof record['index'] === 'string';
}
