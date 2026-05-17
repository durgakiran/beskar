/**
 * Candidate C: Jotai
 *
 * Strategy:
 *   - One PrimitiveAtom<GlideRecord> per record ID.
 *   - Jotai's vanilla store (createStore) for node-compatible usage (no React).
 *   - store.sub(atom, listener) for subscriptions.
 *
 * Key weakness to test: Jotai has NO built-in batch() API in its vanilla store.
 * We simulate it by collecting dirty atoms, running all puts, then flushing —
 * but because jotai notifies synchronously on each set(), listeners will fire
 * N times during a batch of N puts. This is the expected failure case.
 */

import { createStore, atom } from "jotai/vanilla";
import type { Atom, PrimitiveAtom } from "jotai/vanilla";
import type { GlideRecord, Listener, ReactiveStore, RecordId, Unsubscribe } from "../types.js";

export class JotaiStore implements ReactiveStore {
  private store = createStore();
  private atoms = new Map<RecordId, PrimitiveAtom<GlideRecord | undefined>>();

  get size() {
    return this.atoms.size;
  }

  private getOrCreate(id: RecordId): PrimitiveAtom<GlideRecord | undefined> {
    let a = this.atoms.get(id);
    if (!a) {
      a = atom<GlideRecord | undefined>(undefined);
      this.atoms.set(id, a);
    }
    return a;
  }

  put(records: GlideRecord[]): void {
    for (const r of records) {
      const a = this.getOrCreate(r.id);
      this.store.set(a, r);
      // NOTE: jotai vanilla store.set() notifies subscribers synchronously.
      // Each call fires. No batching possible with vanilla store API.
    }
  }

  get(id: RecordId): GlideRecord | undefined {
    const a = this.atoms.get(id);
    return a ? this.store.get(a) : undefined;
  }

  subscribe(id: RecordId, listener: Listener<GlideRecord>): Unsubscribe {
    const a = this.getOrCreate(id);
    return this.store.sub(a, () => {
      const val = this.store.get(a);
      if (val !== undefined) listener(val);
    });
  }

  /**
   * Jotai vanilla has no batch API.
   * This is a "best effort" shim — it does NOT prevent per-put notifications.
   * The benchmark will reveal this as a failure in the batch fire-once test.
   */
  batch(fn: () => void): void {
    // No real batch support — just call fn directly.
    fn();
  }
}
