/** Selective, per-user undo/redo backed by atomic store change sets. */

import type {
  GlideStore,
  JsonPointer,
  RecordDelta,
  StoreChangeSet,
  StoreRecord,
  StoreCommitPreparation,
  StoreTransaction,
  TransactionScope,
} from './store';
import type { AnyRecord, DeepReadonly } from './types';
import type { MutationCapability } from './mutation-policy';
import { MutationPermissionError } from './mutation-policy';

const MAX_STACK = 100;
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;

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

export interface HistoryDelta {
  readonly id: string;
  readonly before: StoreRecord | null;
  readonly after: StoreRecord | null;
  readonly changedPaths: readonly JsonPointer[];
}

export interface FieldPrecondition {
  readonly id: string;
  readonly path: JsonPointer;
  readonly exists: boolean;
  readonly expected: unknown;
  /** Used for whole-record create/delete/restore to detect ID reuse. */
  readonly generation?: number;
}

export interface HistoryEntry {
  readonly id: string;
  readonly label: string;
  readonly commandId?: string;
  readonly before: ReadonlyMap<string, DeepReadonly<AnyRecord> | null>;
  readonly after: ReadonlyMap<string, DeepReadonly<AnyRecord> | null>;
  readonly forward: readonly HistoryDelta[];
  readonly inverse: readonly HistoryDelta[];
  /** Conditions for applying this entry in the stack where it currently lives. */
  readonly preconditions: readonly FieldPrecondition[];
  readonly byteSize: number;
}

export interface HistoryConflict {
  readonly id: string;
  readonly path: JsonPointer;
  readonly reason: 'value-changed' | 'record-created' | 'record-deleted' | 'generation-changed';
}

export class HistoryConflictError extends Error {
  readonly code = 'history-conflict';

  constructor(readonly conflicts: readonly HistoryConflict[]) {
    super(`Cannot apply history entry because ${conflicts.length} field${conflicts.length === 1 ? '' : 's'} changed`);
    this.name = 'HistoryConflictError';
  }
}

export type HistoryResult =
  | { readonly status: 'applied'; readonly entry: HistoryEntry }
  | { readonly status: 'empty' }
  | { readonly status: 'conflict'; readonly entry: HistoryEntry; readonly error: HistoryConflictError };

export interface BatchOptions {
  history?: 'ignore';
  scope?: TransactionScope;
  commandId?: string;
}

export function commandIdFromLabel(label: string, prefix = 'command'): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  return `${prefix}.${slug || 'unnamed'}`;
}

interface PendingTransition {
  readonly kind: 'undo' | 'redo';
  readonly entry: HistoryEntry;
}

export interface InteractionPreviewAdapter {
  readonly active: boolean;
  readonly kind: 'document' | 'ephemeral' | null;
  begin(): void;
  runPreview<T>(fn: () => T): T;
  runEphemeral<T>(fn: () => T): T;
  commit(label: string, commandId: string): void;
  cancel(): void;
}

type MutableHistoryMember =
  | 'batch'
  | 'undo'
  | 'redo'
  | 'clear'
  | 'attachInteractionAdapter'
  | 'beginPreview'
  | 'recordPreview'
  | 'cancelPreview';

export type ReadonlyHistoryManager = Omit<HistoryManager, MutableHistoryMember>;

const BLOCKED_PUBLIC_HISTORY_MEMBERS = new Set<PropertyKey>([
  'batch',
  'undo',
  'redo',
  'clear',
  'attachInteractionAdapter',
  'beginPreview',
  'recordPreview',
  'cancelPreview',
]);

export function createReadonlyHistoryView(history: HistoryManager): ReadonlyHistoryManager {
  return new Proxy(history, {
    get(target, property) {
      if (BLOCKED_PUBLIC_HISTORY_MEMBERS.has(property)) {
        return () => {
          throw new MutationPermissionError(Object.freeze({
            origin: 'local-api',
            command: `history.${String(property)}`,
            affectedIds: Object.freeze([]),
          }));
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ReadonlyHistoryManager;
}

interface PointerValue {
  readonly exists: boolean;
  readonly value: unknown;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function immutableValue<T>(value: T): T {
  const clone = cloneJson(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== 'object' || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(clone);
  return clone;
}

function recordsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function escapePointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerSegments(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON pointer "${pointer}"`);
  return pointer.slice(1).split('/').map(segment => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function readPointer(record: StoreRecord | AnyRecord | null | undefined, pointer: JsonPointer): PointerValue {
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

function writePointer(record: AnyRecord, pointer: JsonPointer, source: PointerValue): void {
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
  if (recordsEqual(before, after)) return [];
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

function historyDelta(delta: Pick<RecordDelta, 'id' | 'before' | 'after' | 'changedPaths'>): HistoryDelta {
  return Object.freeze({
    id: delta.id,
    before: delta.before,
    after: delta.after,
    changedPaths: Object.freeze([...delta.changedPaths]),
  });
}

function inverseDelta(delta: HistoryDelta): HistoryDelta {
  return Object.freeze({
    id: delta.id,
    before: delta.after,
    after: delta.before,
    changedPaths: delta.changedPaths,
  });
}

function makePreconditions(
  deltas: readonly HistoryDelta[],
  side: 'before' | 'after',
  generations: ReadonlyMap<string, number>,
): readonly FieldPrecondition[] {
  return Object.freeze(deltas.flatMap(delta => {
    const snapshot = delta[side];
    return delta.changedPaths.map(path => {
      const expected = readPointer(snapshot, path);
      return Object.freeze({
        id: delta.id,
        path,
        exists: expected.exists,
        expected: immutableValue(expected.value),
        ...(path === '' ? { generation: generations.get(delta.id) ?? 0 } : {}),
      });
    });
  }));
}

function entryBytes(entry: Omit<HistoryEntry, 'byteSize'>): number {
  return new TextEncoder().encode(JSON.stringify({
    id: entry.id,
    label: entry.label,
    commandId: entry.commandId,
    forward: entry.forward,
    preconditions: entry.preconditions,
  })).byteLength;
}

function makeEntry(
  id: string,
  label: string,
  commandId: string | undefined,
  forward: readonly HistoryDelta[],
  preconditions: readonly FieldPrecondition[],
): HistoryEntry {
  const inverse = Object.freeze(forward.map(inverseDelta));
  const base = {
    id,
    label,
    ...(commandId === undefined ? {} : { commandId }),
    before: new ImmutableMap(forward.map(delta => [delta.id, delta.before] as const)),
    after: new ImmutableMap(forward.map(delta => [delta.id, delta.after] as const)),
    forward: Object.freeze([...forward]),
    inverse,
    preconditions,
  };
  return Object.freeze({ ...base, byteSize: entryBytes(base) });
}

function entryFromChanges(changes: StoreChangeSet): HistoryEntry {
  const forward = Object.freeze(changes.deltas.map(historyDelta));
  const generations = new Map(changes.deltas.map(delta => [delta.id, delta.afterGeneration]));
  return makeEntry(
    changes.id,
    changes.label ?? 'Store Change',
    changes.commandId,
    forward,
    makePreconditions(forward, 'after', generations),
  );
}

function refreshEntry(
  entry: HistoryEntry,
  currentSide: 'before' | 'after',
  changes: StoreChangeSet,
): HistoryEntry {
  const generations = new Map(changes.deltas.map(delta => [delta.id, delta.afterGeneration]));
  return makeEntry(
    entry.id,
    entry.label,
    entry.commandId,
    entry.forward,
    makePreconditions(entry.forward, currentSide, generations),
  );
}

/**
 * A later local undo/redo may legitimately delete and restore an ID that is
 * also mentioned by an older entry. Carry the new incarnation generation
 * backward only when the resulting whole record exactly matches that older
 * entry's expected value. Remote commits never use this path.
 */
function synchronizeEntryGenerations(entry: HistoryEntry, changes: StoreChangeSet): HistoryEntry {
  const resulting = new Map(changes.deltas.map(delta => [delta.id, delta]));
  let changed = false;
  const preconditions = entry.preconditions.map(condition => {
    if (condition.path !== '' || condition.generation === undefined) return condition;
    const delta = resulting.get(condition.id);
    if (!delta) return condition;
    const exists = delta.after !== null;
    if (exists !== condition.exists
      || (exists && !recordsEqual(condition.expected, delta.after))) return condition;
    if (condition.generation === delta.afterGeneration) return condition;
    changed = true;
    return Object.freeze({ ...condition, generation: delta.afterGeneration });
  });
  return changed
    ? makeEntry(entry.id, entry.label, entry.commandId, entry.forward, Object.freeze(preconditions))
    : entry;
}

function checkPreconditions(
  store: GlideStore,
  tx: StoreTransaction,
  preconditions: readonly FieldPrecondition[],
): readonly HistoryConflict[] {
  const conflicts: HistoryConflict[] = [];
  for (const condition of preconditions) {
    const currentRecord = tx.get(condition.id);
    const current = readPointer(currentRecord, condition.path);
    let reason: HistoryConflict['reason'] | null = null;
    if (condition.exists !== current.exists) {
      reason = condition.path === ''
        ? (condition.exists ? 'record-deleted' : 'record-created')
        : 'value-changed';
    } else if (condition.exists && !recordsEqual(condition.expected, current.value)) {
      reason = 'value-changed';
    } else if (condition.generation !== undefined
      && store.getRecordGeneration(condition.id) !== condition.generation) {
      reason = 'generation-changed';
    }
    if (reason) conflicts.push(Object.freeze({ id: condition.id, path: condition.path, reason }));
  }
  return Object.freeze(conflicts);
}

function applyDeltas(tx: StoreTransaction, deltas: readonly HistoryDelta[]): void {
  for (const delta of deltas) {
    if (delta.changedPaths.includes('')) {
      if (delta.after === null) tx.remove(delta.id);
      else tx.upsert(delta.after as AnyRecord);
      continue;
    }
    const current = tx.get(delta.id);
    if (!current || !delta.after) {
      throw new HistoryConflictError(Object.freeze([{
        id: delta.id,
        path: '',
        reason: current ? 'record-created' : 'record-deleted',
      }]));
    }
    const next = cloneJson(current) as AnyRecord;
    for (const path of delta.changedPaths) {
      writePointer(next, path, readPointer(delta.after, path));
    }
    tx.update(delta.id, () => next);
  }
}

function stackBytes(stack: readonly HistoryEntry[]): number {
  return stack.reduce((sum, entry) => sum + entry.byteSize, 0);
}

function appendBounded(stack: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  if (entry.byteSize > MAX_HISTORY_BYTES) return [];
  const next = [...stack, entry];
  while (next.length > MAX_STACK || stackBytes(next) > MAX_HISTORY_BYTES) next.shift();
  return next;
}

export class HistoryManager {
  private _undo: HistoryEntry[] = [];
  private _redo: HistoryEntry[] = [];
  private _previewBefore: Map<string, DeepReadonly<AnyRecord> | null> | null = null;
  private _pending: PendingTransition | null = null;
  private _interaction: InteractionPreviewAdapter | null = null;

  constructor(
    private _store: GlideStore,
    private _localMutationCapability?: MutationCapability,
  ) {
    this._store.participateInCommits(changes => this._prepareCommit(changes));
    // Compatibility capture for tools not yet migrated to InteractionManager.
    this._store.listen(changes => {
      if (
        this._previewBefore
        && changes.history === 'ignore'
        && changes.scope === 'document'
        && changes.origin === 'user'
      ) {
        for (const delta of changes.deltas) {
          if (!this._previewBefore.has(delta.id)) this._previewBefore.set(delta.id, delta.before);
        }
      }
    });
  }

  batch(label: string, fn: () => void, opts?: BatchOptions): void {
    if (opts?.scope === 'ephemeral' && this._interaction) {
      this._interaction.runEphemeral(fn);
      return;
    }
    if (this._previewBefore && opts?.history === 'ignore' && this._interaction?.active) {
      this._interaction.runPreview(fn);
      return;
    }
    this._store.transact({
      origin: 'user',
      label,
      commandId: opts?.commandId ?? commandIdFromLabel(label),
      history: opts?.history === 'ignore' ? 'ignore' : 'record',
      scope: opts?.scope ?? 'document',
    }, () => fn(), this._localMutationCapability);
  }

  attachInteractionAdapter(adapter: InteractionPreviewAdapter): void {
    this._interaction = adapter;
  }

  beginPreview(): void {
    this._previewBefore = new Map();
    this._interaction?.begin();
  }

  cancelPreview(): void {
    this._previewBefore = null;
    this._interaction?.cancel();
  }

  /** @deprecated Interaction previews should use InteractionManager. */
  recordPreview(label: string, before: ReadonlyMap<string, AnyRecord | null>): void {
    if (this._interaction?.active && this._interaction.kind === 'document') {
      this._previewBefore = null;
      const commandId = commandIdFromLabel(label, 'interaction');
      this._interaction.commit(label, commandId);
      return;
    }
    const allBefore = new Map<string, DeepReadonly<AnyRecord> | null>(this._previewBefore ?? []);
    this._previewBefore = null;
    for (const [id, value] of before) allBefore.set(id, immutableValue(value));

    const forward: HistoryDelta[] = [];
    const generations = new Map<string, number>();
    for (const [id, beforeValue] of allBefore) {
      const afterValue = this._store.get(id) ?? null;
      if (recordsEqual(beforeValue, afterValue)) continue;
      forward.push(Object.freeze({
        id,
        before: beforeValue,
        after: afterValue,
        changedPaths: Object.freeze(beforeValue === null || afterValue === null
          ? ['']
          : collectChangedPaths(beforeValue, afterValue)),
      }));
      generations.set(id, this._store.getRecordGeneration(id));
    }
    if (forward.length === 0) return;
    const frozenForward = Object.freeze(forward);
    const entry = makeEntry(
      `preview:${Date.now()}`,
      label,
      undefined,
      frozenForward,
      makePreconditions(frozenForward, 'after', generations),
    );
    this._undo = appendBounded(this._undo, entry);
    this._redo = [];
  }

  undo(): HistoryResult {
    return this._apply('undo');
  }

  redo(): HistoryResult {
    return this._apply('redo');
  }

  get undoStack(): readonly HistoryEntry[] { return Object.freeze([...this._undo]); }
  get redoStack(): readonly HistoryEntry[] { return Object.freeze([...this._redo]); }
  get canUndo(): boolean { return this._undo.length > 0; }
  get canRedo(): boolean { return this._redo.length > 0; }
  get undoBytes(): number { return stackBytes(this._undo); }
  get redoBytes(): number { return stackBytes(this._redo); }

  clear(): void {
    this._undo = [];
    this._redo = [];
    this._previewBefore = null;
    this._pending = null;
    this._interaction?.cancel();
  }

  private _apply(kind: 'undo' | 'redo'): HistoryResult {
    const source = kind === 'undo' ? this._undo : this._redo;
    const entry = source[source.length - 1];
    if (!entry) return Object.freeze({ status: 'empty' });

    this._pending = { kind, entry };
    try {
      this._store.transact({
        origin: kind,
        label: entry.label,
        commandId: entry.commandId as string,
        history: 'ignore',
      }, tx => {
        const conflicts = checkPreconditions(this._store, tx, entry.preconditions);
        if (conflicts.length > 0) throw new HistoryConflictError(conflicts);
        applyDeltas(tx, kind === 'undo' ? entry.inverse : entry.forward);
      }, this._localMutationCapability);
      return Object.freeze({ status: 'applied', entry });
    } catch (error) {
      this._pending = null;
      if (error instanceof HistoryConflictError) {
        return Object.freeze({ status: 'conflict', entry, error });
      }
      throw error;
    } finally {
      this._pending = null;
    }
  }

  private _prepareCommit(changes: StoreChangeSet): StoreCommitPreparation | null {
    const pending = this._pending;
    if (pending) {
      if (changes.origin !== pending.kind) {
        throw new Error(`History ${pending.kind} published with unexpected origin "${changes.origin}"`);
      }
      const refreshed = refreshEntry(
        pending.entry,
        pending.kind === 'undo' ? 'before' : 'after',
        changes,
      );
      const rawNextUndo = pending.kind === 'undo'
        ? this._undo.slice(0, -1)
        : appendBounded(this._undo, refreshed);
      const rawNextRedo = pending.kind === 'undo'
        ? appendBounded(this._redo, refreshed)
        : this._redo.slice(0, -1);
      const nextUndo = rawNextUndo.map(entry => synchronizeEntryGenerations(entry, changes));
      const nextRedo = rawNextRedo.map(entry => synchronizeEntryGenerations(entry, changes));
      const previousUndo = this._undo;
      const previousRedo = this._redo;
      return {
        publish: () => {
          this._undo = nextUndo;
          this._redo = nextRedo;
        },
        rollback: () => {
          this._undo = previousUndo;
          this._redo = previousRedo;
        },
      };
    }

    // History is local-user intent. Remote/load/system commits never enter it,
    // even if a caller accidentally marks such a transaction as recordable.
    if (changes.origin !== 'user' || changes.history !== 'record' || changes.scope !== 'document') {
      return null;
    }
    const entry = entryFromChanges(changes);
    const nextUndo = appendBounded(this._undo, entry);
    const previousUndo = this._undo;
    const previousRedo = this._redo;
    return {
      publish: () => {
        this._undo = nextUndo;
        this._redo = [];
      },
      rollback: () => {
        this._undo = previousUndo;
        this._redo = previousRedo;
      },
    };
  }
}
