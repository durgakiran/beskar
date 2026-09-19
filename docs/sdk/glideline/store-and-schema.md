# Store & Schema

**Package:** `@durgakiran/glideline` · **Stability:** 🔴 Unstable (all APIs on this page)

`GlideSchema` defines which record types exist and how they validate/migrate. `GlideStore` is the reactive, transactional record store built on that schema. Most apps drive the store indirectly through `GlideEditor` ([Editor](./editor.md)) rather than touching it directly — this page is for when you need store-level behavior (custom transactions, spatial queries, integrity checks, import/export) that the editor doesn't expose.

## `GlideSchema`

```ts
class GlideSchema {
  registerShapeUtil(util: { type: string; props?: ...; migrations?: GlideMigrations }): void;
  registerBindingUtil(util: { type: string; props?: ...; migrations?: GlideMigrations }): void;
  freeze(): void;
  loadDocument(doc: GlideDocument): LoadedDocument;
  save(records: AnyRecord[]): GlideDocument;
  prepareRecord(record: AnyRecord): AnyRecord;
}
```

- Register every shape/binding type **before** freezing — `createEditor()` does this for you (see [Editor § boot sequence](./editor.md#boot-sequence)); call these directly only if you're assembling a store without `createEditor()`.
- `loadDocument(doc)` runs schema validation and migration over a serialized `GlideDocument`, returning `{ records, report }` (`LoadReport` — lists what was migrated/dropped/rejected).
- `DocumentValidationError` is thrown for a document that fails validation outright (not a migratable shape).
- `CURRENT_STORE_VERSION`, `DEFAULT_DOCUMENT_LIMITS`, `DEFAULT_PAGE_ID`, `DEFAULT_PAGE_INDEX`, `createDefaultPageRecord()` — constants/helpers for the default single-page document shape.

## `GlideStore`

> "Reactive, transactional record store. Writes are staged and fully validated before publication. Committed records are engine-owned, deeply frozen JSON data; record signals are stable for the lifetime of the store and publish null tombstones on deletion." — source doc comment

### Reading records

```ts
store.get(id): StoreRecord | undefined
store.has(id): boolean
store.getSignal(id): ReadonlySignal<StoreRecord | null> | undefined   // undefined until the id has ever existed
store.getShapeIdsSignal(): ReadonlySignal<readonly ShapeId[]>
store.getVersionSignal(): ReadonlySignal<number>                      // bumps on every commit
store.getShapesAtPoint(x, y): AnyRecord[]                             // rbush spatial index + per-shape hit test
store.getShapesInBox(minX, minY, maxX, maxY): AnyRecord[]
store.getBindingsFromShape(shapeId) / getBindingsToShape(shapeId): GlideBinding[]
store.getChildren(parentId): readonly StoreRecord[]
store.getPageIds(): readonly PageId[]
```

`getSignal` is the reactivity hook: subscribe with `effect()` from `@preact/signals` to re-run when one specific record changes, without diffing the whole document. `glideboard`'s React layer is built entirely on this — a shape component subscribes only to its own signal.

### Writing records

```ts
store.put(records: AnyRecord[]): void      // upsert, origin: 'user', tracked in history
store.remove(ids: string[]): void          // origin: 'user', tracked in history
store.batch(fn: () => void): void          // origin: 'system', history: 'ignore' — for derived/internal writes
```

For anything beyond simple upsert/remove, use `store.transact(options, fn, capability?)` directly:

```ts
store.transact(
  { origin: 'user', commandId: 'my-op', affectedIds: [id] },
  (tx) => {
    tx.update(id, (record) => ({ ...record, props: { ...record.props, locked: true } }));
  },
);
```

`TransactionOptions.origin` is a `ChangeOrigin` (`'user' | 'undo' | 'redo' | 'remote' | 'load' | 'system' | 'repair'`) — store-level bookkeeping of *why* a write happened, distinct from the editor-level `MutationOrigin` (`'local-user' | 'local-api' | 'remote' | 'load' | 'system'`) that the [mutation policy](./content-ingress-mutation-and-ai.md#mutation-policy) authorizes against. `history: 'ignore'` is how internal bookkeeping writes avoid polluting undo/redo. A nested `transact()` call while one is already active joins the outer transaction rather than starting a new one (`_runNested`).

`capability` (a `MutationCapability` from `createMutationCapability()`) is how a transaction proves it's authorized to write with a given `origin` — see [Mutation policy](./content-ingress-mutation-and-ai.md#mutation-policy). Omit it for trusted local code paths.

### Serialization & integrity

```ts
store.serialize(): GlideDocument                                       // full snapshot, JSON-safe, deeply cloned
store.replaceDocument(doc, options?, capability?): LoadReport           // atomic full-store replace (hydration)
store.importRecords(payload, options?): ImportReport                   // merge semantics, not atomic replace
store.assertIntegrity(): IntegrityReport                                // referential-integrity self-check
store.rebuildIndices(): void                                            // rebuild the spatial index from scratch
```

`replaceDocument` is deliberately distinct from `importRecords`: replace tears down every existing record and loads the incoming document atomically (used for initial hydration or a full remote-state resync); import merges incoming records into whatever's already in the store. `deserialize()` still exists but is `@deprecated` in favor of `replaceDocument`.

### Errors

- `AsyncTransactionError` — an async operation was attempted inside a synchronous transaction body.
- `TransactionAbortedError` — the transaction function threw; all staged writes are discarded.
- `TransactionReentryError` — `transact()` was called on a store whose commit is already in flight (`_preparingCommit`).
- `StoreFatalIntegrityError` — the store detected a broken invariant it can't recover from; the store then rejects all further `transact()` calls (`this._fatalIntegrityError`). This is a "something is fundamentally wrong" signal, not a normal validation failure.

## Related types

`ChangeOrigin`, `JsonPointer`, `StoreRecord`, `RecordDelta`, `StoreChangeSet`, `TransactionScope`, `StoreTransaction`, `TransactionResult`, `StoreChangeListener`, `StoreCommitPreparation`, `StoreCommitParticipant`, `ReplaceDocumentOptions`, `ImportOptions`, `ImportReport`, `IntegrityIssue`, `IntegrityReport`, `ReadonlyGlideStore` (a read-only view handed to untrusted code — see `createReadonlyStoreView` used internally by `GlideEditor`).

## Validators & migrations

`T` (from `validators.ts`) is the builder used for a `ShapeUtil`'s `props` schema — see [Shapes & Bindings](./shapes-and-bindings.md) for how it's used in practice. `defineMigrations({ currentVersion, migrators })`, `migrateRecord`, `migrateRecordDown` define and run versioned prop migrations; each migrator is `{ up(record), down(record) }` for one version step, applied in sequence by the schema when it loads an older document.
