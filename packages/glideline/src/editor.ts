/**
 * Glideline — GlideEditor + createEditor() (Phase 2, Story 2.2)
 *
 * GlideEditor is the public API brain. All mutations flow through it.
 * createEditor({ plugins }) is the single entry point — installs plugins,
 * bakes validators into GlideSchema, injects editor reference into each
 * ShapeUtil instance, then freezes the schema.
 *
 * Schema is frozen after init — no late registration accepted.
 */

import { signal, type Signal } from '@preact/signals';
import { GlideStore } from './store';
import { GlideSchema } from './schema';
import { GlideCamera } from './camera';
import type { ShapeUtil, BindingUtil } from './shapes/ShapeUtil';
import type { GlideShape, GlideBinding, ShapeId, BindingId, Vec2, Box2d, AnyRecord } from './types';

// ─────────────────────────────────────────────────────────────
// GlidePlugin — unit of extension
// ─────────────────────────────────────────────────────────────

export interface GlidePlugin {
  id: string;
  shapes?:   (abstract new() => ShapeUtil<any>)[];
  bindings?: (abstract new() => BindingUtil<any>)[];
  onInstall?(editor: GlideEditor): void;
}

// Internal static-side shape of a ShapeUtil class
interface ShapeUtilClass {
  type: string;
  props?: Record<string, { validate(v: unknown): unknown }>;
  migrations?: import('./types').GlideMigrations;
}

// ─────────────────────────────────────────────────────────────
// GlideEditor
// ─────────────────────────────────────────────────────────────

export class GlideEditor {
  readonly store:  GlideStore;
  readonly schema: GlideSchema;
  readonly camera: GlideCamera;

  private _utils   = new Map<string, ShapeUtil<any>>();
  private _selection: Signal<Set<ShapeId>>;

  constructor(store: GlideStore, schema: GlideSchema, camera: GlideCamera) {
    this.store  = store;
    this.schema = schema;
    this.camera = camera;
    this._selection = signal(new Set<ShapeId>());
  }

  // ── Shape util resolution ──────────────────────────────────

  /**
   * Return the ShapeUtil instance for a shape or type string.
   * Throws if the type is not registered — message includes the type name.
   */
  getShapeUtil<S extends GlideShape>(shapeOrType: S | string): ShapeUtil<S> {
    const type = typeof shapeOrType === 'string' ? shapeOrType : shapeOrType.type;
    const util = this._utils.get(type);
    if (!util) {
      throw new Error(
        `GlideEditor: no ShapeUtil registered for type "${type}". ` +
        `Did you forget to include a plugin?`,
      );
    }
    return util as ShapeUtil<S>;
  }

  /** @internal — called by createEditor during plugin installation. */
  _registerUtil(instance: ShapeUtil<any>): void {
    const type = (instance.constructor as ShapeUtilClass).type;
    if (this._utils.has(type)) {
      throw new Error(
        `GlideEditor: duplicate ShapeUtil type "${type}". ` +
        `Two plugins are registering the same type.`,
      );
    }
    instance.editor = this as any;   // inject editor reference
    this._utils.set(type, instance);
  }

  // ── Shape queries ──────────────────────────────────────────

  getShape<S extends GlideShape>(id: ShapeId): S | undefined {
    return this.store.get(id) as S | undefined;
  }

  getShapesAtPoint(point: Vec2): GlideShape[] {
    return this.store.getShapesAtPoint(point.x, point.y) as GlideShape[];
  }

  getShapesInBox(box: Box2d): GlideShape[] {
    return this.store.getShapesInBox(box.minX, box.minY, box.maxX, box.maxY) as GlideShape[];
  }

  // ── Binding queries ────────────────────────────────────────

  getBinding<B extends GlideBinding>(id: BindingId): B | undefined {
    return this.store.get(id) as B | undefined;
  }

  getBindingsFromShape(shapeId: ShapeId): GlideBinding[] {
    return this.store.getBindingsFromShape(shapeId);
  }

  getBindingsToShape(shapeId: ShapeId): GlideBinding[] {
    return this.store.getBindingsToShape(shapeId);
  }

  // ── Shape mutations ────────────────────────────────────────

  createShape(partial: AnyRecord): ShapeId {
    this.store.put([partial]);
    return partial['id'] as ShapeId;
  }

  updateShape<S extends GlideShape>(id: ShapeId, partial: Partial<Omit<S, 'id' | 'type'>>): void {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`GlideEditor: shape "${id}" not found`);
    this.store.put([{ ...existing, ...partial }]);
  }

  deleteShapes(ids: ShapeId[]): void {
    this.store.remove(ids);
  }

  // ── Selection ──────────────────────────────────────────────

  getSelectedShapeIds(): ShapeId[] {
    return Array.from(this._selection.value);
  }

  setSelectedShapeIds(ids: ShapeId[]): void {
    this._selection.value = new Set(ids);
  }

  selectAll(): void {
    // Phase 3 will implement full selectAll; stub returns []
    this._selection.value = new Set();
  }

  // ── Batch / history ────────────────────────────────────────

  batch(fn: () => void): void {
    this.store.batch(fn);
  }

  // ── Camera delegates ───────────────────────────────────────

  screenToPage(point: Vec2): Vec2  { return this.camera.screenToPage(point); }
  pageToScreen(point: Vec2): Vec2  { return this.camera.pageToScreen(point); }
  getViewportBounds(): Box2d       { return this.camera.getViewportBounds(); }

  // ── Persistence ────────────────────────────────────────────

  serialize()                                { return this.store.serialize(); }
  deserialize(doc: ReturnType<GlideStore['serialize']>) { this.store.deserialize(doc); }
}

// ─────────────────────────────────────────────────────────────
// createEditor() — factory / boot sequence
// ─────────────────────────────────────────────────────────────

export interface CreateEditorOptions {
  plugins?: GlidePlugin[];
  viewport?: { width: number; height: number };
  camera?: { x?: number; y?: number; z?: number };
}

/**
 * Boot sequence (LLD §18):
 *  1. Create GlideSchema
 *  2. For each plugin: register each ShapeUtil class (throws on duplicate type)
 *  3. Bake validators + migrations into GlideSchema
 *  4. Freeze schema — no further registration after this point
 *  5. Create GlideStore with the frozen schema
 *  6. Create GlideCamera
 *  7. Create GlideEditor
 *  8. For each plugin: instantiate ShapeUtil, inject editor, register instance
 *  9. Call plugin.onInstall(editor) if provided
 * 10. Return editor
 */
export function createEditor(opts: CreateEditorOptions = {}): GlideEditor {
  const { plugins = [], viewport, camera: camInit } = opts;

  // 1. Schema
  const schema = new GlideSchema();

  // 2+3. Register ShapeUtils (checks for duplicates, bakes validators)
  const seenTypes = new Set<string>();
  for (const plugin of plugins) {
    for (const UtilClass of plugin.shapes ?? []) {
      const type = (UtilClass as unknown as ShapeUtilClass).type;
      if (!type) throw new Error(`Plugin "${plugin.id}": ShapeUtil missing static 'type'`);
      if (seenTypes.has(type)) {
        throw new Error(
          `createEditor: duplicate shape type "${type}" ` +
          `registered by plugin "${plugin.id}". ` +
          `Each type must be unique across all plugins.`,
        );
      }
      seenTypes.add(type);
      schema.registerShapeUtil(UtilClass as unknown as ShapeUtilClass);
    }
  }

  // 4. Freeze schema
  schema.freeze();

  // 5–7. Store + Camera + Editor
  const store  = new GlideStore(schema);
  const cam    = new GlideCamera(camInit ?? {}, viewport?.width ?? 1000, viewport?.height ?? 600);
  const editor = new GlideEditor(store, schema, cam);

  // 8. Instantiate + inject each ShapeUtil
  for (const plugin of plugins) {
    for (const UtilClass of plugin.shapes ?? []) {
      const instance = new (UtilClass as any)() as ShapeUtil<any>;
      editor._registerUtil(instance);  // injects editor + checks duplicate
    }
  }

  // 9. onInstall hooks
  for (const plugin of plugins) {
    plugin.onInstall?.(editor);
  }

  return editor;
}
