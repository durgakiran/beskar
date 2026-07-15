/**
 * Reactive, transactional record store.
 *
 * Writes are staged and fully validated before publication. Committed records
 * are engine-owned, deeply frozen JSON data; record signals are stable for the
 * lifetime of the store and publish null tombstones on deletion.
 */

import {
  signal,
  computed,
  batch as preactBatch,
  type Signal,
  type ReadonlySignal,
} from '@preact/signals';
import RBush from 'rbush';
import type {
  ShapeId,
  BindingId,
  PageId,
  GlideShape,
  GlideBinding,
  GlideDocument,
  AnyRecord,
  DeepReadonly,
} from './types';
import type { Geometry2d } from './geometry';
import { GlideSchema, DocumentValidationError, type LoadReport } from './schema';

interface RBushEntry {
  id: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ChangeOrigin =
  | 'user'
  | 'undo'
  | 'redo'
  | 'remote'
  | 'load'
  | 'system'
  | 'repair';

export type JsonPointer = string;
export type StoreRecord = DeepReadonly<AnyRecord>;
export type TransactionScope = 'document' | 'ephemeral';

export interface RecordDelta {
  readonly id: string;
  readonly before: StoreRecord | null;
  readonly after: StoreRecord | null;
  readonly changedPaths: readonly JsonPointer[];
}

export interface StoreChangeSet {
  readonly id: string;
  readonly revision: number;
  readonly origin: ChangeOrigin;
  readonly label?: string;
  readonly actorId?: string;
  readonly scope: TransactionScope;
  readonly history: 'record' | 'ignore';
  readonly deltas: readonly RecordDelta[];
  readonly changedIds: readonly string[];
  readonly timestamp: number;
}

export interface TransactionOptions {
  origin: ChangeOrigin;
  label?: string;
  actorId?: string;
  history?: 'record' | 'ignore';
  scope?: TransactionScope;
}

export interface StoreTransaction {
  insert(record: AnyRecord): void;
  update(id: string, updater: (record: StoreRecord) => AnyRecord): void;
  remove(id: string): void;
  get(id: string): StoreRecord | undefined;
  /** Trusted load/synchronization primitive. Normal editor commands use insert/update. */
  upsert(record: AnyRecord): void;
}

export interface TransactionResult<T> {
  value: T;
  changes: StoreChangeSet | null;
}

export interface ReplaceDocumentOptions {
  origin?: Extract<ChangeOrigin, 'load' | 'remote' | 'system' | 'repair'>;
}

export interface ImportOptions {
  idPolicy?: 'remap' | 'reject';
  relationshipPolicy?: 'detach-external' | 'preserve';
  label?: string;
}

export interface ImportReport {
  readonly importedRecordCount: number;
  readonly idMap: Readonly<Record<string, string>>;
  readonly warnings: readonly string[];
}

export type StoreChangeListener = (changes: StoreChangeSet) => void;

export class AsyncTransactionError extends Error {
  constructor() {
    super('GlideStore transaction callbacks must be synchronous');
    this.name = 'AsyncTransactionError';
  }
}

export class TransactionAbortedError extends Error {
  constructor(cause?: unknown) {
    super('GlideStore transaction was aborted because a nested transaction failed');
    this.name = 'TransactionAbortedError';
    if (cause !== undefined) Object.defineProperty(this, 'cause', { value: cause });
  }
}

export class TransactionReentryError extends Error {
  constructor() {
    super('GlideStore mutation is not allowed from validation or derived-data hooks');
    this.name = 'TransactionReentryError';
  }
}

interface TransactionState {
  readonly options: TransactionOptions;
  readonly before: Map<string, StoreRecord | null>;
  readonly overlay: Map<string, StoreRecord | null>;
  readonly touchedIds: string[];
  failed: unknown;
}

interface DerivedState {
  treeRemovals: readonly RBushEntry[];
  treeInsertions: readonly RBushEntry[];
  bindingsByFrom: Map<ShapeId, Set<BindingId>>;
  bindingsByTo: Map<ShapeId, Set<BindingId>>;
  shapesByPage: Map<PageId, Set<ShapeId>>;
  shapeIds: readonly ShapeId[] | null;
}

const NO_FAILURE = Symbol('no transaction failure');

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? typeof (value as { then?: unknown }).then === 'function'
    : false;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function cloneJsonValue(value: unknown, path = '', ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path || '/'}`);
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Non-JSON value at ${path || '/'}`);
  }
  if (ancestors.has(value)) throw new TypeError(`Cyclic value at ${path || '/'}`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => cloneJsonValue(item, `${path}/${index}`, ancestors));
    }
    if (!isPlainObject(value)) throw new TypeError(`Non-plain object at ${path || '/'}`);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const escaped = key.replace(/~/g, '~0').replace(/\//g, '~1');
      result[key] = cloneJsonValue((value as Record<string, unknown>)[key], `${path}/${escaped}`, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function ownRecord(record: AnyRecord): StoreRecord {
  const cloned = cloneJsonValue(record) as AnyRecord;
  const id = cloned['id'];
  const type = cloned['type'];
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('Record id must be a non-empty string');
  if (typeof type !== 'string' || type.length === 0) throw new TypeError(`Record "${id}" type must be a non-empty string`);
  return deepFreeze(cloned) as StoreRecord;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const right = b as unknown[];
    return a.length === right.length && a.every((item, index) => jsonEqual(item, right[index]));
  }
  const leftKeys = Object.keys(a as object);
  const rightKeys = Object.keys(b as object);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(b, key)
    && jsonEqual((a as AnyRecord)[key], (b as AnyRecord)[key]));
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerSegments(pointer: string): string[] {
  return pointer.slice(1).split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function readRecordPointer(record: AnyRecord, pointer: string): unknown {
  let value: unknown = record;
  for (const segment of pointerSegments(pointer)) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as AnyRecord)[segment];
  }
  return value;
}

function writeRecordPointer(record: AnyRecord, pointer: string, value: unknown, remove = false): void {
  const segments = pointerSegments(pointer);
  let target: AnyRecord = record;
  for (const segment of segments.slice(0, -1)) {
    const child = target[segment];
    if (child === null || typeof child !== 'object') return;
    target = child as AnyRecord;
  }
  const key = segments.at(-1);
  if (key === undefined) return;
  if (remove) delete target[key];
  else target[key] = value;
}

function collectChangedPaths(before: unknown, after: unknown, path = ''): string[] {
  if (jsonEqual(before, after)) return [];
  if (
    before === null || after === null
    || typeof before !== 'object' || typeof after !== 'object'
    || Array.isArray(before) !== Array.isArray(after)
  ) return [path];

  if (Array.isArray(before)) {
    const left = before;
    const right = after as unknown[];
    if (left.length !== right.length) return [path];
    return left.flatMap((value, index) => collectChangedPaths(value, right[index], `${path}/${index}`));
  }

  const keys = Array.from(new Set([
    ...Object.keys(before as object),
    ...Object.keys(after as object),
  ])).sort();
  return keys.flatMap(key => collectChangedPaths(
    (before as AnyRecord)[key],
    (after as AnyRecord)[key],
    `${path}/${escapePointer(key)}`,
  ));
}

function frozenOptions(options: TransactionOptions): TransactionOptions {
  return Object.freeze({ ...options });
}

export class GlideStore {
  private _signals = new Map<string, Signal<StoreRecord | null>>();
  private _readonlySignals = new Map<string, ReadonlySignal<StoreRecord | null>>();
  private _tree = new RBush<RBushEntry>();
  private _treeEntries = new Map<string, RBushEntry>();
  private _bindingsByFrom = new Map<ShapeId, Set<BindingId>>();
  private _bindingsByTo = new Map<ShapeId, Set<BindingId>>();
  private _shapesByPage = new Map<PageId, Set<ShapeId>>();
  private _shapeIdsSignal = signal<readonly ShapeId[]>(Object.freeze([]));
  private _shapeIdsReadonly = computed(() => this._shapeIdsSignal.value);
  private _ephemeralIds = new Set<string>();
  private _versionSignal = signal(0);
  private _versionReadonly = computed(() => this._versionSignal.value);
  private _activeTransaction: TransactionState | null = null;
  private _listeners = new Set<StoreChangeListener>();
  private _changeSequence = 0;
  private _preparingCommit = false;

  public getGeometry?: (shape: AnyRecord) => Geometry2d | undefined;
  public hitTestPoint?: (shape: AnyRecord, x: number, y: number) => boolean;

  constructor(public readonly schema: GlideSchema = new GlideSchema()) {}

  get revision(): number { return this._versionSignal.peek(); }

  get(id: string): StoreRecord | undefined {
    if (this._activeTransaction?.overlay.has(id)) {
      return this._activeTransaction.overlay.get(id) ?? undefined;
    }
    return this._signals.get(id)?.peek() ?? undefined;
  }

  has(id: string): boolean { return this.get(id) !== undefined; }

  getSignal(id: string): ReadonlySignal<StoreRecord | null> | undefined {
    return this._readonlySignals.get(id);
  }

  getShapeIdsSignal(): ReadonlySignal<readonly ShapeId[]> { return this._shapeIdsReadonly; }
  getVersionSignal(): ReadonlySignal<number> { return this._versionReadonly; }

  /** Non-reactive shape IDs, including staged values while inside a transaction. */
  getShapeIds(): readonly ShapeId[] {
    if (!this._activeTransaction) return this._shapeIdsSignal.peek();
    const ids = [...this._shapeIdsSignal.peek()];
    for (const [id, record] of this._activeTransaction.overlay) {
      const index = ids.indexOf(id as ShapeId);
      const isShape = record !== null && this.schema.isRenderableShape(record as AnyRecord);
      if (isShape && index < 0) ids.push(id as ShapeId);
      if (!isShape && index >= 0) ids.splice(index, 1);
    }
    return Object.freeze(ids);
  }

  listen(listener: StoreChangeListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  getBindingsFromShape(shapeId: ShapeId): GlideBinding[] {
    if (this._activeTransaction) {
      return this._candidateValues()
        .filter(record => this.schema.isBindingRecord(record as AnyRecord)
          && this.schema.hasRuntimeCapability(record as AnyRecord)
          && record['fromId'] === shapeId) as unknown as GlideBinding[];
    }
    const ids = this._bindingsByFrom.get(shapeId);
    if (!ids) return [];
    return Array.from(ids, id => this.get(id)).filter(Boolean) as unknown as GlideBinding[];
  }

  getBindingsToShape(shapeId: ShapeId): GlideBinding[] {
    if (this._activeTransaction) {
      return this._candidateValues()
        .filter(record => this.schema.isBindingRecord(record as AnyRecord)
          && this.schema.hasRuntimeCapability(record as AnyRecord)
          && record['toId'] === shapeId) as unknown as GlideBinding[];
    }
    const ids = this._bindingsByTo.get(shapeId);
    if (!ids) return [];
    return Array.from(ids, id => this.get(id)).filter(Boolean) as unknown as GlideBinding[];
  }

  getShapesAtPoint(x: number, y: number): AnyRecord[] {
    const hits = this._tree.search({ minX: x, minY: y, maxX: x, maxY: y });
    const shapes = hits.map(hit => this.get(hit.id)).filter(Boolean) as StoreRecord[];
    if (!this.hitTestPoint) return shapes as AnyRecord[];
    return shapes.filter(shape => this.hitTestPoint!(shape as AnyRecord, x, y)) as AnyRecord[];
  }

  getShapesInBox(minX: number, minY: number, maxX: number, maxY: number): AnyRecord[] {
    return this._tree.search({ minX, minY, maxX, maxY })
      .map(hit => this.get(hit.id)).filter(Boolean) as AnyRecord[];
  }

  put(records: AnyRecord[]): void {
    this.transact({ origin: 'user' }, tx => {
      for (const record of records) tx.upsert(record);
    });
  }

  remove(ids: string[]): void {
    this.transact({ origin: 'user' }, tx => {
      for (const id of ids) tx.remove(id);
    });
  }

  batch(fn: () => void): void {
    this.transact({ origin: 'system', history: 'ignore' }, () => fn());
  }

  transact<T>(options: TransactionOptions, fn: (tx: StoreTransaction) => T): TransactionResult<T> {
    if (this._preparingCommit) throw new TransactionReentryError();
    if (this._activeTransaction) return this._runNested(fn);

    const state: TransactionState = {
      options: frozenOptions(options),
      before: new Map(),
      overlay: new Map(),
      touchedIds: [],
      failed: NO_FAILURE,
    };
    this._activeTransaction = state;
    let value!: T;
    try {
      value = fn(this._makeTransaction(state));
      if (isThenable(value)) throw new AsyncTransactionError();
      if (state.failed !== NO_FAILURE) throw new TransactionAbortedError(state.failed);
      const changes = this._commit(state);
      return { value, changes };
    } catch (error) {
      state.failed = error;
      throw error;
    } finally {
      this._activeTransaction = null;
    }
  }

  private _runNested<T>(fn: (tx: StoreTransaction) => T): TransactionResult<T> {
    const state = this._activeTransaction!;
    try {
      const value = fn(this._makeTransaction(state));
      if (isThenable(value)) throw new AsyncTransactionError();
      return { value, changes: null };
    } catch (error) {
      if (state.failed === NO_FAILURE) state.failed = error;
      throw error;
    }
  }

  private _makeTransaction(state: TransactionState): StoreTransaction {
    return {
      get: id => this._readCandidate(state, id) ?? undefined,
      insert: record => {
        const owned = ownRecord(this.schema.prepareRecord(record));
        const id = owned['id'] as string;
        if (this._readCandidate(state, id)) throw new Error(`Record "${id}" already exists`);
        this._stage(state, id, owned);
      },
      update: (id, updater) => {
        const existing = this._readCandidate(state, id);
        if (!existing) throw new Error(`Record "${id}" does not exist`);
        const next = ownRecord(this.schema.prepareRecord(updater(existing)));
        if (next['id'] !== id) throw new Error(`Record update cannot change id "${id}"`);
        if (next['type'] !== existing['type']) throw new Error(`Record "${id}" update cannot change type`);
        if (next['kind'] !== existing['kind']) throw new Error(`Record "${id}" update cannot change kind`);
        this._stage(state, id, next);
      },
      remove: id => {
        if (!this._readCandidate(state, id)) return;
        this._stage(state, id, null);
      },
      upsert: record => {
        const owned = ownRecord(this.schema.prepareRecord(record));
        const id = owned['id'] as string;
        const existing = this._readCandidate(state, id);
        if (existing) {
          if (owned['type'] !== existing['type']) throw new Error(`Record "${id}" upsert cannot change type`);
          if (owned['kind'] !== existing['kind']) throw new Error(`Record "${id}" upsert cannot change kind`);
        }
        this._stage(state, id, owned);
      },
    };
  }

  private _readCandidate(state: TransactionState, id: string): StoreRecord | null {
    if (state.overlay.has(id)) return state.overlay.get(id) ?? null;
    return this._signals.get(id)?.peek() ?? null;
  }

  private _stage(state: TransactionState, id: string, value: StoreRecord | null): void {
    if (!state.before.has(id)) {
      state.before.set(id, this._signals.get(id)?.peek() ?? null);
      state.touchedIds.push(id);
    }
    state.overlay.set(id, value);
  }

  private _commit(state: TransactionState): StoreChangeSet | null {
    const deltas: RecordDelta[] = [];
    for (const id of state.touchedIds) {
      const before = state.before.get(id) ?? null;
      const after = state.overlay.get(id) ?? null;
      if (jsonEqual(before, after)) continue;
      const changedPaths = before === null || after === null
        ? Object.freeze([''])
        : Object.freeze(collectChangedPaths(before, after));
      deltas.push(Object.freeze({ id, before, after, changedPaths }));
    }
    if (deltas.length === 0) return null;

    // All fallible work happens against the candidate snapshot. Store writes
    // from validators and geometry hooks are rejected as impure re-entry.
    let derived: DerivedState;
    this._preparingCommit = true;
    try {
      const graphMayHaveChanged = deltas.some(delta =>
        delta.before === null
        || delta.after === null
        || delta.changedPaths.some(path =>
          /^\/(parentId|pageId|assetId|fromId|toId)(\/|$)/.test(path)
          || (this.schema.isBindingRecord(delta.after as AnyRecord) && /^\/props(\/|$)/.test(path)),
        ),
      );
      if (graphMayHaveChanged) {
        // Existing committed records are already valid, so a non-structural
        // update only needs its changed records revalidated. Relationship
        // edits, inserts, and deletes validate the complete final graph.
        this.schema.validateCandidate(this._candidateValues() as unknown as AnyRecord[]);
      } else {
        for (const delta of deltas) {
          if (delta.after) this.schema.validateRecord(delta.after as AnyRecord);
        }
      }
      derived = this._buildDerivedState(deltas);
    } finally {
      this._preparingCommit = false;
    }
    const revision = this.revision + 1;
    const changedIds = Object.freeze(deltas.map(delta => delta.id));
    const rawChanges = {
      id: `change:${revision}:${++this._changeSequence}`,
      revision,
      origin: state.options.origin,
      scope: state.options.scope ?? 'document',
      history: state.options.history ?? (state.options.origin === 'user' ? 'record' : 'ignore'),
      ...(state.options.label === undefined ? {} : { label: state.options.label }),
      ...(state.options.actorId === undefined ? {} : { actorId: state.options.actorId }),
      deltas: Object.freeze(deltas),
      changedIds,
      timestamp: Date.now(),
    } satisfies StoreChangeSet;
    const changes = deepFreeze(rawChanges) as StoreChangeSet;

    preactBatch(() => {
      this._applyDerivedState(derived);
      for (const delta of deltas) {
        if (changes.scope === 'ephemeral') {
          if (delta.after === null) this._ephemeralIds.delete(delta.id);
          else if (delta.before === null || this._ephemeralIds.has(delta.id)) {
            this._ephemeralIds.add(delta.id);
          }
        } else {
          this._ephemeralIds.delete(delta.id);
        }
        const writable = this._ensureSignal(delta.id);
        writable.value = delta.after;
      }
      this._versionSignal.value = revision;
    });

    // Observers run outside the transaction and may start subsequent commands.
    this._activeTransaction = null;
    for (const listener of this._listeners) {
      try {
        listener(changes);
      } catch (error) {
        // Observers cannot invalidate an already-published commit.
        if (typeof reportError === 'function') reportError(error);
        else console.error('GlideStore change listener failed', error);
      }
    }
    return changes;
  }

  private _candidateValues(): StoreRecord[] {
    const result: StoreRecord[] = [];
    const seen = new Set<string>();
    for (const [id, recordSignal] of this._signals) {
      const record = this._activeTransaction?.overlay.has(id)
        ? this._activeTransaction.overlay.get(id)
        : recordSignal.peek();
      if (record) result.push(record);
      seen.add(id);
    }
    if (this._activeTransaction) {
      for (const [id, record] of this._activeTransaction.overlay) {
        if (!seen.has(id) && record) result.push(record);
      }
    }
    return result;
  }

  private _ensureSignal(id: string): Signal<StoreRecord | null> {
    let writable = this._signals.get(id);
    if (!writable) {
      writable = signal<StoreRecord | null>(null);
      this._signals.set(id, writable);
      this._readonlySignals.set(id, computed(() => writable!.value));
    }
    return writable;
  }

  private _buildDerivedState(deltas: readonly RecordDelta[]): DerivedState {
    const treeRemovals: RBushEntry[] = [];
    const treeInsertions: RBushEntry[] = [];
    const bindingsByFrom = new Map<ShapeId, Set<BindingId>>();
    const bindingsByTo = new Map<ShapeId, Set<BindingId>>();
    const shapesByPage = new Map<PageId, Set<ShapeId>>();
    let shapeIds: ShapeId[] | null = null;

    const mutableSet = <K, V>(
      source: Map<K, Set<V>>,
      patches: Map<K, Set<V>>,
      key: K,
    ): Set<V> => {
      let value = patches.get(key);
      if (!value) {
        value = new Set(source.get(key));
        patches.set(key, value);
      }
      return value;
    };

    const mutableShapeIds = (): ShapeId[] => {
      if (!shapeIds) shapeIds = [...this._shapeIdsSignal.peek()];
      return shapeIds;
    };

    for (const delta of deltas) {
      const { id, before, after } = delta;
      const beforeIsShape = before !== null && this.schema.isRenderableShape(before as AnyRecord);
      const afterIsShape = after !== null && this.schema.isRenderableShape(after as AnyRecord);
      if (before) {
        if (this.schema.isBindingRecord(before as AnyRecord)
          && this.schema.hasRuntimeCapability(before as AnyRecord)) {
          const fromId = before['fromId'] as ShapeId;
          const toId = before['toId'] as ShapeId;
          mutableSet(this._bindingsByFrom, bindingsByFrom, fromId).delete(id as BindingId);
          mutableSet(this._bindingsByTo, bindingsByTo, toId).delete(id as BindingId);
        } else if (beforeIsShape) {
          const oldEntry = this._treeEntries.get(id);
          if (oldEntry) treeRemovals.push(oldEntry);
          const pageId = before['pageId'] as PageId | undefined;
          if (pageId) mutableSet(this._shapesByPage, shapesByPage, pageId).delete(id as ShapeId);
          if (!afterIsShape) {
            const ids = mutableShapeIds();
            const index = ids.indexOf(id as ShapeId);
            if (index >= 0) ids.splice(index, 1);
          }
        }
      }

      if (!after) continue;
      if (this.schema.isBindingRecord(after as AnyRecord)
        && this.schema.hasRuntimeCapability(after as AnyRecord)) {
        const fromId = after['fromId'] as ShapeId;
        const toId = after['toId'] as ShapeId;
        mutableSet(this._bindingsByFrom, bindingsByFrom, fromId).add(id as BindingId);
        mutableSet(this._bindingsByTo, bindingsByTo, toId).add(id as BindingId);
        continue;
      }

      if (!afterIsShape) continue;

      if (!beforeIsShape) {
        mutableShapeIds().push(id as ShapeId);
      }
      const pageId = after['pageId'] as PageId | undefined;
      if (pageId) mutableSet(this._shapesByPage, shapesByPage, pageId).add(id as ShapeId);

      let bounds: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
      if (this.getGeometry) {
        bounds = this.getGeometry(after as AnyRecord)?.getBounds();
      } else {
        const x = after['x'];
        const y = after['y'];
        const w = after['w'];
        const h = after['h'];
        if ([x, y, w, h].every(value => typeof value === 'number')) {
          bounds = { minX: x as number, minY: y as number, maxX: (x as number) + (w as number), maxY: (y as number) + (h as number) };
        }
      }
      if (bounds) {
        if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
          throw new Error(`Shape "${id}" produced non-finite geometry bounds`);
        }
        const entry = { id, ...bounds };
        treeInsertions.push(entry);
      }
    }

    return {
      treeRemovals: Object.freeze(treeRemovals),
      treeInsertions: Object.freeze(treeInsertions),
      bindingsByFrom,
      bindingsByTo,
      shapesByPage,
      shapeIds: shapeIds ? Object.freeze(shapeIds) : null,
    };
  }

  private _applyDerivedState(derived: DerivedState): void {
    for (const entry of derived.treeRemovals) {
      this._tree.remove(entry, (left, right) => left.id === right.id);
      this._treeEntries.delete(entry.id);
    }
    for (const entry of derived.treeInsertions) {
      this._tree.insert(entry);
      this._treeEntries.set(entry.id, entry);
    }
    for (const [id, values] of derived.bindingsByFrom) {
      if (values.size === 0) this._bindingsByFrom.delete(id);
      else this._bindingsByFrom.set(id, values);
    }
    for (const [id, values] of derived.bindingsByTo) {
      if (values.size === 0) this._bindingsByTo.delete(id);
      else this._bindingsByTo.set(id, values);
    }
    for (const [id, values] of derived.shapesByPage) {
      if (values.size === 0) this._shapesByPage.delete(id);
      else this._shapesByPage.set(id, values);
    }
    if (derived.shapeIds) this._shapeIdsSignal.value = derived.shapeIds;
  }

  serialize(): GlideDocument {
    const records = Array.from(this._signals.entries())
      .filter(([id]) => !this._ephemeralIds.has(id))
      .map(([, sig]) => sig.peek())
      .filter((record): record is StoreRecord => record !== null)
      .sort((a, b) => String(a['id']).localeCompare(String(b['id'])))
      .map(record => cloneJsonValue(record) as AnyRecord);
    return cloneJsonValue(this.schema.save(records)) as GlideDocument;
  }

  /**
   * Atomically replace the complete store snapshot after migration and full
   * graph validation. This is deliberately different from import/merge.
   */
  replaceDocument(doc: GlideDocument, options: ReplaceDocumentOptions = {}): LoadReport {
    const detached = cloneJsonValue(doc) as GlideDocument;
    const loaded = this.schema.loadDocument(detached);
    this.transact({ origin: options.origin ?? 'load', label: 'Replace Document', history: 'ignore' }, tx => {
      for (const [id, recordSignal] of this._signals) {
        if (recordSignal.peek()) tx.remove(id);
      }
      for (const record of loaded.records) tx.upsert(record);
    });
    return loaded.report;
  }

  /** @deprecated Use replaceDocument() for hydration or importRecords() for merge semantics. */
  deserialize(doc: GlideDocument): void {
    this.replaceDocument(doc);
  }

  importRecords(
    payload: GlideDocument | readonly AnyRecord[],
    options: ImportOptions = {},
  ): ImportReport {
    const source = Array.isArray(payload)
      ? payload.map(record => this.schema.prepareRecord(cloneJsonValue(record) as AnyRecord))
      : this.schema.loadDocument(cloneJsonValue(payload) as GlideDocument).records;
    const idPolicy = options.idPolicy ?? 'remap';
    const relationshipPolicy = options.relationshipPolicy ?? 'detach-external';
    const sourceIds = new Set<string>();
    for (const record of source) {
      this.schema.validateRecord(record);
      const id = record['id'] as string;
      if (sourceIds.has(id)) throw new DocumentValidationError(`duplicate imported record id "${id}"`);
      sourceIds.add(id);
    }

    const reserved = new Set<string>([
      ...Array.from(this._signals.entries())
        .filter(([, recordSignal]) => recordSignal.peek() !== null)
        .map(([id]) => id),
    ]);
    const idMap: Record<string, string> = {};
    let sequence = 1;
    for (const oldId of sourceIds) {
      if (idPolicy === 'reject') {
        if (reserved.has(oldId)) throw new DocumentValidationError(`import id "${oldId}" already exists`);
        idMap[oldId] = oldId;
        reserved.add(oldId);
        continue;
      }
      const stem = `${oldId}:import`;
      let nextId: string;
      do nextId = `${stem}:${sequence++}`; while (reserved.has(nextId));
      idMap[oldId] = nextId;
      reserved.add(nextId);
    }

    const warnings: string[] = [];
    const referenceFields = ['parentId', 'pageId', 'assetId', 'fromId', 'toId'] as const;
    const imported = source.map(record => {
      const next = cloneJsonValue(record) as AnyRecord;
      next['id'] = idMap[record['id'] as string];
      for (const field of referenceFields) {
        const reference = next[field];
        if (typeof reference !== 'string') continue;
        if (idMap[reference]) {
          next[field] = idMap[reference];
          continue;
        }
        if (relationshipPolicy === 'preserve') continue;
        if (field === 'fromId' || field === 'toId') {
          throw new DocumentValidationError(`cannot detach external binding ${field} "${reference}"`, String(record['id']));
        }
        delete next[field];
        warnings.push(`Detached ${field} "${reference}" from imported record "${String(record['id'])}".`);
      }
      for (const descriptor of this.schema.getReferenceDescriptors(record)) {
        const reference = readRecordPointer(next, descriptor.path);
        if (typeof reference !== 'string') continue;
        if (idMap[reference]) {
          writeRecordPointer(next, descriptor.path, idMap[reference]);
          continue;
        }
        if (relationshipPolicy === 'preserve') continue;
        writeRecordPointer(
          next,
          descriptor.path,
          null,
          descriptor.onDetach !== 'null',
        );
        warnings.push(`Detached ${descriptor.path} "${reference}" from imported record "${String(record['id'])}".`);
      }
      return next;
    });

    this.transact({ origin: 'user', label: options.label ?? 'Import Records', history: 'record' }, tx => {
      for (const record of imported) tx.insert(record);
    });

    return Object.freeze({
      importedRecordCount: imported.length,
      idMap: Object.freeze({ ...idMap }),
      warnings: Object.freeze(warnings),
    });
  }
}
