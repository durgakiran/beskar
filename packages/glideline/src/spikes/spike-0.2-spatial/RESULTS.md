# Spike 0.2: Spatial Indexing Performance — Results

Generated: 2026-05-13T12:23:19.057Z

## Decision: `rbush`

## Benchmark Setup
- **Point query**: 1000 random point lookups — simulates onPointerMove hover detection
- **Bounds query**: 1000 random 500×500 region queries — simulates marquee selection
- **Drag tick**: 300 ticks moving 10 shapes (remove→translate→insert + viewport search per tick)
- **Distributions**: uniform (evenly spread) and clustered (realistic canvas with shape groups)
- **60fps target**: drag tick must stay < 16ms at 10k shapes

## Results: Uniform Distribution

| Candidate | Count | Point query (μs) | Bounds query (μs) | Drag tick (ms) |
|---|---|---|---|---|
| rbush | 1,000 | 141.899 | 172.551 | 3.360 |
| rbush | 5,000 | 13.154 | 7.397 | 1.541 |
| rbush | 10,000 | 2.804 | 81.383 | 0.169 |
| brute | 1,000 | 55.386 | 23.049 | 0.053 |
| brute | 5,000 | 192.417 | 287.659 | 0.601 |
| brute | 10,000 | 9060.308 | 4048.696 | 2.275 |
| quadtree | 1,000 | 429.902 | 109.734 | 2.197 |
| quadtree | 5,000 | 38.388 | 135.022 | 15.607 |
| quadtree | 10,000 | 99.213 | 210.509 | 28.290 |

## Results: Clustered Distribution (Realistic Canvas)

| Candidate | Count | Point query (μs) | Bounds query (μs) | Drag tick (ms) |
|---|---|---|---|---|
| rbush | 1,000 | 27.945 | 1.075 | 1.276 |
| rbush | 5,000 | 8.802 | 33.807 | 1.629 |
| rbush | 10,000 | 11.270 | 60.673 | 0.489 |
| brute | 1,000 | 89.250 | 34.415 | 0.445 |
| brute | 5,000 | 476.552 | 746.541 | 1.750 |
| brute | 10,000 | 1919.684 | 996.065 | 4.769 |
| quadtree | 1,000 | 46.236 | 5.765 | 9.445 |
| quadtree | 5,000 | 10.265 | 33.149 | 9.883 |
| quadtree | 10,000 | 3.070 | 82.249 | 50.887 |

## Rationale

**`rbush`** wins:
- Passes 60fps constraint (drag tick < 16ms) at 10k shapes on both distributions
- Lowest drag-tick cost on clustered data (worst-case real canvas)
- Fastest or competitive on point and bounds queries

### Note: Brute Force
O(N) scan. Viable at low counts. Degrades linearly — unacceptable for 10k+ shapes.

## Impact on Spike 0.4 (API Design)
- `GlideStore` must maintain a spatial index internally (updated on every put/remove).
- Index strategy: **`rbush`**
- Incremental update (remove + insert) is the core drag operation — must stay sub-millisecond.
- Viewport culling query fires every pan/zoom — must be fast on large counts.
