# Glideline — Low-Level Design (LLD)

> **Frozen API surface**: `packages/glideline/src/spikes/spike-0.4-api/types.ts`
> **Migration runner**: `packages/glideline/src/schema.ts`

---

## 1. Type System & ID Branding

All record IDs are branded strings to prevent mixing at compile time:

```typescript
declare const _brand: unique symbol;
type Brand<T, B> = T & { [_brand]: B };

export type ShapeId   = Brand<string, "Shape">;
export type BindingId = Brand<string, "Binding">;
export type PageId    = Brand<string, "Page">;

// Constructors
export const sid = (id: string): ShapeId   => id as ShapeId;
export const bid = (id: string): BindingId => id as BindingId;
```

**Why:** `editor.getShape(bindingId)` is a compile-time error. Eliminates an entire class of runtime bugs.

---

## 2. Record Schema

### 2.1 GlideShape

```typescript
interface GlideShape<Props extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: ShapeId;
  readonly type: string;      // matches ShapeUtil.type
  x: number;                  // page-space position (top-left)
  y: number;
  index: string;              // fractional index for z-order ("a1", "a2", "a3")
  rotation: number;           // radians
  props: Props;               // per-type, validated by ShapeUtil.props
  meta: Record<string, unknown>; // arbitrary plugin metadata, never validated
}
```

### 2.2 GlideBinding

```typescript
interface GlideBinding<Props extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: BindingId;
  readonly type: string;
  readonly fromId: ShapeId;  // the arrow
  readonly toId: ShapeId;    // the target box
  props: Props;
  meta: Record<string, unknown>;
}
```

### 2.3 ArrowBinding Props (built-in)

```typescript
interface ArrowBindingProps {
  terminal: "start" | "end";
  normalizedAnchor: { x: number; y: number }; // 0–1 relative to target bounds
  fromEdge: "left" | "right" | "top" | "bottom"; // computed, never float
  routeStyle: "curve" | "ortho";
  bend: number;         // curve style: curvature scalar. 0 = straight.
  isPrecise: boolean;   // false = snap to nearest edge point
}
```

### 2.4 Document Envelope (serialised format)

```typescript
interface GlideDocument {
  schema: {
    storeVersion: number;               // global store version
    shapes:   Record<string, number>;   // { "box": 2, "arrow": 4 }
    bindings: Record<string, number>;
  };
  records: Array<GlideShape | GlideBinding | Record<string, unknown>>;
  // Unknown types in records are preserved as-is on load
}
```

---

## 3. Runtime Validators (T system)

Lightweight O(1) validators run on every `store.put()`. No Zod in the hot path.

```typescript
interface Validator<T> { validate(value: unknown): T; }

const T = {
  number:  { validate: v => { if (typeof v !== "number")  throw ...; return v; } },
  string:  { validate: v => { if (typeof v !== "string")  throw ...; return v; } },
  boolean: { validate: v => { if (typeof v !== "boolean") throw ...; return v; } },
  literal: <V>(expected: V) => ({ validate: v => { if (v !== expected) throw ...; return v; } }),
  optional:<T>(inner: Validator<T>) => ({ validate: v => v === undefined ? undefined : inner.validate(v) }),
  union:   <T>(...vs: Validator<T>[]) => ({ validate: v => { for (const val of vs) try { return val.validate(v) } catch {} throw ...; } }),
};

// Usage on ShapeUtil:
static props: GlideProps<BoxProps> = {
  w: T.number, h: T.number, color: T.string, label: T.string,
};
```

**GlideProps type:**
```typescript
type GlideProps<Props extends Record<string, unknown>> = {
  [K in keyof Props]: Validator<Props[K]>;
};
```

---

## 4. Migration System

### 4.1 Interfaces

```typescript
interface GlideMigrator {
  up(record: Record<string, unknown>):   Record<string, unknown>;
  down(record: Record<string, unknown>): Record<string, unknown>;
}

interface GlideMigrations {
  currentVersion: number;
  migrators: Record<number, GlideMigrator>; // key = version produced by up()
}
```

### 4.2 defineMigrations helper

Validates contiguous sequence at declaration time (startup crash > silent corruption):

```typescript
function defineMigrations(def: GlideMigrations): GlideMigrations {
  const keys = Object.keys(def.migrators).map(Number).sort((a,b) => a-b);
  for (let i = 0; i < keys.length; i++)
    if (keys[i] !== i + 1) throw new Error("version sequence must be contiguous starting at 1");
  if (keys.at(-1) !== def.currentVersion)
    throw new Error("last migrator must equal currentVersion");
  return def;
}
```

### 4.3 Usage on ShapeUtil

```typescript
class BoxUtil extends ShapeUtil<BoxShape> {
  static type = "box" as const;

  static props = { w: T.number, h: T.number, color: T.string, label: T.string };

  static migrations = defineMigrations({
    currentVersion: 2,
    migrators: {
      1: { // added opacity in v1
        up:   (r) => ({ ...r, props: { ...(r.props as any), opacity: 1 } }),
        down: (r) => { const { opacity, ...rest } = r.props as any; return { ...r, props: rest }; },
      },
      2: { // added cornerRadius in v2
        up:   (r) => ({ ...r, props: { ...(r.props as any), cornerRadius: 0 } }),
        down: (r) => { const { cornerRadius, ...rest } = r.props as any; return { ...r, props: rest }; },
      },
    }
  });
  // ...
}
```

### 4.4 Migration Runner (GlideSchema.load)

```
On load(doc):
  for each record in doc.records:
    type = record.type
    UtilClass = registry.get(type)
    if !UtilClass → preserve as-is (unknown type)
    savedVersion = doc.schema.shapes[type] ?? 0
    if savedVersion === currentVersion → return as-is
    if savedVersion > currentVersion  → preserve as-is (forward compat)
    run up() for each step from savedVersion+1 to currentVersion
```

### 4.5 Down Migration (Yjs Peer Sync)

When a newer client (v3) connects to an older peer (v1), before broadcasting:
```
migrateRecordDown(record, migrations, fromVersion=3, toVersion=1)
  → runs down() for versions 3, 2 in sequence
```

---

## 5. ShapeUtil — Abstract Class

```typescript
abstract class ShapeUtil<S extends GlideShape = GlideShape> {
  static readonly type: string;
  static readonly props: GlideProps<Record<string, unknown>>;
  static readonly migrations?: GlideMigrations;

  editor!: GlideEditor; // injected on registration

  abstract getDefaultProps(): S["props"];
  abstract getGeometry(shape: S): Box2d;
  abstract component(shape: S): ReactNode;   // SVG <g> context
  abstract indicator(shape: S): ReactNode | null;

  // Concrete defaults (override as needed)
  hitTestPoint(shape: S, pt: Vec2): boolean {
    const b = this.getGeometry(shape);
    return pt.x >= b.minX && pt.x <= b.maxX && pt.y >= b.minY && pt.y <= b.maxY;
  }
  canContain(_shape: S): boolean  { return false; }
  onBeforeDelete(_shape: S): boolean | void { return true; }

  // Export — implement to enable PNG/SVG export
  toSvg?(shape: S, ctx: ExportContext): SVGElement | null;
}
```

### Built-in shapes (Phase 2)

| Type | Props | Notes |
| :--- | :--- | :--- |
| `box` | `{ w, h, color, label, cornerRadius, opacity }` | Rectangle with optional label |
| `text` | `{ text, fontSize, fontFamily, color, align }` | Standalone text node |
| `arrow` | `{ routeStyle, bend, start, end, arrowheadStart, arrowheadEnd, color, strokeWidth }` | Arc or Elbow connector |
| `image` | `{ w, h, assetId, crop }` | References `GlideAsset` by ID |
| `frame` | `{ w, h, label }` | Container — `canContain()` returns true |

---

## 6. BindingUtil — Abstract Class

```typescript
abstract class BindingUtil<B extends GlideBinding = GlideBinding> {
  static readonly type: string;
  static readonly props: GlideProps<Record<string, unknown>>;
  static readonly migrations?: GlideMigrations;

  editor!: GlideEditor;

  abstract getDefaultProps(): B["props"];

  // Lifecycle hooks — implement as needed
  onAfterChangeToShape?(binding: B):   void;
  onAfterChangeFromShape?(binding: B): void;
  onBeforeDeleteToShape?(binding: B):  void;
  onBeforeDeleteFromShape?(binding: B): void;
}
```

### ArrowBindingUtil.onAfterChangeToShape — key logic

```typescript
onAfterChangeToShape(binding: ArrowBinding) {
  const target = this.editor.getShape(binding.toId);
  if (!target) return;

  const util = this.editor.getShapeUtil(target);
  const bounds = util.getGeometry(target);
  const { normalizedAnchor, terminal } = binding.props;

  // Compute page-space point from anchor
  const point = {
    x: bounds.x + normalizedAnchor.x * bounds.w,
    y: bounds.y + normalizedAnchor.y * bounds.h,
  };

  // Compute edge from anchor — NOT from a float normal
  const fromEdge = anchorToEdge(normalizedAnchor); // "right"|"left"|"top"|"bottom"

  // Update arrow terminal
  const arrow = this.editor.getShape<ArrowShape>(binding.fromId);
  this.editor.updateShape<ArrowShape>(binding.fromId, {
    props: { ...arrow!.props, [terminal]: { ...arrow!.props[terminal], point, boundShapeId: binding.toId } }
  });
  this.editor.updateBinding<ArrowBinding>(binding.id, { fromEdge });
}

function anchorToEdge(a: { x: number; y: number }): EdgeName {
  if (a.x > 0.75) return "right";
  if (a.x < 0.25) return "left";
  if (a.y > 0.75) return "bottom";
  return "top";
}
```

---

## 7. StateNode FSM

```typescript
abstract class StateNode {
  static readonly id: string;
  static readonly children?: () => (typeof StateNode)[];
  static readonly initial?: string;

  editor!: GlideEditor;
  parent!: StateNode;
  protected _current?: StateNode;

  transition(id: string, info?: unknown): void {
    const Child = this.constructor.children?.().find(C => C.id === id);
    if (!Child) throw new Error(`Unknown child "${id}"`);
    const child = new Child();
    child.editor = this.editor;
    child.parent = this;
    this._current?.onExit?.();
    this._current = child;
    child.onEnter?.(info);
  }

  // Event handlers — implement in child states
  onEnter?(info?: unknown): void;
  onExit?(): void;
  onPointerDown?(info: PointerInfo): void;
  onPointerMove?(info: PointerInfo): void;
  onPointerUp?(info: PointerInfo): void;
  onKeyDown?(key: string, e: KeyboardEvent): void;
}
```

### SelectTool state table

| State | Trigger | → Next State | Action |
| :--- | :--- | :--- | :--- |
| Idle | pointerDown on shape | PointingShape | — |
| Idle | pointerDown on canvas | PointingCanvas | — |
| Idle | `a` key | Idle | selectAll() |
| PointingShape | pointerMove > 4px | Dragging | — |
| PointingShape | pointerUp | Idle | select shape |
| Dragging | pointerMove | Dragging | translate shapes |
| Dragging | pointerUp | Idle | commit move |
| Dragging | Escape | Idle | cancel (restore pos) |
| PointingCanvas | pointerMove > 4px | MarqueeSelecting | — |
| PointingCanvas | pointerUp | Idle | deselect all |
| MarqueeSelecting | pointerMove | MarqueeSelecting | update marquee + selection |
| MarqueeSelecting | pointerUp | Idle | commit selection |

---

## 8. GlideEditor — Full API Surface

```typescript
interface GlideEditor {
  // Shape queries (O(log N) via RBush)
  getShape<S extends GlideShape>(id: ShapeId): S | undefined;
  getShapeUtil<S extends GlideShape>(shape: S): ShapeUtil<S>;
  getShapesAtPoint(point: Vec2): GlideShape[];
  getShapesInBox(box: Box2d): GlideShape[];

  // Shape mutations
  createShape(partial: Omit<GlideShape, "index"> & Partial<Pick<GlideShape,"index">>): ShapeId;
  updateShape<S extends GlideShape>(id: ShapeId, partial: Partial<Omit<S,"id"|"type">>): void;
  deleteShapes(ids: ShapeId[]): void;

  // Binding queries
  getBinding<B extends GlideBinding>(id: BindingId): B | undefined;
  getBindingsFromShape(id: ShapeId): GlideBinding[];
  getBindingsToShape(id: ShapeId): GlideBinding[];

  // Binding mutations
  createBinding(partial: Omit<GlideBinding, "id">): BindingId;
  updateBinding<B extends GlideBinding>(id: BindingId, partial: Partial<B["props"]>): void;
  deleteBindings(ids: BindingId[]): void;

  // Selection
  getSelectedShapeIds(): ShapeId[];
  setSelectedShapeIds(ids: ShapeId[]): void;
  selectAll(): void;

  // Tool
  setCurrentTool(id: string, info?: unknown): void;
  getCurrentTool(): StateNode;

  // History
  undo(): void;
  redo(): void;
  batch(label: string, fn: () => void, opts?: { history?: "record" | "ignore" }): void;

  // Camera
  screenToPage(point: Vec2): Vec2;
  pageToScreen(point: Vec2): Vec2;
  getCamera(): { x: number; y: number; z: number };
  setCamera(camera: { x?: number; y?: number; z?: number }): void;

  // Persistence
  serialize(): GlideDocument;
  deserialize(doc: GlideDocument): void;
}
```

---

## 9. GlideStore — Internals

### Structure

```typescript
class GlideStore {
  // Per-record signals (Spike 0.1 decision)
  private _signals = new Map<string, Signal<GlideShape | GlideBinding | null>>();

  // RBush spatial index (Spike 0.2 decision)
  private _tree = new RBush<RBushEntry>();

  // Secondary indices (avoid O(N) scans)
  private _bindingsByFrom = new Map<ShapeId, Set<BindingId>>();
  private _bindingsByTo   = new Map<ShapeId, Set<BindingId>>();
  private _shapesByPage   = new Map<PageId,  Set<ShapeId>>();

  // Schema (validators + migration runner)
  private _schema: GlideSchema;
}
```

### put() flow

```
store.put(records):
  1. Validate each record's props via ShapeUtil.props validators
  2. If validation fails → throw (never corrupt state)
  3. Begin transaction (batch signal updates + RBush updates)
  4. For each record:
     a. Update signal: _signals.get(id).value = record
     b. Update RBush: remove old entry, insert new bbox entry
     c. Update secondary indices
  5. Commit transaction → signals notify subscribers
  6. Emit diff to Yjs (if collaboration active)
```

### Signal isolation — why it matters

```typescript
// BAD (tldraw pre-signals): entire shape list re-renders on any change
const shapes = signal(allShapes);

// GOOD (per-record signals): only Shape A's component re-renders
const shapeA = signal(shapeAData); // subscriber: ShapeA React component
const shapeB = signal(shapeBData); // subscriber: ShapeB React component
// Updating shapeA → only ShapeA re-renders. ShapeB untouched.
```

---

## 10. Arrow Routing — Implementation Detail

### Arc Router ("curve" style)

```
Given: start point S, end point E, bend scalar b (user-draggable, default 0)

midpoint M = lerp(S, E, 0.5)
perpendicular offset = normalize(E - S).perp() * b * |E - S|
control point C = M + perpendicular offset

SVG path: "M Sx Sy Q Cx Cy Ex Ey"  (quadratic bezier through C)
```

`b = 0` → straight line (degenerate arc). `b = 0.5` → symmetric arc. Negative `b` → opposite direction.

### Elbow Router ("ortho" style)

Input: `fromBounds`, `toBounds`, `fromEdge`, `toEdge` — all typed, none float.

**16 edge-pair cases** (4 from × 4 to). Examples:

| fromEdge | toEdge | Route |
| :--- | :--- | :--- |
| right | left | Exit right → midX → entry left (3-segment Z) |
| right | right | Exit right → loop above → entry right (5-segment U-bend) |
| right | top | Exit right → corner → entry top (L-shape) |
| bottom | top | Exit down → midY → entry top (3-segment vertical Z) |

U-bend detection: `fromEdge === toEdge` → shapes face same direction → route around. No float math needed — edge names are the ground truth.

**Fallback:** if `fromBounds` and `toBounds` overlap severely → straight line.

---

## 11. Camera & Coordinate System

```
Page space:   infinite coordinate plane. Shape at (x, y) in world units.
Screen space: physical pixels on monitor.

screenToPage(pt):
  x = (pt.x / camera.z) + camera.x
  y = (pt.y / camera.z) + camera.y

pageToScreen(pt):
  x = (pt.x - camera.x) * camera.z
  y = (pt.y - camera.y) * camera.z
```

**Floating-point precision:** At extreme zoom (< 0.001×), large world coordinates lose precision when subtracted. Fix: translate coordinate origin to viewport center before applying zoom.

**Camera constraints:**
- Min zoom: 0.1 (10%)
- Max zoom: 8.0 (800%)
- Smooth zoom: exponential interpolation to target z over 200ms

---

## 12. Rendering Pipeline — Component Tree

```
<GlideCanvas editor={editor}>
  <svg>                            ← Content layer
    <g transform="camera-matrix">  ← Camera transform applied once
      {visibleShapes.map(shape =>
        <ShapeComponent            ← Per-shape signal subscriber
          key={shape.id}
          shape={shape}
          util={getShapeUtil(shape)}
        />
      )}
    </g>
  </svg>

  <canvas ref={indicatorCanvas} /> ← Indicator layer (Canvas 2D)
</GlideCanvas>
```

### ShapeComponent

```typescript
function ShapeComponent({ shape, util }) {
  // Subscribed to per-shape signal — re-renders ONLY when this shape changes
  const s = useSignal(shapeSignal);
  return (
    <g transform={`translate(${s.x}, ${s.y}) rotate(${s.rotation}rad)`}>
      {util.component(s)}
      {isSelected && util.indicator(s)}
    </g>
  );
}
```

### Indicator Canvas — redrawn every frame during interaction

```
requestAnimationFrame loop (only active during pointer interaction):
  ctx.clearRect(0, 0, w, h)
  for each selected shape:
    ctx.strokeRect(bounds)    // selection box
    drawHandles(bounds)       // 8 resize handles
  if snapping:
    ctx.strokeStyle = "blue"
    drawSnapLines()
  if marquee:
    ctx.fillRect(marqueeBox)
```

---

## 13. Fractional Indexing (Z-Order)

Shape stacking order uses **lexicographic fractional indices** (`"a1"`, `"a2"`, `"a3"`, `"a15"`, ...) rather than integer z-indices.

**Why:** inserting a shape between two existing shapes never requires renumbering all others. `"a1"` < `"a15"` < `"a2"` alphabetically — the engine always sorts by string comparison.

**Library:** `fractional-indexing` (npm) — same approach as tldraw.

---

## 14. History Manager

```typescript
interface HistoryEntry {
  label: string;
  before: Record<string, GlideShape | GlideBinding | null>; // id → old value (null = created)
  after:  Record<string, GlideShape | GlideBinding | null>; // id → new value (null = deleted)
}

class HistoryManager {
  private _undoStack: HistoryEntry[] = [];
  private _redoStack: HistoryEntry[] = [];
  private _inBatch = false;
  private _pendingEntry: HistoryEntry | null = null;

  record(before: ..., after: ...): void;  // called by store on every put/remove
  batch(label: string, fn: () => void): void;   // groups into one entry
  ignore(fn: () => void): void;  // runs fn, does not record

  undo(): void;  // apply entry.before to store
  redo(): void;  // apply entry.after to store
}
```

**AI/Remote invariant:** `editor.batch(label, fn, { history: 'ignore' })` calls `historyManager.ignore(fn)`. Remote Yjs changes always use this path. The local undo stack is never polluted by remote actions.

---

## 15. Collaboration (Yjs Integration)

```
GlideStore ←→ YDoc (Y.Map<string, any>)

On local store.put(records):
  ydoc.transact(() => {
    for (record of records) ymap.set(record.id, record)
  })

On remote Y.Map change:
  editor.run(() => {
    store.put(changedRecords)  // no validators — already validated by remote
  }, { history: 'ignore' })

On peer connect:
  1. Exchange schema versions
  2. If remote.schema.shapes["box"] < local.currentVersion:
     → run down() migrators on outgoing records
  3. If remote.shapes has unknown types:
     → preserve opaque on our side (forward compat)
```

---

## 16. Asset System

```typescript
interface GlideAssetStore {
  upload(asset: GlideAsset, file: File): Promise<{ src: string }>;
  resolve(asset: GlideAsset, ctx: { screenScale: number }): string | null;
  // resolve returns thumbnail URL at low zoom, full-res at high zoom
}

interface GlideAsset {
  id: AssetId;
  type: "image" | "video" | "bookmark";
  src: string;       // original URL or blob URL
  props: { w: number; h: number; mimeType: string; };
}
```

Image shapes reference `assetId` — the asset record holds the URL. This allows the same image to be used in multiple places without duplicating the blob.

---

## 17. Export Pipeline

Every `ShapeUtil` implements `toSvg(shape, ctx)` returning an `SVGElement`.

```
editor.exportToSvg(shapeIds):
  1. Collect ShapeUtil.toSvg() for each shape
  2. Assemble into <svg> with embedded fonts + inlined asset data URLs
  3. Return SVG string

editor.exportToPng(shapeIds, { scale: 2 }):
  1. exportToSvg(shapeIds)
  2. Draw SVG onto <canvas> at given scale
  3. canvas.toBlob('image/png') → File
```

---

## 18. Plugin Registration Flow

```
createEditor({ plugins: [BoxPlugin, ArrowPlugin, BoxToolPlugin] }):
  1. For each plugin:
     a. Instantiate each ShapeUtil class, inject editor reference
     b. Register static.props validators in GlideSchema
     c. Register static.migrations in GlideSchema
     d. Instantiate RBush entries template for each shape type
     e. Register each BindingUtil class
     f. Register each StateNode class as a tool
     g. Call plugin.onInstall(editor)
  2. Freeze schema (no further registrations accepted)
  3. Set initial tool = "select"
  4. Return editor
```

---

## 19. File Layout (Phase 1 target)

```
packages/glideline/src/
├── types.ts              ← GlideShape, GlideBinding, Box2d, Vec2 (canonical)
├── schema.ts             ← GlideSchema, migrateRecord, migrateRecordDown
├── validators.ts         ← T.number, T.string, T.optional, GlideProps
├── migrations.ts         ← defineMigrations, GlideMigrations
├── store/
│   ├── GlideStore.ts     ← signals + RBush + secondary indices
│   └── index.ts          ← public store index
│   fractional-index.ts   ← z-order helpers
├── editor/
│   ├── GlideEditor.ts    ← camera, selection, history, plugin installation
│   ├── HistoryManager.ts
│   └── SnapEngine.ts
├── shapes/
│   ├── ShapeUtil.ts      ← abstract class
│   ├── BindingUtil.ts    ← abstract class
│   └── StateNode.ts      ← abstract FSM class
├── plugins/
│   ├── BoxPlugin.ts      ← BoxUtil + BoxShape types
│   ├── ArrowPlugin.ts    ← ArrowUtil + ArrowBinding + ArrowBindingUtil
│   ├── TextPlugin.ts
│   ├── ImagePlugin.ts
│   └── FramePlugin.ts
├── tools/
│   ├── SelectTool.ts     ← FSM: Idle/PointingShape/Dragging/Marquee
│   ├── BoxTool.ts        ← FSM: Idle/Pointing/Drawing
│   ├── ArrowTool.ts
│   └── TextTool.ts
├── routing/
│   ├── arc.ts            ← computeArcPath(start, end, bend): string
│   └── elbow.ts          ← computeElbowPath(fromBounds, toBounds, fromEdge, toEdge): string
├── camera.ts             ← screenToPage, pageToScreen, Camera type
├── spatial.ts            ← RBush wrapper, getShapesAtPoint, getShapesInBox
├── export/
│   ├── toSvg.ts
│   └── toPng.ts
└── spikes/               ← Validated prototypes (reference only)
    ├── spike-0.1-reactivity/
    ├── spike-0.2-spatial/
    ├── spike-0.3-routing/
    └── spike-0.4-api/     ← types.ts is the canonical API reference
```
