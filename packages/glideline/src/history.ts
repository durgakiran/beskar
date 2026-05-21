/**
 * Glideline — HistoryManager (Phase 3, Story 3.4)
 *
 * Per-user undo/redo with batch() grouping and { history: 'ignore' }
 * for AI/remote mutations.
 *
 * Intercepts store.put() and store.remove() during batch() to record
 * before/after diffs. undo() applies the before diff; redo() re-applies
 * the after diff. Stack is capped at MAX_STACK entries.
 */

import type { GlideStore } from './store';
import type { AnyRecord } from './types';

const MAX_STACK = 100;

export interface HistoryEntry {
  label: string;
  before: Map<string, AnyRecord | null>; // id → pre-value  (null = didn't exist)
  after:  Map<string, AnyRecord | null>; // id → post-value (null = deleted)
}

export interface BatchOptions {
  history?: 'ignore';
}

export class HistoryManager {
  private _undo: HistoryEntry[] = [];
  private _redo: HistoryEntry[] = [];
  private _applying = false; // true while undo/redo is applying — prevents re-recording

  constructor(private _store: GlideStore) {}

  // ── Public API ──────────────────────────────────────────────

  /**
   * Group all store mutations performed inside `fn` into a single undo entry.
   * Pass `{ history: 'ignore' }` to apply mutations without recording —
   * used for remote Yjs changes and AI/MCP actions.
   */
  batch(label: string, fn: () => void, opts?: BatchOptions): void {
    if (opts?.history === 'ignore' || this._applying) {
      fn();
      return;
    }

    const before = new Map<string, AnyRecord | null>();
    const after  = new Map<string, AnyRecord | null>();

    const origPut    = this._store.put.bind(this._store);
    const origRemove = this._store.remove.bind(this._store);

    // Intercept put()
    (this._store as any).put = (records: AnyRecord[]) => {
      for (const r of records) {
        const id = r['id'] as string;
        if (!before.has(id)) before.set(id, this._store.get(id) ?? null);
      }
      origPut(records);
      for (const r of records) {
        const id = r['id'] as string;
        after.set(id, this._store.get(id) ?? null);
      }
    };

    // Intercept remove()
    (this._store as any).remove = (ids: string[]) => {
      for (const id of ids) {
        if (!before.has(id)) before.set(id, this._store.get(id) ?? null);
      }
      origRemove(ids);
      for (const id of ids) {
        after.set(id, null);
      }
    };

    try {
      fn();
    } finally {
      (this._store as any).put    = origPut;
      (this._store as any).remove = origRemove;
    }

    if (before.size > 0) {
      this._push({ label, before, after });
      this._redo = []; // new action clears redo stack
    }
  }

  /** Reverse the most recent recorded action. No-op on empty stack. */
  undo(): void {
    const entry = this._undo.pop();
    if (!entry) return;

    this._applying = true;
    try {
      for (const [id, value] of entry.before) {
        if (value === null) {
          this._store.remove([id]);
        } else {
          this._store.put([value]);
        }
      }
    } finally {
      this._applying = false;
    }

    this._redo.push(entry);
  }

  /** Re-apply the most recently undone action. No-op on empty redo stack. */
  redo(): void {
    const entry = this._redo.pop();
    if (!entry) return;

    this._applying = true;
    try {
      for (const [id, value] of entry.after) {
        if (value === null) {
          this._store.remove([id]);
        } else {
          this._store.put([value]);
        }
      }
    } finally {
      this._applying = false;
    }

    this._undo.push(entry);
  }

  // ── Introspection (tests + UI) ──────────────────────────────

  get undoStack(): readonly HistoryEntry[] { return this._undo; }
  get redoStack(): readonly HistoryEntry[] { return this._redo; }
  get canUndo(): boolean { return this._undo.length > 0; }
  get canRedo(): boolean { return this._redo.length > 0; }

  // ── Private ─────────────────────────────────────────────────

  private _push(entry: HistoryEntry): void {
    if (this._undo.length >= MAX_STACK) {
      this._undo.shift(); // drop oldest when cap reached
    }
    this._undo.push(entry);
  }
}
