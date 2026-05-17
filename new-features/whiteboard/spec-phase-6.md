# Phase 6: Advanced Routing (Optional) & MCP/AI Integration

**Goal (Phase 6)**: Implement Lucidchart-quality obstacle-avoiding connector routing.
**Goal (Phase ∞)**: Expose the canvas as a first-class MCP toolset for AI agents.
**Reference**: HLD §3.6 Tier 3, LLD §15, arch-reference §2.5a, §2.5 MCP notes.

---

## Story 6.1: A* Obstacle-Avoiding Routing *(Phase 6 — Optional)*

**Summary**: Implement Tier 3 connector routing using an orthogonal visibility graph and A* pathfinding so arrows never pass through shapes.

**Description**: Tier 2 elbow routing does not avoid obstacles — arrows can pass through unrelated shapes in dense diagrams. Tier 3 builds an orthogonal visibility graph (OVG) of all free horizontal/vertical corridors on the canvas, runs A* with a `path_length + bend_count_penalty` cost function, then applies a nudging pass to separate parallel routes. This is the primary capability differentiating Lucidchart from tldraw and Miro. It runs on every shape move — careful frame budgeting is required (target: < 8ms per route at 500 shapes).

**Acceptance Criteria**:
- Arrows with `routeStyle: "smart"` never pass through the bounding box of any registered shape
- The OVG is invalidated and rebuilt only when shapes are added/moved/deleted (not on every frame)
- A* uses `length + 2 * bend_count` as cost metric
- Parallel routes are nudged apart by a minimum of 6px
- At 500 shapes, route computation < 8ms per arrow
- Falls back to Tier 2 elbow routing if OVG computation times out (> 12ms)
- Opt-in only: existing `"curve"` and `"ortho"` styles are unchanged

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T6.1-01 | Arrow avoids shape | Place box B between A and C. Draw smart arrow A→C. Assert path does not intersect B's bounds. |
| T6.1-02 | OVG invalidated on move | Move shape. Assert OVG marked dirty. Next route call rebuilds OVG. |
| T6.1-03 | Parallel routes nudged | Two arrows same path. Assert they are at least 6px apart horizontally or vertically. |
| T6.1-04 | Performance at 500 shapes | 500 shapes, 1 smart arrow. Measure route time < 8ms. |
| T6.1-05 | Timeout fallback | Force OVG build to exceed 12ms (mock). Assert route falls back to elbow, no crash. |
| T6.1-06 | Existing styles unaffected | `routeStyle:"curve"` arrow beside smart arrows. Curve shape unchanged after OVG rebuild. |

---

## Story ∞.1: Canvas Context Serialisation for AI

**Summary**: Implement `editor.getAIContext()` that returns a structured, token-efficient representation of the current canvas for AI model consumption.

**Description**: An AI model reasoning about the canvas needs a structured representation it can parse, not raw store records. `getAIContext()` returns a compact JSON object with shapes (id, type, label if any, position, size), connections (fromId, toId, label), and the current viewport bounds. It also supports `getAIContext({ viewport: true })` to return only shapes visible on screen — reducing context size for focused prompts. A `takeScreenshot()` method returns the canvas area as a base64 PNG for visual reasoning.

**Acceptance Criteria**:
- `editor.getAIContext()` returns `{ shapes: [...], connections: [...], viewport: Box2d }`
- Each shape entry includes `{ id, type, label?, x, y, w, h }`
- Each connection entry includes `{ id, fromId, toId, label?, routeStyle }`
- `getAIContext({ viewport: true })` only includes shapes in the current viewport
- `editor.takeScreenshot(box?)` returns a base64 PNG string
- Output is valid JSON parseable without error
- No internal store records, signal objects, or React state in the output

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T∞.1-01 | Shape list correct | Place 3 boxes. `getAIContext().shapes.length === 3`. Each has `id, type, x, y, w, h`. |
| T∞.1-02 | Connection list correct | Draw arrow from A→B. `getAIContext().connections` → `[{fromId:A.id, toId:B.id}]`. |
| T∞.1-03 | Viewport filter | 10 shapes, 3 visible. `getAIContext({viewport:true}).shapes.length === 3`. |
| T∞.1-04 | Output is plain JSON | `JSON.parse(JSON.stringify(getAIContext()))` — no error. No Signal or ReactElement in output. |
| T∞.1-05 | takeScreenshot returns base64 | `editor.takeScreenshot()` → string starting with `data:image/png;base64,`. |
| T∞.1-06 | Viewport in output | `getAIContext().viewport` matches `editor.getViewportBounds()`. |

---

## Story ∞.2: MCP Tool Server

**Summary**: Implement an MCP-compatible tool server exposing canvas mutations as callable tools for AI agents.

**Description**: The MCP server wraps the `GlideEditor` API as a set of typed tools callable by Claude and other MCP-compatible AI models. Each tool uses Zod for input validation and auto-generates its JSON Schema for the MCP tool manifest. All mutations use `editor.run(fn, { history: 'ignore' })` so AI changes never pollute the user's undo stack. The server handles tool calls synchronously and returns structured results.

**Acceptance Criteria**:
- `create_shape` tool: validates `{ type, x, y, props? }` with Zod, creates shape, returns `{ id }`
- `update_shape` tool: validates `{ id, props }`, updates shape, returns `{ ok: true }`
- `delete_shapes` tool: validates `{ ids: string[] }`, deletes shapes, returns `{ deleted: number }`
- `create_connection` tool: creates ArrowShape + bindings between `fromId` and `toId`
- `get_canvas_state` tool: returns full AI context from `editor.getAIContext()`
- All mutations bypass undo stack (`{ history: 'ignore' }`)
- Invalid tool params (Zod failure) return structured error, not a crash
- Tool manifest (JSON Schema) is auto-generated from Zod schemas

**Test Cases**:

| Test ID | Expected Behaviour | Steps |
|---|---|---|
| T∞.2-01 | create_shape creates box | Call `create_shape({type:"box",x:100,y:100})`. `store.getShape(result.id)` → box at (100,100). |
| T∞.2-02 | AI shape not undoable | `create_shape(...)`. `editor.undo()`. Shape still in store. |
| T∞.2-03 | Invalid params return error | `create_shape({type:123})`. Response → `{error: "Expected string"}`. No crash. |
| T∞.2-04 | create_connection binds shapes | `create_connection({fromId:A, toId:B})`. `getBindingsToShape(B.id).length === 1`. |
| T∞.2-05 | get_canvas_state returns context | `get_canvas_state()`. Response matches `editor.getAIContext()` structure. |
| T∞.2-06 | Tool manifest valid JSON Schema | `generateToolManifest()`. Parse with JSON Schema validator. Assert valid. |

---

## Quality Assurance & Coverage Strategy

### Testing Stack

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | Store, validators, migrations, routers, camera math |
| Integration | Vitest | Multi-component flows (plugin install → put → query) |
| Component | Vitest + @testing-library/react | ShapeUtil rendering, indicator canvas |
| E2E | Playwright | Full interaction flows in real browser |

### Coverage Targets

| Module | Minimum Coverage |
|---|---|
| `store/` | 95% |
| `schema.ts`, `validators.ts`, `migrations.ts` | 100% |
| `routing/arc.ts`, `routing/elbow.ts` | 95% |
| `camera.ts` | 90% |
| `plugins/` (built-in shapes) | 85% |

### Performance Baselines (must not regress)

| Benchmark | Limit | Measured in |
|---|---|---|
| Signal isolation at 10k | < 12ms throughput | Spike 0.1 baseline |
| RBush point query at 10k | < 0.2ms | Spike 0.2 baseline |
| RBush drag-tick at 10k | < 4ms | Spike 0.2 baseline |
| Arc route computation | < 0.01ms | Spike 0.3 baseline |
| Elbow route computation | < 0.01ms | Spike 0.3 baseline |
| Frame time at 10k/100 visible | < 16ms | Phase 5 target |

### Manual Verification Checklist

1. **Stress test**: Create 1,000 shapes. Pan and zoom. Maintain 60fps (Chrome DevTools Performance tab).
2. **Undo/Redo**: Perform 20 random operations. Undo all 20. Assert canvas returns to original state.
3. **Cross-browser**: Rendering + pointer events on Chrome, Safari, Firefox.
4. **Plugin isolation**: Register a custom shape plugin. Verify it doesn't affect built-in shape behaviour.
5. **Document durability**: Save document. Add a migration (bump version). Load document. Verify migration applied.
6. **MCP audit**: Run `create_shape` via MCP tool. Verify shape appears on canvas. Verify `undo()` does NOT remove it.
7. **Collaboration**: Two browser tabs. Move shape in tab A. Verify tab B updates within 100ms. Undo in tab A does not affect tab B.
