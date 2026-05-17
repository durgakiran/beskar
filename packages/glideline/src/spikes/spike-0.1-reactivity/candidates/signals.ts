/**
 * Candidate A: @preact/signals
 *
 * Strategy:
 *   - One Signal<GlideRecord> per record ID.
 *   - Subscribers use effect() to track their specific signal.
 *   - batch() wraps all puts in preact's built-in batch() — defers
 *     all effect notifications until the batch completes.
 */

import { signal, effect, batch, Signal } from "@preact/signals";
import type { GlideRecord, Listener, ReactiveStore, RecordId, Unsubscribe } from "./types.js";

export class SignalsStore implements ReactiveStore {
  private signals = new Map<RecordId, Signal<GlideRecord | undefined>>();

  get size() {
    return this.signals.size;
  }

  private getOrCreate(id: RecordId): Signal<GlideRecord | undefined> {
    let s = this.signals.get(id);
    if (!s) {
      s = signal<GlideRecord | undefined>(undefined);
      this.signals.set(id, s);
    }
    return s;
  }

  put(records: GlideRecord[]): void {
    for (const r of records) {
      this.getOrCreate(r.id).value = r;
    }
  }

  get(id: RecordId): GlideRecord | undefined {
    return this.signals.get(id)?.value;
  }

  subscribe(id: RecordId, listener: Listener<GlideRecord>): Unsubscribe {
    const s = this.getOrCreate(id);
    // effect() runs immediately then re-runs when s.value changes.
    // We skip the first (immediate) run since we want change-only notification.
    let initialized = false;
    const dispose = effect(() => {
      const val = s.value;
      if (!initialized) { initialized = true; return; }
      if (val !== undefined) listener(val);
    });
    return dispose;
  }

  batch(fn: () => void): void {
    batch(fn);
  }
}
