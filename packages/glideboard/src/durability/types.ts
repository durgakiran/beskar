import type { ReadonlySignal } from '@preact/signals';

export interface YjsProjectionCheckpoint {
  readonly transactionSequence: number;
  readonly stateDigest: string;
  /** Diff optimization only; never use as exact document-state identity. */
  readonly stateVector?: Uint8Array;
}

export interface ProjectionTarget {
  readonly storeRevision: number;
  readonly yjs: Pick<YjsProjectionCheckpoint, 'transactionSequence' | 'stateDigest'>;
}

export interface ProjectedYjsState {
  readonly target: ProjectionTarget;
  /** Detached bytes whose SHA-256 digest is `target.yjs.stateDigest`. */
  readonly encodedState: Uint8Array;
}

export type ProjectionStatus = 'healthy' | 'catching-up' | 'quarantined' | 'incompatible' | 'failed';

export interface CollaborationCheckpointSource {
  readonly status: ReadonlySignal<ProjectionStatus>;
  subscribe(listener: (state: ProjectedYjsState) => void): () => void;
  captureTarget(): Promise<ProjectionTarget>;
  waitForStoreRevision(storeRevision: number): Promise<ProjectionTarget>;
}

export interface MutationFence {
  readonly reason: 'close' | 'publish';
  release(): void;
}
