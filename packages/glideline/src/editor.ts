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

import { computed, signal, type Signal, type ReadonlySignal } from '@preact/signals';
import { bid, isGlideShape, makeBox, pid, sid } from './types.js';
import {
  GlideStore,
  createReadonlyStoreView,
  type ImportOptions,
  type ImportReport,
  type ReadonlyGlideStore,
  type StoreTransaction,
  type StoreCommitParticipant,
  type TransactionOptions,
  type TransactionResult,
} from './store.js';
import { CURRENT_STORE_VERSION, DEFAULT_PAGE_ID, GlideSchema } from './schema.js';
import { GlideCamera } from './camera.js';
import { HistoryManager, commandIdFromLabel, createReadonlyHistoryView } from './history.js';
import type { BatchOptions, HistoryResult, ReadonlyHistoryManager } from './history.js';
import { Rectangle2d } from './geometry/index.js';
import { matrixToSvg, TransformService, type Matrix2d } from './transform.js';
import { StateNode } from './state-node.js';
import { SelectTool } from './tools/SelectTool.js';
import { BoxTool } from './tools/BoxTool.js';
import type { ShapeUtil, BindingUtil } from './shapes/ShapeUtil.js';
import type { ArrowheadStyle, ArrowRouteStyle, ArrowShape } from './shapes/ArrowUtil.js';
import { buildAIContext, type AIContextSnapshot } from './ai-context.js';
import { getWorldBounds, SmartRouterCache, type SmartRouteResolution, type SmartRoutingSnapshot } from './smart-router.js';
import type { GlideShape, GlideBinding, GlidePage, GlideAsset, ShapeId, BindingId, PageId, Vec2, Box2d, AnyRecord } from './types.js';
import type { GlideEvent } from './state-node.js';
import { getMinHeightForShape } from './styles.js';
import { RecordIdService } from './id.js';
import { InteractionManager } from './interaction.js';
import {
  compareSiblingOrder,
  generateOrderKeysBetween,
  generateRebalancedOrderKeys,
  getCanonicalShapeIds,
  getShapeOrderParentId,
  isCanonicalOrderKey,
  OrderKeySpaceExhaustedError,
  sortShapesByCanonicalOrder,
} from './ordering.js';
import {
  allowAllMutations,
  createMutationCapability,
  MutationPermissionError,
  type MutationCapability,
  type MutationCapabilityGrant,
  type MutationPolicy,
  type MutationRequest,
} from './mutation-policy.js';
import { TextEditSessionController } from './text-edit.js';
import { SnapManager } from './snapping.js';

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
  migrations?: import('./types.js').GlideMigrations;
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
  candidateAnchors: readonly BindingPreviewAnchor[];
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
  pressureSensitive: false,
  font: 'sans',
  fontSize: 'md',
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

/** Host-defined immutable coordinates for resolving assets from a retained snapshot. */
export interface AssetResolutionContext {
  readonly documentId?: string;
  readonly versionId?: string;
  readonly snapshotId?: string;
  readonly createdAt?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export type PortableRasterExport =
  | { readonly kind: 'self-contained'; readonly bytes: Uint8Array }
  | { readonly kind: 'durable-reference'; readonly reference: string };

export type PortableRasterPayload =
  | {
    readonly assetId: string;
    readonly kind: 'embedded';
    readonly base64: string;
    readonly byteLength: number;
  }
  | {
    readonly assetId: string;
    readonly kind: 'durable-reference';
    readonly reference: string;
  };

export interface PortableBoardFragmentSchemaHeader {
  readonly portableBoardFragmentVersion: 1;
  readonly storeVersion: number;
}

export interface PortableBoardFragmentLimits {
  readonly maxRecords: number;
  readonly maxRootIds: number;
  readonly maxAssetRefs: number;
  readonly maxRasterPayloads: number;
  readonly maxStringBytes: number;
  readonly maxRecordBytes: number;
  readonly maxRecordsBytes: number;
  readonly maxMetadataBytes: number;
  readonly maxEmbeddedAssetBytes: number;
  readonly maxTotalEmbeddedBytes: number;
  readonly maxEncodedFragmentBytes: number;
}

export const PORTABLE_BOARD_FRAGMENT_LIMITS: PortableBoardFragmentLimits = Object.freeze({
  maxRecords: 10_000,
  maxRootIds: 10_000,
  maxAssetRefs: 10_000,
  maxRasterPayloads: 1_000,
  maxStringBytes: 256 * 1024,
  maxRecordBytes: 1024 * 1024,
  maxRecordsBytes: 16 * 1024 * 1024,
  maxMetadataBytes: 64 * 1024,
  maxEmbeddedAssetBytes: 20 * 1024 * 1024,
  maxTotalEmbeddedBytes: 64 * 1024 * 1024,
  maxEncodedFragmentBytes: 32 * 1024 * 1024,
});

/** JSON-safe cross-board payload. Raster bytes are embedded or explicitly durable. */
export interface PortableBoardFragment {
  readonly schema: PortableBoardFragmentSchemaHeader;
  readonly rootIds: readonly ShapeId[];
  readonly records: readonly AnyRecord[];
  readonly assetRefs: readonly string[];
  readonly rasterPayloads: readonly PortableRasterPayload[];
  readonly sourceBounds: Box2d;
  readonly resolutionContext?: AssetResolutionContext;
}

export type PortableAssetExportHook = (
  asset: GlideAsset,
  context: AssetResolutionContext | undefined,
) => Promise<PortableRasterExport>;

export interface PortableAssetMaterialization {
  /** Required compensation used when a later materialization or record import fails. */
  readonly rollback: () => void | Promise<void>;
}

export type PortableAssetMaterializer = (
  payload: PortableRasterPayload,
  asset: GlideAsset,
  context: AssetResolutionContext | undefined,
) => Promise<PortableAssetMaterialization>;

export interface CreatePortableBoardFragmentOptions {
  readonly exportRasterAsset: PortableAssetExportHook;
  readonly resolutionContext?: AssetResolutionContext;
  /** Register live/historical references with durable storage retention. */
  readonly retainAssetReferences: (
    assetIds: readonly string[],
    context: AssetResolutionContext | undefined,
  ) => void | Promise<void>;
}

export interface PastePortableBoardFragmentOptions {
  readonly materializeRasterAsset: PortableAssetMaterializer;
  readonly point?: Vec2;
}

export interface PortableSvgExportOptions {
  readonly exportRasterAsset: PortableAssetExportHook;
  readonly resolutionContext?: AssetResolutionContext;
}

export class PortablePasteRollbackError extends Error {
  readonly importError: unknown;
  readonly rollbackErrors: readonly unknown[];

  constructor(importError: unknown, rollbackErrors: readonly unknown[]) {
    super(`Portable paste failed and ${rollbackErrors.length} compensation operation(s) also failed`);
    this.name = 'PortablePasteRollbackError';
    this.importError = importError;
    this.rollbackErrors = Object.freeze([...rollbackErrors]);
  }
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
  readonly scope?: import('./store.js').TransactionScope;
  readonly actorId?: string;
}

export type AlignOperation = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';
export type DistributeMode = 'centers' | 'gaps';
export type MatchSizeOperation = 'width' | 'height' | 'both';
export type FlipAxis = 'horizontal' | 'vertical';
export type TidyLayout = 'row' | 'grid';

export interface ShapePrecisionPatch {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  lockAspect?: boolean;
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
  readonly textEditing: TextEditSessionController;
  readonly snapping = new SnapManager();
  /** Canonical local/page transform and geometry service. */
  readonly transforms: TransformService;
  private _clipboard: ClipboardPayload | null = null;
  arrowRouteStyle: ArrowRouteStyle = 'ortho';
  arrowheadStart: ArrowheadStyle = 'none';
  arrowheadEnd: ArrowheadStyle = 'arrow';
  private _smartRouter = new SmartRouterCache();

  private _utils = new Map<string, ShapeUtil<any>>();
  private _bindingUtils = new Map<string, BindingUtil<any>>();
  private _selection: Signal<Set<ShapeId>>;
  private _tools = new Map<string, StateNode>();
  private _currentToolSignal: Signal<StateNode | null> = signal(null);
  private readonly _orderedShapeIdsSignal: ReadonlySignal<readonly ShapeId[]>;
  private readonly _currentPageShapeIdsSignal: ReadonlySignal<readonly ShapeId[]>;
  private readonly _pageIdsSignal: ReadonlySignal<readonly PageId[]>;
  private readonly _pageCameras = new Map<PageId, { x: number; y: number; z: number }>();

  /** Reactive signal of the active tool id — subscribe in UI for live highlight. */
  readonly currentToolId: Signal<string> = signal('select');

  /** The locally active page. This viewport state is not persisted in the document. */
  readonly activePageId: Signal<PageId> = signal(DEFAULT_PAGE_ID);

  /** Group whose direct content is currently being edited. Ephemeral UI state. */
  readonly focusedGroupId: Signal<ShapeId | null> = signal(null);

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
  private readonly _assetResolver: AssetResolver | undefined;
  private readonly _assetResolutionContext: AssetResolutionContext | undefined;
  private _exportAssetUrlOverrides: ReadonlyMap<string, string> | null = null;
  private _liveTextEditBaseline: GlideShape | null = null;

  constructor(
    store: GlideStore,
    schema: GlideSchema,
    camera: GlideCamera,
    mutationPolicy: MutationPolicy,
    private readonly _localMutationCapability: MutationCapability,
    private readonly _loadMutationCapability: MutationCapability,
    assetResolver?: AssetResolver,
    assetResolutionContext?: AssetResolutionContext,
  ) {
    this._store = store;
    this.store = createReadonlyStoreView(store);
    mutableEditorStores.set(this, store);
    this.schema = schema;
    this.camera = camera;
    this._mutationPolicy = mutationPolicy;
    this._assetResolver = assetResolver;
    this._assetResolutionContext = assetResolutionContext
      ? Object.freeze(cloneRecord(assetResolutionContext))
      : undefined;
    this.interactions = new InteractionManager(store, this._localMutationCapability);
    this.transforms = new TransformService({
      getShape: id => this.getShape(id),
      getGeometry: shape => this.getShapeUtil(shape.type).getGeometry(shape as any),
      getVisualBounds: shape => this.getShapeUtil(shape.type).getVisualBounds(shape as any),
      getZoom: () => this.camera.signal.peek().z,
      hitTestLocal: (shape, point) => this.getShapeUtil(shape.type).hitTestPoint(shape as any, point),
    });
    this.textEditing = new TextEditSessionController({
      getRevision: () => this.store.revision,
      getEditableText: id => {
        const shape = this.getShape(id);
        if (!shape) return null;
        const util = this.getShapeUtil(shape.type);
        return util.canEditLabel(shape as any) ? util.getEditableText(shape as any) : null;
      },
      commit: (id, draft, pendingProps) => {
        this._applyTextEdit(id, draft, pendingProps, 'record');
      },
    });
    this.textEditing.session.subscribe(session => {
      this.editingShapeId.value = session?.shapeId ?? null;
    });
    this.interactions.getVersionSignal().subscribe(() => this.textEditing.reconcile());
    this._pageIdsSignal = computed(() => {
      this.interactions.getVersionSignal().value;
      return this._store.getPageIds();
    });
    this._currentPageShapeIdsSignal = computed(() => {
      this.interactions.getVersionSignal().value;
      const pageId = this.activePageId.value;
      return Object.freeze(this._getAllShapes()
        .filter(shape => this.getShapePageId(shape.id as ShapeId) === pageId)
        .map(shape => shape.id as ShapeId));
    });
    this._orderedShapeIdsSignal = computed(() => {
      this.interactions.getVersionSignal().value;
      const pageId = this.activePageId.value;
      return getCanonicalShapeIds(this._getAllShapes()
        .filter(shape => this.getShapePageId(shape.id as ShapeId) === pageId));
    });
    this.interactions.getVersionSignal().subscribe(() => this._reconcileActivePage());
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

  /** Resolve immutable asset metadata through trusted host configuration. */
  resolveAssetUrl(asset: GlideAsset, context?: AssetResolutionContext): string | null {
    const override = this._exportAssetUrlOverrides?.get(String(asset.id));
    if (override) return override;
    const resolved = this._assetResolver?.(asset, context ?? this._assetResolutionContext) ?? null;
    if (resolved === null) return null;
    try {
      const url = new URL(resolved, typeof document === 'undefined' ? 'https://localhost/' : document.baseURI);
      if (!['https:', 'http:', 'blob:'].includes(url.protocol)) return null;
      return resolved;
    } catch {
      return null;
    }
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

  getCurrentPageShapeIdsSignal(): ReadonlySignal<readonly ShapeId[]> {
    return this._currentPageShapeIdsSignal;
  }

  getPageIdsSignal(): ReadonlySignal<readonly PageId[]> {
    return this._pageIdsSignal;
  }

  getOrderedShapeIdsSignal(): ReadonlySignal<readonly ShapeId[]> {
    return this._orderedShapeIdsSignal;
  }

  getOrderedShapeIds(): readonly ShapeId[] {
    return this._orderedShapeIdsSignal.peek();
  }

  getShapeSignal(id: ShapeId): ReadonlySignal<import('./store.js').StoreRecord | null> {
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
    const changed = this._getInteractionAffectedShapeIds();
    const committed = toGlideShapes(this.store.getShapesAtPoint(point.x, point.y))
      .filter(shape => !changed.has(shape.id));
    const transient = [...changed]
      .map(id => toGlideShape(this.interactions.get(id)))
      .filter((shape): shape is GlideShape => shape !== null)
      .filter(shape => this.transforms.hitTestPagePoint(shape.id as ShapeId, point));
    return this.sortShapesByCanonicalOrder([...committed, ...transient])
      .filter(shape => this.getShapePageId(shape.id as ShapeId) === this.activePageId.peek())
      .filter(shape => !this.isShapeEffectivelyHidden(shape.id as ShapeId))
      .filter(shape => this._pointInsideClippingAncestors(shape.id as ShapeId, point));
  }

  getTopShapeAtPoint(
    point: Vec2,
    filter?: (shape: GlideShape) => boolean,
  ): GlideShape | undefined {
    const hits = this.getShapesAtPoint(point);
    if (!filter) return hits[hits.length - 1];
    for (let index = hits.length - 1; index >= 0; index--) {
      if (filter(hits[index]!)) return hits[index];
    }
    return undefined;
  }

  getShapesInBox(box: Pick<Box2d, 'minX' | 'minY' | 'maxX' | 'maxY'> & Partial<Pick<Box2d, 'x' | 'y' | 'w' | 'h'>>): GlideShape[] {
    const changed = this._getInteractionAffectedShapeIds();
    const committed = toGlideShapes(this.store.getShapesInBox(box.minX, box.minY, box.maxX, box.maxY))
      .filter(shape => !changed.has(shape.id));
    const transient = [...changed]
      .map(id => toGlideShape(this.interactions.get(id)))
      .filter((shape): shape is GlideShape => shape !== null)
      .filter(shape => {
        const bounds = getWorldBounds(this, shape);
        return bounds.maxX >= box.minX && bounds.minX <= box.maxX
          && bounds.maxY >= box.minY && bounds.minY <= box.maxY;
      });
    return this.sortShapesByCanonicalOrder([...committed, ...transient])
      .filter(shape => this.getShapePageId(shape.id as ShapeId) === this.activePageId.peek())
      .filter(shape => !this.isShapeEffectivelyHidden(shape.id as ShapeId));
  }

  private _pointInsideClippingAncestors(id: ShapeId, point: Vec2): boolean {
    return this.getAncestors(id).every(parent => parent.type !== 'frame'
      || !(parent.props as AnyRecord)['clipContent']
      || this.transforms.hitTestPagePoint(parent.id as ShapeId, point));
  }

  getClippingFrameAncestors(id: ShapeId): GlideShape[] {
    return this.getAncestors(id).filter(parent => parent.type === 'frame'
      && Boolean((parent.props as AnyRecord)['clipContent']));
  }

  private _getInteractionAffectedShapeIds(): Set<string> {
    const affected = new Set(this.interactions.changedIds);
    const queue = [...affected];
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      for (const child of this.store.getChildren(parentId)) {
        if (child['kind'] !== 'shape' || affected.has(String(child['id']))) continue;
        affected.add(String(child['id']));
        queue.push(String(child['id']));
      }
    }
    return affected;
  }

  sortShapesByCanonicalOrder(shapes: readonly GlideShape[]): GlideShape[] {
    return [...shapes].sort((left, right) => this._compareCanonicalShapeOrder(left, right));
  }

  compareShapeOrder(left: GlideShape, right: GlideShape): number {
    return this._compareCanonicalShapeOrder(left, right);
  }

  private _compareCanonicalShapeOrder(left: GlideShape, right: GlideShape): number {
    if (left.id === right.id) return 0;
    const pathFor = (shape: GlideShape): GlideShape[] => {
      const path = [shape];
      const visited = new Set<string>([String(shape.id)]);
      let current = shape;
      while ('parentId' in current && typeof current.parentId === 'string') {
        const parentId = current.parentId;
        if (visited.has(parentId)) break;
        const parent = this.getShape(parentId as ShapeId);
        if (!parent) break;
        path.unshift(parent);
        visited.add(parentId);
        current = parent;
      }
      return path;
    };
    const leftPath = pathFor(left);
    const rightPath = pathFor(right);
    const leftScope = getShapeOrderParentId(leftPath[0]!);
    const rightScope = getShapeOrderParentId(rightPath[0]!);
    if (leftScope !== rightScope) return leftScope < rightScope ? -1 : 1;
    let shared = 0;
    while (shared < leftPath.length && shared < rightPath.length
      && leftPath[shared]!.id === rightPath[shared]!.id) shared++;
    if (shared === leftPath.length) return -1;
    if (shared === rightPath.length) return 1;
    return compareSiblingOrder(leftPath[shared]!, rightPath[shared]!);
  }

  getOrderedChildIds(parentId: string): readonly ShapeId[] {
    return Object.freeze(this._getAllShapes()
      .filter(shape => getShapeOrderParentId(shape) === parentId)
      .sort(compareSiblingOrder)
      .map(shape => shape.id as ShapeId));
  }

  getChildren(parentId: string): GlideShape[] {
    return this.getOrderedChildIds(parentId)
      .map(id => this.getShape(id))
      .filter((shape): shape is GlideShape => shape !== undefined);
  }

  getAncestors(id: ShapeId): GlideShape[] {
    const result: GlideShape[] = [];
    const seen = new Set<string>();
    let current = this.getShape(id);
    while (current && !seen.has(String(current.parentId))) {
      seen.add(String(current.parentId));
      const parent = this.getShape(current.parentId as ShapeId);
      if (!parent) break;
      result.push(parent);
      current = parent;
    }
    return result;
  }

  isShapeEffectivelyLocked(id: ShapeId): boolean {
    const shape = this.getShape(id);
    if (!shape) return false;
    if (shape.isLocked) return true;
    if (String(shape.parentId).startsWith('page:')) return false;
    return this.getAncestors(id).some(parent => parent.isLocked);
  }

  isShapeEffectivelyHidden(id: ShapeId): boolean {
    const shape = this.getShape(id);
    if (!shape) return false;
    if (shape.isHidden) return true;
    if (String(shape.parentId).startsWith('page:')) return false;
    return this.getAncestors(id).some(parent => parent.isHidden);
  }

  getSelectableShapeId(id: ShapeId): ShapeId | null {
    if (this.isShapeEffectivelyHidden(id)) return null;
    const focused = this.focusedGroupId.peek();
    const path = [...this.getAncestors(id)].reverse();
    if (focused) {
      const focusIndex = path.findIndex(shape => shape.id === focused);
      if (focusIndex >= 0) return (path[focusIndex + 1]?.id as ShapeId | undefined) ?? id;
    }
    const outerGroup = path.find(shape => shape.type === 'group');
    return outerGroup ? outerGroup.id as ShapeId : id;
  }

  enterGroup(id: ShapeId): boolean {
    const shape = this.getShape(id);
    if (!shape || shape.type !== 'group' || this.isShapeEffectivelyLocked(id) || this.isShapeEffectivelyHidden(id)) return false;
    this.focusedGroupId.value = id;
    this.setSelectedShapeIds([]);
    return true;
  }

  exitGroup(): boolean {
    const focused = this.focusedGroupId.peek();
    if (!focused) return false;
    const parentGroup = this.getAncestors(focused).find(shape => shape.type === 'group');
    this.focusedGroupId.value = (parentGroup?.id as ShapeId | undefined) ?? null;
    this.setSelectedShapeIds([focused]);
    return true;
  }

  getDefaultPageId(): PageId {
    return this._store.getPageIds()[0] ?? DEFAULT_PAGE_ID;
  }

  getActivePageId(): PageId {
    return this.activePageId.peek();
  }

  getPageIds(): readonly PageId[] {
    return this._store.getPageIds();
  }

  getPage(pageId: PageId): GlidePage | undefined {
    const record = this.interactions.get(pageId);
    return record?.['kind'] === 'page' ? record as unknown as GlidePage : undefined;
  }

  getShapePageId(shapeId: ShapeId): PageId | null {
    let cursor = this.interactions.get(shapeId);
    const seen = new Set<string>();
    while (cursor && cursor['kind'] === 'shape' && typeof cursor['parentId'] === 'string') {
      const parentId = cursor['parentId'] as string;
      if (seen.has(parentId)) return null;
      seen.add(parentId);
      const parent = this.interactions.get(parentId);
      if (parent?.['kind'] === 'page') return parentId as PageId;
      cursor = parent;
    }
    return null;
  }

  setActivePage(pageId: PageId): void {
    if (!this.getPage(pageId)) throw new Error(`GlideEditor: page "${pageId}" not found`);
    const current = this.activePageId.peek();
    if (current === pageId) return;
    this._pageCameras.set(current, this.camera.getCamera());
    this.interactions.cancel();
    this.textEditing.cancel();
    this.setSelectedShapeIds([]);
    this.focusedGroupId.value = null;
    this.bindingPreview.value = null;
    this.activePageId.value = pageId;
    this.camera.setCamera(this._pageCameras.get(pageId) ?? { x: 0, y: 0, z: 1 });
  }

  createPage(name?: string): PageId {
    const pages = this.getPageIds().map(id => this.getPage(id)!).filter(Boolean);
    const pageId = pid(this._store.createRecordId('page'));
    const pageName = this._normalizePageName(name ?? `Page ${pages.length + 1}`);
    const allocation = this._allocatePageOrder(pages.length);
    this.executeCommand({
      id: 'page.create', label: 'Create Page', affectedIds: [pageId, ...allocation.rebalanced.keys()],
      execute: tx => {
        for (const [id, index] of allocation.rebalanced) tx.update(id, record => ({ ...record, index }));
        tx.insert({ id: pageId, kind: 'page', type: 'page', schemaVersion: 0, name: pageName, index: allocation.index, meta: {} });
      },
    });
    this.setActivePage(pageId);
    return pageId;
  }

  renamePage(pageId: PageId, name: string): void {
    if (!this.getPage(pageId)) throw new Error(`GlideEditor: page "${pageId}" not found`);
    const nextName = this._normalizePageName(name);
    this.executeCommand({
      id: 'page.rename', label: 'Rename Page', affectedIds: [pageId],
      execute: tx => tx.update(pageId, record => ({ ...record, name: nextName })),
    });
  }

  duplicatePage(pageId: PageId): PageId {
    const page = this.getPage(pageId);
    if (!page) throw new Error(`GlideEditor: page "${pageId}" not found`);
    const pages = this.getPageIds();
    const sourceIndex = pages.indexOf(pageId);
    const nextPage = sourceIndex >= 0 ? this.getPage(pages[sourceIndex + 1]!) : undefined;
    const duplicateIndex = generateOrderKeysBetween(page.index, nextPage?.index ?? null, 1)[0]!;
    const shapeIds = new Set(this._store.getShapeIdsOnPage(pageId));
    const records = (this.store.serialize().records as AnyRecord[]).filter(record => (
      record['id'] === pageId
      || (record['kind'] === 'shape' && shapeIds.has(record['id'] as ShapeId))
      || (record['kind'] === 'binding'
        && shapeIds.has(record['fromId'] as ShapeId)
        && shapeIds.has(record['toId'] as ShapeId))
    )).map(record => record['id'] === pageId
      ? { ...cloneRecord(record), name: `${page.name} Copy`, index: duplicateIndex }
      : cloneRecord(record));
    const report = this.importRecords(records, {
      idPolicy: 'remap', relationshipPolicy: 'preserve', preserveExternalKinds: ['asset'], label: 'Duplicate Page',
    });
    const duplicateId = report.idMap[pageId] as PageId;
    this.setActivePage(duplicateId);
    return duplicateId;
  }

  movePage(pageId: PageId, direction: -1 | 1): boolean {
    const pages = [...this.getPageIds()];
    const from = pages.indexOf(pageId);
    const to = from + direction;
    if (from < 0) throw new Error(`GlideEditor: page "${pageId}" not found`);
    if (to < 0 || to >= pages.length) return false;
    [pages[from], pages[to]] = [pages[to]!, pages[from]!];
    const indices = generateRebalancedOrderKeys(pages.length);
    this.executeCommand({
      id: 'page.reorder', label: 'Reorder Page', affectedIds: pages,
      execute: tx => pages.forEach((id, index) => tx.update(id, record => ({ ...record, index: indices[index]! }))),
    });
    return true;
  }

  deletePage(pageId: PageId): PageId {
    const pages = [...this.getPageIds()];
    const index = pages.indexOf(pageId);
    if (index < 0) throw new Error(`GlideEditor: page "${pageId}" not found`);
    if (pages.length === 1) throw new Error('A whiteboard must contain at least one page.');
    const fallback = pages[index + 1] ?? pages[index - 1]!;
    const wasActive = this.activePageId.peek() === pageId;
    const shapeIds = new Set(this._store.getShapeIdsOnPage(pageId));
    if ([...shapeIds].some(id => this.isShapeEffectivelyLocked(id))) {
      throw new Error('Unlock page content before deleting the page.');
    }
    const bindingIds = (this.store.serialize().records as AnyRecord[])
      .filter(record => record['kind'] === 'binding'
        && (shapeIds.has(record['fromId'] as ShapeId) || shapeIds.has(record['toId'] as ShapeId)))
      .map(record => String(record['id']));
    this.executeCommand({
      id: 'page.delete', label: 'Delete Page', affectedIds: [pageId, ...shapeIds, ...bindingIds],
      execute: tx => {
        bindingIds.forEach(id => tx.remove(id));
        shapeIds.forEach(id => tx.remove(id));
        tx.remove(pageId);
      },
    });
    this._pageCameras.delete(pageId);
    if (wasActive) this.setActivePage(fallback);
    return fallback;
  }

  private _normalizePageName(name: string): string {
    const normalized = name.trim();
    if (!normalized) throw new Error('Page name cannot be empty.');
    if (normalized.length > 512) throw new Error('Page name cannot exceed 512 characters.');
    return normalized;
  }

  private _allocatePageOrder(existingCount: number): { index: string; rebalanced: ReadonlyMap<PageId, string> } {
    const pageIds = this.getPageIds();
    const pages = pageIds.map(id => this.getPage(id)!).filter(Boolean);
    try {
      return { index: generateOrderKeysBetween(pages[pages.length - 1]?.index ?? null, null, 1)[0]!, rebalanced: new Map() };
    } catch (error) {
      if (!(error instanceof OrderKeySpaceExhaustedError)) throw error;
      const keys = generateRebalancedOrderKeys(existingCount + 1);
      return { index: keys[existingCount]!, rebalanced: new Map(pageIds.map((id, ordinal) => [id, keys[ordinal]!])) };
    }
  }

  private _reconcileActivePage(): void {
    if (this.getPage(this.activePageId.peek())) return;
    const fallback = this.getPageIds()[0];
    if (!fallback) return;
    this.setSelectedShapeIds([]);
    this.focusedGroupId.value = null;
    this.activePageId.value = fallback;
    this.camera.setCamera(this._pageCameras.get(fallback) ?? { x: 0, y: 0, z: 1 });
  }

  generateIndexAbove(parentId: string): string {
    const siblings = this._getSiblingShapes(parentId);
    const top = siblings[siblings.length - 1]?.index ?? null;
    if (top !== null && !isCanonicalOrderKey(top)) {
      const keys = generateRebalancedOrderKeys(siblings.length + 1);
      return keys[keys.length - 1]!;
    }
    return generateOrderKeysBetween(top, null, 1)[0]!;
  }

  generateIndicesBetween(
    _parentId: string,
    lower: string | null,
    upper: string | null,
    count: number,
  ): readonly string[] {
    return generateOrderKeysBetween(lower, upper, count);
  }

  private _getAllShapes(): GlideShape[] {
    const result: GlideShape[] = [];
    const ids = new Set<ShapeId>([
      ...this._store.getShapeIds(),
      ...this.interactions.getShapeIdsSignal().peek(),
    ]);
    for (const id of ids) {
      const shape = toGlideShape(this.interactions.get(id));
      if (shape) result.push(shape);
    }
    return result;
  }

  private _getSiblingShapes(parentId: string): GlideShape[] {
    return this._getAllShapes()
      .filter(shape => getShapeOrderParentId(shape) === parentId)
      .sort(compareSiblingOrder);
  }

  private _allocateOrderKeysAbove(parentId: string, count: number): {
    keys: readonly string[];
    rebalanced: ReadonlyMap<ShapeId, string>;
  } {
    const siblings = this._getSiblingShapes(parentId);
    if (siblings.every(shape => isCanonicalOrderKey(shape.index))) {
      try {
        return {
          keys: generateOrderKeysBetween(siblings[siblings.length - 1]?.index ?? null, null, count),
          rebalanced: new Map(),
        };
      } catch (error) {
        if (!(error instanceof OrderKeySpaceExhaustedError)) throw error;
      }
    }
    const allKeys = generateRebalancedOrderKeys(siblings.length + count);
    return {
      keys: Object.freeze(allKeys.slice(siblings.length)),
      rebalanced: new Map(siblings.map((shape, index) => [shape.id as ShapeId, allKeys[index]!])),
    };
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
      parentId: this.getActivePageId(),
      isLocked: false,
      isHidden: false,
      meta: {},
      ...partial,
      kind: 'shape',
      id: partial['id'] ?? this.createShapeId(requestedType),
    };
    const parentId = getShapeOrderParentId(partial);
    const allocation = this._allocateOrderKeysAbove(parentId, 1);
    partial = { ...partial, index: allocation.keys[0]! };
    const type = partial['type'] as string;
    if (type === 'arrow' && Number(partial['rotation'] ?? 0) !== 0) {
      throw new Error('Arrow rotation must be encoded in its path points; record rotation must remain zero.');
    }
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
      affectedIds: [partial['id'] as string, ...allocation.rebalanced.keys()],
      execute: tx => {
        for (const [id, index] of allocation.rebalanced) {
          tx.update(id, record => ({ ...record, index }));
        }
        tx.insert(partial);
      },
    });
    if (type !== 'arrow') {
      this._smartRouter.markDirty();
    }
    return partial['id'] as ShapeId;
  }

  updateShape<S extends GlideShape>(id: ShapeId, partial: Partial<Omit<S, 'id' | 'type'>>): void {
    if (Object.prototype.hasOwnProperty.call(partial, 'index')) {
      throw new Error('Shape order is managed by reorderShapes(); index cannot be updated directly.');
    }
    const existing = this.interactions.get(id);
    if (!existing) throw new Error(`GlideEditor: shape "${id}" not found`);
    if (this.isShapeEffectivelyLocked(id)) throw new Error(`Shape "${id}" is locked.`);
    if (existing.type === 'arrow' && partial.rotation !== undefined && partial.rotation !== 0) {
      throw new Error('Arrow rotation must be encoded in its path points; record rotation must remain zero.');
    }
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

  /** Reparent shapes while preserving their page-space geometry. */
  reparentShapes(ids: readonly ShapeId[], parentId: PageId | ShapeId): void {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    const parent = this.interactions.get(parentId);
    if (!parent || (parent['kind'] !== 'page'
      && (parent['kind'] !== 'shape' || !this.schema.getUtil(String(parent['type']))?.canContainChildren))) {
      throw new Error(`Parent "${parentId}" must be a page or registered container shape.`);
    }
    if (parent['kind'] === 'shape' && this.isShapeEffectivelyLocked(parentId as ShapeId)) {
      throw new Error('Cannot reparent into a locked container.');
    }
    const snapshots = uniqueIds.map(id => {
      const shape = this.getShape(id);
      if (!shape) throw new Error(`GlideEditor: shape "${id}" not found`);
      if (id === parentId) throw new Error('A shape cannot be its own parent.');
      if (this.isShapeEffectivelyLocked(id)) throw new Error('Locked shapes cannot be reparented.');
      return {
        shape,
        world: this.transforms.getWorldTransform(id),
        startWorld: shape.type === 'arrow'
          ? this.localToPage(id, (shape as ArrowShape).props.start.point)
          : null,
        endWorld: shape.type === 'arrow'
          ? this.localToPage(id, (shape as ArrowShape).props.end.point)
          : null,
      };
    });
    const allocation = this._allocateOrderKeysAbove(parentId, snapshots.length);
    const movedIds = new Set(snapshots.map(item => item.shape.id as ShapeId));
    const emptiedGroups = new Set(snapshots
      .map(item => item.shape.parentId as ShapeId)
      .filter(oldParentId => {
        if (oldParentId === parentId) return false;
        const oldParent = this.getShape(oldParentId);
        return oldParent?.type === 'group'
          && this.getChildren(oldParentId).every(child => movedIds.has(child.id as ShapeId));
      }));

    this.executeCommand({
      id: 'shape.reparent',
      label: 'Reparent Shapes',
      affectedIds: [...uniqueIds, ...allocation.rebalanced.keys()],
      execute: tx => {
        for (const [id, index] of allocation.rebalanced) {
          tx.update(id, record => ({ ...record, index }));
        }
        snapshots.forEach(({ shape, world, startWorld, endWorld }, ordinal) => {
          if (shape.type === 'arrow' && startWorld && endWorld) {
            const start = this.transforms.pageToParent(parentId, startWorld);
            const end = this.transforms.pageToParent(parentId, endWorld);
            const arrow = shape as ArrowShape;
            tx.update(shape.id, record => ({
              ...record,
              parentId,
              index: allocation.keys[ordinal]!,
              x: start.x,
              y: start.y,
              rotation: 0,
              props: {
                ...arrow.props,
                start: { ...arrow.props.start, point: { x: 0, y: 0 } },
                end: {
                  ...arrow.props.end,
                  point: { x: end.x - start.x, y: end.y - start.y },
                },
              },
            }));
            return;
          }
          const placement = this.transforms.getLocalPlacementForWorldTransform(shape, world, parentId);
          tx.update(shape.id, record => ({
            ...record,
            ...placement,
            parentId,
            index: allocation.keys[ordinal]!,
          }));
        });
        for (const groupId of emptiedGroups) tx.remove(groupId);
      },
    });
    this._smartRouter.markDirty();
  }

  groupShapes(ids: readonly ShapeId[]): ShapeId {
    const shapes = [...new Set(ids)].map(id => {
      const shape = this.getShape(id);
      if (!shape) throw new Error(`GlideEditor: shape "${id}" not found`);
      return shape;
    });
    if (shapes.length < 2) throw new Error('Grouping requires at least two shapes.');
    const parentId = shapes[0]!.parentId;
    if (shapes.some(shape => shape.parentId !== parentId)) {
      throw new Error('Grouped shapes must be siblings under the same parent.');
    }
    if (shapes.some(shape => this.isShapeEffectivelyLocked(shape.id as ShapeId))) {
      throw new Error('Locked shapes cannot be grouped.');
    }
    const ordered = [...shapes].sort(compareSiblingOrder);
    const bounds = ordered.map(shape => this.getShapeVisualWorldBounds(shape));
    const minX = Math.min(...bounds.map(box => box.minX));
    const minY = Math.min(...bounds.map(box => box.minY));
    const origin = this.pageToParent(parentId, { x: minX, y: minY });
    const groupId = this.createShapeId('group');
    const worlds = new Map(ordered.map(shape => [shape.id as ShapeId, this.getWorldTransform(shape.id as ShapeId)]));
    const arrowPoints = new Map(ordered.filter(shape => shape.type === 'arrow').map(shape => [
      shape.id as ShapeId,
      {
        start: this.localToPage(shape.id as ShapeId, (shape as ArrowShape).props.start.point),
        end: this.localToPage(shape.id as ShapeId, (shape as ArrowShape).props.end.point),
      },
    ]));
    const childIndices = generateRebalancedOrderKeys(ordered.length);

    this.executeCommand({
      id: 'shape.group', label: 'Group Shapes', affectedIds: [groupId, ...ordered.map(shape => shape.id)],
      execute: tx => {
        tx.insert({
          id: groupId, kind: 'shape', type: 'group', schemaVersion: 0,
          parentId, x: origin.x, y: origin.y, rotation: 0,
          index: ordered[0]!.index, isLocked: false, isHidden: false, props: {}, meta: {},
        });
        ordered.forEach((shape, index) => {
          const arrow = arrowPoints.get(shape.id as ShapeId);
          if (shape.type === 'arrow' && arrow) {
            const start = this.pageToParent(groupId, arrow.start);
            const end = this.pageToParent(groupId, arrow.end);
            tx.update(shape.id, record => ({ ...record, parentId: groupId, index: childIndices[index]!,
              x: start.x, y: start.y, rotation: 0,
              props: { ...(record['props'] as AnyRecord),
                start: { ...((record['props'] as AnyRecord)['start'] as AnyRecord), point: { x: 0, y: 0 } },
                end: { ...((record['props'] as AnyRecord)['end'] as AnyRecord), point: { x: end.x - start.x, y: end.y - start.y } },
              },
            }));
          } else {
            const placement = this.transforms.getLocalPlacementForWorldTransform(shape, worlds.get(shape.id as ShapeId)!, groupId);
            tx.update(shape.id, record => ({ ...record, ...placement, parentId: groupId, index: childIndices[index]! }));
          }
        });
      },
    });
    this.setSelectedShapeIds([groupId]);
    this._smartRouter.markDirty();
    return groupId;
  }

  ungroupShapes(ids: readonly ShapeId[]): ShapeId[] {
    return this._removeContainersKeepContent(ids, 'group', 'shape.ungroup', 'Ungroup Shapes');
  }

  removeFramesKeepContent(ids: readonly ShapeId[]): ShapeId[] {
    return this._removeContainersKeepContent(ids, 'frame', 'frame.remove-keep-content', 'Remove Frames, Keep Content');
  }

  private _removeContainersKeepContent(
    ids: readonly ShapeId[], type: 'group' | 'frame', commandId: string, label: string,
  ): ShapeId[] {
    const containers = [...new Set(ids)].map(id => {
      const shape = this.getShape(id);
      if (!shape || shape.type !== type) throw new Error(`Shape "${id}" is not a ${type}.`);
      if (this.isShapeEffectivelyLocked(id)) throw new Error(`Locked ${type}s cannot be removed.`);
      return shape;
    }).sort(compareSiblingOrder);
    const children = containers.flatMap(container => this.getChildren(container.id as ShapeId));
    const snapshots = children.map(shape => ({
      shape,
      world: this.getWorldTransform(shape.id as ShapeId),
      arrow: shape.type === 'arrow' ? {
        start: this.localToPage(shape.id as ShapeId, (shape as ArrowShape).props.start.point),
        end: this.localToPage(shape.id as ShapeId, (shape as ArrowShape).props.end.point),
      } : null,
    }));

    this.executeCommand({
      id: commandId, label,
      affectedIds: [...containers.map(shape => shape.id), ...children.map(shape => shape.id)],
      execute: tx => {
        for (const container of containers) {
          const siblings = this._getSiblingShapes(container.parentId).filter(shape => shape.id !== container.id);
          const direct = snapshots.filter(item => item.shape.parentId === container.id);
          const insertion = siblings.findIndex(shape => compareSiblingOrder(shape, container) > 0);
          const desired = insertion < 0
            ? [...siblings, ...direct.map(item => item.shape)]
            : [...siblings.slice(0, insertion), ...direct.map(item => item.shape), ...siblings.slice(insertion)];
          const indices = generateRebalancedOrderKeys(desired.length);
          desired.forEach((shape, index) => tx.update(shape.id, record => ({ ...record, index: indices[index]! })));
          direct.forEach(item => {
            if (item.arrow) {
              const start = this.pageToParent(container.parentId, item.arrow.start);
              const end = this.pageToParent(container.parentId, item.arrow.end);
              tx.update(item.shape.id, record => ({ ...record, parentId: container.parentId,
                x: start.x, y: start.y, rotation: 0,
                props: { ...(record['props'] as AnyRecord),
                  start: { ...((record['props'] as AnyRecord)['start'] as AnyRecord), point: { x: 0, y: 0 } },
                  end: { ...((record['props'] as AnyRecord)['end'] as AnyRecord), point: { x: end.x - start.x, y: end.y - start.y } },
                },
              }));
            } else {
              const placement = this.transforms.getLocalPlacementForWorldTransform(item.shape, item.world, container.parentId);
              tx.update(item.shape.id, record => ({ ...record, ...placement, parentId: container.parentId }));
            }
          });
          tx.remove(container.id);
        }
      },
    });
    const childIds = children.map(shape => shape.id as ShapeId);
    this.setSelectedShapeIds(childIds);
    this._smartRouter.markDirty();
    return childIds;
  }

  setLocked(ids: readonly ShapeId[], locked: boolean): void {
    const unique = [...new Set(ids)];
    this.executeCommand({ id: 'shape.set-locked', label: locked ? 'Lock Shapes' : 'Unlock Shapes', affectedIds: unique,
      execute: tx => unique.forEach(id => tx.update(id, record => ({ ...record, isLocked: locked }))),
    });
  }

  setHidden(ids: readonly ShapeId[], hidden: boolean): void {
    const unique = [...new Set(ids)];
    this.executeCommand({ id: 'shape.set-hidden', label: hidden ? 'Hide Shapes' : 'Show Shapes', affectedIds: unique,
      execute: tx => unique.forEach(id => tx.update(id, record => ({ ...record, isHidden: hidden }))),
    });
    this._smartRouter.markDirty();
  }

  alignShapes(ids: readonly ShapeId[], operation: AlignOperation): void {
    const shapes = this._getTransformRoots(ids, 2);
    const bounds = new Map(shapes.map(shape => [shape.id as ShapeId, this.getShapeVisualWorldBounds(shape)]));
    const all = [...bounds.values()];
    const minX = Math.min(...all.map(box => box.minX));
    const minY = Math.min(...all.map(box => box.minY));
    const maxX = Math.max(...all.map(box => box.maxX));
    const maxY = Math.max(...all.map(box => box.maxY));
    const deltas = new Map<ShapeId, Vec2>();
    for (const shape of shapes) {
      const box = bounds.get(shape.id as ShapeId)!;
      let dx = 0;
      let dy = 0;
      if (operation === 'left') dx = minX - box.minX;
      if (operation === 'center-x') dx = (minX + maxX) / 2 - (box.minX + box.maxX) / 2;
      if (operation === 'right') dx = maxX - box.maxX;
      if (operation === 'top') dy = minY - box.minY;
      if (operation === 'center-y') dy = (minY + maxY) / 2 - (box.minY + box.maxY) / 2;
      if (operation === 'bottom') dy = maxY - box.maxY;
      deltas.set(shape.id as ShapeId, { x: dx, y: dy });
    }
    this._translateShapes('shape.align', `Align ${operation}`, shapes, deltas);
  }

  distributeShapes(
    ids: readonly ShapeId[], axis: DistributeAxis, mode: DistributeMode = 'gaps',
  ): void {
    const shapes = this._getTransformRoots(ids, 3);
    const entries = shapes.map(shape => ({ shape, box: this.getShapeVisualWorldBounds(shape) }));
    const horizontal = axis === 'horizontal';
    entries.sort((left, right) => {
      const leftCenter = horizontal
        ? (left.box.minX + left.box.maxX) / 2
        : (left.box.minY + left.box.maxY) / 2;
      const rightCenter = horizontal
        ? (right.box.minX + right.box.maxX) / 2
        : (right.box.minY + right.box.maxY) / 2;
      return leftCenter - rightCenter || this.compareShapeOrder(left.shape, right.shape);
    });
    const first = entries[0]!;
    const last = entries[entries.length - 1]!;
    const deltas = new Map<ShapeId, Vec2>();
    if (mode === 'centers') {
      const firstCenter = horizontal
        ? (first.box.minX + first.box.maxX) / 2
        : (first.box.minY + first.box.maxY) / 2;
      const lastCenter = horizontal
        ? (last.box.minX + last.box.maxX) / 2
        : (last.box.minY + last.box.maxY) / 2;
      const step = (lastCenter - firstCenter) / (entries.length - 1);
      entries.forEach((entry, index) => {
        const center = horizontal
          ? (entry.box.minX + entry.box.maxX) / 2
          : (entry.box.minY + entry.box.maxY) / 2;
        const delta = firstCenter + step * index - center;
        deltas.set(entry.shape.id as ShapeId, horizontal ? { x: delta, y: 0 } : { x: 0, y: delta });
      });
    } else {
      const start = horizontal ? first.box.minX : first.box.minY;
      const end = horizontal ? last.box.maxX : last.box.maxY;
      const occupied = entries.reduce((sum, entry) => sum + (horizontal ? entry.box.w : entry.box.h), 0);
      const gap = (end - start - occupied) / (entries.length - 1);
      let cursor = start;
      entries.forEach(entry => {
        const current = horizontal ? entry.box.minX : entry.box.minY;
        const delta = cursor - current;
        deltas.set(entry.shape.id as ShapeId, horizontal ? { x: delta, y: 0 } : { x: 0, y: delta });
        cursor += (horizontal ? entry.box.w : entry.box.h) + gap;
      });
    }
    this._translateShapes('shape.distribute', `Distribute ${axis} ${mode}`, shapes, deltas);
  }

  matchShapeSizes(ids: readonly ShapeId[], operation: MatchSizeOperation): void {
    const shapes = this._getTransformRoots(ids, 2);
    const reference = shapes[shapes.length - 1]!;
    const referenceBounds = this.getShapeLocalBounds(reference.id as ShapeId);
    const patches = new Map<ShapeId, Partial<GlideShape>>();
    for (const shape of shapes) {
      if (shape.id === reference.id) continue;
      const bounds = this.getShapeLocalBounds(shape.id as ShapeId);
      const w = operation === 'height' ? bounds.w : referenceBounds.w;
      const h = operation === 'width' ? bounds.h : referenceBounds.h;
      patches.set(shape.id as ShapeId, this._getResizePatch(shape, w, h, false));
    }
    this._applyShapePatches('shape.match-size', `Match ${operation}`, patches);
  }

  flipShapes(ids: readonly ShapeId[], axis: FlipAxis): void {
    const shapes = this._getTransformRoots(ids, 1);
    const boxes = shapes.map(shape => this.getShapeVisualWorldBounds(shape));
    const pivot = axis === 'horizontal'
      ? (Math.min(...boxes.map(box => box.minX)) + Math.max(...boxes.map(box => box.maxX))) / 2
      : (Math.min(...boxes.map(box => box.minY)) + Math.max(...boxes.map(box => box.maxY))) / 2;
    const patches = new Map<ShapeId, Partial<GlideShape>>();
    for (const shape of shapes) {
      if (shape.type === 'arrow') {
        const arrow = shape as ArrowShape;
        const reflect = (point: Vec2): Vec2 => axis === 'horizontal'
          ? { x: pivot * 2 - point.x, y: point.y }
          : { x: point.x, y: pivot * 2 - point.y };
        const start = this.pageToParent(shape.parentId, reflect(this.localToPage(shape.id as ShapeId, arrow.props.start.point)));
        const end = this.pageToParent(shape.parentId, reflect(this.localToPage(shape.id as ShapeId, arrow.props.end.point)));
        patches.set(shape.id as ShapeId, {
          x: start.x, y: start.y, rotation: 0,
          props: {
            ...arrow.props,
            start: { ...arrow.props.start, point: { x: 0, y: 0 } },
            end: { ...arrow.props.end, point: { x: end.x - start.x, y: end.y - start.y } },
          },
        } as Partial<GlideShape>);
        continue;
      }
      const localBounds = this.getShapeLocalBounds(shape.id as ShapeId);
      const localCenter = { x: localBounds.minX + localBounds.w / 2, y: localBounds.minY + localBounds.h / 2 };
      const center = this.localToPage(shape.id as ShapeId, localCenter);
      const targetCenter = axis === 'horizontal'
        ? { x: pivot * 2 - center.x, y: center.y }
        : { x: center.x, y: pivot * 2 - center.y };
      const rotation = axis === 'horizontal' ? Math.PI - shape.rotation : -shape.rotation;
      const candidate = { ...shape, rotation } as GlideShape;
      const translation = this.transforms.getTranslationForLocalPoint(candidate, localCenter, targetCenter);
      patches.set(shape.id as ShapeId, { x: translation.x, y: translation.y, rotation });
    }
    this._applyShapePatches('shape.flip', `Flip ${axis}`, patches);
  }

  tidyShapes(ids: readonly ShapeId[], layout: TidyLayout = 'row', gap = 24): void {
    const shapes = this._getTransformRoots(ids, 2).sort((left, right) => this.compareShapeOrder(left, right));
    const boxes = shapes.map(shape => this.getShapeVisualWorldBounds(shape));
    const startX = Math.min(...boxes.map(box => box.minX));
    const startY = Math.min(...boxes.map(box => box.minY));
    const deltas = new Map<ShapeId, Vec2>();
    if (layout === 'row') {
      let x = startX;
      shapes.forEach((shape, index) => {
        const box = boxes[index]!;
        deltas.set(shape.id as ShapeId, { x: x - box.minX, y: startY - box.minY });
        x += box.w + gap;
      });
    } else {
      const columns = Math.ceil(Math.sqrt(shapes.length));
      const cellW = Math.max(...boxes.map(box => box.w)) + gap;
      const cellH = Math.max(...boxes.map(box => box.h)) + gap;
      shapes.forEach((shape, index) => {
        const box = boxes[index]!;
        const column = index % columns;
        const row = Math.floor(index / columns);
        deltas.set(shape.id as ShapeId, {
          x: startX + column * cellW - box.minX,
          y: startY + row * cellH - box.minY,
        });
      });
    }
    this._translateShapes('shape.tidy', `Tidy ${layout}`, shapes, deltas);
  }

  nudgeShapes(ids: readonly ShapeId[], delta: Vec2): void {
    const shapes = this._getTransformRoots(ids, 1);
    this._translateShapes('shape.nudge', 'Nudge Shapes', shapes,
      new Map(shapes.map(shape => [shape.id as ShapeId, delta])));
  }

  setShapePrecision(id: ShapeId, patch: ShapePrecisionPatch): void {
    const shape = this._getTransformRoots([id], 1)[0]!;
    let nextPatch: Partial<GlideShape> = {};
    if (patch.w !== undefined || patch.h !== undefined) {
      const bounds = this.getShapeLocalBounds(id);
      let w = Math.max(1, patch.w ?? bounds.w);
      let h = Math.max(1, patch.h ?? bounds.h);
      if (patch.lockAspect && bounds.w > 0 && bounds.h > 0) {
        if (patch.w !== undefined && patch.h === undefined) h = w * bounds.h / bounds.w;
        if (patch.h !== undefined && patch.w === undefined) w = h * bounds.w / bounds.h;
      }
      nextPatch = this._getResizePatch(shape, w, h, patch.lockAspect ?? false);
    }
    if (patch.rotation !== undefined && shape.type !== 'arrow') {
      const bounds = this.getShapeLocalBounds(id);
      const center = { x: bounds.minX + bounds.w / 2, y: bounds.minY + bounds.h / 2 };
      const pageCenter = this.localToPage(id, center);
      const candidate = { ...shape, ...nextPatch, rotation: patch.rotation,
        props: { ...shape.props, ...(nextPatch.props ?? {}) } } as GlideShape;
      const translation = this.transforms.getTranslationForLocalPoint(candidate, center, pageCenter);
      nextPatch = { ...nextPatch, x: translation.x, y: translation.y, rotation: patch.rotation };
    }
    if (patch.x !== undefined || patch.y !== undefined) {
      const world = this.getShapeVisualWorldBounds(id);
      const delta = { x: (patch.x ?? world.minX) - world.minX, y: (patch.y ?? world.minY) - world.minY };
      const localDelta = this.pageDeltaToParent(shape.parentId, delta);
      nextPatch.x = (nextPatch.x ?? shape.x) + localDelta.x;
      nextPatch.y = (nextPatch.y ?? shape.y) + localDelta.y;
    }
    this._applyShapePatches('shape.set-precision', 'Set Shape Geometry', new Map([[id, nextPatch]]));
  }

  resetShapeRotations(ids: readonly ShapeId[]): void {
    const shapes = this._getTransformRoots(ids, 1);
    const patches = new Map<ShapeId, Partial<GlideShape>>();
    for (const shape of shapes) {
      if (shape.type === 'arrow') continue;
      const bounds = this.getShapeLocalBounds(shape.id as ShapeId);
      const center = { x: bounds.minX + bounds.w / 2, y: bounds.minY + bounds.h / 2 };
      const pageCenter = this.localToPage(shape.id as ShapeId, center);
      const candidate = { ...shape, rotation: 0 } as GlideShape;
      const translation = this.transforms.getTranslationForLocalPoint(candidate, center, pageCenter);
      patches.set(shape.id as ShapeId, { x: translation.x, y: translation.y, rotation: 0 });
    }
    this._applyShapePatches('shape.reset-rotation', 'Reset Rotation', patches);
  }

  private _getTransformRoots(ids: readonly ShapeId[], minimum: number): GlideShape[] {
    const selected = new Set(ids);
    const shapes = [...selected].map(id => {
      const shape = this.getShape(id);
      if (!shape) throw new Error(`GlideEditor: shape "${id}" not found`);
      if (this.isShapeEffectivelyLocked(id)) throw new Error(`Shape "${id}" is locked.`);
      return shape;
    }).filter(shape => !this.getAncestors(shape.id as ShapeId)
      .some(parent => selected.has(parent.id as ShapeId)));
    if (shapes.length < minimum) throw new Error(`Operation requires at least ${minimum} shape${minimum === 1 ? '' : 's'}.`);
    return shapes;
  }

  private _translateShapes(
    commandId: string, label: string, shapes: readonly GlideShape[], deltas: ReadonlyMap<ShapeId, Vec2>,
  ): void {
    const patches = new Map<ShapeId, Partial<GlideShape>>();
    for (const shape of shapes) {
      const delta = deltas.get(shape.id as ShapeId) ?? { x: 0, y: 0 };
      const local = this.pageDeltaToParent(shape.parentId, delta);
      patches.set(shape.id as ShapeId, { x: shape.x + local.x, y: shape.y + local.y });
    }
    this._applyShapePatches(commandId, label, patches);
  }

  private _getResizePatch(shape: GlideShape, width: number, height: number, constrainAspect: boolean): Partial<GlideShape> {
    if (shape.type === 'arrow' || shape.type === 'group') {
      throw new Error(`${shape.type} size is controlled by its content.`);
    }
    const util = this.getShapeUtil(shape.type);
    const bounds = util.getGeometry(shape as any).getBounds();
    const pageCenter = this.localToPage(shape.id as ShapeId, {
      x: bounds.minX + bounds.w / 2,
      y: bounds.minY + bounds.h / 2,
    });
    let w = Math.max(1, width);
    let h = Math.max(1, height);
    if (constrainAspect && bounds.w > 0 && bounds.h > 0) {
      const scale = Math.max(w / bounds.w, h / bounds.h);
      w = bounds.w * scale;
      h = bounds.h * scale;
    }
    const result = util.onResize(shape as any, {
      handle: 'se', scaleX: w / (bounds.w || 1), scaleY: h / (bounds.h || 1),
      initialShape: shape as any, initialBounds: bounds,
      newBounds: makeBox(bounds.minX, bounds.minY, w, h),
    }) as Partial<GlideShape>;
    const candidate = { ...shape, ...result, x: shape.x, y: shape.y,
      props: { ...shape.props, ...(result.props ?? {}) } } as GlideShape;
    const nextBounds = util.getGeometry(candidate as any).getBounds();
    const translation = this.transforms.getTranslationForLocalPoint(candidate, {
      x: nextBounds.minX + nextBounds.w / 2,
      y: nextBounds.minY + nextBounds.h / 2,
    }, pageCenter);
    return { ...result, x: translation.x, y: translation.y };
  }

  private _applyShapePatches(
    commandId: string, label: string, patches: ReadonlyMap<ShapeId, Partial<GlideShape>>,
  ): void {
    if (patches.size === 0) return;
    this.executeCommand({
      id: commandId, label, affectedIds: [...patches.keys()],
      execute: tx => {
        for (const [id, patch] of patches) {
          tx.update(id, record => ({
            ...record,
            ...patch,
            ...(patch.props ? { props: { ...(record['props'] as AnyRecord), ...(patch.props as AnyRecord) } } : {}),
          }));
        }
      },
    });
    this._smartRouter.markDirty();
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
    let addedEmptyGroup = true;
    while (addedEmptyGroup) {
      addedEmptyGroup = false;
      for (const id of [...closure]) {
        const shape = this.getShape(id);
        const parent = shape ? this.getShape(shape.parentId as ShapeId) : undefined;
        if (parent?.type !== 'group' || closure.has(parent.id as ShapeId)) continue;
        if (this.getChildren(parent.id as ShapeId).every(child => closure.has(child.id as ShapeId))) {
          visit(parent.id as ShapeId);
          addedEmptyGroup = true;
        }
      }
    }
    const deleteIds = Array.from(closure);
    if (deleteIds.some(id => this.isShapeEffectivelyLocked(id))) {
      throw new Error('Locked shapes cannot be deleted.');
    }
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
    this._selection.value = new Set(ids.filter(id => this.getShape(id)
      && this.getShapePageId(id) === this.activePageId.peek()
      && !this.isShapeEffectivelyHidden(id)));
  }

  selectAll(): void {
    this.setSelectedShapeIds([...this._currentPageShapeIdsSignal.peek()]);
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

  /**
   * Create a versioned, JSON-safe fragment for cross-board or retained-snapshot use.
   * Every raster must be made self-contained or assigned a durable host reference.
   */
  async createPortableBoardFragment(
    ids: readonly ShapeId[],
    options: CreatePortableBoardFragmentOptions,
  ): Promise<PortableBoardFragment | null> {
    const clipboard = this._createClipboardPayload(ids);
    if (!clipboard) return null;
    const context = options.resolutionContext
      ? cloneRecord(options.resolutionContext)
      : undefined;
    if (context !== undefined) validatePortableResolutionContext(context);
    validatePortableRasterRecordIds(clipboard.records);
    const assets = new Map<string, GlideAsset>();
    for (const record of clipboard.records) {
      if (record['kind'] === 'asset') assets.set(String(record['id']), record as unknown as GlideAsset);
    }

    const rasterPayloads: PortableRasterPayload[] = [];
    let totalEmbeddedBytes = 0;
    for (const assetId of [...clipboard.assetRefs].sort()) {
      const asset = assets.get(assetId);
      if (!asset || asset.type !== 'raster-image') continue;
      const exported = await options.exportRasterAsset(cloneRecord(asset), context);
      if (exported.kind === 'self-contained') {
        const bytes = new Uint8Array(exported.bytes);
        if (bytes.byteLength > PORTABLE_BOARD_FRAGMENT_LIMITS.maxEmbeddedAssetBytes) {
          throw new Error(`Raster asset "${assetId}" exceeds portable embedded-byte limit`);
        }
        totalEmbeddedBytes += bytes.byteLength;
        if (totalEmbeddedBytes > PORTABLE_BOARD_FRAGMENT_LIMITS.maxTotalEmbeddedBytes) {
          throw new Error('Portable raster payloads exceed total embedded-byte limit');
        }
        rasterPayloads.push(Object.freeze({
          assetId,
          kind: 'embedded' as const,
          base64: bytesToBase64(bytes),
          byteLength: bytes.byteLength,
        }));
      } else {
        if (exported.reference.length === 0
          || utf8ByteLength(exported.reference) > PORTABLE_BOARD_FRAGMENT_LIMITS.maxStringBytes) {
          throw new Error(`Raster asset "${assetId}" has an empty durable reference`);
        }
        rasterPayloads.push(Object.freeze({
          assetId,
          kind: 'durable-reference' as const,
          reference: exported.reference,
        }));
      }
    }
    const fragment = Object.freeze({
      schema: Object.freeze({
        portableBoardFragmentVersion: 1 as const,
        storeVersion: clipboard.schema.storeVersion,
      }),
      rootIds: clipboard.rootIds,
      records: Object.freeze(clipboard.records.map(record => cloneRecord(record))),
      assetRefs: clipboard.assetRefs,
      rasterPayloads: Object.freeze(rasterPayloads),
      sourceBounds: clipboard.sourceBounds,
      ...(context ? { resolutionContext: Object.freeze(context) } : {}),
    });
    validatePortableBoardFragmentStructure(fragment);
    await options.retainAssetReferences(Object.freeze(rasterPayloads.map(payload => payload.assetId)), context);
    return fragment;
  }

  /** Materialize all external raster data before atomically importing any records. */
  async pastePortableBoardFragment(
    fragment: PortableBoardFragment,
    options: PastePortableBoardFragmentOptions,
  ): Promise<ShapeId[]> {
    validatePortableBoardFragmentStructure(fragment);
    const records = fragment.records.map(record => cloneRecord(record));
    this._preflightPortableBoardFragment(fragment, records);
    const rasterAssets = new Map<string, GlideAsset>();
    for (const record of records) {
      if (record['kind'] !== 'asset' || record['type'] !== 'raster-image') continue;
      rasterAssets.set(String(record['id']), record as unknown as GlideAsset);
    }
    const payloads = new Map<string, PortableRasterPayload>();
    for (const payload of fragment.rasterPayloads) {
      if (payloads.has(payload.assetId)) throw new Error(`Duplicate raster payload for asset "${payload.assetId}"`);
      if (payload.kind === 'embedded') {
        const bytes = base64ToBytes(payload.base64);
        if (bytes.byteLength !== payload.byteLength) {
          throw new Error(`Embedded raster payload length mismatch for asset "${payload.assetId}"`);
        }
      } else if (payload.reference.length === 0) {
        throw new Error(`Raster asset "${payload.assetId}" has an empty durable reference`);
      }
      payloads.set(payload.assetId, payload);
    }
    for (const assetId of rasterAssets.keys()) {
      if (!payloads.has(assetId)) throw new Error(`Missing raster payload for asset "${assetId}"`);
    }
    for (const assetId of payloads.keys()) {
      if (!rasterAssets.has(assetId)) throw new Error(`Raster payload references unknown asset "${assetId}"`);
    }

    const completed: PortableAssetMaterialization[] = [];
    try {
      for (const assetId of [...rasterAssets.keys()].sort()) {
        const asset = rasterAssets.get(assetId)!;
        const result = await options.materializeRasterAsset(
          cloneRecord(payloads.get(assetId)!),
          cloneRecord(asset),
          fragment.resolutionContext ? cloneRecord(fragment.resolutionContext) : undefined,
        );
        if (!result || typeof result.rollback !== 'function') {
          throw new Error(`Raster materialization for asset "${assetId}" did not provide required compensation`);
        }
        completed.push(result);
      }
      const offset = options.point
        ? { x: options.point.x - fragment.sourceBounds.minX, y: options.point.y - fragment.sourceBounds.minY }
        : { x: 20, y: 20 };
      const ids = this._pasteClipboardPayload({
        schema: { clipboardVersion: 1, storeVersion: fragment.schema.storeVersion },
        rootIds: fragment.rootIds,
        records,
        assetRefs: fragment.assetRefs,
        sourceBounds: fragment.sourceBounds,
      }, offset, 'Paste');
      this.setSelectedShapeIds(ids);
      return ids;
    } catch (error) {
      const rollbackResults = await Promise.allSettled(completed.reverse().map(result => result.rollback()));
      const rollbackErrors = rollbackResults
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => result.reason);
      if (rollbackErrors.length > 0) throw new PortablePasteRollbackError(error, rollbackErrors);
      throw error;
    }
  }

  private _preflightPortableBoardFragment(
    fragment: PortableBoardFragment,
    records: readonly AnyRecord[],
  ): void {
    const byId = new Map<string, AnyRecord>();
    for (const record of records) {
      const prepared = this.schema.prepareRecord(record);
      this.schema.validateRecord(prepared);
      const id = String(prepared['id']);
      if (byId.has(id)) throw new Error(`Duplicate portable record id "${id}"`);
      byId.set(id, prepared);
    }
    for (const rootId of fragment.rootIds) {
      if (byId.get(rootId)?.['kind'] !== 'shape') throw new Error(`Portable root "${rootId}" is not a shape`);
    }
    for (const assetId of fragment.assetRefs) {
      if (byId.get(assetId)?.['kind'] !== 'asset') {
        throw new Error(`Portable asset reference "${assetId}" is not an imported asset`);
      }
    }
    for (const record of records) {
      const id = String(record['id']);
      if (record['kind'] === 'shape') {
        const parentId = record['parentId'];
        if (typeof parentId === 'string' && !byId.has(parentId)
          && this.store.get(parentId)?.['kind'] !== 'page') {
          throw new Error(`Portable shape "${id}" has an invalid parent`);
        }
      }
      if (record['kind'] === 'binding') {
        if (byId.get(String(record['fromId']))?.['kind'] !== 'shape'
          || byId.get(String(record['toId']))?.['kind'] !== 'shape') {
          throw new Error(`Portable binding "${id}" must reference imported shapes`);
        }
      }
      for (const descriptor of this.schema.getReferenceDescriptors(record)) {
        const reference = readPointer(record, descriptor.path);
        if (typeof reference !== 'string') continue;
        const target = byId.get(reference);
        if (!target || target['kind'] !== descriptor.targetKind) {
          throw new Error(`Portable record "${id}" has an invalid ${descriptor.path} reference`);
        }
      }
    }
    this.assertMutationAllowed({
      origin: 'local-api',
      command: 'document.import',
      affectedIds: records.map(record => String(record['id'])),
    });
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
    const copiedById = new Map(records.map(record => [String(record['id']), record]));
    for (const rootId of rootIds) {
      const source = this.getShape(rootId);
      const copied = copiedById.get(rootId);
      if (!source || !copied || !this.getShape(source.parentId as ShapeId)) continue;
      let pageId: PageId = this.getActivePageId();
      let cursor: GlideShape | undefined = source;
      while (cursor) {
        if (!this.getShape(cursor.parentId as ShapeId)) {
          pageId = cursor.parentId as PageId;
          break;
        }
        cursor = this.getShape(cursor.parentId as ShapeId);
      }
      if (source.type === 'arrow') {
        const arrow = source as ArrowShape;
        const start = this.localToPage(rootId, arrow.props.start.point);
        const end = this.localToPage(rootId, arrow.props.end.point);
        Object.assign(copied, {
          parentId: pageId, x: start.x, y: start.y, rotation: 0,
          props: {
            ...arrow.props,
            start: { ...arrow.props.start, point: { x: 0, y: 0 } },
            end: { ...arrow.props.end, point: { x: end.x - start.x, y: end.y - start.y } },
          },
        });
      } else {
        Object.assign(copied, this.transforms.getLocalPlacementForWorldTransform(
          source, this.getWorldTransform(rootId), pageId,
        ), { parentId: pageId });
      }
    }
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
    for (const rootId of payload.rootIds) {
      const root = recordById.get(rootId);
      if (root?.['kind'] === 'shape') root['parentId'] = this.getActivePageId();
    }
    const orderedRootIds = [...payload.rootIds].sort((left, right) => {
      const leftRecord = recordById.get(left);
      const rightRecord = recordById.get(right);
      if (!leftRecord || !rightRecord) return String(left).localeCompare(String(right));
      return compareSiblingOrder(leftRecord as unknown as GlideShape, rightRecord as unknown as GlideShape);
    });
    const rootsByParent = new Map<string, ShapeId[]>();
    for (const id of orderedRootIds) {
      const record = recordById.get(id);
      if (!record) continue;
      const parentId = getShapeOrderParentId(record);
      const group = rootsByParent.get(parentId) ?? [];
      group.push(id);
      rootsByParent.set(parentId, group);
    }
    const rebalanced = new Map<ShapeId, string>();
    for (const [parentId, rootIds] of rootsByParent) {
      const allocation = this._allocateOrderKeysAbove(parentId, rootIds.length);
      for (const [id, index] of allocation.rebalanced) rebalanced.set(id, index);
      rootIds.forEach((id, ordinal) => {
        const record = recordById.get(id);
        if (record) record['index'] = allocation.keys[ordinal]!;
      });
    }
    for (const record of records) {
      if (!payload.rootIds.includes(record['id'] as ShapeId) || record['kind'] !== 'shape') continue;
      record['x'] = Number(record['x']) + offset.x;
      record['y'] = Number(record['y']) + offset.y;
    }

    let report!: ImportReport;
    this.executeCommand({
      id: label === 'Paste' ? 'clipboard.paste' : 'shape.duplicate',
      label,
      affectedIds: [...payload.records.map(record => String(record['id'])), ...rebalanced.keys()],
      execute: tx => {
        for (const [id, index] of rebalanced) {
          tx.update(id, record => ({ ...record, index }));
        }
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
    const activePageId = this.activePageId.peek();
    const shapes = this._getAllShapes()
      .filter(shape => this.getShapePageId(shape.id as ShapeId) === activePageId)
      .filter(shape => !this.isShapeEffectivelyHidden(shape.id as ShapeId));
    return sorted ? sortShapesByCanonicalOrder(shapes, shapes) : shapes;
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
   * Only selected siblings receive new fractional keys. A parent-local full
   * rebalance is used solely when legacy keys or exhausted key space require it.
   */
  reorderShapes(
    ids: ShapeId[],
    position: 'front' | 'back' | 'forward' | 'backward',
  ): void {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;
    if ([...idSet].some(id => this.isShapeEffectivelyLocked(id))) {
      throw new Error('Locked shapes cannot be reordered.');
    }
    this.assertMutationAllowed({
      origin: 'local-user',
      command: 'shape.reorder',
      affectedIds: [...idSet],
    });
    const groups = new Map<string, GlideShape[]>();
    for (const shape of this._getAllShapes()) {
      if (!idSet.has(shape.id as ShapeId)) continue;
      const parentId = getShapeOrderParentId(shape);
      const group = groups.get(parentId) ?? [];
      group.push(shape);
      groups.set(parentId, group);
    }

    const updates = new Map<ShapeId, string>();
    for (const [parentId] of groups) {
      const siblings = this._getSiblingShapes(parentId);
      const targets = new Set(siblings.filter(shape => idSet.has(shape.id as ShapeId)).map(shape => shape.id as ShapeId));
      if (targets.size === 0 || targets.size === siblings.length) continue;
      const desired = [...siblings];
      if (position === 'front' || position === 'back') {
        const selected = desired.filter(shape => targets.has(shape.id as ShapeId));
        const rest = desired.filter(shape => !targets.has(shape.id as ShapeId));
        desired.splice(0, desired.length, ...(position === 'front' ? [...rest, ...selected] : [...selected, ...rest]));
      } else if (position === 'forward') {
        for (let index = desired.length - 2; index >= 0; index--) {
          if (targets.has(desired[index]!.id as ShapeId) && !targets.has(desired[index + 1]!.id as ShapeId)) {
            [desired[index], desired[index + 1]] = [desired[index + 1]!, desired[index]!];
          }
        }
      } else {
        for (let index = 1; index < desired.length; index++) {
          if (targets.has(desired[index]!.id as ShapeId) && !targets.has(desired[index - 1]!.id as ShapeId)) {
            [desired[index - 1], desired[index]] = [desired[index]!, desired[index - 1]!];
          }
        }
      }

      if (desired.every((shape, index) => shape.id === siblings[index]?.id)) continue;

      const groupUpdates = this._keysForDesiredSiblingOrder(desired, targets);
      for (const [id, index] of groupUpdates) updates.set(id, index);
    }
    if (updates.size === 0) return;

    this.executeCommand({
      id: 'shape.reorder',
      label: 'Reorder Shapes',
      affectedIds: [...updates.keys()],
      execute: tx => {
        for (const [id, index] of updates) {
          tx.update(id, record => ({ ...record, index }));
        }
      },
    });
  }

  private _keysForDesiredSiblingOrder(
    desired: readonly GlideShape[],
    mutableIds: ReadonlySet<ShapeId>,
  ): ReadonlyMap<ShapeId, string> {
    if (desired.every(shape => isCanonicalOrderKey(shape.index))) {
      try {
        const result = new Map<ShapeId, string>();
        let cursor = 0;
        while (cursor < desired.length) {
          if (!mutableIds.has(desired[cursor]!.id as ShapeId)) {
            cursor++;
            continue;
          }
          const start = cursor;
          while (cursor < desired.length && mutableIds.has(desired[cursor]!.id as ShapeId)) cursor++;
          const lower = start > 0 ? desired[start - 1]!.index : null;
          const upper = cursor < desired.length ? desired[cursor]!.index : null;
          const keys = generateOrderKeysBetween(lower, upper, cursor - start);
          for (let index = start; index < cursor; index++) {
            const shape = desired[index]!;
            if (shape.index !== keys[index - start]) result.set(shape.id as ShapeId, keys[index - start]!);
          }
        }
        return result;
      } catch (error) {
        if (!(error instanceof OrderKeySpaceExhaustedError)) throw error;
      }
    }

    const keys = generateRebalancedOrderKeys(desired.length);
    const result = new Map<ShapeId, string>();
    desired.forEach((shape, index) => {
      if (shape.index !== keys[index]) result.set(shape.id as ShapeId, keys[index]!);
    });
    return result;
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

  private _applyTextEdit(
    id: ShapeId,
    draft: string,
    pendingProps: Readonly<Record<string, unknown>> | undefined,
    history: 'record' | 'ignore',
  ): void {
    const latest = this.getShape(id);
    if (!latest) return;
    if (latest.type === 'text' && draft.trim() === '') {
      if (history === 'record') this.batch('Delete Empty Text', () => this.deleteShapes([id]));
      return;
    }
    const util = this.getShapeUtil(latest.type);
    const patch = util.getTextCommitPatch(latest as any, draft, pendingProps) as Partial<GlideShape>;
    if (latest.type === 'text' && latest.rotation !== 0) {
      const anchoredPagePoint = this.transforms.localToPage(id, { x: 0, y: 0 });
      const nextShape = {
        ...latest,
        ...patch,
        props: { ...latest.props, ...(patch.props ?? {}) },
      } as GlideShape;
      const translation = this.transforms.getTranslationForLocalPoint(
        nextShape,
        { x: 0, y: 0 },
        anchoredPagePoint,
      );
      patch.x = translation.x;
      patch.y = translation.y;
    }
    this.batch('Edit Text', () => this.updateShape(id, patch as any), { history });
  }

  // ── Inline editing state ───────────────────────────────────

  /**
   * Start the canonical draft session for a shape's editable text field.
   */
  startEditing(
    id: ShapeId,
    pendingProps?: Readonly<Record<string, unknown>>,
  ): void {
    this._liveTextEditBaseline = null;
    const session = this.textEditing.start(id, pendingProps);
    if (!session) return;
    this.setSelectedShapeIds([]);
  }

  /** Clear the inline-editing state. */
  stopEditing(selectAgain = false): void {
    const id = this.editingShapeId.peek();
    this.textEditing.cancel();
    if (selectAgain && id && this.getShape(id)) {
      this.setSelectedShapeIds([id]);
    }
  }

  updateEditingDraft(
    draft: string,
    pendingProps?: Readonly<Record<string, unknown>>,
    forceDirty = false,
  ): void { this.textEditing.updateDraft(draft, pendingProps, forceDirty); }
  setEditingComposition(composing: boolean): void { this.textEditing.setComposing(composing); }

  /** Publish the active draft without closing the editor or adding a per-key undo entry. */
  publishEditingDraft(): boolean {
    const session = this.textEditing.session.peek();
    if (!session || session.composing || session.status === 'conflicted') return false;
    const shape = this.getShape(session.shapeId);
    if (!shape) return false;
    if (!this._liveTextEditBaseline) this._liveTextEditBaseline = shape;
    this._applyTextEdit(session.shapeId, session.draft, session.pendingProps, 'ignore');
    return true;
  }

  commitEditing(selectAgain = true): boolean {
    const id = this.editingShapeId.peek();
    const session = this.textEditing.session.peek();
    const shape = id ? this.getShape(id) : undefined;
    const deleteEmptyText = shape?.type === 'text' && session?.draft.trim() === '';
    const committed = this.textEditing.commit();
    if (committed && deleteEmptyText && id && this.getShape(id)) {
      this.batch('Delete Empty Text', () => this.deleteShapes([id]));
    }
    if (committed && selectAgain && id && this.getShape(id)) this.setSelectedShapeIds([id]);
    if (committed && this._liveTextEditBaseline) {
      this.recordHistoryPreview('Edit Text', new Map([
        [this._liveTextEditBaseline.id, this._liveTextEditBaseline],
      ]));
      this._liveTextEditBaseline = null;
    }
    return committed;
  }

  cancelEditing(selectAgain = true, recover = false): void {
    const id = this.editingShapeId.peek();
    const baseline = this._liveTextEditBaseline;
    this._liveTextEditBaseline = null;
    if (baseline && this.getShape(baseline.id as ShapeId)) {
      this.batch('Cancel Text Edit', () => {
        this.executeCommand({
          id: 'text.edit.cancel',
          label: 'Cancel Text Edit',
          affectedIds: [baseline.id],
          execute: tx => tx.update(baseline.id, () => baseline),
        });
      }, { history: 'ignore' });
    }
    this.textEditing.cancel({ recover });
    if (selectAgain && id && this.getShape(id)) this.setSelectedShapeIds([id]);
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
  setCurrentTool(id: string, options: { preserveSelection?: boolean } = {}): void {
    const tool = this._tools.get(id);
    if (!tool) throw new Error(`GlideEditor: unknown tool "${id}"`);
    const prev = this._currentToolSignal.peek();
    if (prev) prev.current?.onExit();
    // Tool changes are a hard interaction boundary. Tool-specific onExit gets
    // the first chance to clean up; this catches every remaining overlay.
    if (this.interactions.active) this.interactions.cancel();
    this.clearBindingPreview();
    if (id !== 'select' && !options.preserveSelection) {
      this.setSelectedShapeIds([]);
    }
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

  getShapeLocalBounds(id: ShapeId): Box2d {
    const shape = this.getShape(id);
    if (!shape) throw new Error(`GlideEditor: shape "${id}" not found`);
    return this.getShapeUtil(shape.type).getGeometry(shape as any).getBounds();
  }

  getShapeLocalOutline(id: ShapeId): readonly Vec2[] {
    const shape = this.getShape(id);
    if (!shape) throw new Error(`GlideEditor: shape "${id}" not found`);
    return this.getShapeUtil(shape.type).getGeometry(shape as any).getOutline();
  }

  getShapeWorldBounds(shapeOrId: GlideShape | ShapeId): Box2d {
    const shape = typeof shapeOrId === 'string'
      ? this.getShape(shapeOrId)
      : shapeOrId;
    if (!shape) {
      throw new Error(`GlideEditor: shape "${shapeOrId}" not found`);
    }
    return this.transforms.getWorldBounds(shape.id as ShapeId);
  }

  getShapeVisualWorldBounds(shapeOrId: GlideShape | ShapeId): Box2d {
    const shape = typeof shapeOrId === 'string' ? this.getShape(shapeOrId) : shapeOrId;
    if (!shape) throw new Error(`GlideEditor: shape "${shapeOrId}" not found`);
    return this.transforms.getVisualWorldBounds(shape.id as ShapeId);
  }

  getLocalTransform(id: ShapeId): Matrix2d { return this.transforms.getLocalTransform(id); }
  getWorldTransform(id: ShapeId): Matrix2d { return this.transforms.getWorldTransform(id); }
  getWorldTransformInverse(id: ShapeId): Matrix2d { return this.transforms.getWorldTransformInverse(id); }
  localToPage(id: ShapeId, point: Vec2): Vec2 { return this.transforms.localToPage(id, point); }
  pageToLocal(id: ShapeId, point: Vec2): Vec2 { return this.transforms.pageToLocal(id, point); }
  parentToPage(parentId: PageId | ShapeId, point: Vec2): Vec2 {
    return this.transforms.parentToPage(parentId, point);
  }
  pageToParent(parentId: PageId | ShapeId, point: Vec2): Vec2 {
    return this.transforms.pageToParent(parentId, point);
  }
  pageDeltaToParent(parentId: PageId | ShapeId, delta: Vec2): Vec2 {
    return this.transforms.pageDeltaToParent(parentId, delta);
  }

  resolveSmartRouteForArrow(
    arrow: ArrowShape,
    args: {
      startWorld: Vec2;
      endWorld: Vec2;
      fromEdge: import('./types.js').EdgeName;
      toEdge: import('./types.js').EdgeName;
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
    this._pageCameras.clear();
    this.activePageId.value = this.getDefaultPageId();
    this.camera.setCamera({ x: 0, y: 0, z: 1 });
    this.setSelectedShapeIds([]);
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
    this.textEditing.cancel();
    this.erasingShapeIds.value = new Set<ShapeId>();
    this.bindingPreview.value = null;
    this._pageCameras.clear();
    this.activePageId.value = this.getDefaultPageId();
    this.activeStyles.value = { ...DEFAULT_ACTIVE_STYLES };
    this.arrowRouteStyle = 'ortho';
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
    const expanded = new Set<ShapeId>();
    const visit = (id: ShapeId) => {
      if (expanded.has(id)) return;
      expanded.add(id);
      this.getChildren(id).forEach(child => visit(child.id as ShapeId));
    };
    shapeIds.forEach(visit);
    const shapes = this.sortShapesByCanonicalOrder([...expanded]
      .filter(id => !this.isShapeEffectivelyHidden(id))
      .map(id => this.getShape(id))
      .filter(Boolean) as GlideShape[]);
    return this._renderShapesToSvg(shapes);
  }

  async exportToPortableSvg(
    shapeIds: ShapeId[],
    options: PortableSvgExportOptions,
  ): Promise<string> {
    const assets = new Map<string, GlideAsset>();
    const visit = (id: ShapeId) => {
      const shape = this.getShape(id);
      if (!shape) return;
      for (const descriptor of this.schema.getReferenceDescriptors(shape)) {
        if (descriptor.targetKind !== 'asset') continue;
        const assetId = readPointer(shape, descriptor.path);
        const asset = typeof assetId === 'string' ? this.store.get(assetId) : undefined;
        if (asset?.['kind'] === 'asset' && asset['type'] === 'raster-image') {
          assets.set(assetId, asset as unknown as GlideAsset);
        }
      }
      this.getChildren(id).forEach(child => visit(child.id as ShapeId));
    };
    shapeIds.forEach(visit);

    const context = options.resolutionContext
      ? cloneRecord(options.resolutionContext)
      : this._assetResolutionContext;
    if (context !== undefined) validatePortableResolutionContext(context);
    for (const assetId of assets.keys()) {
      assertCanonicalPortableRasterAssetId(assetId, 'Portable SVG raster asset id');
    }
    const overrides = new Map<string, string>();
    for (const assetId of [...assets.keys()].sort()) {
      const asset = assets.get(assetId)!;
      const exported = await options.exportRasterAsset(cloneRecord(asset), context);
      if (exported.kind === 'self-contained') {
        const bytes = new Uint8Array(exported.bytes);
        if (bytes.byteLength > PORTABLE_BOARD_FRAGMENT_LIMITS.maxEmbeddedAssetBytes) {
          throw new Error(`Raster asset "${assetId}" exceeds portable embedded-byte limit`);
        }
        const mimeType = String(asset.props['mimeType']);
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
          throw new Error(`Raster asset "${assetId}" has an unsupported export MIME type`);
        }
        overrides.set(assetId, `data:${mimeType};base64,${bytesToBase64(bytes)}`);
      } else {
        overrides.set(assetId, validatePortableExportReference(exported.reference, assetId));
      }
    }
    this._exportAssetUrlOverrides = overrides;
    try {
      return this.exportToSvg(shapeIds);
    } finally {
      this._exportAssetUrlOverrides = null;
    }
  }

  exportRegionToSvg(box: Box2d): string {
    const shapes = this.getShapesInBox(box);
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
    const clipDefs = new Map<string, string>();

    for (const shape of shapes) {
      const util = this.getShapeUtil(shape.type);
      const box = this.getShapeVisualWorldBounds(shape);
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
          wrapper.setAttribute('transform', matrixToSvg(this.transforms.getWorldTransform(shape.id as ShapeId)));
          wrapper.appendChild(svgEl);
          const clippingFrame = this.getClippingFrameAncestors(shape.id as ShapeId)[0];
          if (clippingFrame) {
            const clipId = `clip-${String(clippingFrame.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
            if (!clipDefs.has(clipId)) {
              const bounds = this.transforms.getLocalGeometry(clippingFrame.id as ShapeId).getBounds();
              const points = [
                { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
              ].map(point => this.localToPage(clippingFrame.id as ShapeId, point))
                .map(point => `${point.x},${point.y}`).join(' ');
              clipDefs.set(clipId, `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><polygon points="${points}" /></clipPath>`);
            }
            elements.push(`<g clip-path="url(#${clipId})">${wrapper.outerHTML}</g>`);
          } else {
            elements.push(wrapper.outerHTML);
          }
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
  ${clipDefs.size ? `<defs>${[...clipDefs.values()].join('')}</defs>` : ''}
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

  /** @internal Collaboration integration for atomic Yjs-before-store publication. */
  participateInCommitsWithCapability(
    capability: MutationCapability,
    participant: StoreCommitParticipant,
  ): () => void {
    return this._store.participateInCommitsTrusted(capability, participant);
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

function bytesToBase64(bytes: Uint8Array): string {
  const BufferCtor = (globalThis as { Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } } }).Buffer;
  if (BufferCtor) return BufferCtor.from(bytes).toString('base64');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa === 'function') return btoa(binary);
  throw new Error('No available base64 encoding path');
}

function base64ToBytes(value: string): Uint8Array {
  const BufferCtor = (globalThis as {
    Buffer?: { from(data: string, encoding: string): { readonly length: number; readonly [index: number]: number } };
  }).Buffer;
  if (BufferCtor) return new Uint8Array(BufferCtor.from(value, 'base64'));
  if (typeof atob !== 'function') throw new Error('No available base64 decoding path');
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function validatePortableExportReference(reference: string, assetId: string): string {
  if (reference.length === 0 || utf8ByteLength(reference) > PORTABLE_BOARD_FRAGMENT_LIMITS.maxStringBytes) {
    throw new Error(`Raster asset "${assetId}" has an invalid durable export reference`);
  }
  try {
    const url = new URL(reference);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new Error(`Raster asset "${assetId}" has an invalid durable export reference`);
  }
  return reference;
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  const BufferCtor = (globalThis as { Buffer?: { byteLength(value: string, encoding: string): number } }).Buffer;
  if (BufferCtor) return BufferCtor.byteLength(value, 'utf8');
  return unescape(encodeURIComponent(value)).length;
}

const CANONICAL_RASTER_ASSET_ID = /^asset:sha256:[a-f0-9]{64}$/;

export function isCanonicalRasterAssetId(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_RASTER_ASSET_ID.test(value);
}

function assertPortableString(value: unknown, label: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)
    || utf8ByteLength(value) > PORTABLE_BOARD_FRAGMENT_LIMITS.maxStringBytes) {
    throw new Error(`${label} is invalid or exceeds the portable string limit`);
  }
}

function assertCanonicalPortableRasterAssetId(value: unknown, label: string): asserts value is string {
  assertPortableString(value, label);
  if (!isCanonicalRasterAssetId(value)) {
    throw new Error(`${label} must match asset:sha256:<64 lowercase hex>`);
  }
}

function isPlainPortableObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).find(key => !allowed.has(key));
  if (unexpected) throw new Error(`${label} contains unsupported property "${unexpected}"`);
}

function assertBoundedJson(value: unknown, label: string, maxBytes: number): void {
  const seen = new Set<object>();
  const visit = (candidate: unknown, depth: number) => {
    if (depth > 64) throw new Error(`${label} exceeds nesting limit`);
    if (typeof candidate === 'string') {
      const length = utf8ByteLength(candidate);
      if (length > PORTABLE_BOARD_FRAGMENT_LIMITS.maxStringBytes) {
        throw new Error(`${label} contains a string exceeding the portable limit`);
      }
    } else if (Array.isArray(candidate)) {
      if (seen.has(candidate)) throw new Error(`${label} must be JSON-safe`);
      seen.add(candidate);
      candidate.forEach(item => visit(item, depth + 1));
    } else if (candidate && typeof candidate === 'object') {
      if (!isPlainPortableObject(candidate) || seen.has(candidate)) throw new Error(`${label} must be JSON-safe`);
      seen.add(candidate);
      for (const [key, item] of Object.entries(candidate)) {
        visit(key, depth + 1);
        visit(item, depth + 1);
      }
    } else if (candidate !== null && typeof candidate !== 'boolean'
      && (typeof candidate !== 'number' || !Number.isFinite(candidate))) {
      throw new Error(`${label} must be JSON-safe`);
    }
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (serialized === undefined || utf8ByteLength(serialized) > maxBytes) {
    throw new Error(`${label} exceeds portable size limit`);
  }
}

function assertEncodedJsonSize(value: unknown, label: string, maxBytes: number): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON-safe`);
  }
  if (serialized === undefined || utf8ByteLength(serialized) > maxBytes) {
    throw new Error(`${label} exceeds portable size limit`);
  }
}

function validatePortableResolutionContext(context: unknown): asserts context is AssetResolutionContext {
  if (!isPlainPortableObject(context)) throw new Error('Portable resolutionContext is invalid');
  assertExactKeys(context, ['documentId', 'versionId', 'snapshotId', 'createdAt', 'metadata'], 'Portable resolutionContext');
  for (const key of ['documentId', 'versionId', 'snapshotId'] as const) {
    if (context[key] !== undefined) assertPortableString(context[key], `Portable resolutionContext ${key}`);
  }
  if (context['createdAt'] !== undefined) {
    assertPortableString(context['createdAt'], 'Portable resolutionContext createdAt');
    const createdAt = context['createdAt'];
    const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
    if (!isoTimestamp.test(createdAt) || Number.isNaN(Date.parse(createdAt))) {
      throw new Error('Portable resolutionContext createdAt must be an ISO-8601 timestamp');
    }
  }
  if (context['metadata'] !== undefined) {
    const metadata = context['metadata'];
    if (!isPlainPortableObject(metadata)) throw new Error('Portable resolutionContext metadata is invalid');
    for (const [key, value] of Object.entries(metadata)) {
      assertPortableString(key, 'Portable resolutionContext metadata key', true);
      if (typeof value === 'string') {
        assertPortableString(value, `Portable resolutionContext metadata value for "${key}"`, true);
      } else if (value !== null && typeof value !== 'boolean'
        && (typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error(`Portable resolutionContext metadata value for "${key}" is invalid`);
      }
    }
    assertBoundedJson(metadata, 'Portable resolutionContext metadata', PORTABLE_BOARD_FRAGMENT_LIMITS.maxMetadataBytes);
  }
  assertBoundedJson(context, 'Portable resolutionContext', PORTABLE_BOARD_FRAGMENT_LIMITS.maxMetadataBytes);
}

function validatePortableRasterRecordIds(records: readonly unknown[]): void {
  for (const candidate of records) {
    if (!isPlainPortableObject(candidate)) continue;
    if (candidate['kind'] === 'asset' && candidate['type'] === 'raster-image') {
      assertCanonicalPortableRasterAssetId(candidate['id'], 'Portable raster asset id');
    }
    if (candidate['kind'] === 'shape' && candidate['type'] === 'raster-image') {
      const props = candidate['props'];
      if (!isPlainPortableObject(props)) throw new Error('Portable raster shape props are invalid');
      assertCanonicalPortableRasterAssetId(props['assetId'], 'Portable raster shape assetId');
    }
  }
}

function validateCanonicalBase64(value: string, byteLength: number, assetId: string): void {
  const encodedLength = Math.ceil(byteLength / 3) * 4;
  if (value.length !== encodedLength) {
    throw new Error(`Embedded raster payload length mismatch for asset "${assetId}"`);
  }
  const canonical = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!canonical.test(value)) throw new Error(`Embedded raster payload for asset "${assetId}" is not canonical base64`);
}

export function validatePortableBoardFragmentStructure(fragment: unknown): asserts fragment is PortableBoardFragment {
  if (!isPlainPortableObject(fragment)) throw new Error('Portable board fragment must be a plain object');
  assertExactKeys(fragment, ['schema', 'rootIds', 'records', 'assetRefs', 'rasterPayloads', 'sourceBounds', 'resolutionContext'], 'Portable board fragment');
  assertEncodedJsonSize(
    fragment,
    'Portable board fragment encoded JSON',
    PORTABLE_BOARD_FRAGMENT_LIMITS.maxEncodedFragmentBytes,
  );
  const schema = fragment['schema'];
  if (!isPlainPortableObject(schema)) throw new Error('Portable board fragment schema is invalid');
  assertExactKeys(schema, ['portableBoardFragmentVersion', 'storeVersion'], 'Portable board fragment schema');
  if (schema['portableBoardFragmentVersion'] !== 1
    || !Number.isInteger(schema['storeVersion'])
    || Number(schema['storeVersion']) < 1
    || Number(schema['storeVersion']) > CURRENT_STORE_VERSION) {
    throw new Error(`Unsupported portable board fragment schema version ${String(schema['portableBoardFragmentVersion'])}`);
  }
  const arrays = [
    ['rootIds', PORTABLE_BOARD_FRAGMENT_LIMITS.maxRootIds],
    ['records', PORTABLE_BOARD_FRAGMENT_LIMITS.maxRecords],
    ['assetRefs', PORTABLE_BOARD_FRAGMENT_LIMITS.maxAssetRefs],
    ['rasterPayloads', PORTABLE_BOARD_FRAGMENT_LIMITS.maxRasterPayloads],
  ] as const;
  for (const [key, limit] of arrays) {
    const value = fragment[key];
    if (!Array.isArray(value) || value.length > limit) throw new Error(`Portable board fragment ${key} exceeds limit or is invalid`);
  }
  for (const key of ['rootIds', 'assetRefs'] as const) {
    const seen = new Set<string>();
    for (const value of fragment[key] as unknown[]) {
      if (typeof value !== 'string' || value.length === 0
        || utf8ByteLength(value) > PORTABLE_BOARD_FRAGMENT_LIMITS.maxStringBytes) {
        throw new Error(`Portable board fragment ${key} contains an invalid id`);
      }
      if (seen.has(value)) throw new Error(`Portable board fragment ${key} contains a duplicate id`);
      seen.add(value);
    }
  }
  assertBoundedJson(fragment['records'], 'Portable records', PORTABLE_BOARD_FRAGMENT_LIMITS.maxRecordsBytes);
  for (const record of fragment['records'] as unknown[]) {
    if (!isPlainPortableObject(record)) throw new Error('Portable records must contain plain objects');
    assertBoundedJson(record, 'Portable record', PORTABLE_BOARD_FRAGMENT_LIMITS.maxRecordBytes);
    if ('meta' in record) assertBoundedJson(record['meta'], 'Portable record metadata', PORTABLE_BOARD_FRAGMENT_LIMITS.maxMetadataBytes);
  }
  validatePortableRasterRecordIds(fragment['records'] as unknown[]);
  const bounds = fragment['sourceBounds'];
  if (!isPlainPortableObject(bounds)) throw new Error('Portable sourceBounds is invalid');
  assertExactKeys(bounds, ['x', 'y', 'w', 'h', 'minX', 'minY', 'maxX', 'maxY'], 'Portable sourceBounds');
  if (Object.values(bounds).some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Portable sourceBounds must contain finite numbers');
  }
  if (fragment['resolutionContext'] !== undefined) {
    validatePortableResolutionContext(fragment['resolutionContext']);
  }
  let totalEmbeddedBytes = 0;
  for (const item of fragment['rasterPayloads'] as unknown[]) {
    if (!isPlainPortableObject(item)) throw new Error('Portable raster payload is invalid');
    assertCanonicalPortableRasterAssetId(item['assetId'], 'Portable raster payload assetId');
    if (item['kind'] === 'embedded') {
      assertExactKeys(item, ['assetId', 'kind', 'base64', 'byteLength'], 'Embedded raster payload');
      const byteLength = item['byteLength'];
      if (!Number.isSafeInteger(byteLength) || Number(byteLength) < 0
        || Number(byteLength) > PORTABLE_BOARD_FRAGMENT_LIMITS.maxEmbeddedAssetBytes
        || typeof item['base64'] !== 'string') {
        throw new Error(`Embedded raster payload for asset "${item['assetId']}" exceeds limit or is invalid`);
      }
      totalEmbeddedBytes += Number(byteLength);
      if (totalEmbeddedBytes > PORTABLE_BOARD_FRAGMENT_LIMITS.maxTotalEmbeddedBytes) {
        throw new Error('Portable raster payloads exceed total embedded-byte limit');
      }
      validateCanonicalBase64(item['base64'], Number(byteLength), item['assetId']);
    } else if (item['kind'] === 'durable-reference') {
      assertExactKeys(item, ['assetId', 'kind', 'reference'], 'Durable raster payload');
      if (typeof item['reference'] !== 'string' || item['reference'].length === 0
        || utf8ByteLength(item['reference']) > PORTABLE_BOARD_FRAGMENT_LIMITS.maxStringBytes) {
        throw new Error(`Raster asset "${item['assetId']}" has an invalid durable reference`);
      }
    } else {
      throw new Error('Portable raster payload kind is invalid');
    }
  }
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
  /** Trusted host lookup; returned URLs are never persisted in the document. */
  assetResolver?: AssetResolver;
  /** Default immutable snapshot coordinates for rendering and export resolution. */
  assetResolutionContext?: AssetResolutionContext;
}

export type AssetResolver = (
  asset: GlideAsset,
  context?: AssetResolutionContext,
) => string | null;

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
    assetResolver,
    assetResolutionContext,
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
    assetResolver,
    assetResolutionContext,
  );

  // Inject canonical transformed geometry hooks for RBush broad/precise phases.
  store.getGeometry = (shape) => {
    const bounds = editor.transforms.getVisualWorldBounds(shape.id as ShapeId);
    return new Rectangle2d(bounds.x, bounds.y, bounds.w, bounds.h);
  };
  store.hitTestPoint = (shape, x, y) => {
    return editor.transforms.hitTestPagePoint(shape.id as ShapeId, { x, y });
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
