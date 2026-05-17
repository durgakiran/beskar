# Phase 1: Reactive Foundation (Store & Schema)

**Goal**: Establish the single source of truth with bulletproof validation, granular reactivity, and durable document persistence.
**Output**: `GlideStore`, `T` validators, `defineMigrations`, `GlideSchema`, `serialize`/`deserialize`.
**Reference**: HLD §3.1, LLD §2–4, `src/schema.ts`, `spikes/spike-0.4-api/types.ts`

---

## Story 1.1: GlideStore — Reactive State Container

**Summary**: Implement the in-memory reactive database that holds all canvas records and notifies only affected subscribers on change.

**Description**: The store is the single source of truth for all canvas data (shapes, bindings, pages, assets). It wraps every record in a `@preact/signals` signal so that when one shape moves, only that shape's React component re-renders — not the entire canvas. The store also maintains secondary indices (`bindingsByFromShape`, `shapesByPage`) to avoid O(N) scans and manages an RBush spatial index for viewport-speed queries.

**Acceptance Criteria**:
- `store.put([record])` stores the record and fires the record's signal exactly once
- `store.put([r1, r2, r3])` inside a `batch()` fires each signal once (not 3× per subscriber)
- `store.remove([id])` deletes the record and its signal
- `store.get(id)` returns the current record or `undefined` if not present
- `store.has(id)` returns correct boolean without triggering a signal read
- A transaction that throws mid-way rolls back all changes (no partial writes)
- `store.getBindingsFromShape(id)` returns correct results using the secondary index (no full scan)
- Unknown record types stored by `put()` are preserved unchanged and retrievable by `get()`

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T1.1-01 | Signal fires exactly once per `put()` | Subscribe to shape signal. Call `put([shape])`. Assert subscriber called once. |
| T1.1-02 | Batch groups 100 puts into 1 signal fire | Subscribe. Call `batch(() => put 100 records)`. Assert subscriber called once total. |
| T1.1-03 | Transaction rolls back on error | `batch(() => { put(r1); throw new Error(); })`. Assert `get(r1.id)` returns undefined. |
| T1.1-04 | Secondary index stays consistent | `put([binding])`. Call `getBindingsFromShape(binding.fromId)`. Assert binding returned without scanning all records. |
| T1.1-05 | Signal isolation — unrelated shape not fired | Subscribe to shape A signal. Update shape B. Assert shape A subscriber NOT called. |
| T1.1-06 | `remove` deletes record and signal | `put([s])`, `remove([s.id])`. Assert `get(s.id) === undefined` and subscriber not called after remove. |

---

## Story 1.2: T Validators & GlideSchema

**Summary**: Implement the lightweight runtime prop validator system (`T`) and the schema registry that validates every record on `put()`.

**Description**: The `T` validator system provides O(1) field-level checks run on every `store.put()`. Unlike Zod, `T` validators are simple objects (`{ validate(v): T }`) that compose cleanly with the migration pipeline and add no parsing overhead. `GlideSchema` is the registry that maps shape types to their `ShapeUtil` classes, extracts `static props`, and runs validators before any record enters the store. Unknown types bypass validation (preserved as-is).

**Acceptance Criteria**:
- `T.number.validate(42)` returns `42`; `T.number.validate("x")` throws with message containing `"Expected number"`
- `T.string`, `T.boolean`, `T.literal(v)`, `T.optional(inner)`, `T.union(...inner)` all behave correctly
- `GlideSchema.registerShapeUtil(BoxUtil)` extracts `BoxUtil.props` and uses it for validation
- `store.put([invalidShape])` throws before writing — store state unchanged after throw
- `store.put([unknownTypeShape])` succeeds without validation (type not in registry)
- `GlideProps<Props>` TypeScript type enforces that every key of `Props` has a matching `Validator`

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T1.2-01 | `T.number` accepts number, rejects non-number | `T.number.validate(5)` → 5. `T.number.validate("hi")` → throws `/Expected number/`. |
| T1.2-02 | `T.optional` passes undefined through | `T.optional(T.number).validate(undefined)` → undefined. `.validate(3)` → 3. `.validate("x")` → throws. |
| T1.2-03 | `T.union` matches first valid | `T.union(T.string, T.number).validate("ok")` → "ok". `.validate(true)` → throws `/union member/`. |
| T1.2-04 | Schema blocks invalid prop on put | Register BoxUtil with `{ w: T.number }`. `store.put([{...box, props: { w: "bad" }}])` → throws. Store unchanged. |
| T1.2-05 | Unknown type bypasses validation | No util for type "alien". `store.put([{type:"alien", props:{x:1}}])` → succeeds. |
| T1.2-06 | GlideProps type enforces completeness | TypeScript error if `static props` is missing a key present in `S["props"]`. (Compile-time check.) |

---

## Story 1.3: Document Persistence — Migrations & Envelope

**Summary**: Implement `defineMigrations`, the migration runner, and `serialize`/`deserialize` so documents saved today open correctly years later.

**Description**: Each `ShapeUtil` owns its migration history as `static migrations = defineMigrations({...})`. The migration runner applies `up()` functions sequentially from the saved version to the current version on load. The serialised document wraps records in a schema envelope `{ schema: { storeVersion, shapes: { box: 2 } }, records: [...] }` so the loader knows exactly what version each type was at save time. Unknown types and future-versioned records are preserved as-is — the canvas never crashes on a missing plugin.

**Acceptance Criteria**:
- `defineMigrations({ currentVersion: 3, migrators: { 1:{up,down}, 2:{up,down}, 3:{up,down} } })` succeeds
- `defineMigrations` throws at definition time if the version sequence is non-contiguous
- `defineMigrations` throws if the last migrator key ≠ `currentVersion`
- `migrateRecord(record, migrations, fromVersion=1)` applies `up()` for versions 2 and 3 in order
- `serialize()` produces envelope with correct per-type versions from registered ShapeUtils
- `deserialize(doc)` with `shape.box` at v1 in header: record is migrated to current v3 before entering store
- `deserialize(doc)` with unknown type record: record preserved as-is, no crash
- `deserialize(doc)` with savedVersion > currentVersion: record preserved as-is (forward compat)
- `migrateRecordDown(record, migrations, from=3, to=1)` reverses two migrators in order (Yjs peer sync)

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T1.3-01 | v0→v3 migration applies all three up()s | `migrateRecord({props:{w:100}}, migrations, 0)`. Assert props has `opacity`, `cornerRadius`, `locked`. |
| T1.3-02 | v2→v3 applies only missing migrator | `migrateRecord({props:{w:100,opacity:1,cornerRadius:0}}, migrations, 2)`. Assert only `locked` added. |
| T1.3-03 | Already at current: no-op | `migrateRecord(record, migrations, 3)`. Assert props unchanged. |
| T1.3-04 | Non-contiguous sequence throws at definition | `defineMigrations({currentVersion:2, migrators:{2:{up,down}}})` → throws `/contiguous/`. |
| T1.3-05 | Full round-trip: save v1, load as v3 | `serialize()` → JSON. Add v2+v3 migrators. `deserialize(JSON)`. Assert all records at v3 props. |
| T1.3-06 | Unknown type preserved on load | Doc with `type:"my-plugin-shape"`, no util registered. `deserialize()`. `store.get(id).type === "my-plugin-shape"`. |
| T1.3-07 | Down migration for Yjs peer | `migrateRecordDown(v3record, migrations, 3, 1)`. Assert props reverted to v1 structure. |
