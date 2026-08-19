import type {
  GlideAsset,
  GlideDocument,
  GlidePlugin,
  GlidePage,
  LoadReport,
  PageId,
  ShapeId,
  Vec2,
  AssetMaterializer,
  AssetPlacementCallbacks,
  AssetPlacementSelection,
  AssetResolutionContext,
  PortableAssetMaterialization,
  PortableBoardFragment,
  PortableRasterPayload,
} from '@durgakiran/glideline';
import type { CollaborationCheckpointSource, MutationFence, ProjectionTarget } from './durability/types.js';
import type { AssetLibraryProvider } from './asset-library.js';

export interface GlideboardUser {
  id: string;
  name: string;
  color: string;
}

export interface GlideboardAwareness {
  setLocalStateField(field: string, value: unknown): void;
  getStates(): Map<number, any>;
  on(event: 'change', handler: () => void): void;
  off(event: 'change', handler: () => void): void;
  clientID: number;
}

export interface GlideboardCollaborationProvider {
  /** Awareness providers are session-owned and must not be shared by mounted boards. */
  awareness?: GlideboardAwareness;
  /** Provider readiness gates seeding of a genuinely empty shared document. */
  synced?: boolean;
  on?(event: 'sync' | 'synced', handler: (synced: boolean) => void): void;
  off?(event: 'sync' | 'synced', handler: (synced: boolean) => void): void;
}

export interface GlideboardMapKeyChange {
  action: 'add' | 'update' | 'delete';
}

export interface GlideboardMapEvent {
  changes: {
    keys: Map<string, GlideboardMapKeyChange>;
  };
}

export interface GlideboardSharedMap<T> {
  readonly size: number;
  values(): IterableIterator<T>;
  get(key: string): T | undefined;
  set(key: string, value: T): unknown;
  delete(key: string): void;
  observe(listener: (event: GlideboardMapEvent, transaction: any) => void): void;
  unobserve(listener: (event: GlideboardMapEvent, transaction: any) => void): void;
  observeDeep?(listener: (events: readonly unknown[], transaction: any) => void): void;
  unobserveDeep?(listener: (events: readonly unknown[], transaction: any) => void): void;
}

export interface GlideboardCollaborationDoc {
  getMap<T>(name: string): GlideboardSharedMap<T>;
  transact(fn: () => void, origin?: unknown): void;
}

export interface GlideboardCollaborationConfig {
  doc: GlideboardCollaborationDoc;
  provider?: GlideboardCollaborationProvider | null;
  user?: GlideboardUser | null;
  /** Stable logical board identity used to reject a Y.Doc from another board. */
  boardIdentity?: string;
  /** Server revision from which an otherwise-empty shared document was bootstrapped. */
  bootstrapRevision?: string;
}

export type InitialDocumentDisposition =
  | { kind: 'acknowledged-baseline'; durableRevision: string }
  | { kind: 'local-recovery'; recoveryCheckpoint: string }
  | { kind: 'new-unsaved-seed' };

export interface GlideboardAssetStorage {
  /**
   * Obtain a server-owned staging transaction before any bytes are uploaded.
   * This ordering makes cancellation possible even when the byte-upload
   * response is lost.
   */
  prepare(
    asset: GlideAsset,
    signal: AbortSignal,
  ): Promise<GlideboardAssetPersistence>;
  /** Trusted runtime lookup; the returned URL is never persisted. */
  resolve(asset: GlideAsset, context?: AssetResolutionContext): string | null;
  /** Trusted host retrieval of the immutable original bytes; URLs are never accepted here. */
  download?(asset: GlideAsset, signal: AbortSignal, context?: AssetResolutionContext): Promise<GlideboardAssetDownload>;
  /** Register every live or historical reference before a portable payload is released. */
  retainReferences?(
    assetIds: readonly string[],
    context: AssetResolutionContext | undefined,
    signal: AbortSignal,
  ): Promise<void>;
  /** Materialize a validated portable payload and return mandatory compensation. */
  materializePortableAsset?(
    payload: PortableRasterPayload,
    asset: GlideAsset,
    context: AssetResolutionContext | undefined,
    signal: AbortSignal,
  ): Promise<PortableAssetMaterialization>;
}

export interface GlideboardAssetPersistence {
  /** Opaque server-issued ownership token, available before stage sends bytes. */
  readonly token: string;
  /** Upload immutable bytes into this transaction. */
  stage(
    bytes: Uint8Array,
    signal: AbortSignal,
    reportProgress?: (progress: number) => void,
  ): Promise<void>;
  /** Make staged bytes durable after the editor transaction succeeds. */
  commit(signal: AbortSignal): Promise<void>;
  /** Idempotently cancel this transaction and retry pending cleanup. */
  rollback(): Promise<void>;
}

export interface GlideboardAssetDownload {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly fileName?: string;
}

export interface GlideboardAssetLimits {
  readonly maxSvgBytes: number;
  readonly maxRasterBytes: number;
  readonly maxRasterDimension: number;
  readonly maxRasterPixels: number;
  readonly supportedMimeTypes: readonly string[];
}

export const GLIDEBOARD_ASSET_LIMITS: GlideboardAssetLimits = Object.freeze({
  maxSvgBytes: 1024 * 1024,
  maxRasterBytes: 20 * 1024 * 1024,
  maxRasterDimension: 16_384,
  maxRasterPixels: 64_000_000,
  supportedMimeTypes: Object.freeze([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
  ]),
});

export type GlideboardAssetImportStatus =
  | 'queued'
  | 'uploading'
  | 'complete'
  | 'error'
  | 'cancelled';

export type GlideboardAssetErrorCategory =
  | 'invalid-content'
  | 'unsupported-format'
  | 'limit-exceeded'
  | 'storage'
  | 'network'
	| 'rate-limit'
  | 'permission'
  | 'conflict'
  | 'not-found'
  | 'unavailable'
  | 'unknown';

export interface GlideboardAssetImportError {
  readonly category: GlideboardAssetErrorCategory;
  readonly message: string;
  readonly retryable: boolean;
}

export type GlideboardAssetImportRequest =
  | {
    readonly kind: 'svg';
    readonly source: string;
    readonly name?: string;
    readonly point?: Vec2;
    readonly correlationToken?: string;
  }
  | {
    readonly kind: 'raster';
    readonly bytes: Uint8Array;
    readonly declaredMimeType?: string;
    readonly name?: string;
    readonly point?: Vec2;
    readonly correlationToken?: string;
  };

export interface GlideboardAssetImportJob {
  readonly id: string;
  readonly kind: GlideboardAssetImportRequest['kind'];
  readonly name?: string;
  readonly correlationToken?: string;
  readonly status: GlideboardAssetImportStatus;
  /** Normalized upload progress in the inclusive range 0..1. */
  readonly progress: number;
  readonly attempt: number;
  readonly shapeId?: ShapeId;
  readonly error?: GlideboardAssetImportError;
}

export interface GlideboardAssetImportTask {
  readonly id: string;
  readonly result: Promise<ShapeId>;
}

export interface GlideboardAssetPlacementConfig {
  readonly selection: AssetPlacementSelection;
  readonly materializer: AssetMaterializer;
  readonly callbacks?: AssetPlacementCallbacks;
  /** Human-readable catalog name shown while placement is armed. Defaults to itemId. */
  readonly displayName?: string;
}

export interface GlideboardAssetPlacementState {
  readonly selection: AssetPlacementSelection;
  readonly displayName: string;
  readonly status: 'armed' | 'pending' | 'error';
  readonly error?: string;
}

export type GlideboardToolbarLayout = 'split' | 'vertical';

export interface GlideboardProps {
  /** Changing this value starts a new, isolated board session. */
  sessionKey?: string;
  initialDocument?: GlideDocument | null;
  /** Required when initialDocument is provided; determines initial durability state. */
  initialDocumentDisposition?: InitialDocumentDisposition;
  collaboration?: GlideboardCollaborationConfig | null;
  readOnly?: boolean;
  /** Toolbar arrangement. Defaults to split drawing and action toolbars. */
  toolbarLayout?: GlideboardToolbarLayout;
  /** Optional searchable catalog shown by the Assets toolbar panel. */
  assetLibraryProvider?: AssetLibraryProvider;
  onDocumentChange?: (
    document: GlideDocument,
    context: GlideboardDocumentChangeContext,
  ) => void | Promise<void>;
  documentChangeDebounceMs?: number;
  /** What to do with a dirty standalone snapshot when this board unmounts. */
  pendingSaveOnUnmount?: 'cancel' | 'flush';
  debugApiKey?: string;
  /** Startup-only plugins. Change sessionKey to construct a board with a new plugin set. */
  customShapes?: readonly GlidePlugin[];
  /** Required for raster import. Sanitized SVG path assets are self-contained. */
  assetStorage?: GlideboardAssetStorage;
  /** Immutable coordinates used by historical rendering and portable export. */
  assetResolutionContext?: AssetResolutionContext;
}

export interface GlideboardDocumentChangeContext {
  /** Aborted when this board is disposed with the cancel policy. */
  signal: AbortSignal;
}

export interface GlideboardExportSvgOptions {
  shapeIds?: readonly ShapeId[];
  /** Reject export if the board no longer represents this projection target. */
  target?: ProjectionTarget;
  /** Overrides the board's default historical asset coordinates. */
  resolutionContext?: AssetResolutionContext;
}

export interface GlideboardCreatePortableFragmentOptions {
  readonly shapeIds: readonly ShapeId[];
  readonly resolutionContext?: AssetResolutionContext;
}

export interface GlideboardPastePortableFragmentOptions {
  readonly point?: Vec2;
}

export interface RecoverableTextDraft {
  readonly shapeId: string;
  readonly text: string;
}

/** Imperative operations scoped to this rendered Glideboard instance. */
export interface GlideboardHandle {
  readonly checkpoints: CollaborationCheckpointSource;
  serialize(): GlideDocument;
  replaceDocument(document: GlideDocument): LoadReport;
  getPages(): readonly GlidePage[];
  getActivePageId(): PageId;
  setActivePage(pageId: PageId): void;
  createPage(name?: string): PageId;
  renamePage(pageId: PageId, name: string): void;
  duplicatePage(pageId: PageId): PageId;
  movePage(pageId: PageId, direction: -1 | 1): boolean;
  deletePage(pageId: PageId): PageId;
  exportSvg(options?: GlideboardExportSvgOptions): Promise<string>;
  createPortableFragment(options: GlideboardCreatePortableFragmentOptions): Promise<PortableBoardFragment | null>;
  pastePortableFragment(
    fragment: PortableBoardFragment,
    options?: GlideboardPastePortableFragmentOptions,
  ): Promise<ShapeId[]>;
  /** Sanitize and import untrusted SVG data; raw XML is never stored. */
  importSvg(source: string): Promise<ShapeId>;
  importRaster(bytes: Uint8Array, declaredMimeType?: string): Promise<ShapeId>;
	replaceAsset(shapeId: ShapeId, request: GlideboardAssetImportRequest): Promise<ShapeId>;
	downloadAsset(recordId: string, signal?: AbortSignal, context?: AssetResolutionContext): Promise<GlideboardAssetDownload>;
	clearAssetImportHistory(): void;
  configureAssetPlacement(config: GlideboardAssetPlacementConfig): void;
  getRecoverableTextDraft(): RecoverableTextDraft | null;
	setCurrentTool(toolId: string): void;
	setReadOnly(readOnly: boolean): void;
  settleActiveEdit(policy: 'commit' | 'cancel'): Promise<void>;
  acquireMutationFence(reason: 'close' | 'publish'): MutationFence;
  captureProjectionTarget(): Promise<ProjectionTarget>;
  /** @deprecated Observational callback flush only; not a durability acknowledgement. */
  flush(): Promise<void>;
}
