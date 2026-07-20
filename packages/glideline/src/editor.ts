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

import { signal, type Signal, type ReadonlySignal } from '@preact/signals';
import { bid, isGlideShape, sid } from './types';
import {
  GlideStore,
  createReadonlyStoreView,
  type ImportOptions,
  type ImportReport,
  type ReadonlyGlideStore,
  type StoreTransaction,
  type TransactionOptions,
  type TransactionResult,
} from './store';
import { CURRENT_STORE_VERSION, GlideSchema } from './schema';
import { GlideCamera } from './camera';
import { HistoryManager, commandIdFromLabel, createReadonlyHistoryView } from './history';
import type { BatchOptions, HistoryResult, ReadonlyHistoryManager } from './history';
import { Rectangle2d } from './geometry';
import { StateNode } from './state-node';
import { SelectTool } from './tools/SelectTool';
import { BoxTool } from './tools/BoxTool';
import type { ShapeUtil, BindingUtil } from './shapes/ShapeUtil';
import type { ArrowheadStyle, ArrowRouteStyle, ArrowShape } from './shapes/ArrowUtil';
import { buildAIContext, type AIContextSnapshot } from './ai-context';
import { getWorldBounds, SmartRouterCache, type SmartRouteResolution, type SmartRoutingSnapshot } from './smart-router';
import type { GlideShape, GlideBinding, ShapeId, BindingId, Vec2, Box2d, AnyRecord } from './types';
import type { GlideEvent } from './state-node';
import { getMinHeightForShape } from './styles';
import { createTopIndex } from './arrow-records';
import { RecordIdService } from './id';
import { InteractionManager } from './interaction';
import {
  allowAllMutations,
  createMutationCapability,
  MutationPermissionError,
  type MutationCapability,
  type MutationCapabilityGrant,
  type MutationPolicy,
  type MutationRequest,
} from './mutation-policy';

// ─────────────────────────────────────────────────────────────
// GlidePlugin — unit of extension
// ─────────────────────────────────────────────────────────────


export interface GlidePlugin {
  id: string;
  shapes?: (abstract new () => ShapeUtil<any>)[];
  bindings?: (abstract new () => BindingUtil<any>)[];
  tools?: (typeof StateNode)[];
  onInstall?(editor: GlideEditor): void;
}

// Internal static-side shape shared by ShapeUtil and BindingUtil classes.
interface UtilStatic {
  readonly type: string;
  props?: Record<string, { validate(v: unknown): unknown }>;
  migrations?: import('./types').GlideMigrations;
}

export interface BindingPreviewAnchor {
  normalizedAnchor: Vec2;
  point: Vec2;
}

export interface BindingPreviewCandidate {
  targetId: ShapeId;
  targetType: string;
  normalizedAnchor: Vec2;
  point: Vec2;
  candidateAnchors: BindingPreviewAnchor[];
}

export interface BindingPreview extends BindingPreviewCandidate {
  terminal: 'start' | 'end';
  sourceCandidate?: BindingPreviewCandidate | null;
}

const DEFAULT_ACTIVE_STYLES = Object.freeze({
  color: 'black',
  labelColor: 'black',
  fillStyle: 'none',
  strokeStyle: 'solid',
  strokeWidth: 'medium',
  font: 'sans',
  fontSize: 'md',
  textAlign: 'center',
});

export interface ClipboardSchemaHeader {
  readonly clipboardVersion: 1;
  readonly storeVersion: number;
}

export interface ClipboardPayload {
  readonly schema: ClipboardSchemaHeader;
  readonly rootIds: readonly ShapeId[];
  readonly records: readonly AnyRecord[];
  readonly assetRefs: readonly string[];
  readonly sourceBounds: Box2d;
}

export interface EditorCommand<T = void> {
  /** Stable machine-readable intent name, e.g. `shape.move`. */
  readonly id: string;
  readonly label: string;
  readonly affectedIds?: readonly string[];
  readonly execute: (tx: StoreTransaction) => T;
}

export interface ExecuteCommandOptions {
  readonly history?: 'ignore';
  readonly scope?: import('./store').TransactionScope;
  readonly actorId?: string;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readPointer(record: AnyRecord, pointer: string): unknown {
  let value: unknown = record;
  for (const segment of pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as AnyRecord)[segment];
  }
  return value;
}

function toGlideShape(record: unknown): GlideShape | null {
  if (!record || typeof record !== 'object') return null;
  if (!isGlideShape(record as AnyRecord)) return null;
  return record as unknown as GlideShape;
}

function toGlideShapes(records: readonly AnyRecord[]): GlideShape[] {
  const shapes: GlideShape[] = [];
  for (const record of records) {
    const shape = toGlideShape(record);
    if (shape) shapes.push(shape);
  }
  return shapes;
}

// ─────────────────────────────────────────────────────────────
// GlideEditor
// ─────────────────────────────────────────────────────────────

const mutableEditorStores = new WeakMap<GlideEditor, GlideStore>();
const mutableEditorHistories = new WeakMap<GlideEditor, HistoryManager>();

/** @internal Source-only helper for low-level store tests; not exported publicly. */
export function getMutableStoreForTesting(editor: GlideEditor): GlideStore {
  const store = mutableEditorStores.get(editor);
  if (!store) throw new Error('GlideEditor store is unavailable');
  return store;
}

/** @internal Source-only helper for low-level history tests; not exported publicly. */
export function getHistoryManagerForTesting(editor: GlideEditor): HistoryManager {
  const history = mutableEditorHistories.get(editor);
  if (!history) throw new Error('GlideEditor history is unavailable');
  return history;
}

export class GlideEditor {
  readonly store: ReadonlyGlideStore;
  private readonly _store: GlideStore;
  readonly schema: GlideSchema;
  readonly camera: GlideCamera;
  readonly history: ReadonlyHistoryManager;
  private readonly _history: HistoryManager;
  readonly interactions: InteractionManager;
  private _clipboard: ClipboardPayload | null = null;
  arrowRouteStyle: ArrowRouteStyle = 'curve';
  arrowheadStart: ArrowheadStyle = 'none';
  arrowheadEnd: ArrowheadStyle = 'arrow';
  private _smartRouter = new SmartRouterCache();

  private _utils = new Map<string, ShapeUtil<any>>();
  private _bindingUtils = new Map<string, BindingUtil<any>>();
  private _selection: Signal<Set<ShapeId>>;
  private _tools = new Map<string, StateNode>();
  private _currentToolSignal: Signal<StateNode | null> = signal(null);

  /** Reactive signal of the active tool id — subscribe in UI for live highlight. */
  readonly currentToolId: Signal<string> = signal('select');

  /** Signal carrying the ID of the shape currently being inline-edited, or null. */
  readonly editingShapeId: Signal<ShapeId | null> = signal(null);

  /** Signal carrying the set of shape IDs marked for erasure during an eraser drag.
   *  Empty set when the eraser is not active. EraserTool writes; ShapeLayer reads. */
  readonly erasingShapeIds: Signal<ReadonlySet<ShapeId>> = signal(new Set<ShapeId>());

  /** Signal describing the current arrow-binding candidate under the pointer, if any. */
  readonly bindingPreview: Signal<BindingPreview | null> = signal(null);

  /** Signal carrying the active/last-selected styles. */
  readonly activeStyles = signal<Record<string, any>>({ ...DEFAULT_ACTIVE_STYLES });

  private readonly _mutationPolicy: MutationPolicy;

  constructor(
    store: GlideStore,
    schema: GlideSchema,
    camera: GlideCamera,
    mutationPolicy: MutationPolicy,
    private readonly _localMutationCapability: MutationCapability,
    private readonly _loadMutationCapability: MutationCapability,
  ) {
    this._store = store;
    this.store = createReadonlyStoreView(store);
    mutableEditorStores.set(this, store);
    this.schema = schema;
    this.camera = camera;
    this._mutationPolicy = mutationPolicy;
    this.interactions = new InteractionManager(store, this._localMutationCapability);
    this._history = new HistoryManager(store, this._localMutationCapability);
    this.history = createReadonlyHistoryView(this._history);
    mutableEditorHistories.set(this, this._history);
    const interactionManager = this.interactions;
    this._history.attachInteractionAdapter({
      get active() { return interactionManager.active; },
      get kind() { return interactionManager.kind; },
      begin: () => interactionManager.begin('document'),
      runPreview: fn => interactionManager.runPreview(fn),
      runEphemeral: fn => interactionManager.runEphemeral(fn),
      commit: (label, commandId) => interactionManager.commit({ label, commandId }),
      cancel: () => interactionManager.cancel(),
    });
    this._selection = signal(new Set<ShapeId>());

    // Update activeStyles based on the newly selected shape's props
    this._selection.subscribe(set => {
      if (set.size === 1) {
        const shapeId = Array.from(set)[0]!;
        const shape = this.getShape(shapeId);
        if (shape && shape.props) {
          const nextActive = { ...this.activeStyles.peek() };
          let changed = false;
          for (const key of Object.keys(nextActive)) {
            if (key in shape.props && shape.props[key] !== nextActive[key]) {
              nextActive[key] = shape.props[key];
              changed = true;
            }
          }
          if (changed) {
            this.activeStyles.value = nextActive;
          }
        }
      }
    });
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
    const type = (instance.constructor as unknown as UtilStatic).type;
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
    const type = (instance.constructor as unknown as UtilStatic).type;
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
    return this.interactions.get(id) as S | undefined;
  }

  getShapeIdsSignal(): ReadonlySignal<readonly ShapeId[]> {
    return this.interactions.getShapeIdsSignal();
  }

  getShapeSignal(id: ShapeId): ReadonlySignal<import('./store').StoreRecord | null> {
    return this.interactions.getSignal(id);
  }

  getDocumentVersionSignal(): ReadonlySignal<number> {
    return this.interactions.getVersionSignal();
  }

  getShapesInViewport(): GlideShape[] {
    const box = this.getViewportBounds();
    return this.getShapesInBox(box);
  }

  getShapesAtPoint(point: Vec2): GlideShape[] {
    const changed = new Set(this.interactions.changedIds);
    const committed = toGlideShapes(this.store.getShapesAtPoint(point.x, point.y))
      .filter(shape => !changed.has(shape.id));
    const transient = this.interactions.changedIds
      .map(id => toGlideShape(this.interactions.get(id)))
      .filter((shape): shape is GlideShape => shape !== null)
      .filter(shape => this.getShapeUtil(shape.type).hitTestPoint(
        shape,
        { x: point.x - shape.x, y: point.y - shape.y },
      ));
    return [...committed, ...transient];
  }

  getShapesInBox(box: Pick<Box2d, 'minX' | 'minY' | 'maxX' | 'maxY'> & Partial<Pick<Box2d, 'x' | 'y' | 'w' | 'h'>>): GlideShape[] {
    const changed = new Set(this.interactions.changedIds);
    const committed = toGlideShapes(this.store.getShapesInBox(box.minX, box.minY, box.maxX, box.maxY))
      .filter(shape => !changed.has(shape.id));
    const transient = this.interactions.changedIds
      .map(id => toGlideShape(this.interactions.get(id)))
      .filter((shape): shape is GlideShape => shape !== null)
      .filter(shape => {
        const bounds = getWorldBounds(this, shape);
        return bounds.maxX >= box.minX && bounds.minX <= box.maxX
          && bounds.maxY >= box.minY && bounds.minY <= box.maxY;
      });
    return [...committed, ...transient];
  }

  // ── Binding queries ────────────────────────────────────────

  getBinding<B extends GlideBinding>(id: BindingId): B | undefined {
    return this.interactions.get(id) as B | undefined;
  }

  getBindingsFromShape(shapeId: ShapeId): GlideBinding[] {
    return this.store.getBindingsFromShape(shapeId);
  }

  getBindingsToShape(shapeId: ShapeId): GlideBinding[] {
    return this.store.getBindingsToShape(shapeId);
  }

  // ── Shape mutations ────────────────────────────────────────

  createShapeId(type = 'shape'): ShapeId {
    return sid(this.store.createRecordId(`shape:${type}`));
  }

  createBindingId(type = 'binding'): BindingId {
    return bid(this.store.createRecordId(`binding:${type}`));
  }

  createShape(partial: AnyRecord): ShapeId {
    const requestedType = String(partial['type'] ?? 'shape');
    partial = {
      rotation: 0,
      index: createTopIndex(),
      meta: {},
      ...partial,
      kind: 'shape',
      id: partial['id'] ?? this.createShapeId(requestedType),
    };
    const type = partial['type'] as string;
    const util = this._utils.get(type);
    if (util) {
      const defaultProps = util.getDefaultProps();
      const activeStyles = this.activeStyles.peek();
      const userProps = partial['props'] as AnyRecord || {};

      const mergedProps = { ...defaultProps, ...userProps };
      const shapePropsSchema = (util.constructor as any).props || {};
      for (const [key, val] of Object.entries(activeStyles)) {
        if (key in defaultProps) {
          if (key in userProps) {
            continue;
          }
          // Special case: do not force 'black' color on sticky-note when it's the initial default active style
          if (type === 'sticky-note' && key === 'color' && val === 'black' && !userProps.color) {
            continue;
          }
          // Validate styling values before merging to prevent conflicts (e.g., fontSize number vs enum)
          const validator = shapePropsSchema[key];
          if (validator) {
            try {
              validator.validate(val);
              mergedProps[key] = val;
            } catch {
              // Ignore invalid styling values for this shape type
            }
          } else {
            mergedProps[key] = val;
          }
        }
      }
      partial['props'] = mergedProps;
    }
    this.executeCommand({
      id: 'shape.create',
      label: 'Create Shape',
      affectedIds: [partial['id'] as string],
      execute: tx => {
        tx.insert(partial);
      },
    });
    if (type !== 'arrow') {
      this._smartRouter.markDirty();
    }
    return partial['id'] as ShapeId;
  }

  updateShape<S extends GlideShape>(id: ShapeId, partial: Partial<Omit<S, 'id' | 'type'>>): void {
    const existing = this.interactions.get(id);
    if (!existing) throw new Error(`GlideEditor: shape "${id}" not found`);
    const newShape = { ...existing, ...partial } as any;
    if (partial.props && existing.props) {
      newShape.props = { ...existing.props, ...(partial.props as any) };
    }

    // Auto-expand/clamp height based on text content
    if (newShape.props && typeof newShape.props.h === 'number') {
      const minH = getMinHeightForShape(newShape);
      if (newShape.props.h < minH) {
        newShape.props.h = minH;
      }
    }

    this.executeCommand({
      id: 'shape.update',
      label: 'Update Shape',
      affectedIds: [id],
      execute: tx => {
        tx.update(id, () => newShape);
        if ((existing['type'] as string) !== 'arrow') {
          this._smartRouter.markDirty();
        }
        // Binding lifecycle writes join this same root transaction. If a hook
        // throws, neither the target update nor any hook-generated write commits.
        const bindings = this.store.getBindingsToShape(id);
        for (const binding of bindings) {
          const util = this._bindingUtils.get(binding.type);
          util?.onAfterChangeToShape?.(binding);
        }
      },
    });
  }

  deleteShapes(ids: ShapeId[]): void {
    const closure = new Set<ShapeId>();
    const visit = (id: ShapeId) => {
      if (closure.has(id)) return;
      const record = this.interactions.get(id);
      if (!record || record['kind'] !== 'shape') return;
      closure.add(id);
      for (const child of this.store.getChildren(id)) {
        if (child['kind'] === 'shape') visit(child['id'] as ShapeId);
      }
    };
    for (const id of ids) visit(id);
    const deleteIds = Array.from(closure);
    let shouldInvalidateSmartRoutes = false;
    this.executeCommand({
      id: 'shape.delete',
      label: 'Delete Shapes',
      affectedIds: deleteIds,
      execute: tx => {
        for (const id of deleteIds) {
          const existing = tx.get(id);
          if (existing && existing['type'] !== 'arrow') {
            shouldInvalidateSmartRoutes = true;
          }
          // 1. Fire onBeforeDeleteToShape for bindings pointing to this shape
          const bindingsTo = this.store.getBindingsToShape(id);
          for (const binding of bindingsTo) {
            const util = this._bindingUtils.get(binding.type);
            util?.onBeforeDeleteToShape?.(binding);
            this._stageBindingTerminal(tx, binding as unknown as AnyRecord, null);
            tx.remove(binding.id);
          }

          // 2. Fire onBeforeDeleteFromShape for bindings from this shape
          const bindingsFrom = this.store.getBindingsFromShape(id);
          for (const binding of bindingsFrom) {
            const util = this._bindingUtils.get(binding.type);
            util?.onBeforeDeleteFromShape?.(binding);
            this._stageBindingTerminal(tx, binding as unknown as AnyRecord, null);
            tx.remove(binding.id);
          }
        }
        // 3. Finally remove the shapes themselves
        for (const id of deleteIds) tx.remove(id);
      },
    });
    if (shouldInvalidateSmartRoutes) {
      this._smartRouter.markDirty();
    }
  }

  // ── Binding mutations ──────────────────────────────────────

  createBinding(partial: AnyRecord): BindingId {
    partial = {
      meta: {},
      ...partial,
      kind: 'binding',
      id: partial['id'] ?? this.createBindingId(String(partial['type'] ?? 'binding')),
      props: partial['props'] ?? {},
    };
    this.executeCommand({
      id: 'binding.create',
      label: 'Create Binding',
      affectedIds: [partial['id'] as string, partial['fromId'] as string],
      execute: tx => {
        tx.insert(partial);
        // Binding records are authoritative. If the source shape exposes an
        // arrow-style terminal cache, derive its boundShapeId in the same
        // staged command so no contradictory graph is ever published.
        this._stageBindingTerminal(tx, partial, partial['toId']);
      },
    });
    return partial['id'] as BindingId;
  }

  updateBinding(id: BindingId, partialProps: AnyRecord): void {
    const existing = this.interactions.get(id);
    if (!existing) return; // binding may have been deleted; silent no-op
    this.executeCommand({
      id: 'binding.update',
      label: 'Update Binding',
      affectedIds: [id],
      execute: tx => {
        tx.update(id, record => ({
          ...record,
          props: { ...(record['props'] as object), ...partialProps },
        }));
      },
    });
  }

  deleteBinding(id: BindingId): void {
    this.executeCommand({
      id: 'binding.delete',
      label: 'Delete Binding',
      affectedIds: [id],
      execute: tx => {
        const binding = tx.get(id);
        if (binding) this._stageBindingTerminal(tx, binding as unknown as AnyRecord, null);
        tx.remove(id);
      },
    });
  }

  private _stageBindingTerminal(
    tx: StoreTransaction,
    binding: AnyRecord,
    boundShapeId: unknown,
  ): void {
    const terminal = (binding['props'] as AnyRecord | undefined)?.['terminal'];
    const fromId = binding['fromId'];
    if ((terminal !== 'start' && terminal !== 'end') || typeof fromId !== 'string') return;
    if (boundShapeId !== null && typeof boundShapeId !== 'string') return;
    const source = tx.get(fromId);
    const props = source?.['props'];
    const terminalValue = props && typeof props === 'object'
      ? (props as AnyRecord)[terminal]
      : undefined;
    if (!terminalValue || typeof terminalValue !== 'object'
      || (terminalValue as AnyRecord)['boundShapeId'] === boundShapeId) return;
    tx.update(fromId, record => ({
      ...record,
      props: {
        ...(record['props'] as AnyRecord),
        [terminal]: {
          ...(terminalValue as AnyRecord),
          boundShapeId,
        },
      },
    }));
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
    this._selection.value = new Set(this.interactions.getShapeIdsSignal().peek());
  }

  // ── Clipboard ──────────────────────────────────────────────

  copy(ids: ShapeId[]): void {
    this._clipboard = this._createClipboardPayload(ids);
  }

  paste(point?: Vec2): ShapeId[] {
    if (!this._clipboard) return [];
    const offset = point
      ? { x: point.x - this._clipboard.sourceBounds.minX, y: point.y - this._clipboard.sourceBounds.minY }
      : { x: 20, y: 20 };
    const newIds = this._pasteClipboardPayload(this._clipboard, offset, 'Paste');
    this.setSelectedShapeIds(newIds);
    return newIds;
  }

  private _createClipboardPayload(ids: readonly ShapeId[]): ClipboardPayload | null {
    const selected = new Set(ids.filter(id => this.interactions.get(id)?.['kind'] === 'shape'));
    const rootIds = Array.from(selected).filter(id => {
      let cursor = this.interactions.get(id);
      const seen = new Set<string>();
      while (typeof cursor?.['parentId'] === 'string') {
        const parentId = cursor['parentId'] as string;
        if (selected.has(parentId as ShapeId)) return false;
        if (seen.has(parentId)) break;
        seen.add(parentId);
        cursor = this.interactions.get(parentId);
      }
      return true;
    });
    if (rootIds.length === 0) return null;

    const shapeIds = new Set<ShapeId>();
    const visit = (id: ShapeId) => {
      if (shapeIds.has(id)) return;
      const record = this.interactions.get(id);
      if (!record || record['kind'] !== 'shape') return;
      shapeIds.add(id);
      for (const child of this.store.getChildren(id)) {
        if (child['kind'] === 'shape') visit(child['id'] as ShapeId);
      }
    };
    rootIds.forEach(visit);

    const documentRecords = this.store.serialize().records as AnyRecord[];
    const records: AnyRecord[] = documentRecords
      .filter(record => record['kind'] === 'shape' && shapeIds.has(record['id'] as ShapeId))
      .map(record => cloneRecord(record));
    for (const record of documentRecords) {
      if (record['kind'] !== 'binding') continue;
      if (shapeIds.has(record['fromId'] as ShapeId) && shapeIds.has(record['toId'] as ShapeId)) {
        records.push(cloneRecord(record));
      }
    }

    const assetRefs = new Set<string>();
    for (const record of records) {
      if (record['kind'] !== 'shape') continue;
      if (typeof record['assetId'] === 'string') assetRefs.add(record['assetId']);
      for (const descriptor of this.schema.getReferenceDescriptors(record)) {
        if (descriptor.targetKind !== 'asset') continue;
        const value = readPointer(record, descriptor.path);
        if (typeof value === 'string') assetRefs.add(value);
      }
    }
    for (const assetId of assetRefs) {
      const asset = documentRecords.find(record => record['id'] === assetId && record['kind'] === 'asset');
      if (asset) records.push(cloneRecord(asset));
    }

    const shapes = Array.from(shapeIds)
      .map(id => this.getShape(id))
      .filter((shape): shape is GlideShape => shape !== undefined);
    const bounds = shapes.map(shape => getWorldBounds(this, shape));
    const minX = Math.min(...bounds.map(box => box.minX));
    const minY = Math.min(...bounds.map(box => box.minY));
    const maxX = Math.max(...bounds.map(box => box.maxX));
    const maxY = Math.max(...bounds.map(box => box.maxY));

    return Object.freeze({
      schema: Object.freeze({ clipboardVersion: 1 as const, storeVersion: CURRENT_STORE_VERSION }),
      rootIds: Object.freeze(rootIds),
      records: Object.freeze(records),
      assetRefs: Object.freeze(Array.from(assetRefs)),
      sourceBounds: Object.freeze({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, minX, minY, maxX, maxY }),
    });
  }

  private _pasteClipboardPayload(payload: ClipboardPayload, offset: Vec2, label: string): ShapeId[] {
    if (payload.schema.clipboardVersion !== 1 || payload.schema.storeVersion > CURRENT_STORE_VERSION) {
      throw new Error(`Unsupported clipboard schema version ${payload.schema.clipboardVersion}`);
    }
    const records = payload.records.map(record => cloneRecord(record));
    const recordById = new Map(records.map(record => [record['id'] as string, record]));
    const orderedRootIds = [...payload.rootIds].sort((left, right) =>
      String(recordById.get(left)?.['index'] ?? '').localeCompare(String(recordById.get(right)?.['index'] ?? ''))
      || String(left).localeCompare(String(right)),
    );
    const rootOrder = new Map(orderedRootIds.map((id, ordinal) => [id, ordinal]));
    const orderStamp = Date.now().toString(36);
    for (const record of records) {
      const ordinal = rootOrder.get(record['id'] as ShapeId);
      if (ordinal === undefined || record['kind'] !== 'shape') continue;
      record['x'] = Number(record['x']) + offset.x;
      record['y'] = Number(record['y']) + offset.y;
      record['index'] = `zz:${orderStamp}:${ordinal.toString(36).padStart(6, '0')}`;
    }

    let report!: ImportReport;
    this.executeCommand({
      id: label === 'Paste' ? 'clipboard.paste' : 'shape.duplicate',
      label,
      affectedIds: payload.records.map(record => String(record['id'])),
      execute: () => {
        report = this._store.importRecords(records, {
          label,
          relationshipPolicy: 'detach-external',
          preserveExternalKinds: ['page'],
        });
      },
    });
    return payload.rootIds.map(id => report.idMap[id] as ShapeId);
  }

  // ── Shape list ─────────────────────────────────────────────

  /**
   * Return all shape records (non-binding), optionally sorted by their
   * fractional `index` field for z-ordered rendering.
   */
  getShapes(sorted = false): GlideShape[] {
    const ids = this.interactions.getShapeIdsSignal().peek();
    const shapes: GlideShape[] = [];
    for (const id of ids) {
      const s = this.interactions.get(id);
      const shape = toGlideShape(s);
      if (shape) shapes.push(shape);
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
    const rest = all.filter(s => !idSet.has(s.id as ShapeId));

    let reordered: GlideShape[];
    switch (position) {
      case 'front': reordered = [...rest, ...targets]; break;
      case 'back': reordered = [...targets, ...rest]; break;
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
          const shape = all[i];
          if (shape && !idSet.has(shape.id as ShapeId)) nonTargetPos++;
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
    this.executeCommand({
      id: 'shape.reorder',
      label: 'Reorder Shapes',
      affectedIds: reordered.map(shape => shape.id),
      execute: tx => {
        reordered.forEach((shape, i) => {
          const newIndex = `a${String(i + 1).padStart(4, '0')}`;
          if (shape.index !== newIndex) {
            tx.update(shape.id, record => ({ ...record, index: newIndex }));
          }
        });
      },
    });
  }

  // ── Duplication ────────────────────────────────────────────

  /**
   * Duplicate shapes by ID, assigning fresh IDs and offsetting positions.
   * Returns the new shape IDs.
   */
  duplicateShapes(ids: ShapeId[], offset: Vec2 = { x: 10, y: 10 }): ShapeId[] {
    const payload = this._createClipboardPayload(ids);
    if (!payload) return [];
    return this._pasteClipboardPayload(payload, offset, 'Duplicate Shapes');
  }

  // ── Inline editing state ───────────────────────────────────

  /**
   * Mark a shape as being inline-edited.
   * The demo layer uses this signal to overlay a <textarea>.
   */
  startEditing(id: ShapeId): void {
    this.editingShapeId.value = id;
    this.setSelectedShapeIds([]);
  }

  /** Clear the inline-editing state. */
  stopEditing(selectAgain = false): void {
    const id = this.editingShapeId.peek();
    this.editingShapeId.value = null;
    if (selectAgain && id && this.getShape(id)) {
      this.setSelectedShapeIds([id]);
    }
  }

  setBindingPreview(preview: BindingPreview | null): void {
    this.bindingPreview.value = preview;
  }

  clearBindingPreview(): void {
    this.bindingPreview.value = null;
  }

  // ── Batch / history ────────────────────────────────────────

  /**
   * The single durable command gateway. Validation, canonical publication,
   * derived indices, and history preparation either all succeed or all abort.
   */
  executeCommand<T>(command: EditorCommand<T>, options: ExecuteCommandOptions = {}): T {
    const mutationRequest: MutationRequest = {
      origin: 'local-user',
      command: command.id,
      affectedIds: command.affectedIds ?? [],
    };
    this.assertMutationAllowed(mutationRequest);

    if (this.interactions.previewing) {
      return this.interactions.transact(command.execute);
    }
    return this._store.transact({
      origin: 'user',
      label: command.label,
      commandId: command.id,
      ...(command.affectedIds === undefined ? {} : { affectedIds: command.affectedIds }),
      ...(options.actorId === undefined ? {} : { actorId: options.actorId }),
      history: options.history === 'ignore' ? 'ignore' : 'record',
      scope: options.scope ?? 'document',
    }, command.execute, this._localMutationCapability).value;
  }

  /**
   * Execute a mutation block at the editor API level.
   *
   * - `batch(fn)` records one generically-labelled undo entry.
   * - `batch(label, fn, opts)` records a named undo entry, unless history is ignored.
   */
  batch(fn: () => void): void;
  batch(label: string, fn: () => void, opts?: BatchOptions): void;
  batch(
    labelOrFn: string | (() => void),
    fn?: (() => void),
    opts?: BatchOptions,
  ): void {
    if (typeof labelOrFn === 'function') {
      this.assertMutationAllowed({
        origin: 'local-user',
        command: 'editor.batch',
        affectedIds: [],
      });
      this._history.batch('Batch', labelOrFn, { commandId: 'editor.batch' });
      return;
    }

    if (!fn) {
      throw new Error('GlideEditor.batch(label, fn): missing callback');
    }

    const commandId = opts?.commandId ?? commandIdFromLabel(labelOrFn);
    this.assertMutationAllowed({
      origin: 'local-user',
      command: commandId,
      affectedIds: [],
    });
    this._history.batch(labelOrFn, fn, { ...opts, commandId });
  }

  /**
   * Execute a mutation block with optional history control.
   * Used by AI/MCP and remote sync to bypass the local undo stack.
   */
  run(fn: () => void, opts?: BatchOptions): void {
    this.executeCommand(
      { id: opts?.commandId ?? 'editor.run', label: 'Run', execute: () => fn() },
      opts,
    );
  }

  undo(): HistoryResult {
    const mutationRequest: MutationRequest = {
      origin: 'local-user',
      command: 'history.undo',
      affectedIds: [],
    };
    this.assertMutationAllowed(mutationRequest);

    return this._history.undo();
  }

  redo(): HistoryResult {
    const mutationRequest: MutationRequest = {
      origin: 'local-user',
      command: 'history.redo',
      affectedIds: [],
    };
    this.assertMutationAllowed(mutationRequest);

    return this._history.redo();
  }

  /** @internal Compatibility lifecycle for tools migrating to InteractionManager. */
  beginHistoryPreview(): void {
    this.assertMutationAllowed({
      origin: 'local-user',
      command: 'history.preview.begin',
      affectedIds: [],
    });
    this._history.beginPreview();
  }

  /** @internal Compatibility lifecycle for tools migrating to InteractionManager. */
  recordHistoryPreview(
    label: string,
    before: ReadonlyMap<string, AnyRecord | null> = new Map(),
  ): void {
    this.assertMutationAllowed({
      origin: 'local-user',
      command: commandIdFromLabel(label, 'interaction'),
      affectedIds: [...before.keys()],
    });
    this._history.recordPreview(label, before);
  }

  /** @internal Compatibility lifecycle for tools migrating to InteractionManager. */
  cancelHistoryPreview(): void {
    this._history.cancelPreview();
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
    // Tool changes are a hard interaction boundary. Tool-specific onExit gets
    // the first chance to clean up; this catches every remaining overlay.
    if (this.interactions.active) this.interactions.cancel();
    this.clearBindingPreview();
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

  screenToPage(point: Vec2): Vec2 { return this.camera.screenToPage(point); }
  pageToScreen(point: Vec2): Vec2 { return this.camera.pageToScreen(point); }
  getViewportBounds(): Box2d { return this.camera.getViewportBounds(); }
  getSmartRoutingSnapshot(): SmartRoutingSnapshot { return this._smartRouter.getSnapshot(); }

  getShapeWorldBounds(shapeOrId: GlideShape | ShapeId): Box2d {
    const shape = typeof shapeOrId === 'string'
      ? this.getShape(shapeOrId)
      : shapeOrId;
    if (!shape) {
      throw new Error(`GlideEditor: shape "${shapeOrId}" not found`);
    }
    return getWorldBounds(this, shape);
  }

  resolveSmartRouteForArrow(
    arrow: ArrowShape,
    args: {
      startWorld: Vec2;
      endWorld: Vec2;
      fromEdge: import('./types').EdgeName;
      toEdge: import('./types').EdgeName;
      fromShapeId: ShapeId | null;
      toShapeId: ShapeId | null;
      now?: () => number;
      budgetMs?: number;
    },
  ): SmartRouteResolution {
    return this._smartRouter.resolve(this, { arrow, ...args });
  }

  // ── Persistence ────────────────────────────────────────────

  serialize() { return this.store.serialize(); }

  /**
   * Hydrate the editor from a complete document snapshot.
   *
   * The resulting store exactly matches `doc`: records that belonged to the
   * previous document but are absent from `doc` are removed. The store first
   * migrates and validates the complete candidate, then publishes the
   * replacement atomically, so a failure leaves the current document intact.
   *
   * Use importRecords() when the intention is to merge content into the
   * current document. Keeping replacement and import separate prevents an
   * old board's records from surviving a hydration or board switch.
   */
  replaceDocument(doc: ReturnType<GlideStore['serialize']>) {
    const report = this._store.replaceDocument(doc, {}, this._loadMutationCapability);
    this._smartRouter.markDirty();
    return report;
  }

  /**
   * Backward-compatible hydration alias.
   * @deprecated Use replaceDocument() so the replacement semantics are explicit.
   */
  deserialize(doc: ReturnType<GlideStore['serialize']>) {
    this.replaceDocument(doc);
  }

  importRecords(payload: Parameters<GlideStore['importRecords']>[0], options?: ImportOptions): ImportReport {
    const records = Array.isArray(payload)
      ? payload as readonly AnyRecord[]
      : (payload as { records: readonly AnyRecord[] }).records;
    this.assertMutationAllowed({
      origin: 'local-api',
      command: 'document.import',
      affectedIds: records.map(record => String(record['id'] ?? '')),
    });
    const report = this._store.importRecords(payload, options);
    this._smartRouter.markDirty();
    return report;
  }

  resetSessionState(): void {
    this.interactions.cancel();
    this._history.clear();
    this._clipboard = null;
    this.setSelectedShapeIds([]);
    this.editingShapeId.value = null;
    this.erasingShapeIds.value = new Set<ShapeId>();
    this.bindingPreview.value = null;
    this.activeStyles.value = { ...DEFAULT_ACTIVE_STYLES };
    this.arrowRouteStyle = 'curve';
    this.arrowheadStart = 'none';
    this.arrowheadEnd = 'arrow';
    this.camera.setCamera({ x: 0, y: 0, z: 1 });
    this.setCurrentTool('select');
  }

  // ── AI / MCP ───────────────────────────────────────────────

  getAIContext(opts?: { viewport?: boolean }): AIContextSnapshot {
    return buildAIContext(this, opts);
  }

  // ── Export ─────────────────────────────────────────────────

  exportToSvg(shapeIds: ShapeId[]): string {
    const shapes = shapeIds
      .map(id => this.getShape(id))
      .filter(Boolean) as GlideShape[];
    return this._renderShapesToSvg(shapes);
  }

  exportRegionToSvg(box: Box2d): string {
    const shapes = this.getShapesInBox(box).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));
    return this._renderShapesToSvg(shapes, box);
  }

  exportToPng(shapeIds: ShapeId[], opts?: { scale?: number }): Promise<Blob> {
    return this._svgToPngBlob(this.exportToSvg(shapeIds), opts?.scale ?? 1);
  }

  exportRegionToPng(box: Box2d, opts?: { scale?: number }): Promise<Blob> {
    return this._svgToPngBlob(this.exportRegionToSvg(box), opts?.scale ?? 1);
  }

  async takeScreenshot(box?: Box2d): Promise<string> {
    const blob = await this.exportRegionToPng(box ?? this.getViewportBounds());
    return blobToDataUrl(blob);
  }

  private _renderShapesToSvg(shapes: GlideShape[], explicitViewBox?: Box2d): string {
    if (shapes.length === 0 && !explicitViewBox) return '<svg></svg>';

    let minX = explicitViewBox?.minX ?? Infinity;
    let minY = explicitViewBox?.minY ?? Infinity;
    let maxX = explicitViewBox?.maxX ?? -Infinity;
    let maxY = explicitViewBox?.maxY ?? -Infinity;
    const elements: string[] = [];

    for (const shape of shapes) {
      const util = this.getShapeUtil(shape.type);
      const box = this.getShapeWorldBounds(shape);
      if (!explicitViewBox) {
        if (box.minX < minX) minX = box.minX;
        if (box.minY < minY) minY = box.minY;
        if (box.maxX > maxX) maxX = box.maxX;
        if (box.maxY > maxY) maxY = box.maxY;
      }

      const exportFn = (util as any).toSvgExport || (util as any).toSvg;
      if (exportFn) {
        const svgEl = exportFn.call(util, shape);
        if (svgEl) {
          this._prepareSvgElementForExport(svgEl);
          const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          const localBounds = util.getGeometry(shape).getBounds();
          const cx = localBounds.minX + localBounds.w / 2;
          const cy = localBounds.minY + localBounds.h / 2;
          const angleDeg = ((shape.rotation || 0) * 180) / Math.PI;
          wrapper.setAttribute('transform', `translate(${shape.x}, ${shape.y}) rotate(${angleDeg}, ${cx}, ${cy})`);
          wrapper.appendChild(svgEl);
          elements.push(wrapper.outerHTML);
        }
      }
    }

    if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
      minX = explicitViewBox?.minX ?? 0;
      minY = explicitViewBox?.minY ?? 0;
      maxX = explicitViewBox?.maxX ?? 100;
      maxY = explicitViewBox?.maxY ?? 100;
    }

    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}">
  <style>
    text { font-family: Inter, system-ui, sans-serif; }
  </style>
  ${elements.join('\n  ')}
</svg>`;
  }

  private assertMutationAllowed(request: MutationRequest): void {
    if (this._mutationPolicy.authorize(request) === 'deny') {
      throw new MutationPermissionError(request);
    }
  }

  /** @internal Host integration requiring a capability registered at creation. */
  transactWithCapability<T>(
    capability: MutationCapability,
    options: TransactionOptions,
    fn: (tx: StoreTransaction) => T,
  ): TransactionResult<T> {
    return this._store.transactTrusted(options, fn, capability);
  }

  private _svgToPngBlob(svgStr: string, scale = 1): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const svgMatch = svgStr.match(/width="([^"]+)"\s+height="([^"]+)"/);
      if (!svgMatch) return reject(new Error('Invalid SVG bounds'));
      const widthValue = svgMatch[1];
      const heightValue = svgMatch[2];
      if (widthValue === undefined || heightValue === undefined) {
        return reject(new Error('Invalid SVG bounds'));
      }

      const width = parseFloat(widthValue);
      const height = parseFloat(heightValue);

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

  private _prepareSvgElementForExport(root: SVGElement): void {
    const foreignObjects = Array.from(root.querySelectorAll('foreignObject'));
    for (const foreignObject of foreignObjects) {
      const replacement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const x = parseFloat(foreignObject.getAttribute('x') ?? '0');
      const y = parseFloat(foreignObject.getAttribute('y') ?? '0');
      const width = parseFloat(foreignObject.getAttribute('width') ?? '0');
      const height = parseFloat(foreignObject.getAttribute('height') ?? '0');
      const content = foreignObject.textContent?.trim();
      const div = foreignObject.querySelector('div');

      replacement.setAttribute('x', String(x + width / 2));
      replacement.setAttribute('y', String(y + height / 2));
      replacement.setAttribute('text-anchor', 'middle');
      replacement.setAttribute('dominant-baseline', 'middle');
      replacement.setAttribute('font-family', div?.style.fontFamily || 'Inter, system-ui, sans-serif');
      replacement.setAttribute('font-size', div?.style.fontSize || '14px');
      replacement.setAttribute('fill', div?.style.color || '#111827');
      replacement.textContent = content ? content.replace(/\s+/g, ' ') : '';

      foreignObject.replaceWith(replacement);
    }
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result === 'string') resolve(result);
        else reject(new Error('Failed to convert blob to data URL'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to convert blob to data URL'));
      reader.readAsDataURL(blob);
    });
  }

  const BufferCtor = (globalThis as { Buffer?: { from(data: ArrayBuffer): { toString(encoding: string): string } } }).Buffer;
  if (typeof blob.arrayBuffer === 'function' && BufferCtor) {
    const buffer = BufferCtor.from(await blob.arrayBuffer());
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }

  throw new Error('No available blob to data URL conversion path');
}

// ─────────────────────────────────────────────────────────────
// createEditor() — factory / boot sequence
// ─────────────────────────────────────────────────────────────

export interface CreateEditorOptions {
  plugins?: GlidePlugin[];
  tools?: (typeof StateNode)[];
  viewport?: { width: number; height: number };
  camera?: { x?: number; y?: number; z?: number };
  idService?: RecordIdService;
  mutationPolicy?: MutationPolicy;
  trustedMutationCapabilities?: readonly MutationCapabilityGrant[];
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
  const {
    plugins = [],
    tools,
    viewport,
    camera: camInit,
    mutationPolicy = allowAllMutations,
    trustedMutationCapabilities = [],
  } = opts;

  // 1. Schema
  const schema = new GlideSchema();

  // 2+3. Register ShapeUtils (checks for duplicates, bakes validators)
  const seenShapeTypes = new Set<string>();
  const seenBindingTypes = new Set<string>();
  for (const plugin of plugins) {
    for (const UtilClass of plugin.shapes ?? []) {
      const type = (UtilClass as unknown as UtilStatic).type;
      if (!type) throw new Error(`Plugin "${plugin.id}": ShapeUtil missing static 'type'`);
      if (seenShapeTypes.has(type)) {
        throw new Error(
          `createEditor: duplicate shape type "${type}" ` +
          `registered by plugin "${plugin.id}". ` +
          `Each type must be unique across all plugins.`,
        );
      }
      seenShapeTypes.add(type);
      schema.registerShapeUtil(UtilClass as unknown as UtilStatic);
    }
    for (const UtilClass of plugin.bindings ?? []) {
      const type = (UtilClass as unknown as UtilStatic).type;
      if (!type) throw new Error(`Plugin "${plugin.id}": BindingUtil missing static 'type'`);
      if (seenBindingTypes.has(type)) {
        throw new Error(
          `createEditor: duplicate binding type "${type}" ` +
          `registered by plugin "${plugin.id}". ` +
          `Each binding type must be unique across all plugins.`,
        );
      }
      seenBindingTypes.add(type);
      schema.registerBindingUtil(UtilClass as unknown as UtilStatic);
    }
  }

  // 4. Freeze schema
  schema.freeze();

  // 5–7. Store + Camera + Editor
  const localMutationCapability = createMutationCapability();
  const loadMutationCapability = createMutationCapability();
  const store = new GlideStore(schema, opts.idService ?? new RecordIdService(), {
    policy: mutationPolicy,
    grants: [
      { capability: localMutationCapability, origins: ['local-user'] },
      { capability: loadMutationCapability, origins: ['load'] },
      ...trustedMutationCapabilities,
    ],
  });
  const cam = new GlideCamera(camInit ?? {}, viewport?.width ?? 1000, viewport?.height ?? 600);
  const editor = new GlideEditor(
    store,
    schema,
    cam,
    mutationPolicy,
    localMutationCapability,
    loadMutationCapability,
  );

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
  const pluginTools = plugins.flatMap(plugin => plugin.tools ?? []);
  const toolClasses = [...(tools ?? [SelectTool, BoxTool]), ...pluginTools];
  const seenToolIds = new Set<string>();
  for (const ToolClass of toolClasses) {
    if (seenToolIds.has(ToolClass.id)) continue;
    seenToolIds.add(ToolClass.id);
    editor._registerTool(ToolClass);
  }

  return editor;
}
