import { signal, type Signal } from '@preact/signals';
import * as Y from 'yjs';
import type {
  CollaborationCheckpointSource,
  ProjectedYjsState,
  ProjectionStatus,
  ProjectionTarget,
} from '../durability/types';

function copyTarget(target: ProjectionTarget): ProjectionTarget {
  return Object.freeze({
    storeRevision: target.storeRevision,
    yjs: Object.freeze({ ...target.yjs }),
  });
}

function copyProjectedState(state: ProjectedYjsState): ProjectedYjsState {
  return Object.freeze({
    target: copyTarget(state.target),
    encodedState: state.encodedState.slice(),
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Glideboard collaboration checkpoints require Web Crypto SHA-256 support.');
  }
  const digest = await subtle.digest('SHA-256', Uint8Array.from(bytes));
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Records the exact Yjs bytes corresponding to each published Glideline store
 * revision. It deliberately knows nothing about recovery or server saves.
 */
export class GlideboardCollaborationCheckpointSource implements CollaborationCheckpointSource {
  readonly status: Signal<ProjectionStatus> = signal('catching-up');

  private transactionSequence = 0;
  private disposed = false;
  private latest: Promise<ProjectedYjsState> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly byStoreRevision = new Map<number, Promise<ProjectedYjsState>>();
  private readonly listeners = new Set<(state: ProjectedYjsState) => void>();

  record(doc: Y.Doc, storeRevision: number): Promise<ProjectedYjsState> {
    if (this.disposed) {
      return Promise.reject(new Error('Glideboard collaboration checkpoint source is disposed.'));
    }

    const transactionSequence = ++this.transactionSequence;
    const encodedState = Y.encodeStateAsUpdate(doc).slice();
    let resolveState!: (state: ProjectedYjsState) => void;
    let rejectState!: (error: unknown) => void;
    const result = new Promise<ProjectedYjsState>((resolve, reject) => {
      resolveState = resolve;
      rejectState = reject;
    });

    this.byStoreRevision.set(storeRevision, result);
    this.latest = result;
    this.queue = this.queue.then(async () => {
      try {
        const stateDigest = await sha256(encodedState);
        const state: ProjectedYjsState = Object.freeze({
          target: Object.freeze({
            storeRevision,
            yjs: Object.freeze({ transactionSequence, stateDigest }),
          }),
          encodedState,
        });
        resolveState(state);
        if (!this.disposed) {
          for (const listener of [...this.listeners]) listener(copyProjectedState(state));
        }
      } catch (error) {
        this.status.value = 'quarantined';
        rejectState(error);
      }
    });
    return result;
  }

  markHealthy(): void {
    const current = this.status.peek();
    if (!this.disposed && (current === 'catching-up' || current === 'healthy')) {
      this.status.value = 'healthy';
    }
  }

  quarantine(): void {
    if (!this.disposed) this.status.value = 'quarantined';
  }

  markIncompatible(): void {
    if (!this.disposed) this.status.value = 'incompatible';
  }

  markFailed(): void {
    if (!this.disposed) this.status.value = 'failed';
  }

  subscribe(listener: (state: ProjectedYjsState) => void): () => void {
    if (this.disposed) throw new Error('Glideboard collaboration checkpoint source is disposed.');
    this.listeners.add(listener);
    const latest = this.latest;
    if (latest) {
      void latest.then(state => {
        if (!this.disposed && this.listeners.has(listener)) listener(copyProjectedState(state));
      });
    }
    return () => this.listeners.delete(listener);
  }

  async captureTarget(): Promise<ProjectionTarget> {
    if (this.status.peek() !== 'healthy') {
      throw new Error(`Glideboard collaboration projection is ${this.status.peek()}.`);
    }
    const latest = this.latest;
    if (!latest) throw new Error('Glideboard collaboration projection is not ready.');
    return copyTarget((await latest).target);
  }

  async waitForStoreRevision(storeRevision: number): Promise<ProjectionTarget> {
    if (this.status.peek() !== 'healthy') {
      throw new Error(`Glideboard collaboration projection is ${this.status.peek()}.`);
    }
    const checkpoint = this.byStoreRevision.get(storeRevision);
    if (!checkpoint) {
      throw new Error(`No Yjs projection checkpoint exists for store revision ${storeRevision}.`);
    }
    return copyTarget((await checkpoint).target);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.byStoreRevision.clear();
    this.latest = null;
  }
}
