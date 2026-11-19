import { signal, type Signal } from '@preact/signals';
import * as Y from 'yjs';
import type {
  CollaborationCheckpointSource,
  ProjectedYjsState,
  ProjectionStatus,
  ProjectionTarget,
} from '../durability/types.js';

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
 * Captures exact Yjs bytes for projected Glideline revisions. Hosts that set
 * a collection interval can combine several commits into one projection.
 */
export class GlideboardCollaborationCheckpointSource implements CollaborationCheckpointSource {
  readonly status: Signal<ProjectionStatus> = signal('catching-up');

  private transactionSequence = 0;
  private disposed = false;
  private latest: Promise<ProjectedYjsState> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly byStoreRevision = new Map<number, Promise<ProjectionTarget>>();
  private pending: { doc: Y.Doc; revision: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recording: Promise<ProjectedYjsState> | null = null;
  private readonly listeners = new Set<(state: ProjectedYjsState) => void>();

  constructor(private readonly intervalMs = 0, private readonly onDemand = false) {}

  stage(doc: Y.Doc, revision: number): void {
    if (this.disposed) return;
    if (this.intervalMs === 0 && !this.onDemand) {
      void this.record(doc, revision).catch(() => {});
      return;
    }
    this.pending = { doc, revision };
    this.schedule();
  }

  private schedule(): void {
    if (this.onDemand || this.timer !== null || this.recording || !this.pending || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushPending();
    }, this.intervalMs);
  }

  private flushPending(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    const result = this.record(pending.doc, pending.revision);
    this.recording = result;
    const complete = () => {
      if (this.recording !== result) return;
      this.recording = null;
      this.schedule();
    };
    void result.then(complete, complete);
  }

  private emit(state: ProjectedYjsState, target?: ProjectionTarget): void {
    if (this.disposed) return;
    for (const listener of [...this.listeners]) {
      listener(target ? { target, encodedState: state.encodedState.slice() } : copyProjectedState(state));
    }
  }

  record(doc: Y.Doc, storeRevision: number): Promise<ProjectedYjsState> {
    if (this.disposed) {
      return Promise.reject(new Error('Glideboard collaboration checkpoint source is disposed.'));
    }

    const transactionSequence = ++this.transactionSequence;
    let encodedState: Uint8Array;
    try {
      encodedState = Y.encodeStateAsUpdate(doc);
    } catch (error) {
      this.quarantine();
      return Promise.reject(error);
    }
    let resolveState!: (state: ProjectedYjsState) => void;
    let rejectState!: (error: unknown) => void;
    const result = new Promise<ProjectedYjsState>((resolve, reject) => {
      resolveState = resolve;
      rejectState = reject;
    });

    // Revision lookups only need the target metadata. Retaining the state
    // promises would also retain a full Yjs buffer for every revision.
    const target = result.then(state => copyTarget(state.target));
    void target.catch(() => {});
    this.byStoreRevision.set(storeRevision, target);
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
        this.emit(state);
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

  hasPendingProjection(): boolean {
    return !this.onDemand && (this.pending !== null || this.recording !== null);
  }

  async captureTarget(): Promise<ProjectionTarget> {
    if (this.status.peek() !== 'healthy') {
      throw new Error(`Glideboard collaboration projection is ${this.status.peek()}.`);
    }
    this.flushPending();
    const latest = this.latest;
    if (!latest) throw new Error('Glideboard collaboration projection is not ready.');
    const state = await latest;
    // Close the late-subscriber race at save/publish boundaries. Consumers
    // can safely deduplicate this immutable target.
    const target = copyTarget(state.target);
    this.emit(state, target);
    return target;
  }

  async waitForStoreRevision(storeRevision: number): Promise<ProjectionTarget> {
    if (this.status.peek() !== 'healthy') {
      throw new Error(`Glideboard collaboration projection is ${this.status.peek()}.`);
    }
    if (this.pending?.revision === storeRevision) this.flushPending();
    const checkpoint = this.byStoreRevision.get(storeRevision);
    if (!checkpoint) {
      throw new Error(`No Yjs projection checkpoint exists for store revision ${storeRevision}.`);
    }
    return copyTarget(await checkpoint);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.pending = null;
    this.listeners.clear();
    this.byStoreRevision.clear();
    this.latest = null;
  }
}
