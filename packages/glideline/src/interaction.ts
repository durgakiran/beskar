/** Transient interaction overlay: previews never enter the canonical store. */

import {
  batch as preactBatch,
  computed,
  signal,
  type ReadonlySignal,
} from '@preact/signals';
import type { GlideStore, JsonPointer, StoreRecord, StoreTransaction } from './store.js';
import type { AnyRecord, ShapeId } from './types.js';
import type { MutationCapability } from './mutation-policy.js';

export interface InteractionConflict {
  readonly id: string;
  readonly path: JsonPointer;
  readonly reason: 'value-changed' | 'record-created' | 'record-deleted' | 'generation-changed';
}

export class InteractionConflictError extends Error {
  readonly code = 'interaction-conflict';

  constructor(readonly conflicts: readonly InteractionConflict[]) {
    super(`Cannot commit interaction because ${conflicts.length} field${conflicts.length === 1 ? '' : 's'} changed`);
    this.name = 'InteractionConflictError';
  }
}

export interface InteractionCommitOptions {
  readonly label: string;
  readonly commandId: string;
  readonly actorId?: string;
}

type InteractionKind = 'document' | 'ephemeral';

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function ownRecord(value: AnyRecord | StoreRecord | null): StoreRecord | null {
  return value === null ? null : deepFreeze(cloneJson(value)) as StoreRecord;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerSegments(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer.slice(1).split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function readPointer(record: StoreRecord | AnyRecord | null | undefined, pointer: JsonPointer): {
  exists: boolean;
  value: unknown;
} {
  if (pointer === '') return { exists: record !== null && record !== undefined, value: record };
  let value: unknown = record;
  for (const segment of pointerSegments(pointer)) {
    if (value === null || typeof value !== 'object'
      || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return { exists: false, value: undefined };
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return { exists: true, value };
}

function writePointer(record: AnyRecord, pointer: JsonPointer, source: { exists: boolean; value: unknown }): void {
  const segments = pointerSegments(pointer);
  let target: Record<string, unknown> | unknown[] = record;
  for (const [index, segment] of segments.slice(0, -1).entries()) {
    const nextSegment = segments[index + 1];
    let child = (target as Record<string, unknown>)[segment];
    if (child === null || typeof child !== 'object') {
      child = /^\d+$/.test(nextSegment ?? '') ? [] : {};
      (target as Record<string, unknown>)[segment] = child;
    }
    target = child as Record<string, unknown> | unknown[];
  }
  const key = segments[segments.length - 1];
  if (key === undefined) return;
  if (!source.exists) {
    if (Array.isArray(target) && /^\d+$/.test(key)) target.splice(Number(key), 1);
    else delete (target as Record<string, unknown>)[key];
  } else {
    (target as Record<string, unknown>)[key] = cloneJson(source.value);
  }
}

function collectChangedPaths(before: unknown, after: unknown, path = ''): JsonPointer[] {
  if (jsonEqual(before, after)) return [];
  if (
    before === null || after === null
    || typeof before !== 'object' || typeof after !== 'object'
    || Array.isArray(before) !== Array.isArray(after)
  ) return [path];
  if (Array.isArray(before)) {
    if (before.length !== (after as unknown[]).length) return [path];
    return before.flatMap((value, index) => collectChangedPaths(value, (after as unknown[])[index], `${path}/${index}`));
  }
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  return keys.flatMap(key => collectChangedPaths(
    (before as AnyRecord)[key],
    (after as AnyRecord)[key],
    `${path}/${escapePointer(key)}`,
  ));
}

/**
 * Owns one active gesture. Overlay records are reactive for rendering but are
 * excluded from persistence, collaboration, spatial indices, and history.
 */
export class InteractionManager {
  private _kind: InteractionKind | null = null;
  private _overlay = new Map<string, StoreRecord | null>();
  private _baselines = new Map<string, StoreRecord | null>();
  private _baselineGenerations = new Map<string, number>();
  private _signals = new Map<string, ReadonlySignal<StoreRecord | null>>();
  private _overlayVersion = signal(0);
  private _previewDepth = 0;
  private _combinedVersion = computed(() => {
    // Consumers such as canvas overlays need a new numeric value for both
    // committed store changes and transient interaction previews. Merely
    // reading overlayVersion as a dependency is insufficient: computed
    // signals suppress notifications when their returned value is unchanged.
    return this._store.getVersionSignal().value + this._overlayVersion.value;
  });
  private _shapeIds = computed<readonly ShapeId[]>(() => {
    this._overlayVersion.value;
    const ids = [...this._store.getShapeIdsSignal().value];
    for (const [id, record] of this._overlay) {
      const index = ids.indexOf(id as ShapeId);
      const isShape = record !== null && this._store.schema.isRenderableShape(record as AnyRecord);
      if (isShape && index < 0) ids.push(id as ShapeId);
      if (!isShape && index >= 0) ids.splice(index, 1);
    }
    return Object.freeze(ids);
  });
  private _changedIds = computed<readonly string[]>(() => {
    this._overlayVersion.value;
    return Object.freeze([...this._overlay.keys()]);
  });

  constructor(
    private _store: GlideStore,
    private _localMutationCapability?: MutationCapability,
  ) {
    this._store.listen(changes => {
      if (!this.active) return;
      const deletedOwnedRecord = changes.deltas.some(delta =>
        delta.after === null
        && this._overlay.has(delta.id)
        && this._baselines.get(delta.id) !== null,
      );
      if (deletedOwnedRecord) this.cancel();
    });
  }

  get active(): boolean { return this._kind !== null; }
  get previewing(): boolean { return this._previewDepth > 0; }
  get kind(): InteractionKind | null { return this._kind; }
  get changedIds(): readonly string[] { return Object.freeze([...this._overlay.keys()]); }

  begin(kind: InteractionKind = 'document'): void {
    if (this._kind) this.cancel();
    this._kind = kind;
  }

  get(id: string): StoreRecord | undefined {
    if (this._overlay.has(id)) return this._overlay.get(id) ?? undefined;
    return this._store.get(id);
  }

  getSignal(id: string): ReadonlySignal<StoreRecord | null> {
    let result = this._signals.get(id);
    if (!result) {
      result = computed(() => {
        this._overlayVersion.value;
        if (this._overlay.has(id)) return this._overlay.get(id) ?? null;
        return this._store.getSignal(id)?.value ?? null;
      });
      this._signals.set(id, result);
    }
    return result;
  }

  getVersionSignal(): ReadonlySignal<number> { return this._combinedVersion; }
  getShapeIdsSignal(): ReadonlySignal<readonly ShapeId[]> { return this._shapeIds; }
  getChangedIdsSignal(): ReadonlySignal<readonly string[]> { return this._changedIds; }

  runPreview<T>(fn: () => T): T {
    if (!this._kind) throw new Error('No interaction is active');
    const overlayBefore = new Map(this._overlay);
    const baselinesBefore = new Map(this._baselines);
    const generationsBefore = new Map(this._baselineGenerations);
    this._previewDepth++;
    try {
      const value = fn();
      if (value !== null && (typeof value === 'object' || typeof value === 'function')
        && typeof (value as { then?: unknown }).then === 'function') {
        throw new Error('Interaction preview callbacks must be synchronous');
      }
      return value;
    } catch (error) {
      this._overlay = overlayBefore;
      this._baselines = baselinesBefore;
      this._baselineGenerations = generationsBefore;
      throw error;
    } finally {
      this._previewDepth--;
      if (this._previewDepth === 0) this._publishOverlay();
    }
  }

  runEphemeral<T>(fn: () => T): T {
    if (!this._kind) this.begin('ephemeral');
    const value = this.runPreview(fn);
    if (this._kind === 'ephemeral' && this._overlay.size === 0) this._clear(false);
    return value;
  }

  transact<T>(fn: (tx: StoreTransaction) => T): T {
    if (!this.previewing) throw new Error('Overlay transactions are only valid inside preview callbacks');
    return fn({
      get: id => this.get(id),
      insert: record => {
        const id = String(record['id']);
        if (this.get(id)) throw new Error(`Record "${id}" already exists`);
        this._stage(id, ownRecord(this._store.schema.prepareRecord(record)));
      },
      update: (id, updater) => {
        const existing = this.get(id);
        if (!existing) throw new Error(`Record "${id}" does not exist`);
        const next = ownRecord(this._store.schema.prepareRecord(updater(existing)));
        if (next?.['id'] !== id || next['type'] !== existing['type'] || next['kind'] !== existing['kind']) {
          throw new Error(`Interaction update cannot change identity of record "${id}"`);
        }
        this._stage(id, next);
      },
      remove: id => {
        if (this.get(id)) this._stage(id, null);
      },
      upsert: record => {
        const id = String(record['id']);
        this._stage(id, ownRecord(this._store.schema.prepareRecord(record)));
      },
    });
  }

  commit(options: InteractionCommitOptions): void {
    if (!this._kind) return;
    const entries = [...this._overlay.entries()];
    if (entries.length === 0) {
      this._clear(true);
      return;
    }
    preactBatch(() => {
      this._store.transact({
        origin: 'user',
        label: options.label,
        commandId: options.commandId,
        affectedIds: entries.map(([id]) => id),
        ...(options.actorId === undefined ? {} : { actorId: options.actorId }),
        history: 'record',
        scope: 'document',
      }, tx => {
        const conflicts: InteractionConflict[] = [];
        const prepared: Array<{ id: string; before: StoreRecord | null; after: StoreRecord | null; paths: JsonPointer[] }> = [];
        for (const [id, after] of entries) {
          const before = this._baselines.get(id) ?? null;
          const current = tx.get(id) ?? null;
          const paths = before === null || after === null ? [''] : collectChangedPaths(before, after);
          for (const path of paths) {
            const expected = readPointer(before, path);
            const actual = readPointer(current, path);
            if (expected.exists !== actual.exists) {
              conflicts.push({
                id,
                path,
                reason: path === ''
                  ? (expected.exists ? 'record-deleted' : 'record-created')
                  : 'value-changed',
              });
            } else if (expected.exists && !jsonEqual(expected.value, actual.value)) {
              conflicts.push({ id, path, reason: 'value-changed' });
            } else if (path === ''
              && this._store.getRecordGeneration(id) !== this._baselineGenerations.get(id)) {
              conflicts.push({ id, path, reason: 'generation-changed' });
            }
          }
          prepared.push({ id, before, after, paths });
        }
        if (conflicts.length > 0) throw new InteractionConflictError(Object.freeze(conflicts));

        for (const { id, before, after, paths } of prepared) {
          if (paths.includes('')) {
            if (after === null) tx.remove(id);
            else if (before === null) tx.insert(after as AnyRecord);
            else tx.upsert(after as AnyRecord);
            continue;
          }
          const current = tx.get(id);
          if (!current || !after) continue;
          const next = cloneJson(current) as AnyRecord;
          for (const path of paths) writePointer(next, path, readPointer(after, path));
          tx.update(id, () => next);
        }
      }, this._localMutationCapability);
      this._clear(true);
    });
  }

  cancel(): void { this._clear(true); }

  private _stage(id: string, value: StoreRecord | null): void {
    if (!this._baselines.has(id)) {
      this._baselines.set(id, this._store.get(id) ?? null);
      this._baselineGenerations.set(id, this._store.getRecordGeneration(id));
    }
    const baseline = this._baselines.get(id) ?? null;
    if (jsonEqual(baseline, value)) {
      this._overlay.delete(id);
      this._baselines.delete(id);
      this._baselineGenerations.delete(id);
    } else {
      this._overlay.set(id, value);
    }
  }

  private _clear(publish: boolean): void {
    this._kind = null;
    this._overlay.clear();
    this._baselines.clear();
    this._baselineGenerations.clear();
    if (publish) this._publishOverlay();
  }

  private _publishOverlay(): void {
    this._overlayVersion.value = this._overlayVersion.peek() + 1;
  }
}
