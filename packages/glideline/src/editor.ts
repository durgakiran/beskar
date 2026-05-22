/**
 * Glideline — GlideEditor + createEditor() (Phase 2–4)
 *
 * GlideEditor is the public API brain. All mutations flow through it.
 * createEditor({ plugins, tools }) is the single entry point.
 *
 * Phase 3 additions:
 *  - history: HistoryManager (undo/redo/batch)
 *  - tools: StateNode FSM (setCurrentTool / getCurrentTool / dispatchEvent)
 *  - selectAll() now returns all shape IDs
 *
 * Phase 4 additions:
 *  - BindingUtil registry (per-type, parallel to ShapeUtil)
 *  - createBinding / updateBinding / deleteBinding
 *  - deleteShapes calls onBeforeDeleteToShape + cascades fromId bindings
 *  - updateShape calls onAfterChangeToShape for all bindings to the shape
 */

import { signal, batch as preactBatch, type Signal } from '@preact/signals';
import { sid, makeBox } from './types';
import { GlideStore } from './store';
import { GlideSchema } from './schema';
import { GlideCamera } from './camera';
import { HistoryManager } from './history';
import { Rectangle2d } from './geometry';
import { StateNode } from './state-node';
import { SelectTool } from './tools/SelectTool';
import { BoxTool } from './tools/BoxTool';
import type { ShapeUtil, BindingUtil } from './shapes/ShapeUtil';
import type { GlideShape, GlideBinding, ShapeId, BindingId, Vec2, Box2d, AnyRecord } from './types';
import type { GlideEvent } from './state-node';

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
  readonly store:   GlideStore;
  readonly schema:  GlideSchema;
  readonly camera:  GlideCamera;
  readonly history: HistoryManager;
  private _clipboard: GlideShape[] = [];
  arrowRouteStyle: 'curve' | 'ortho' = 'curve';

  private _utils        = new Map<string, ShapeUtil<any>>();
  private _bindingUtils = new Map<string, BindingUtil<any>>();
  private _selection: Signal<Set<ShapeId>>;
  private _tools    = new Map<string, StateNode>();
  private _currentToolSignal: Signal<StateNode | null> = signal(null);

  /** Reactive signal of the active tool id — subscribe in UI for live highlight. */
  readonly currentToolId: Signal<string> = signal('select');

  /** Signal carrying the ID of the shape currently being inline-edited, or null. */
  readonly editingShapeId: Signal<ShapeId | null> = signal(null);

  /** Signal carrying the set of shape IDs marked for erasure during an eraser drag.
   *  Empty set when the eraser is not active. EraserTool writes; ShapeLayer reads. */
  readonly erasingShapeIds: Signal<ReadonlySet<ShapeId>> = signal(new Set<ShapeId>());

  constructor(store: GlideStore, schema: GlideSchema, camera: GlideCamera) {
    this.store   = store;
    this.schema  = schema;
    this.camera  = camera;
    this.history = new HistoryManager(store);
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

  /** @internal — called by createEditor for each BindingUtil. */
  _registerBindingUtil(instance: BindingUtil<any>): void {
    const type = (instance.constructor as ShapeUtilClass).type;
    if (this._bindingUtils.has(type)) {
      throw new Error(
        `GlideEditor: duplicate BindingUtil type "${type}". ` +
        `Two plugins are registering the same binding type.`,
      );
    }
    instance.editor = this as any;
    this._bindingUtils.set(type, instance);
  }

  /** Return the BindingUtil for a given binding type, or undefined. */
  getBindingUtil<B extends GlideBinding>(bindingOrType: B | string): BindingUtil<B> | undefined {
    const type = typeof bindingOrType === 'string' ? bindingOrType : bindingOrType.type;
    return this._bindingUtils.get(type) as BindingUtil<B> | undefined;
  }

  // ── Shape queries ──────────────────────────────────────────

  getShape<S extends GlideShape>(id: ShapeId): S | undefined {
    return this.store.get(id) as S | undefined;
  }

  getShapeIdsSignal(): Signal<ShapeId[]> {
    return this.store.getShapeIdsSignal();
  }

  getShapesInViewport(): GlideShape[] {
    const box = this.getViewportBounds();
    return this.getShapesInBox(box);
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
    const type = partial['type'] as string;
    const util = this._utils.get(type);
    if (util) {
      const defaultProps = util.getDefaultProps();
      const userProps = partial['props'] as AnyRecord || {};
      partial['props'] = { ...defaultProps, ...userProps };
    }
    this.store.put([partial]);
    return partial['id'] as ShapeId;
  }

  updateShape<S extends GlideShape>(id: ShapeId, partial: Partial<Omit<S, 'id' | 'type'>>): void {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`GlideEditor: shape "${id}" not found`);
    const newShape = { ...existing, ...partial } as any;
    if (partial.props && existing.props) {
      newShape.props = { ...existing.props, ...(partial.props as any) };
    }
    this.store.put([newShape]);
    // Fire onAfterChangeToShape for all bindings pointing to this shape
    const bindings = this.store.getBindingsToShape(id);
    for (const binding of bindings) {
      const util = this._bindingUtils.get(binding.type);
      util?.onAfterChangeToShape?.(binding);
    }
  }

  deleteShapes(ids: ShapeId[]): void {
    for (const id of ids) {
      // 1. Fire onBeforeDeleteToShape for bindings pointing to this shape
      const bindingsTo = this.store.getBindingsToShape(id);
      for (const binding of bindingsTo) {
        const util = this._bindingUtils.get(binding.type);
        util?.onBeforeDeleteToShape?.(binding);
      }
      // 2. Remove those bindings from the store
      this.store.remove(bindingsTo.map(b => b.id));

      // 3. Fire onBeforeDeleteFromShape + remove bindings from this shape
      const bindingsFrom = this.store.getBindingsFromShape(id);
      for (const binding of bindingsFrom) {
        const util = this._bindingUtils.get(binding.type);
        util?.onBeforeDeleteFromShape?.(binding);
      }
      this.store.remove(bindingsFrom.map(b => b.id));
    }
    // 4. Finally remove the shapes themselves
    this.store.remove(ids);
  }

  // ── Binding mutations ──────────────────────────────────────

  createBinding(partial: AnyRecord): BindingId {
    this.store.put([partial]);
    return partial['id'] as BindingId;
  }

  updateBinding(id: BindingId, partialProps: AnyRecord): void {
    const existing = this.store.get(id);
    if (!existing) return; // binding may have been deleted; silent no-op
    this.store.put([{ ...existing, props: { ...(existing['props'] as object), ...partialProps } }]);
  }

  deleteBinding(id: BindingId): void {
    this.store.remove([id]);
  }

  // ── Selection ──────────────────────────────────────────────

  getSelectedShapeIds(): ShapeId[] {
    return Array.from(this._selection.value);
  }

  /** Returns a reactive signal of the current selection (array of IDs). */
  getSelectionSignal(): Signal<ShapeId[]> {
    // Lazily derive a ShapeId[] signal from the internal Set signal
    if (!this._selectionArraySignal) {
      const derived = signal<ShapeId[]>([]);
      // Keep it in sync via subscription
      this._selection.subscribe(set => {
        derived.value = Array.from(set);
      });
      this._selectionArraySignal = derived;
    }
    return this._selectionArraySignal;
  }
  private _selectionArraySignal?: Signal<ShapeId[]>;

  setSelectedShapeIds(ids: ShapeId[]): void {
    this._selection.value = new Set(ids);
  }

  selectAll(): void {
    const all: ShapeId[] = [];
    for (const sig of (this.store as any)._signals.values()) {
      const rec = sig.peek();
      if (rec && typeof rec['fromId'] === 'undefined') {
        all.push(rec['id'] as ShapeId);
      }
    }
    this._selection.value = new Set(all);
  }

  // ── Clipboard ──────────────────────────────────────────────

  copy(ids: ShapeId[]): void {
    const shapes = this.getShapes().filter(s => ids.includes(s.id as ShapeId));
    this._clipboard = JSON.parse(JSON.stringify(shapes));
  }

  paste(point?: Vec2): ShapeId[] {
    if (this._clipboard.length === 0) return [];
    
    // Find bounding box of clipboard items to calculate offset
    let minX = Infinity, minY = Infinity;
    for (const shape of this._clipboard) {
      minX = Math.min(minX, shape.x as number);
      minY = Math.min(minY, shape.y as number);
    }
    
    // If a point is provided, paste at that point. Otherwise, offset slightly from original.
    let offsetX = 20;
    let offsetY = 20;
    if (point && minX !== Infinity && minY !== Infinity) {
      offsetX = point.x - minX;
      offsetY = point.y - minY;
    }

    const newIds: ShapeId[] = [];
    this.history.batch('Paste', () => {
      for (const shape of this._clipboard) {
        const newId = sid(`${shape.id}-paste-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const clone = {
          ...shape,
          id: newId,
          x: (shape.x as number) + offsetX,
          y: (shape.y as number) + offsetY,
        };
        this.store.put([clone as any]);
        newIds.push(newId);
      }
    });

    // Select the newly pasted items
    this.setSelectedShapeIds(newIds);
    return newIds;
  }

  // ── Shape list ─────────────────────────────────────────────

  /**
   * Return all shape records (non-binding), optionally sorted by their
   * fractional `index` field for z-ordered rendering.
   */
  getShapes(sorted = false): GlideShape[] {
    const ids = this.store.getShapeIdsSignal().peek();
    const shapes: GlideShape[] = [];
    for (const id of ids) {
      const s = this.store.get(id);
      if (s) shapes.push(s as GlideShape);
    }
    if (sorted) {
      shapes.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
    }
    return shapes;
  }

  // ── Z-ordering ─────────────────────────────────────────────

  /**
   * Reorder shapes in the z-stack.
   *
   * 'front'   — move to top (highest index)
   * 'back'    — move to bottom (lowest index)
   * 'forward' — move one step up
   * 'backward'— move one step down
   *
   * Uses simple string lexicographic fractional indexing:
   * inserts a new index between neighbours by averaging their char codes.
   */
  reorderShapes(
    ids: ShapeId[],
    position: 'front' | 'back' | 'forward' | 'backward',
  ): void {
    const all = this.getShapes(true);
    if (all.length === 0 || ids.length === 0) return;

    const idSet = new Set(ids);
    const targets = all.filter(s => idSet.has(s.id as ShapeId));
    const rest    = all.filter(s => !idSet.has(s.id as ShapeId));

    let reordered: GlideShape[];
    switch (position) {
      case 'front':    reordered = [...rest, ...targets]; break;
      case 'back':     reordered = [...targets, ...rest]; break;
      case 'forward': {
        // Move each target one step toward the end, relative to non-targets
        reordered = [...all];
        // For simplicity, treat as 'front' of current batch
        const lastTargetIdx = Math.max(...targets.map(t => all.indexOf(t)));
        const insertAt = Math.min(lastTargetIdx + 2, all.length);
        const withoutTargets = all.filter(s => !idSet.has(s.id as ShapeId));
        // Find the correct insertion position among non-targets
        let nonTargetPos = 0;
        for (let i = 0; i < all.length && i < insertAt; i++) {
          if (!idSet.has(all[i].id as ShapeId)) nonTargetPos++;
        }
        withoutTargets.splice(nonTargetPos, 0, ...targets);
        reordered = withoutTargets;
        break;
      }
      case 'backward': {
        const firstTargetIdx = Math.min(...targets.map(t => all.indexOf(t)));
        const withoutTargets = all.filter(s => !idSet.has(s.id as ShapeId));
        const nonTargetPos = Math.max(0, Math.min(
          firstTargetIdx - 1,
          withoutTargets.length,
        ));
        withoutTargets.splice(nonTargetPos, 0, ...targets);
        reordered = withoutTargets;
        break;
      }
    }

    // Assign new sequential indices
    this.history.batch('Reorder Shapes', () => {
      reordered.forEach((shape, i) => {
        const newIndex = `a${String(i + 1).padStart(4, '0')}`;
        if (shape.index !== newIndex) {
          this.store.put([{ ...shape, index: newIndex }]);
        }
      });
    });
  }

  // ── Duplication ────────────────────────────────────────────

  /**
   * Duplicate shapes by ID, assigning fresh IDs and offsetting positions.
   * Returns the new shape IDs.
   */
  duplicateShapes(ids: ShapeId[], offset: Vec2 = { x: 10, y: 10 }): ShapeId[] {
    const newIds: ShapeId[] = [];
    this.history.batch('Duplicate Shapes', () => {
      for (const id of ids) {
        const shape = this.store.get(id);
        if (!shape) continue;
        const newId = sid(`${id}-copy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const clone = {
          ...shape,
          id: newId,
          x: (shape['x'] as number) + offset.x,
          y: (shape['y'] as number) + offset.y,
        };
        this.store.put([clone as any]);
        newIds.push(newId);
      }
    });
    return newIds;
  }

  // ── Inline editing state ───────────────────────────────────

  /**
   * Mark a shape as being inline-edited.
   * The demo layer uses this signal to overlay a <textarea>.
   */
  startEditing(id: ShapeId): void {
    this.editingShapeId.value = id;
  }

  /** Clear the inline-editing state. */
  stopEditing(): void {
    this.editingShapeId.value = null;
  }

  // ── Batch / history (store-level) ──────────────────────────

  batch(fn: () => void): void {
    this.store.batch(fn);
  }

  // ── Tool management (Phase 3) ──────────────────────────────

  /** @internal — called by createEditor to register a tool. */
  _registerTool(ToolClass: typeof StateNode): void {
    const tool = new (ToolClass as any)() as StateNode;
    tool._init(this);
    this._tools.set(ToolClass.id, tool);
    // Default: first registered tool is active
    if (!this._currentToolSignal.peek()) {
      this._currentToolSignal.value = tool;
      this.currentToolId.value = ToolClass.id;
    }
  }

  /**
   * Switch the active tool by id. Exits the current tool's active child,
   * resets the new tool to its initial child, and calls onEnter.
   */
  setCurrentTool(id: string): void {
    const tool = this._tools.get(id);
    if (!tool) throw new Error(`GlideEditor: unknown tool "${id}"`);
    const prev = this._currentToolSignal.peek();
    if (prev) prev.current?.onExit();
    this._currentToolSignal.value = tool;
    this.currentToolId.value = id;
    tool._reset();
    tool.current.onEnter();
  }

  /** Returns the currently active root tool. `.current` gives the active leaf. */
  getCurrentTool(): StateNode {
    return this._currentToolSignal.peek()!;
  }

  /** Route an event through the active tool's FSM. */
  dispatchEvent(event: GlideEvent): void {
    this._currentToolSignal.peek()?.handleEvent(event);
  }

  // ── Camera delegates ───────────────────────────────────────

  screenToPage(point: Vec2): Vec2  { return this.camera.screenToPage(point); }
  pageToScreen(point: Vec2): Vec2  { return this.camera.pageToScreen(point); }
  getViewportBounds(): Box2d       { return this.camera.getViewportBounds(); }

  // ── Persistence ────────────────────────────────────────────

  serialize()                                { return this.store.serialize(); }
  deserialize(doc: ReturnType<GlideStore['serialize']>) { this.store.deserialize(doc); }

  // ── Export ─────────────────────────────────────────────────

  exportToSvg(shapeIds: ShapeId[]): string {
    const shapes = shapeIds.map(id => this.getShape(id)).filter(Boolean) as GlideShape[];
    if (shapes.length === 0) return '<svg></svg>';

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const elements: string[] = [];

    for (const shape of shapes) {
      const util = this.getShapeUtil(shape.type);
      const box = util.getGeometry(shape).getBounds();
      if (box.minX < minX) minX = box.minX;
      if (box.minY < minY) minY = box.minY;
      if (box.maxX > maxX) maxX = box.maxX;
      if (box.maxY > maxY) maxY = box.maxY;

      if ((util as any).toSvg) {
        const svgEl = (util as any).toSvg(shape);
        if (svgEl) {
          elements.push(svgEl.outerHTML);
        }
      }
    }

    if (minX === Infinity) {
      minX = 0; minY = 0; maxX = 100; maxY = 100;
    }

    const w = maxX - minX;
    const h = maxY - minY;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;display=swap');
    text { font-family: 'Inter', system-ui, sans-serif; }
  </style>
  ${elements.join('\\n  ')}
</svg>`;
  }

  exportToPng(shapeIds: ShapeId[], opts?: { scale?: number }): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const svgStr = this.exportToSvg(shapeIds);
      const svgMatch = svgStr.match(/width="([^"]+)"\\s+height="([^"]+)"/);
      if (!svgMatch) return reject(new Error('Invalid SVG bounds'));
      
      const width = parseFloat(svgMatch[1]);
      const height = parseFloat(svgMatch[2]);
      const scale = opts?.scale ?? 1;

      const img = new Image();
      const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('No 2d context'));
        
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('toBlob failed'));
        }, 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG into image'));
      };
      img.src = url;
    });
  }
}

// ─────────────────────────────────────────────────────────────
// createEditor() — factory / boot sequence
// ─────────────────────────────────────────────────────────────

export interface CreateEditorOptions {
  plugins?:  GlidePlugin[];
  tools?:    (typeof StateNode)[];
  viewport?: { width: number; height: number };
  camera?:   { x?: number; y?: number; z?: number };
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
  const { plugins = [], tools, viewport, camera: camInit } = opts;

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

  // Inject geometric hooks for RBush integration
  // getGeometry() returns LOCAL bounds; RBush needs WORLD bounds.
  // We translate by shape.x/y here so the spatial index is always in world space.
  store.getGeometry = (shape) => {
    const util = editor.getShapeUtil(shape.type as any);
    const localBounds = util.getGeometry(shape as any).getBounds();
    const sx = (shape['x'] as number) ?? 0;
    const sy = (shape['y'] as number) ?? 0;
    return new Rectangle2d(
      localBounds.minX + sx,
      localBounds.minY + sy,
      localBounds.w,
      localBounds.h
    );
  };
  // hitTestPoint receives world-space x/y from the spatial query.
  // Convert to local space before calling the util.
  store.hitTestPoint = (shape, x, y) => {
    const sx = (shape['x'] as number) ?? 0;
    const sy = (shape['y'] as number) ?? 0;
    return editor.getShapeUtil(shape.type as any).hitTestPoint(shape as any, { x: x - sx, y: y - sy });
  };

  // 8. Instantiate + inject each ShapeUtil
  for (const plugin of plugins) {
    for (const UtilClass of plugin.shapes ?? []) {
      const instance = new (UtilClass as any)() as ShapeUtil<any>;
      editor._registerUtil(instance);  // injects editor + checks duplicate
    }
  }

  // 8b. Instantiate + inject each BindingUtil
  for (const plugin of plugins) {
    for (const UtilClass of plugin.bindings ?? []) {
      const instance = new (UtilClass as any)() as BindingUtil<any>;
      editor._registerBindingUtil(instance);
    }
  }

  // 9. onInstall hooks
  for (const plugin of plugins) {
    plugin.onInstall?.(editor);
  }

  // 10. Register tools — default to SelectTool + BoxTool; callers can override
  const toolClasses = tools ?? [SelectTool, BoxTool];
  for (const ToolClass of toolClasses) {
    editor._registerTool(ToolClass);
  }

  return editor;
}
