import type { GlideDocument, GlidePlugin, LoadReport, ShapeId } from '@durgakiran/glideline';
import type { CollaborationCheckpointSource, MutationFence, ProjectionTarget } from './durability/types';

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

export interface GlideboardProps {
  /** Changing this value starts a new, isolated board session. */
  sessionKey?: string;
  initialDocument?: GlideDocument | null;
  /** Required when initialDocument is provided; determines initial durability state. */
  initialDocumentDisposition?: InitialDocumentDisposition;
  collaboration?: GlideboardCollaborationConfig | null;
  readOnly?: boolean;
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
}

export interface GlideboardDocumentChangeContext {
  /** Aborted when this board is disposed with the cancel policy. */
  signal: AbortSignal;
}

export interface GlideboardExportSvgOptions {
  shapeIds?: readonly ShapeId[];
  /** Reject export if the board no longer represents this projection target. */
  target?: ProjectionTarget;
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
  exportSvg(options?: GlideboardExportSvgOptions): Promise<string>;
  getRecoverableTextDraft(): RecoverableTextDraft | null;
  setCurrentTool(toolId: string): void;
  settleActiveEdit(policy: 'commit' | 'cancel'): Promise<void>;
  acquireMutationFence(reason: 'close' | 'publish'): MutationFence;
  captureProjectionTarget(): Promise<ProjectionTarget>;
  /** @deprecated Observational callback flush only; not a durability acknowledgement. */
  flush(): Promise<void>;
}
