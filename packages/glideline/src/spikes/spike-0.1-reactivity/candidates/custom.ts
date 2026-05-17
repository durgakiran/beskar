/**
 * Candidate B: Custom atom map (zero dependencies)
 *
 * Strategy:
 *   - Map<id, record> for storage.
 *   - Map<id, Set<listener>> for subscriptions.
 *   - put() in normal mode: notify immediately after each write.
 *   - batch(): collect dirty IDs during fn, notify each subscriber ONCE after.
 *
 * This is the "control" candidate — minimal overhead, exact semantics.
 */

import type { GlideRecord, Listener, ReactiveStore, RecordId, Unsubscribe } from "../types.js";

export class CustomStore implements ReactiveStore {
  private records = new Map<RecordId, GlideRecord>();
  private listeners = new Map<RecordId, Set<Listener<GlideRecord>>>();
  private batching = false;
  private dirtyIds = new Set<RecordId>();

  get size() {
    return this.records.size;
  }

  put(records: GlideRecord[]): void {
    for (const r of records) {
      this.records.set(r.id, r);
      if (this.batching) {
        this.dirtyIds.add(r.id);
      } else {
        this.notify(r.id);
      }
    }
  }

  get(id: RecordId): GlideRecord | undefined {
    return this.records.get(id);
  }

  subscribe(id: RecordId, listener: Listener<GlideRecord>): Unsubscribe {
    let set = this.listeners.get(id);
    if (!set) {
      set = new Set();
      this.listeners.set(id, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  batch(fn: () => void): void {
    this.batching = true;
    this.dirtyIds.clear();
    try {
      fn();
    } finally {
      this.batching = false;
      for (const id of this.dirtyIds) {
        this.notify(id);
      }
      this.dirtyIds.clear();
    }
  }

  private notify(id: RecordId): void {
    const record = this.records.get(id);
    if (!record) return;
    const set = this.listeners.get(id);
    if (!set) return;
    for (const listener of set) {
      listener(record);
    }
  }
}
