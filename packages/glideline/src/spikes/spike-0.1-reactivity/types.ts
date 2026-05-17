/**
 * Spike 0.1 — Shared interface all candidates must implement.
 * Fair comparison requires identical surface area.
 */

export type RecordId = string;

export interface GlideRecord {
  id: RecordId;
  type: string;
  [key: string]: unknown;
}

export type Listener<T> = (record: T) => void;
export type Unsubscribe = () => void;

export interface ReactiveStore {
  /** Write one or more records. */
  put(records: GlideRecord[]): void;

  /** Read a record by ID. */
  get(id: RecordId): GlideRecord | undefined;

  /** Subscribe to changes on a single record. Returns unsubscribe fn. */
  subscribe(id: RecordId, listener: Listener<GlideRecord>): Unsubscribe;

  /**
   * Batch multiple puts — all listeners should fire ONCE per subscriber
   * at the end of the batch, not once per intermediate put.
   */
  batch(fn: () => void): void;

  /** Total number of records stored. */
  size: number;
}
