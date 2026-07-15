/** Per-user undo/redo backed by atomic store change sets. */

import type { GlideStore, StoreChangeSet, StoreTransaction, TransactionScope } from './store';
import type { AnyRecord, DeepReadonly } from './types';

const MAX_STACK = 100;

class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
  readonly #map: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#map = new Map(entries);
    Object.freeze(this);
  }

  get size(): number { return this.#map.size; }
  get(key: K): V | undefined { return this.#map.get(key); }
  has(key: K): boolean { return this.#map.has(key); }
  entries(): MapIterator<[K, V]> { return this.#map.entries(); }
  keys(): MapIterator<K> { return this.#map.keys(); }
  values(): MapIterator<V> { return this.#map.values(); }
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.#map.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }
  [Symbol.iterator](): MapIterator<[K, V]> { return this.#map[Symbol.iterator](); }
  get [Symbol.toStringTag](): string { return 'ImmutableMap'; }
}

export interface HistoryEntry {
  readonly label: string;
  readonly before: ReadonlyMap<string, DeepReadonly<AnyRecord> | null>;
  readonly after: ReadonlyMap<string, DeepReadonly<AnyRecord> | null>;
}

export interface BatchOptions {
  history?: 'ignore';
  scope?: TransactionScope;
}

function immutableRecordSnapshot(value: DeepReadonly<AnyRecord> | AnyRecord | null): DeepReadonly<AnyRecord> | null {
  if (value === null) return null;
  const clone = JSON.parse(JSON.stringify(value)) as AnyRecord;
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== 'object' || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(clone);
  return clone as DeepReadonly<AnyRecord>;
}

function recordsEqual(
  left: DeepReadonly<AnyRecord> | null,
  right: DeepReadonly<AnyRecord> | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function entryFromChanges(label: string, changes: StoreChangeSet): HistoryEntry {
  return Object.freeze({
    label,
    before: new ImmutableMap(changes.deltas.map(delta => [delta.id, delta.before] as const)),
    after: new ImmutableMap(changes.deltas.map(delta => [delta.id, delta.after] as const)),
  });
}

function applySnapshot(
  tx: StoreTransaction,
  snapshot: ReadonlyMap<string, DeepReadonly<AnyRecord> | null>,
): void {
  for (const [id, value] of snapshot) {
    if (value === null) tx.remove(id);
    else tx.upsert(value as AnyRecord);
  }
}

export class HistoryManager {
  private _undo: HistoryEntry[] = [];
  private _redo: HistoryEntry[] = [];
  private _previewBefore: Map<string, DeepReadonly<AnyRecord> | null> | null = null;

  constructor(private _store: GlideStore) {
    this._store.listen(changes => {
      if (
        this._previewBefore
        && changes.history === 'ignore'
        && changes.scope === 'document'
        && changes.origin === 'user'
      ) {
        for (const delta of changes.deltas) {
          if (!this._previewBefore.has(delta.id)) {
            this._previewBefore.set(delta.id, delta.before);
          }
        }
      }
      if (changes.history !== 'record') return;
      this._push(entryFromChanges(changes.label ?? 'Store Change', changes));
      this._redo = [];
    });
  }

  batch(label: string, fn: () => void, opts?: BatchOptions): void {
    this._store.transact({
      origin: 'user',
      label,
      history: opts?.history === 'ignore' ? 'ignore' : 'record',
      scope: opts?.scope ?? 'document',
    }, () => fn());
  }

  /**
   * Start collecting the before-image of every record changed by an ignored
   * live preview, including records changed indirectly by lifecycle hooks.
   */
  beginPreview(): void {
    this._previewBefore = new Map();
  }

  /** Discard a preview capture after cancellation or an interrupted gesture. */
  cancelPreview(): void {
    this._previewBefore = null;
  }

  /**
   * Record an interactive command whose live preview was applied with
   * history ignored. `before` contains explicit snapshots captured by the
   * tool; beginPreview() also contributes records changed indirectly by
   * binding/lifecycle hooks. The current store supplies the after-image.
   */
  recordPreview(label: string, before: ReadonlyMap<string, AnyRecord | null>): void {
    const allBefore = new Map<string, DeepReadonly<AnyRecord> | null>(this._previewBefore ?? []);
    this._previewBefore = null;
    for (const [id, value] of before) {
      allBefore.set(id, immutableRecordSnapshot(value));
    }
    const beforeEntries: Array<readonly [string, DeepReadonly<AnyRecord> | null]> = [];
    const afterEntries: Array<readonly [string, DeepReadonly<AnyRecord> | null]> = [];

    for (const [id, beforeValue] of allBefore) {
      const afterValue = this._store.get(id) ?? null;
      if (recordsEqual(beforeValue, afterValue)) continue;
      beforeEntries.push([id, beforeValue]);
      afterEntries.push([id, afterValue]);
    }

    if (beforeEntries.length === 0) return;
    this._push(Object.freeze({
      label,
      before: new ImmutableMap(beforeEntries),
      after: new ImmutableMap(afterEntries),
    }));
    this._redo = [];
  }

  undo(): void {
    const entry = this._undo[this._undo.length - 1];
    if (!entry) return;
    this._store.transact({ origin: 'undo', label: entry.label, history: 'ignore' }, tx => {
      applySnapshot(tx, entry.before);
    });
    this._undo.pop();
    this._redo.push(entry);
  }

  redo(): void {
    const entry = this._redo[this._redo.length - 1];
    if (!entry) return;
    this._store.transact({ origin: 'redo', label: entry.label, history: 'ignore' }, tx => {
      applySnapshot(tx, entry.after);
    });
    this._redo.pop();
    this._undo.push(entry);
  }

  get undoStack(): readonly HistoryEntry[] { return Object.freeze([...this._undo]); }
  get redoStack(): readonly HistoryEntry[] { return Object.freeze([...this._redo]); }
  get canUndo(): boolean { return this._undo.length > 0; }
  get canRedo(): boolean { return this._redo.length > 0; }

  clear(): void {
    this._undo = [];
    this._redo = [];
    this._previewBefore = null;
  }

  private _push(entry: HistoryEntry): void {
    if (this._undo.length >= MAX_STACK) this._undo.shift();
    this._undo.push(entry);
  }
}
