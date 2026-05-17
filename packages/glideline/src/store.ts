/**
 * Glideline — GlideStore (Phase 1)
 *
 * Reactive in-memory database. Single source of truth for all canvas records.
 *
 * Key invariants:
 *  - Every put() is atomic: all records written or none (rollback on throw)
 *  - Per-record @preact/signals signals: only the changed shape re-renders
 *  - Secondary indices (bindingsByFrom, bindingsByTo, shapesByPage) avoid O(N) scans
 *  - RBush spatial index updated on every shape create/update/delete
 *  - Unknown record types are preserved as opaque blobs (never dropped, never crash)
 */

import { signal, batch as preactBatch, type Signal } from '@preact/signals';
import RBush from 'rbush';
import type {
  ShapeId, BindingId, PageId,
  GlideShape, GlideBinding, GlideDocument, AnyRecord,
} from './types';
import { isGlideBinding } from './types';
import { GlideSchema } from './schema';

// ─────────────────────────────────────────────────────────────
// RBush entry type
// ─────────────────────────────────────────────────────────────

interface RBushEntry {
  id: string;
  minX: number; minY: number;
  maxX: number; maxY: number;
}

// ─────────────────────────────────────────────────────────────
// GlideStore
// ─────────────────────────────────────────────────────────────

export class GlideStore {
  /** Per-record signals — only the changed record's signal fires. */
  private _signals = new Map<string, Signal<AnyRecord | null>>();

  /** RBush spatial index — shapes only (bindings have no geometry). */
  private _tree = new RBush<RBushEntry>();

  /** Cached RBush entries for fast remove-before-reinsert. */
  private _treeEntries = new Map<string, RBushEntry>();

  /** bindingsByFrom[shapeId] → Set of bindingIds whose fromId = shapeId */
  private _bindingsByFrom = new Map<ShapeId, Set<BindingId>>();

  /** bindingsByTo[shapeId] → Set of bindingIds whose toId = shapeId */
  private _bindingsByTo = new Map<ShapeId, Set<BindingId>>();

  /** shapesByPage[pageId] → Set of shapeIds on that page */
  private _shapesByPage = new Map<PageId, Set<ShapeId>>();

  /**
   * When inside a batch(), tracks { id → pre-write value } for rollback.
   * null = not currently in a batch.
   */
  private _batchChanges: Map<string, AnyRecord | null> | null = null;

  constructor(public readonly schema: GlideSchema = new GlideSchema()) {}

  // ─────────────────────────────────────────────────────────────
  // Public read API
  // ─────────────────────────────────────────────────────────────

  /** Returns the current record, or undefined. Does NOT trigger a signal subscription. */
  get(id: string): AnyRecord | undefined {
    const sig = this._signals.get(id);
    if (!sig) return undefined;
    const val = sig.peek(); // peek() reads without subscribing
    return val ?? undefined;
  }

  /** Returns true if the record exists. Does NOT trigger a signal subscription. */
  has(id: string): boolean {
    const sig = this._signals.get(id);
    if (!sig) return false;
    return sig.peek() !== null;
  }

  /**
   * Returns the Signal for the given id.
   * Subscribers (effects) that read .value will re-run when the record changes.
   */
  getSignal(id: string): Signal<AnyRecord | null> | undefined {
    return this._signals.get(id);
  }

  /** O(1) — uses secondary index. */
  getBindingsFromShape(shapeId: ShapeId): GlideBinding[] {
    const ids = this._bindingsByFrom.get(shapeId);
    if (!ids) return [];
    const result: GlideBinding[] = [];
    for (const bid of ids) {
      const rec = this.get(bid);
      if (rec) result.push(rec as unknown as GlideBinding);
    }
    return result;
  }

  /** O(1) — uses secondary index. */
  getBindingsToShape(shapeId: ShapeId): GlideBinding[] {
    const ids = this._bindingsByTo.get(shapeId);
    if (!ids) return [];
    const result: GlideBinding[] = [];
    for (const bid of ids) {
      const rec = this.get(bid);
      if (rec) result.push(rec as unknown as GlideBinding);
    }
    return result;
  }

  /** Spatial query — O(log N). Returns shapes at the given point. */
  getShapesAtPoint(x: number, y: number): AnyRecord[] {
    const hits = this._tree.search({ minX: x, minY: y, maxX: x, maxY: y });
    return hits.map(h => this.get(h.id)).filter((r): r is AnyRecord => r !== undefined);
  }

  /** Spatial query — O(log N). Returns shapes intersecting the given box. */
  getShapesInBox(minX: number, minY: number, maxX: number, maxY: number): AnyRecord[] {
    const hits = this._tree.search({ minX, minY, maxX, maxY });
    return hits.map(h => this.get(h.id)).filter((r): r is AnyRecord => r !== undefined);
  }

  // ─────────────────────────────────────────────────────────────
  // Public write API
  // ─────────────────────────────────────────────────────────────

  /**
   * Store one or more records.
   *
   * Behavior:
   *  - Validates props for registered shape types (throws before any write)
   *  - If inside a batch(), stages the pre-write snapshot for rollback
   *  - Uses @preact/signals batch() for notification coalescing
   *  - A mid-batch throw will cause batch() to rollback all staged writes
   */
  put(records: AnyRecord[]): void {
    // 1. Validate all records upfront — throws before touching state
    for (const record of records) {
      if (!isGlideBinding(record)) {
        this.schema.validateProps(record as unknown as GlideShape);
      }
    }

    // 2. Snapshot pre-write values for rollback tracking (if in a batch)
    if (this._batchChanges !== null) {
      for (const record of records) {
        const id = record['id'] as string;
        if (!this._batchChanges.has(id)) {
          // Only track the FIRST (original) value per id in this batch
          this._batchChanges.set(id, this.get(id) ?? null);
        }
      }
    }

    // 3. Apply all writes atomically (defers signal notifications)
    preactBatch(() => {
      for (const record of records) {
        this._writeRecord(record);
      }
    });
  }

  /**
   * Remove one or more records by ID.
   * Deletes the signal, removes from RBush, and cleans up secondary indices.
   * Does NOT fire the record's signal (old subscribers are simply orphaned).
   */
  remove(ids: string[]): void {
    // Snapshot for rollback if inside a batch
    if (this._batchChanges !== null) {
      for (const id of ids) {
        if (!this._batchChanges.has(id)) {
          this._batchChanges.set(id, this.get(id) ?? null);
        }
      }
    }

    preactBatch(() => {
      for (const id of ids) {
        this._deleteRecord(id);
      }
    });
  }

  /**
   * Wrap mutations in a transactional batch.
   *
   * - All signal notifications are deferred until the end of the batch
   * - If fn() throws, ALL writes performed inside fn() are rolled back
   * - Subscriber sees zero notifications if fn() throws
   */
  batch(fn: () => void): void {
    const isRoot = this._batchChanges === null;
    if (isRoot) this._batchChanges = new Map();

    let threw = false;
    let error: unknown;

    // Use preact batch to coalesce notifications for the entire fn()
    preactBatch(() => {
      try {
        fn();
      } catch (e) {
        threw = true;
        error = e;
      }
    });

    if (threw && isRoot) {
      // Rollback: restore all pre-write values recorded in _batchChanges
      const changes = this._batchChanges!;
      this._batchChanges = null;

      preactBatch(() => {
        for (const [id, oldValue] of changes) {
          if (oldValue === null) {
            // Record did not exist before — remove it
            this._deleteRecord(id);
          } else {
            // Restore old value
            this._writeRecord(oldValue);
          }
        }
      });

      throw error;
    }

    if (isRoot) this._batchChanges = null;
    if (threw) throw error;
  }

  // ─────────────────────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────────────────────

  /** Serialise the store to a GlideDocument envelope. */
  serialize(): GlideDocument {
    const records: AnyRecord[] = [];
    for (const sig of this._signals.values()) {
      const val = sig.peek();
      if (val !== null) records.push(val);
    }
    return this.schema.save(records);
  }

  /** Load a GlideDocument into the store, running migrations as needed. */
  deserialize(doc: GlideDocument): void {
    const migrated = this.schema.load(doc);
    this.put(migrated);
  }

  // ─────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────

  private _writeRecord(record: AnyRecord): void {
    const id = record['id'] as string;

    // Upsert signal
    let sig = this._signals.get(id);
    if (!sig) {
      sig = signal<AnyRecord | null>(null);
      this._signals.set(id, sig);
    }
    sig.value = record;

    // Update spatial index (shapes only — must have x, y, w, h)
    if (!isGlideBinding(record)) {
      const x = record['x'] as number | undefined;
      const y = record['y'] as number | undefined;
      const w = record['w'] as number | undefined;
      const h = record['h'] as number | undefined;

      if (typeof x === 'number' && typeof y === 'number' &&
          typeof w === 'number' && typeof h === 'number') {
        // Remove old entry first
        const old = this._treeEntries.get(id);
        if (old) this._tree.remove(old, (a, b) => a.id === b.id);

        const entry: RBushEntry = { id, minX: x, minY: y, maxX: x + w, maxY: y + h };
        this._treeEntries.set(id, entry);
        this._tree.insert(entry);
      }

      // shapesByPage index
      const pageId = record['pageId'] as PageId | undefined;
      if (pageId) {
        if (!this._shapesByPage.has(pageId)) this._shapesByPage.set(pageId, new Set());
        this._shapesByPage.get(pageId)!.add(id as ShapeId);
      }
    } else {
      // Binding — update secondary indices
      const fromId = record['fromId'] as ShapeId;
      const toId   = record['toId']   as ShapeId;
      const bindId = id as BindingId;

      if (!this._bindingsByFrom.has(fromId)) this._bindingsByFrom.set(fromId, new Set());
      this._bindingsByFrom.get(fromId)!.add(bindId);

      if (!this._bindingsByTo.has(toId)) this._bindingsByTo.set(toId, new Set());
      this._bindingsByTo.get(toId)!.add(bindId);
    }
  }

  private _deleteRecord(id: string): void {
    const sig = this._signals.get(id);
    if (!sig) return;

    const record = sig.peek();

    // Remove from spatial index
    const entry = this._treeEntries.get(id);
    if (entry) {
      this._tree.remove(entry, (a, b) => a.id === b.id);
      this._treeEntries.delete(id);
    }

    // Remove from binding indices
    if (record && isGlideBinding(record)) {
      const fromId = record['fromId'] as ShapeId;
      const toId   = record['toId']   as ShapeId;
      this._bindingsByFrom.get(fromId)?.delete(id as BindingId);
      this._bindingsByTo.get(toId)?.delete(id as BindingId);
    }

    // Remove from shapesByPage
    const pageId = record?.['pageId'] as PageId | undefined;
    if (pageId) this._shapesByPage.get(pageId)?.delete(id as ShapeId);

    // Remove the signal entirely (does not fire it)
    this._signals.delete(id);
    this._treeEntries.delete(id);
  }
}
