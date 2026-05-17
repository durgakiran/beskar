# Spike 0.1: Reactivity & Store Scalability — Results

Generated: 2026-05-13T10:50:21.060Z

## Decision: `custom atom map`

## Test Results

### Test 1: Isolation
Update one record → only its subscriber fires.

| Candidate | Pass | Watched fired | Unwatched fired |
|---|---|---|---|
| @preact/signals | ✅ | 1 | 0 |
| jotai (vanilla) | ✅ | 1 | 0 |
| custom atom map | ✅ | 1 | 0 |

### Test 2: Throughput

| Candidate | Isolation | 1k | 5k | 10k | Batch fire-once |
|---|---|---|---|---|---|
| @preact/signals | ✅ | 5.92ms (169k/s) | 10.15ms (493k/s) | 12.12ms (825k/s) | ✅ (max: 1x) |
| jotai (vanilla) | ✅ | 28.13ms (36k/s) | 75.71ms (66k/s) | 123.61ms (81k/s) | ❌ (max: 100x) |
| custom atom map | ✅ | 0.57ms (1762k/s) | 3.82ms (1310k/s) | 2.35ms (4256k/s) | ✅ (max: 1x) |

### Test 3: Batch (100 records × 100 subscribers)
All subscribers should fire exactly **once** after the batch, not once per put.

| Candidate | All fire once? | Max fires | Total time |
|---|---|---|---|
| @preact/signals | ✅ | 1x | 16.03ms |
| jotai (vanilla) | ❌ | 100x | 50.45ms |
| custom atom map | ✅ | 1x | 15.10ms |

## Rationale

**custom atom map** wins because:
- ✅ Passes isolation (update A doesn't fire B's listener)
- ✅ Passes batch fire-once (100 updates → 1 notification per subscriber)
- Fastest eligible candidate at 5k throughput: 3.82ms


### Note: Jotai Batch Failure
Jotai vanilla store has no batch API. Each `store.set()` call notifies subscribers synchronously.
For a drag event firing 60 pointer-move events/sec with 10 selected shapes, this means
600 individual subscriber notifications per second instead of 60. Disqualifying for Glideline.


## Impact on Spike 0.4 (API Design)
- Store `batch(fn)` is a **required** primitive in the `GlideStore` interface.
- Store signals library: **custom atom map**
- Fine-grained subscription (per-record, not global): **confirmed required**.
