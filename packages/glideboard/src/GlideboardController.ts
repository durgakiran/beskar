import { signal, type ReadonlySignal } from '@preact/signals';
import * as Y from 'yjs';
import {
  createCanvasToolServer,
  createMutationCapability,
  createSanitizedSvgAsset,
  ContentIngressError,
  prepareRasterAsset,
  MutationPermissionError,
  resolveArrowRoute,
  type Box2d,
  type AssetPlacementTool,
  type CanvasToolName,
  type GlideAsset,
  type GlideDocument,
  type GlidePlugin,
  type LoadReport,
  type MutationPolicy,
  type AssetResolutionContext,
  type PortableBoardFragment,
  type ShapeId,
  type Vec2,
} from '@durgakiran/glideline';
import { bindGlideboardCollaboration } from './collaboration.js';
import { createGlideboardEditorInstance } from './editor.js';
import { GLIDEBOARD_ASSET_LIMITS } from './types.js';
import type {
  GlideboardAssetDownload,
  GlideboardAssetErrorCategory,
  GlideboardAssetImportError,
  GlideboardAssetImportJob,
  GlideboardAssetImportRequest,
  GlideboardAssetImportTask,
  GlideboardAssetPlacementConfig,
  GlideboardAssetPlacementState,
  GlideboardAssetPersistence,
  GlideboardCollaborationConfig,
  GlideboardCollaborationProvider,
  GlideboardDocumentChangeContext,
  GlideboardAssetStorage,
  GlideboardUser,
  InitialDocumentDisposition,
  RecoverableTextDraft,
} from './types.js';
import type { CollaborationCheckpointSource, MutationFence, ProjectionTarget } from './durability/types.js';
import { safeAwarenessEntries } from './collaboration/awareness.js';

export type ConnectorPreset = 'line' | 'arrow' | 'double-arrow';
export type ArrowheadStyle = 'none' | 'arrow';
export type ArrowRouteStyle = 'curve' | 'ortho' | 'smart';

export interface GlideboardControllerOptions {
  sessionKey: string;
  customShapes?: readonly GlidePlugin[];
  initialDocument?: GlideDocument | null;
  initialDocumentDisposition?: InitialDocumentDisposition;
  readOnly?: boolean;
  assetStorage?: GlideboardAssetStorage;
  assetResolutionContext?: AssetResolutionContext;
}

type DocumentChangeHandler = (
  document: GlideDocument,
  context: GlideboardDocumentChangeContext,
) => void | Promise<void>;

export interface GlideboardDisposeOptions {
  pendingSave?: 'cancel' | 'flush';
}

interface PresenceBinding {
  awareness: NonNullable<GlideboardCollaborationProvider['awareness']> | null;
  owner: object;
  active: boolean;
  cleanupScheduled: boolean;
  pageSubscription?: () => void;
  awarenessSubscription?: () => void;
}

interface AssetImportEntry {
  job: GlideboardAssetImportJob;
  request?: GlideboardAssetImportRequest;
  replaceShapeId?: ShapeId;
  controller?: AbortController;
}

let nextControllerId = 0;
const awarenessPresenceOwners = new WeakMap<object, object>();
const MAX_AUTOMATIC_SAVE_RETRIES = 3;
const MAX_AUTOMATIC_RETRY_DELAY_MS = 5_000;
const RICH_TEXT_FRAGMENTS_KEY = 'glideboard-rich-text-fragments-v1';
const ASSET_ERROR_CATEGORIES = new Set<GlideboardAssetErrorCategory>([
  'invalid-content',
  'unsupported-format',
  'limit-exceeded',
  'storage',
	'network',
	'rate-limit',
  'permission',
  'conflict',
  'not-found',
  'unavailable',
  'unknown',
]);

function createAbortError(): DOMException {
  return new DOMException('Asset import cancelled', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function assetCompensationError(message: string, errors: unknown[]): Error {
  return Object.assign(new Error(message), {
    name: 'AssetOrphanCleanupError',
    category: 'storage' satisfies GlideboardAssetErrorCategory,
    retryable: true,
    code: 'orphan-cleanup',
    cause: errors[0],
    errors,
  });
}

function isAssetCompensationError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'orphan-cleanup';
}

function categorizeAssetError(error: unknown): GlideboardAssetImportError {
  if (error instanceof MutationPermissionError) {
    return Object.freeze({ category: 'permission', message: error.message, retryable: false });
  }
  if (error instanceof ContentIngressError) {
    const message = error.message;
    const category: GlideboardAssetErrorCategory = /limit|exceeds|too long|dimension|pixel/i.test(message)
      ? 'limit-exceeded'
      : /unsupported|MIME type|format/i.test(message)
        ? 'unsupported-format'
        : 'invalid-content';
    return Object.freeze({ category, message, retryable: false });
  }

  const candidate = error as { category?: unknown; retryable?: unknown; message?: unknown } | null;
  const category = typeof candidate?.category === 'string'
    && ASSET_ERROR_CATEGORIES.has(candidate.category as GlideboardAssetErrorCategory)
    ? candidate.category as GlideboardAssetErrorCategory
    : 'storage';
  const message = typeof candidate?.message === 'string' && candidate.message
    ? candidate.message
    : 'Asset operation failed';
  const retryable = typeof candidate?.retryable === 'boolean'
    ? candidate.retryable
    : !['invalid-content', 'unsupported-format', 'limit-exceeded', 'permission', 'conflict', 'not-found'].includes(category);
  return Object.freeze({ category, message, retryable });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw Object.assign(new Error('Glideboard: SHA-256 verification is unavailable.'), {
      category: 'unavailable' satisfies GlideboardAssetErrorCategory,
    });
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function getConnectorPreset(
  arrowheadStart: ArrowheadStyle,
  arrowheadEnd: ArrowheadStyle,
): ConnectorPreset {
  if (arrowheadStart === 'arrow' && arrowheadEnd === 'arrow') return 'double-arrow';
  if (arrowheadStart === 'none' && arrowheadEnd === 'none') return 'line';
  return 'arrow';
}

function getPresetArrowheads(
  preset: ConnectorPreset,
): { arrowheadStart: ArrowheadStyle; arrowheadEnd: ArrowheadStyle } {
  switch (preset) {
    case 'line':
      return { arrowheadStart: 'none', arrowheadEnd: 'none' };
    case 'double-arrow':
      return { arrowheadStart: 'arrow', arrowheadEnd: 'arrow' };
    default:
      return { arrowheadStart: 'none', arrowheadEnd: 'arrow' };
  }
}

function createMutationPolicy(
  readonlySignal: ReadonlySignal<boolean>,
  mutationFenceDepth: ReadonlySignal<number>,
  fencedSettlement: ReadonlySignal<boolean>,
): MutationPolicy {
  return {
    authorize(request) {
      if (!readonlySignal.peek() && (mutationFenceDepth.peek() === 0 || fencedSettlement.peek())) {
        return 'allow';
      }

      if (request.origin === 'remote' || request.origin === 'load') {
        return 'allow';
      }

      return 'deny';
    },
  };
}

/**
 * Owns every mutable value that belongs to one mounted whiteboard session.
 * Nothing in this class is shared by another controller instance.
 */
export class GlideboardController {
  readonly sessionKey: string;
  readonly editor;
  readonly readOnlySignal = signal(false);
  readonly awarenessSignal = signal<any | null>(null);
  readonly remoteTextEditingShapeIdsSignal = signal<ReadonlySet<string>>(new Set());
  readonly collaborationTextVersionSignal = signal(0);
  readonly isCanvasDraggingRef = { current: false };
  readonly activePointerIdRef = { current: null as number | null };
  readonly deferredToolRestoreRef = { current: null as string | null };
  readonly recoverableTextDraftSignal = signal<RecoverableTextDraft | null>(null);
  readonly textStyleTargetIdSignal = signal<ShapeId | null>(null);
  readonly mutationFenceDepthSignal = signal(0);
  readonly assetImportJobsSignal = signal<readonly GlideboardAssetImportJob[]>(Object.freeze([]));
  readonly assetPlacementSignal = signal<GlideboardAssetPlacementState | null>(null);
  readonly assetLimits = GLIDEBOARD_ASSET_LIMITS;
  readonly arrowRouteStyleSignal;
  readonly arrowPresetSignal;
  readonly arrowheadStartSignal;
  readonly arrowheadEndSignal;

  private readonly toolServer;
  private readonly domIdPrefix: string;
  private readonly presenceOwner = {};
  private readonly remoteMutationCapability = createMutationCapability();
  private readonly fencedSettlementSignal = signal(false);
  private canvasElement: HTMLElement | null = null;
  private collaborationCleanup: (() => void) | null = null;
  private collaborationConfig: GlideboardCollaborationConfig | null = null;
  private collaborationCheckpoints: CollaborationCheckpointSource | null = null;
  private presenceBinding: PresenceBinding | null = null;
  private documentChangeDispose: (() => void) | null = null;
  private documentChangeHandler: DocumentChangeHandler | null = null;
  private documentChangeDebounceMs = 500;
  private documentChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private documentChangeGeneration = 0;
  private documentTrackingGeneration = 0;
  private documentDirty = false;
  private documentSaveInFlight: Promise<void> | null = null;
  private documentSaveAbortController: AbortController | null = null;
  private documentSaveRetryAttempt = 0;
  private disposalPromise: Promise<void> | null = null;
  private disposalStarted = false;
  private readonly debugCleanups = new Set<() => void>();
  private readonly assetStorage?: GlideboardAssetStorage;
  private readonly assetResolutionContext?: AssetResolutionContext;
  private readonly assetImportEntries = new Map<string, AssetImportEntry>();
  private readonly assetImportPromises = new Set<Promise<ShapeId>>();
  private nextAssetImportId = 0;
  private assetPlacementConfig: GlideboardAssetPlacementConfig | null = null;
  private assetPlacementTool: AssetPlacementTool | null = null;

  constructor(options: GlideboardControllerOptions) {
    this.sessionKey = options.sessionKey;
    this.assetStorage = options.assetStorage;
    this.assetResolutionContext = options.assetResolutionContext;
    this.domIdPrefix = `glideboard-${++nextControllerId}`;
    const mutationPolicy = createMutationPolicy(
      this.readOnlySignal,
      this.mutationFenceDepthSignal,
      this.fencedSettlementSignal,
    );
    this.editor = createGlideboardEditorInstance(
      [...(options.customShapes ?? [])],
      mutationPolicy,
      this.remoteMutationCapability,
      options.assetStorage
        ? (asset, context) => options.assetStorage!.resolve(asset, context)
        : undefined,
      options.assetResolutionContext,
    );
    this.toolServer = createCanvasToolServer(this.editor);

    this.arrowRouteStyleSignal = signal<ArrowRouteStyle>(this.editor.arrowRouteStyle);
    this.arrowPresetSignal = signal<ConnectorPreset>(
      getConnectorPreset(this.editor.arrowheadStart, this.editor.arrowheadEnd),
    );
    this.arrowheadStartSignal = signal<ArrowheadStyle>(this.editor.arrowheadStart);
    this.arrowheadEndSignal = signal<ArrowheadStyle>(this.editor.arrowheadEnd);
    this.debugCleanups.add(this.editor.textEditing.recoverableDraft.subscribe(draft => {
      this.recoverableTextDraftSignal.value = draft
        ? Object.freeze({ shapeId: draft.shapeId, text: draft.text })
        : null;
    }));
    this.debugCleanups.add(this.editor.currentToolId.subscribe(toolId => {
      if (toolId !== 'asset' && this.assetPlacementSignal.peek()) {
        this.assetPlacementTool?.cancel();
        this.assetPlacementTool = null;
        this.assetPlacementSignal.value = null;
        this.assetPlacementConfig = null;
      }
    }));

    if (options.initialDocument) {
      if (!options.initialDocumentDisposition) {
        throw new Error('Glideboard: initialDocumentDisposition is required with initialDocument.');
      }
      this.editor.replaceDocument(options.initialDocument);
      this.documentDirty = options.initialDocumentDisposition.kind !== 'acknowledged-baseline';
    }
    this.setReadOnly(Boolean(options.readOnly));
  }

  configureAssetPlacement(config: GlideboardAssetPlacementConfig): void {
    if (this.readOnlySignal.peek()) {
      throw new MutationPermissionError(Object.freeze({
        origin: 'local-user',
        command: 'asset.place',
        affectedIds: Object.freeze([]),
      }));
    }
    this.assetPlacementConfig = config;
    this.assetPlacementSignal.value = Object.freeze({
      selection: config.selection,
      displayName: config.displayName?.trim() || config.selection.itemId,
      status: 'armed',
    });
    this.editor.setCurrentTool('asset');
    const placementTool = this.editor.getCurrentTool() as AssetPlacementTool;
    this.assetPlacementTool = placementTool;
    placementTool.configure(
      config.selection,
      config.materializer,
      {
        onPendingChange: pending => {
          const current = this.assetPlacementSignal.peek();
          if (current && (pending || current.status !== 'error')) {
            this.assetPlacementSignal.value = Object.freeze({
              selection: current.selection,
              displayName: current.displayName,
              status: pending ? 'pending' : 'armed',
            });
          }
          config.callbacks?.onPendingChange?.(pending);
        },
        onError: error => {
          const current = this.assetPlacementSignal.peek();
          if (current) {
            this.assetPlacementSignal.value = Object.freeze({
              selection: current.selection,
              displayName: current.displayName,
              status: 'error',
              error: error instanceof Error && error.message
                ? error.message
                : 'The asset could not be placed.',
            });
          }
          config.callbacks?.onError?.(error);
        },
        onPlaced: shapeId => config.callbacks?.onPlaced?.(shapeId),
      },
    );
  }

  retryAssetPlacement(): boolean {
    const config = this.assetPlacementConfig;
    if (!config || this.readOnlySignal.peek()) return false;
    this.configureAssetPlacement(config);
    return true;
  }

  cancelAssetPlacement(): void {
    this.assetPlacementTool?.cancel();
    this.assetPlacementTool = null;
    if (this.editor.currentToolId.peek() === 'asset') {
      this.editor.setCurrentTool(this.readOnlySignal.peek() ? 'hand' : 'select');
    }
    this.assetPlacementConfig = null;
    this.assetPlacementSignal.value = null;
  }

  /**
   * Sanitize an untrusted SVG and import its immutable asset plus visible shape
   * in one store transaction. The original XML is never persisted.
   */
  async importSvg(source: string, point?: Vec2): Promise<ShapeId> {
    return this.queueAssetImport({ kind: 'svg', source, point }).result;
  }

  queueAssetImport(request: GlideboardAssetImportRequest): GlideboardAssetImportTask {
    return this.createAssetImportTask(request);
  }

  getAssetImportJob(jobId: string): GlideboardAssetImportJob | undefined {
    return this.assetImportEntries.get(jobId)?.job;
  }

  cancelAssetImport(jobId: string): boolean {
    const entry = this.assetImportEntries.get(jobId);
    if (!entry || !['queued', 'uploading'].includes(entry.job.status)) return false;
    entry.controller?.abort();
    this.updateAssetImportJob(entry, { status: 'cancelled', progress: entry.job.progress });
    return true;
  }

  retryAssetImport(jobId: string): GlideboardAssetImportTask {
    if (this.disposalStarted) throw new Error('Glideboard: controller is disposing.');
    const entry = this.assetImportEntries.get(jobId);
    if (!entry) throw new Error(`Asset import job "${jobId}" is unavailable.`);
    if (!['error', 'cancelled'].includes(entry.job.status)) {
      throw new Error(`Asset import job "${jobId}" cannot be retried from ${entry.job.status}.`);
    }
    if (!entry.request) throw new Error(`Asset import job "${jobId}" has no retained source.`);
    const { error: _error, shapeId: _shapeId, ...job } = entry.job;
    const attempt = job.attempt + 1;
    entry.job = Object.freeze({ ...job, status: 'queued', progress: 0, attempt });
    this.publishAssetImportJobs();
    return { id: jobId, result: this.trackAssetImport(entry, attempt) };
  }

  dismissAssetImport(jobId: string): boolean {
    const entry = this.assetImportEntries.get(jobId);
    if (!entry || ['queued', 'uploading'].includes(entry.job.status)) return false;
    this.assetImportEntries.delete(jobId);
    this.publishAssetImportJobs();
    return true;
  }

  clearAssetImportHistory(): void {
    for (const entry of this.assetImportEntries.values()) entry.controller?.abort();
    this.assetImportEntries.clear();
    this.publishAssetImportJobs();
  }

  async replaceAsset(shapeId: ShapeId, request: GlideboardAssetImportRequest): Promise<ShapeId> {
    return this.createAssetImportTask(request, shapeId).result;
  }

  async downloadAsset(
    recordId: string,
    signal?: AbortSignal,
    context?: AssetResolutionContext,
  ): Promise<GlideboardAssetDownload> {
    if (!this.assetStorage?.download) {
      throw Object.assign(new Error('Glideboard: trusted asset download is unavailable.'), {
        category: 'unavailable' satisfies GlideboardAssetErrorCategory,
      });
    }
    const record = this.editor.store.get(recordId);
    const assetId = record?.['kind'] === 'shape'
      ? (record['props'] as Record<string, unknown> | undefined)?.['assetId']
      : recordId;
    const asset = typeof assetId === 'string'
      ? this.editor.store.get(assetId) as unknown as GlideAsset | undefined
      : undefined;
    if (!asset || asset.kind !== 'asset') {
      throw Object.assign(new Error(`Glideboard: asset for "${recordId}" was not found.`), {
        category: 'not-found' satisfies GlideboardAssetErrorCategory,
      });
    }

    const download = await this.assetStorage.download(
      asset,
      signal ?? new AbortController().signal,
      context ?? this.assetResolutionContext,
    );
    const expectedMimeType = asset.props['mimeType'];
    const expectedByteLength = asset.props['byteLength'];
    const expectedHash = asset.props['hash'];
    const actualHash = download.bytes instanceof Uint8Array
      ? await sha256(download.bytes)
      : null;
    if (
      !(download.bytes instanceof Uint8Array)
      || download.mimeType !== expectedMimeType
      || download.bytes.byteLength !== expectedByteLength
      || actualHash !== expectedHash
    ) {
      throw Object.assign(new Error('Glideboard: trusted asset download did not match its immutable metadata.'), {
        category: 'storage' satisfies GlideboardAssetErrorCategory,
      });
    }
    return Object.freeze({
      bytes: new Uint8Array(download.bytes),
      mimeType: download.mimeType,
      ...(download.fileName ? { fileName: download.fileName } : {}),
    });
  }

  importPlainText(text: string, point?: Vec2): ShapeId | null {
    if (!text) return null;
    const viewport = this.editor.camera.getViewportBounds();
    const origin = point ?? {
      x: viewport.x + viewport.w / 2,
      y: viewport.y + viewport.h / 2,
    };
    const id = this.editor.createShape({
      type: 'text',
      x: origin.x,
      y: origin.y,
      props: { text, textAlign: 'left' },
    });
    this.editor.setSelectedShapeIds([id]);
    this.editor.setCurrentTool('select', { preserveSelection: true });
    return id;
  }

  async importRaster(
    bytes: Uint8Array,
    declaredMimeType?: string,
    point?: Vec2,
  ): Promise<ShapeId> {
    return this.queueAssetImport({ kind: 'raster', bytes, declaredMimeType, point }).result;
  }

  private createAssetImportTask(
    request: GlideboardAssetImportRequest,
    replaceShapeId?: ShapeId,
  ): GlideboardAssetImportTask {
    if (this.disposalStarted) throw new Error('Glideboard: controller is disposing.');
    const id = `asset-import:${++this.nextAssetImportId}`;
    const retainedRequest: GlideboardAssetImportRequest = request.kind === 'raster'
      ? { ...request, bytes: new Uint8Array(request.bytes) }
      : { ...request };
    const entry: AssetImportEntry = {
      job: Object.freeze({
        id,
        kind: request.kind,
        ...(request.name ? { name: request.name } : {}),
        ...(request.correlationToken ? { correlationToken: request.correlationToken } : {}),
        status: 'queued',
        progress: 0,
        attempt: 1,
      }),
      request: retainedRequest,
      ...(replaceShapeId ? { replaceShapeId } : {}),
    };
    this.assetImportEntries.set(id, entry);
    this.publishAssetImportJobs();
    return { id, result: this.trackAssetImport(entry, 1) };
  }

  private trackAssetImport(entry: AssetImportEntry, attempt: number): Promise<ShapeId> {
    const result = Promise.resolve().then(() => this.runAssetImport(entry, attempt));
    this.assetImportPromises.add(result);
    void result.then(
      () => this.assetImportPromises.delete(result),
      () => this.assetImportPromises.delete(result),
    );
    return result;
  }

  private async runAssetImport(entry: AssetImportEntry, attempt: number): Promise<ShapeId> {
    if (
      this.disposalStarted
      || entry.job.status === 'cancelled'
      || entry.job.attempt !== attempt
    ) throw createAbortError();
    const request = entry.request;
    if (!request) throw new Error(`Asset import job "${entry.job.id}" has no retained source.`);
    const controller = new AbortController();
    entry.controller = controller;
    this.updateAssetImportJob(entry, { status: 'uploading', progress: 0 });

    try {
      let asset: GlideAsset;
      let persistence: GlideboardAssetPersistence | undefined;
      if (request.kind === 'svg') {
        const prepared = await createSanitizedSvgAsset(request.source);
        this.assertAssetImportActive(entry, attempt, controller);
        asset = prepared.asset;
        this.reportAssetImportProgress(entry, 1, attempt);
      } else {
        if (!this.assetStorage) {
          throw Object.assign(
            new Error('Glideboard: assetStorage is required to import raster images.'),
            { category: 'unavailable' satisfies GlideboardAssetErrorCategory },
          );
        }
        const prepared = await prepareRasterAsset(request.bytes, request.declaredMimeType);
        this.assertAssetImportActive(entry, attempt, controller);
        asset = prepared.asset;
        persistence = await this.assetStorage.prepare(
          prepared.asset,
          controller.signal,
        );
        try {
          this.assertAssetImportActive(entry, attempt, controller);
          if (entry.replaceShapeId) this.validateAssetReplacement(entry.replaceShapeId, asset);
          await persistence.stage(
            prepared.bytes,
            controller.signal,
            progress => this.reportAssetImportProgress(entry, progress, attempt),
          );
          this.assertAssetImportActive(entry, attempt, controller);
          if (entry.replaceShapeId) this.validateAssetReplacement(entry.replaceShapeId, asset);
        } catch (error) {
          try {
            await persistence.rollback();
          } catch (rollbackError) {
            throw assetCompensationError('Asset staging rollback failed; orphan cleanup is required.', [error, rollbackError]);
          }
          throw error;
        }
        this.reportAssetImportProgress(entry, 1, attempt);
      }

      this.assertAssetImportActive(entry, attempt, controller);
      let shapeId: ShapeId | undefined;
      const previousShape = entry.replaceShapeId
        ? this.editor.store.get(entry.replaceShapeId)
        : undefined;
      const assetPreviouslyExisted = this.editor.store.get(asset.id) !== undefined;
      try {
        shapeId = entry.replaceShapeId
          ? this.commitAssetReplacement(entry.replaceShapeId, asset)
          : this.commitAssetImport(asset, request.point);
        if (persistence) {
          try {
            await persistence.commit(controller.signal);
            this.assertAssetImportActive(entry, attempt, controller);
          } catch (error) {
            let mutationRollbackError: unknown;
            try {
              this.rollbackAssetMutation(shapeId, asset, previousShape, assetPreviouslyExisted);
            } catch (rollbackError) {
              mutationRollbackError = rollbackError;
            }
            try {
              await persistence.rollback();
            } catch (storageRollbackError) {
              throw assetCompensationError(
                'Asset commit and compensation failed.',
                [error, ...(mutationRollbackError ? [mutationRollbackError] : []), storageRollbackError],
              );
            }
            if (mutationRollbackError) {
              throw assetCompensationError(
                'Asset commit and editor compensation failed.',
                [error, mutationRollbackError],
              );
            }
            throw error;
          }
        }
      } catch (error) {
        if (!shapeId && persistence) {
          try {
            await persistence.rollback();
          } catch (rollbackError) {
            if (isAssetCompensationError(error)) throw error;
            throw assetCompensationError('Asset rollback failed; orphan cleanup is required.', [error, rollbackError]);
          }
        }
        throw error;
      }
      if (!shapeId) throw new Error('Glideboard: asset mutation did not return a shape id.');
      this.updateAssetImportJob(entry, { status: 'complete', progress: 1, shapeId });
      delete entry.request;
      return shapeId;
    } catch (error) {
      if (isAssetCompensationError(error)) {
        if (entry.job.attempt === attempt) {
          this.updateAssetImportJob(entry, {
            status: 'error',
            progress: entry.job.progress,
            error: categorizeAssetError(error),
          });
        }
        throw error;
      }
      if (controller.signal.aborted || isAbortError(error)) {
        if (
          entry.job.attempt === attempt
          && (entry.job.status as GlideboardAssetImportJob['status']) !== 'cancelled'
        ) {
          this.updateAssetImportJob(entry, { status: 'cancelled', progress: entry.job.progress });
        }
        throw isAbortError(error) ? error : createAbortError();
      }
      if (entry.job.attempt === attempt) {
        this.updateAssetImportJob(entry, {
          status: 'error',
          progress: entry.job.progress,
          error: categorizeAssetError(error),
        });
      }
      throw error;
    } finally {
      if (entry.controller === controller) delete entry.controller;
    }
  }

  private assertAssetImportActive(
    entry: AssetImportEntry,
    attempt: number,
    controller: AbortController,
  ): void {
    if (
      this.disposalStarted
      || controller.signal.aborted
      || entry.job.status !== 'uploading'
      || entry.job.attempt !== attempt
    ) throw createAbortError();
  }

  private commitAssetImport(asset: GlideAsset, point?: Vec2): ShapeId {
    const viewport = this.editor.camera.getViewportBounds();
    const sourceWidth = asset.props['width'] as number;
    const sourceHeight = asset.props['height'] as number;
    const maximumWidth = Math.min(asset.type === 'raster-image' ? 480 : 320, Math.max(1, viewport.w - 48));
    const maximumHeight = Math.max(1, viewport.h - 48);
    const scale = Math.min(1, maximumWidth / sourceWidth, maximumHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    const origin = point ?? {
      x: viewport.x + (viewport.w - width) / 2,
      y: viewport.y + (viewport.h - height) / 2,
    };
    const sourceShapeId = this.editor.createShapeId(String(asset.type));
    const shapeRecord = {
      id: sourceShapeId,
      kind: 'shape',
      type: asset.type,
      schemaVersion: 0,
      x: origin.x,
      y: origin.y,
      rotation: 0,
      parentId: this.editor.getActivePageId(),
      isLocked: false,
      isHidden: false,
      index: this.editor.generateIndexAbove(this.editor.getActivePageId()),
      props: { w: width, h: height, assetId: asset.id },
      meta: {},
    };
    const assetExists = this.editor.store.get(asset.id) !== undefined;
    const report = this.editor.importRecords(assetExists
      ? [shapeRecord]
      : [asset as unknown as Record<string, unknown>, shapeRecord], {
      label: asset.type === 'raster-image' ? 'Import Raster Image' : 'Import Sanitized SVG',
      idPolicy: 'reject',
      relationshipPolicy: assetExists ? 'preserve' : 'detach-external',
    });
    const importedShapeId = report.idMap[sourceShapeId] as ShapeId;
    this.editor.setSelectedShapeIds([importedShapeId]);
    this.editor.setCurrentTool('select', { preserveSelection: true });
    return importedShapeId;
  }

  private commitAssetReplacement(shapeId: ShapeId, asset: GlideAsset): ShapeId {
    this.validateAssetReplacement(shapeId, asset);
    const assetExists = this.editor.store.get(asset.id) !== undefined;
    this.editor.executeCommand({
      id: 'asset.replace',
      label: 'Replace Asset',
      affectedIds: assetExists ? [shapeId] : [shapeId, asset.id],
      execute: tx => {
        if (!assetExists) tx.insert(asset as unknown as Record<string, unknown>);
        tx.update(shapeId, record => ({
          ...record,
          props: {
            ...(record['props'] as Record<string, unknown>),
            assetId: asset.id,
          },
        }));
      },
    });
    return shapeId;
  }

  private rollbackAssetMutation(
    shapeId: ShapeId,
    asset: GlideAsset,
    previousShape: Record<string, unknown> | undefined,
    assetPreviouslyExisted: boolean,
  ): void {
    this.editor.executeCommand({
      id: 'asset.persistence.rollback',
      label: 'Rollback Asset Persistence',
      affectedIds: assetPreviouslyExisted ? [shapeId] : [shapeId, asset.id],
      execute: tx => {
        if (previousShape) tx.update(shapeId, () => previousShape);
        else tx.remove(shapeId);
        if (!assetPreviouslyExisted) tx.remove(asset.id);
      },
    });
  }

  private validateAssetReplacement(shapeId: ShapeId, asset: GlideAsset): void {
    const shape = this.editor.getShape(shapeId);
    if (!shape) {
      throw Object.assign(new Error(`Glideboard: shape "${shapeId}" was not found.`), {
        category: 'not-found' satisfies GlideboardAssetErrorCategory,
        retryable: false,
      });
    }
    if (shape.type !== asset.type) {
      throw Object.assign(new Error('Glideboard: replacement asset type must match the shape type.'), {
        category: 'unsupported-format' satisfies GlideboardAssetErrorCategory,
        retryable: false,
      });
    }
    if (this.editor.isShapeEffectivelyLocked(shapeId)) {
      throw Object.assign(new Error(`Glideboard: shape "${shapeId}" is locked.`), {
        category: 'permission' satisfies GlideboardAssetErrorCategory,
        retryable: false,
      });
    }

  }

  private reportAssetImportProgress(
    entry: AssetImportEntry,
    progress: number,
    attempt: number,
  ): void {
    if (
      entry.job.status !== 'uploading'
      || entry.job.attempt !== attempt
      || !Number.isFinite(progress)
    ) return;
    const normalized = Math.max(entry.job.progress, Math.min(1, Math.max(0, progress)));
    if (normalized !== entry.job.progress) this.updateAssetImportJob(entry, { progress: normalized });
  }

  private updateAssetImportJob(
    entry: AssetImportEntry,
    patch: Partial<GlideboardAssetImportJob>,
  ): void {
    entry.job = Object.freeze({ ...entry.job, ...patch });
    this.publishAssetImportJobs();
  }

  private publishAssetImportJobs(): void {
    this.assetImportJobsSignal.value = Object.freeze(
      [...this.assetImportEntries.values()].map(entry => entry.job),
    );
  }

  replaceDocument(
    document: GlideDocument,
    options: { resetSessionState?: boolean } = {},
  ): LoadReport {
    const report = this.editor.replaceDocument(document);
    if (options.resetSessionState ?? true) {
      this.editor.resetSessionState();
      this.textStyleTargetIdSignal.value = null;
      this.setArrowRouteStyle('ortho');
      this.setConnectorPreset('arrow');
      this.editor.setCurrentTool(this.readOnlySignal.peek() ? 'hand' : 'select');
      this.isCanvasDraggingRef.current = false;
      this.deferredToolRestoreRef.current = null;
    }

    // Replacement is an acknowledged baseline, not a user edit. Retire any
    // save of the previous document and establish a clean tracking generation.
    this.documentTrackingGeneration += 1;
    this.documentChangeGeneration += 1;
    this.documentDirty = false;
    this.documentSaveRetryAttempt = 0;
    this.cancelPendingDocumentChange();
    this.documentSaveAbortController?.abort();
    return report;
  }

  domId(name: string): string {
    return `${this.domIdPrefix}-${name}`;
  }

  setCanvasElement(element: HTMLElement | null): void {
    this.canvasElement = element;
  }

  getCanvasElement(): HTMLElement | null {
    return this.canvasElement;
  }

  setReadOnly(readOnly: boolean): void {
    if (this.readOnlySignal.peek() === readOnly) {
      return;
    }

    if (readOnly) {
      this.cancelAssetPlacement();
      this.editor.cancelEditing(false, true);
      this.textStyleTargetIdSignal.value = null;
    }

    // Change authorization before any downgrade cleanup can trigger callbacks.
    this.readOnlySignal.value = readOnly;

    if (readOnly) {
      // Edit → View
      this.editor.interactions.cancel();
      this.editor.clearBindingPreview();

      const pointerId = this.activePointerIdRef.current;
      if (pointerId !== null && this.canvasElement?.hasPointerCapture?.(pointerId)) {
        this.canvasElement.releasePointerCapture(pointerId);
      }
      this.activePointerIdRef.current = null;

      this.isCanvasDraggingRef.current = false;
      this.deferredToolRestoreRef.current = null;

      this.editor.setCurrentTool('hand');
    } else {
      // View → Edit
      this.editor.setCurrentTool('select');
    }
  }

  setCurrentTool(toolId: string): void {
    if (this.readOnlySignal.peek() && toolId !== 'hand') {
      throw new MutationPermissionError(Object.freeze({
        origin: 'local-user',
        command: 'tool.select',
        affectedIds: Object.freeze([]),
      }));
    }
    this.editor.setCurrentTool(toolId);
  }

  setArrowRouteStyle(routeStyle: ArrowRouteStyle): void {
    this.editor.arrowRouteStyle = routeStyle;
    this.arrowRouteStyleSignal.value = routeStyle;
  }

  private setArrowheads(
    arrowheadStart: ArrowheadStyle,
    arrowheadEnd: ArrowheadStyle,
  ): void {
    this.editor.arrowheadStart = arrowheadStart;
    this.editor.arrowheadEnd = arrowheadEnd;
    this.arrowheadStartSignal.value = arrowheadStart;
    this.arrowheadEndSignal.value = arrowheadEnd;
    this.arrowPresetSignal.value = getConnectorPreset(arrowheadStart, arrowheadEnd);
  }

  setArrowheadStart(arrowheadStart: ArrowheadStyle): void {
    this.setArrowheads(arrowheadStart, this.editor.arrowheadEnd);
  }

  setArrowheadEnd(arrowheadEnd: ArrowheadStyle): void {
    this.setArrowheads(this.editor.arrowheadStart, arrowheadEnd);
  }

  setConnectorPreset(preset: ConnectorPreset): void {
    const { arrowheadStart, arrowheadEnd } = getPresetArrowheads(preset);
    this.setArrowheads(arrowheadStart, arrowheadEnd);
  }

  clearDocument(): void {
    const ids = this.editor.serialize().records
      .filter(record => record.kind !== 'page')
      .map(record => String(record.id ?? ''))
      .filter(Boolean);
    if (ids.length > 0) {
      this.editor.executeCommand({
        id: 'document.clear',
        label: 'Clear Document',
        affectedIds: ids,
        execute: tx => {
          for (const id of ids) tx.remove(id);
        },
      });
    }
    this.editor.setSelectedShapeIds([]);
    this.editor.stopEditing();
    this.editor.clearBindingPreview();
    this.editor.camera.setCamera({ x: 0, y: 0, z: 1 });
  }

  attachCollaboration(config: GlideboardCollaborationConfig): () => void {
    this.detachCollaboration();
    this.collaborationConfig = config;

    const cleanupBinding = bindGlideboardCollaboration(
      this.editor,
      config,
      this.remoteMutationCapability,
    );
    this.collaborationCheckpoints = cleanupBinding.checkpoints;
    const cleanupPresence = config.provider?.awareness || config.user
      ? this.attachPresence(config.provider, config.user)
      : null;
    const fragments = (config.doc as Y.Doc).getMap<Y.XmlFragment>(RICH_TEXT_FRAGMENTS_KEY);
    const handleFragmentChange = () => {
      this.collaborationTextVersionSignal.value += 1;
    };
    fragments.observeDeep(handleFragmentChange);
    const cleanupFragments = this.editor.store.listen(changes => {
      (config.doc as Y.Doc).transact(() => {
        for (const delta of changes.deltas) {
          if (delta.after === null) fragments.delete(delta.id);
        }
      });
    });
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      cleanupBinding();
      fragments.unobserveDeep(handleFragmentChange);
      this.collaborationTextVersionSignal.value += 1;
      cleanupFragments();
      if (this.collaborationCheckpoints === cleanupBinding.checkpoints) {
        this.collaborationCheckpoints = null;
      }
      cleanupPresence?.();
      if (this.collaborationCleanup === cleanup) {
        this.collaborationCleanup = null;
        this.collaborationConfig = null;
      }
    };

    this.collaborationCleanup = cleanup;
    return cleanup;
  }

  detachCollaboration(): void {
    const cleanup = this.collaborationCleanup;
    this.collaborationCleanup = null;
    cleanup?.();
    this.collaborationConfig = null;
  }

  getCanvasTextCollaboration(shapeId: ShapeId, options: { create?: boolean } = {}) {
    const config = this.collaborationConfig;
    if (!config) return undefined;
    const doc = config.doc as Y.Doc;
    const fragments = doc.getMap<Y.XmlFragment>(RICH_TEXT_FRAGMENTS_KEY);
    let fragment = fragments.get(shapeId);
    if (!(fragment instanceof Y.XmlFragment) && options.create !== false) {
      doc.transact(() => {
        fragment = new Y.XmlFragment();
        fragments.set(shapeId, fragment);
      });
    }
    if (!(fragment instanceof Y.XmlFragment)) return undefined;
    return {
      fragment,
      awareness: config.provider?.awareness,
      user: config.user ?? undefined,
    };
  }

  getCollaborationCheckpoints(): CollaborationCheckpointSource {
    const checkpoints = this.collaborationCheckpoints;
    if (!checkpoints) {
      throw new Error('Glideboard collaboration projection is not attached.');
    }
    return checkpoints;
  }

  captureProjectionTarget(): Promise<ProjectionTarget> {
    return this.getCollaborationCheckpoints().captureTarget();
  }

  acquireMutationFence(reason: 'close' | 'publish'): MutationFence {
    this.mutationFenceDepthSignal.value += 1;
    let active = true;
    return Object.freeze({
      reason,
      release: () => {
        if (!active) return;
        active = false;
        this.mutationFenceDepthSignal.value = Math.max(0, this.mutationFenceDepthSignal.peek() - 1);
      },
    });
  }

  async settleActiveEdit(policy: 'commit' | 'cancel'): Promise<void> {
    this.editor.interactions.cancel();
    this.editor.clearBindingPreview();
    if (policy === 'commit' && this.editor.textEditing.session.peek()) {
      this.fencedSettlementSignal.value = true;
      try {
        if (!this.editor.commitEditing(false)) {
          // A concurrent same-field change must never be overwritten during
          // close/publish. Preserve the local draft and keep the canonical one.
          this.editor.cancelEditing(false, true);
        }
      } finally {
        this.fencedSettlementSignal.value = false;
      }
    } else {
      this.editor.cancelEditing(false, policy === 'cancel');
    }
    await Promise.resolve();
  }

  async exportSvgAtTarget(options: import('./types.js').GlideboardExportSvgOptions = {}): Promise<string> {
    const expected = options.target;
    if (expected) this.assertProjectionTarget(await this.captureProjectionTarget(), expected);
    const shapeIds = options.shapeIds
      ? [...options.shapeIds]
      : this.editor.getShapes().map(shape => shape.id);
    const svg = await this.editor.exportToPortableSvg(shapeIds, {
      resolutionContext: options.resolutionContext ?? this.assetResolutionContext,
      exportRasterAsset: async asset => ({
        kind: 'self-contained',
        bytes: (await this.downloadAsset(String(asset.id), undefined,
          options.resolutionContext ?? this.assetResolutionContext)).bytes,
      }),
    });
    if (expected) this.assertProjectionTarget(await this.captureProjectionTarget(), expected);
    return svg;
  }

  async createPortableFragment(
    options: import('./types.js').GlideboardCreatePortableFragmentOptions,
  ): Promise<PortableBoardFragment | null> {
    if (!this.assetStorage?.download || !this.assetStorage.retainReferences) {
      throw new Error('Glideboard: portable export requires asset download and retention storage hooks.');
    }
    const controller = new AbortController();
    const context = options.resolutionContext ?? this.assetResolutionContext;
    return this.editor.createPortableBoardFragment(options.shapeIds, {
      resolutionContext: context,
      exportRasterAsset: async asset => ({
        kind: 'self-contained',
        bytes: (await this.downloadAsset(String(asset.id), controller.signal, context)).bytes,
      }),
      retainAssetReferences: assetIds => this.assetStorage!.retainReferences!(assetIds, context, controller.signal),
    });
  }

  async pastePortableFragment(
    fragment: PortableBoardFragment,
    options: import('./types.js').GlideboardPastePortableFragmentOptions = {},
  ): Promise<ShapeId[]> {
    if (!this.assetStorage?.materializePortableAsset) {
      throw new Error('Glideboard: portable paste requires a compensating asset materialization hook.');
    }
    const controller = new AbortController();
    return this.editor.pastePortableBoardFragment(fragment, {
      point: options.point,
      materializeRasterAsset: (payload, asset, context) => this.assetStorage!.materializePortableAsset!(
        payload, asset, context, controller.signal,
      ),
    });
  }

  private assertProjectionTarget(actual: ProjectionTarget, expected: ProjectionTarget): void {
    if (
      actual.storeRevision !== expected.storeRevision ||
      actual.yjs.transactionSequence !== expected.yjs.transactionSequence ||
      actual.yjs.stateDigest !== expected.yjs.stateDigest
    ) {
      throw new Error('Glideboard projection changed while capturing the requested target.');
    }
  }

  attachPresence(
    provider?: GlideboardCollaborationProvider | null,
    user?: GlideboardUser | null,
  ): () => void {
    const awareness = provider?.awareness ?? null;
    const previousBinding = this.presenceBinding;
    const existingOwner = awareness
      ? awarenessPresenceOwners.get(awareness)
      : undefined;

    // One awareness instance represents one local Yjs client state. If two
    // boards shared it, their user and cursor fields would overwrite each
    // other, and unmounting either board could clear the other's presence.
    if (existingOwner && existingOwner !== this.presenceOwner) {
      throw new Error(
        'Glideboard: a collaboration awareness provider cannot be shared by multiple boards.',
      );
    }

    if (previousBinding) {
      if (previousBinding.awareness === awareness) {
        // React StrictMode replays effects. Hand ownership to the replacement
        // binding without broadcasting a transient departure in between.
        previousBinding.active = false;
        previousBinding.cleanupScheduled = false;
        previousBinding.pageSubscription?.();
        previousBinding.awarenessSubscription?.();
        this.presenceBinding = null;
      } else {
        this.releasePresenceBinding(previousBinding);
      }
    }

    const binding: PresenceBinding = {
      awareness,
      owner: this.presenceOwner,
      active: true,
      cleanupScheduled: false,
    };
    this.presenceBinding = binding;
    this.awarenessSignal.value = awareness;

    if (awareness) {
      awarenessPresenceOwners.set(awareness, binding.owner);
      awareness.setLocalStateField('user', user
        ? {
          id: user.id,
          name: user.name,
          color: user.color,
        }
        : null);
      awareness.setLocalStateField('pageId', this.editor.getActivePageId());
      let initialPageNotification = true;
      binding.pageSubscription = this.editor.activePageId.subscribe(pageId => {
        if (initialPageNotification) {
          initialPageNotification = false;
          return;
        }
        awareness.setLocalStateField('pageId', pageId);
        awareness.setLocalStateField('canvasCursor', null);
      });
      const syncRemoteTextEditing = () => {
        const next = new Set(
          safeAwarenessEntries(awareness.getStates())
            .filter(entry => entry.clientId !== awareness.clientID && entry.textEditing)
            .map(entry => entry.textEditing!.shapeId),
        );
        const current = this.remoteTextEditingShapeIdsSignal.peek();
        if (next.size === current.size && [...next].every(id => current.has(id))) return;
        this.remoteTextEditingShapeIdsSignal.value = next;
      };
      syncRemoteTextEditing();
      awareness.on('change', syncRemoteTextEditing);
      binding.awarenessSubscription = () => awareness.off('change', syncRemoteTextEditing);
    }

    const cleanup = () => {
      if (!binding.active || binding.cleanupScheduled) return;
      binding.cleanupScheduled = true;
      queueMicrotask(() => {
        if (!binding.active || !binding.cleanupScheduled) return;
        this.releasePresenceBinding(binding);
      });
    };
    return cleanup;
  }

  detachPresence(): void {
    const binding = this.presenceBinding;
    if (binding) this.releasePresenceBinding(binding);
    this.awarenessSignal.value = null;
  }

  configureDocumentChanges(
    handler: DocumentChangeHandler | null | undefined,
    debounceMs = 500,
  ): void {
    const nextHandler = handler ?? null;
    const hadHandler = this.documentChangeHandler !== null;
    const debounceChanged = this.documentChangeDebounceMs !== debounceMs;
    this.documentChangeHandler = nextHandler;
    this.documentChangeDebounceMs = debounceMs;

    if (!this.documentChangeHandler) {
      this.cancelPendingDocumentChange();
      return;
    }

    // Callback identity is live configuration only. Replacing an inline
    // callback must not restart a pending debounce or manufacture another
    // save while an earlier callback is in flight. The timer reads the latest
    // handler when it starts; actual store changes are what mark us dirty.
    if (this.documentDirty && (!hadHandler || debounceChanged)) {
      this.scheduleDocumentChange();
    }
  }

  startDocumentChangeTracking(): () => void {
    this.stopDocumentChangeTracking();
    const disposeSubscription = this.editor.store.listen(changes => {
      if (changes.scope === 'ephemeral') return;
      this.documentDirty = true;
      this.documentSaveRetryAttempt = 0;
      this.scheduleDocumentChange();
    });

    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      disposeSubscription();
      if (this.documentChangeDispose === cleanup) {
        this.documentChangeDispose = null;
        this.documentTrackingGeneration += 1;
        this.cancelPendingDocumentChange();
      }
    };
    this.documentChangeDispose = cleanup;
    if (this.documentDirty) this.scheduleDocumentChange();
    return cleanup;
  }

  stopDocumentChangeTracking(): void {
    const cleanup = this.documentChangeDispose;
    if (cleanup) {
      cleanup();
    } else {
      this.documentTrackingGeneration += 1;
      this.cancelPendingDocumentChange();
    }
  }

  async flush(): Promise<void> {
    this.cancelPendingDocumentChange();

    // Serialize callbacks and keep draining if the document changes while a
    // prior callback is awaiting I/O.
    while (true) {
      const inFlight = this.documentSaveInFlight;
      if (inFlight) {
        await inFlight;
        continue;
      }
      if (!this.documentDirty || !this.documentChangeHandler) return;
      this.cancelPendingDocumentChange();
      await this.startDocumentSave();
    }
  }

  attachDebugApi(debugApiKey: string): () => void {
    if (typeof window === 'undefined' || !debugApiKey) return () => { };

    const api = {
      reset: () => {
        this.clearAssetImportHistory();
        this.clearDocument();
      },
      setCurrentTool: (id: string) => this.setCurrentTool(id),
      configureAssetPlacement: (config: GlideboardAssetPlacementConfig) => (
        this.configureAssetPlacement(config)
      ),
      getCurrentToolId: () => this.editor.currentToolId.peek(),
      callTool: async (name: CanvasToolName, input: unknown) => this.toolServer.callTool(name, input),
      getToolManifest: () => this.toolServer.generateToolManifest(),
      getAIContext: (opts?: { viewport?: boolean }) => this.editor.getAIContext(opts),
      getDocument: () => this.editor.serialize(),
      getPresenceStates: () => Array.from(this.awarenessSignal.peek()?.getStates() ?? []),
      getAcceptanceState: (context?: AssetResolutionContext) => {
        const records = this.editor.serialize().records;
        const assets = records
          .filter((record): record is GlideAsset => record.kind === 'asset')
          .map(asset => ({
            id: String(asset.id),
            type: asset.type,
            resolvedUrl: this.editor.resolveAssetUrl(asset, context ?? this.assetResolutionContext),
          }));
        return {
          recordCount: records.length,
          shapeCount: records.filter(record => record.kind === 'shape').length,
          assetCount: assets.length,
          rasterShapeCount: records.filter(record => record.kind === 'shape' && record.type === 'raster-image').length,
          assets,
          history: {
            undoDepth: this.editor.history.undoStack.length,
            redoDepth: this.editor.history.redoStack.length,
          },
        };
      },
      duplicateShapes: (ids: string[], offset?: Vec2) => this.editor.duplicateShapes(ids as ShapeId[], offset),
      undo: () => this.editor.undo(),
      redo: () => this.editor.redo(),
      createPortableFragment: (shapeIds: string[], context?: AssetResolutionContext) => (
        this.createPortableFragment({ shapeIds: shapeIds as ShapeId[], resolutionContext: context })
      ),
      pastePortableFragment: (fragment: PortableBoardFragment, point?: Vec2) => (
        this.pastePortableFragment(fragment, { point })
      ),
      exportSvg: (shapeIds?: string[], context?: AssetResolutionContext) => this.exportSvgAtTarget({
        shapeIds: shapeIds as ShapeId[] | undefined,
        resolutionContext: context,
      }),
      getSelection: () => this.editor.getSelectedShapeIds(),
      getFocusedGroupId: () => this.editor.focusedGroupId.peek(),
      getShapeLocalBounds: (id: string) => this.editor.getShapeLocalBounds(id as ShapeId),
      takeScreenshot: (box?: Box2d) => this.editor.takeScreenshot(box),
      select: (ids: string[]) => this.editor.setSelectedShapeIds(ids as any),
      getSmartRoutingSnapshot: () => this.editor.getSmartRoutingSnapshot(),
      getArrowRoutePoints: (id: string): Vec2[] | null => {
        const shape = this.editor.getShape(id as any);
        if (!shape || shape.type !== 'arrow') return null;
        return resolveArrowRoute(this.editor as any, shape as any).worldPoints;
      },
    };

    (window as any)[debugApiKey] = api;
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      if ((window as any)[debugApiKey] === api) {
        delete (window as any)[debugApiKey];
      }
      this.debugCleanups.delete(cleanup);
    };
    this.debugCleanups.add(cleanup);
    return cleanup;
  }

  dispose(options: GlideboardDisposeOptions = {}): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;
    this.disposalStarted = true;
    for (const entry of this.assetImportEntries.values()) entry.controller?.abort();
    if (options.pendingSave !== 'flush') this.documentSaveAbortController?.abort();
    this.detachCollaboration();
    this.detachPresence();

    const finishDisposal = () => {
      this.clearAssetImportHistory();
      this.cancelAssetPlacement();
      this.editor.interactions.cancel();
      this.documentChangeHandler = null;
      this.documentDirty = false;
      this.documentSaveRetryAttempt = 0;
      for (const cleanup of [...this.debugCleanups]) cleanup();
      this.isCanvasDraggingRef.current = false;
      this.deferredToolRestoreRef.current = null;
      this.canvasElement = null;
    };

    this.disposalPromise = (async () => {
      await Promise.allSettled([...this.assetImportPromises]);
      this.stopDocumentChangeTracking();
      this.cancelPendingDocumentChange();
      if (options.pendingSave === 'flush') await this.flush();
    })().finally(finishDisposal);

    return this.disposalPromise;
  }

  private scheduleDocumentChange(delayMs = this.documentChangeDebounceMs): void {
    this.cancelPendingDocumentChange();
    if (
      !this.documentChangeDispose ||
      !this.documentDirty ||
      !this.documentChangeHandler ||
      this.documentSaveInFlight
    ) {
      return;
    }

    const generation = this.documentChangeGeneration;
    this.documentChangeTimer = setTimeout(() => {
      if (generation !== this.documentChangeGeneration) return;
      this.documentChangeTimer = null;
      void this.startDocumentSave().catch(error => {
        console.error('[Glideboard] onDocumentChange failed:', error);
      });
    }, Math.max(0, delayMs));
  }

  private startDocumentSave(): Promise<void> {
    if (this.documentSaveInFlight) return this.documentSaveInFlight;
    if (!this.documentDirty || !this.documentChangeHandler) return Promise.resolve();

    const handler = this.documentChangeHandler;
    const document = this.editor.serialize();
    const trackingGeneration = this.documentTrackingGeneration;
    const abortController = new AbortController();
    this.documentSaveAbortController = abortController;
    this.documentDirty = false;
    let failed = false;

    let savePromise!: Promise<void>;
    savePromise = (async () => {
      try {
        await Promise.resolve().then(() => handler(document, { signal: abortController.signal }));
        if (trackingGeneration === this.documentTrackingGeneration) {
          this.documentSaveRetryAttempt = 0;
        }
      } catch (error) {
        failed = true;
        if (trackingGeneration === this.documentTrackingGeneration) {
          this.documentDirty = true;
          this.documentSaveRetryAttempt += 1;
        }
        throw error;
      } finally {
        if (this.documentSaveInFlight === savePromise) {
          this.documentSaveInFlight = null;
        }
        if (this.documentSaveAbortController === abortController) {
          this.documentSaveAbortController = null;
        }
        const shouldSchedule = Boolean(
          this.documentChangeDispose &&
          this.documentDirty &&
          this.documentChangeHandler
        );

        if (shouldSchedule && failed && this.documentSaveRetryAttempt <= MAX_AUTOMATIC_SAVE_RETRIES) {
          const baseDelay = Math.max(100, this.documentChangeDebounceMs);
          const retryDelay = Math.min(
            MAX_AUTOMATIC_RETRY_DELAY_MS,
            baseDelay * (2 ** (this.documentSaveRetryAttempt - 1)),
          );
          this.scheduleDocumentChange(retryDelay);
        } else if (shouldSchedule && !failed) {
          this.scheduleDocumentChange();
        }
      }
    })();

    this.documentSaveInFlight = savePromise;
    return savePromise;
  }

  private cancelPendingDocumentChange(): void {
    this.documentChangeGeneration += 1;
    if (this.documentChangeTimer) {
      clearTimeout(this.documentChangeTimer);
      this.documentChangeTimer = null;
    }
  }

  private releasePresenceBinding(binding: PresenceBinding): void {
    if (!binding.active) return;
    binding.active = false;
    binding.cleanupScheduled = false;
    binding.pageSubscription?.();
    binding.awarenessSubscription?.();
    this.remoteTextEditingShapeIdsSignal.value = new Set();

    const { awareness } = binding;
    if (awareness && awarenessPresenceOwners.get(awareness) === binding.owner) {
      awareness.setLocalStateField('canvasCursor', null);
      awareness.setLocalStateField('user', null);
      awareness.setLocalStateField('pageId', null);
      awarenessPresenceOwners.delete(awareness);
    }

    if (this.presenceBinding === binding) {
      this.presenceBinding = null;
      this.awarenessSignal.value = null;
    }
  }
}
