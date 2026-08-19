# Glideboard Current-State Gap Analysis and Implementation Roadmap

- **Status:** Proposed implementation roadmap
- **Audit date:** 2026-07-13
- **Last updated:** 2026-07-14
- **Code baseline:** `e03d247` plus the working-tree custom SVG/AWS Lambda test
- **Primary scope:** `packages/glideline`, `packages/glideboard`, and their integration contract
- **Related documents:** [spec.md](./spec.md), [roadmap.md](./roadmap.md), [hld.md](./hld.md), [lld.md](./lld.md)

## 1. Purpose

This document records the difference between the whiteboard that exists today and the whiteboard product we intend to ship. It is deliberately based on the current implementation rather than the completion markers in older planning documents.

It provides:

- an evidence-backed inventory of implemented, partial, and missing capabilities;
- immediate correctness and data-safety issues that must be addressed before feature expansion;
- design decisions for hierarchy, groups, frames, assets, clipboard, collaboration, persistence, and rendering;
- a dependency-aware implementation order;
- acceptance criteria, migration requirements, test strategy, risks, and open decisions.

This is not a promise to build every advanced diagramming feature immediately. It establishes the foundations needed to add them without repeatedly replacing the document model.

## 2. Executive Summary

Glideline and Glideboard already provide a useful foundation:

- reactive records and transactions;
- schema-based shape prop validation and migrations;
- shape plugins and drawing tools;
- marquee and multi-selection;
- move, resize, rotate, duplicate, copy, paste, and undo/redo;
- freehand, text, sticky notes, geometric shapes, engineering shapes, and arrows;
- bound connectors with curved, orthogonal, and obstacle-aware routes;
- pan, zoom, fit-to-screen, styles, inline labels, SVG export, and PNG export;
- Yjs-backed record synchronization and remote cursors;
- AI context and MCP-oriented editor APIs.

However, the current model is still flat. `GlideShape` has position, index, rotation, props, and metadata, but no page ownership, parent, lock state, visibility state, or durable display name. That blocks correct grouping, real frames, layer trees, nested transforms, page filtering, inheritance, and graph-aware clipboard operations.

The most important conclusion is:

> Grouping must be implemented as a document-model and transform-system capability, not as a toolbar command that moves several independent shapes together.

Before grouping, we must also correct several existing invariants:

1. history batches and live drag previews must be atomic and reliably undoable;
2. rendered z-order, hit-test order, and stored order must agree;
3. rotated rendering, hit testing, bounds, routing, snapping, and export must use one transform service;
4. editor instances, save timers, collaboration state, and history must be board-scoped rather than module-global;
5. document replacement, read-only enforcement, binding migrations, and index maintenance must be reliable;
6. the UI must stop mounting every offscreen shape before large asset libraries and large diagrams are introduced.

## 3. Scope and Terminology

### 3.1 Packages

- **Glideline** is the headless record, geometry, editor, tool, history, routing, export, and plugin engine.
- **Glideboard** is the React canvas and product interaction layer.
- **Host application** is the Beskar surface that owns authentication, durable persistence, permissions, file storage, comments, and routing.

### 3.2 Priority

| Priority | Meaning |
| --- | --- |
| P0 | Required for correctness, data safety, or foundational editing workflows. |
| P1 | Required for a competitive general-purpose collaborative whiteboard. |
| P2 | Valuable advanced diagramming, facilitation, or ecosystem capability. |

### 3.3 Status

| Status | Meaning |
| --- | --- |
| Implemented | Present through the engine and normal Glideboard UI. |
| Engine only | Core API exists but no normal product UI is exposed. |
| Partial | Some behavior exists, but the user contract or invariant is incomplete. |
| Missing | No meaningful implementation exists in the active path. |

## 4. Current Capability Baseline

| Area | Current status | Notes |
| --- | --- | --- |
| Shape creation | Implemented | Built-in primitives, engineering shapes, freehand, text, sticky notes, and connectors. |
| Custom developer shape | Partial | `createSvgPathShape` supports trusted scalable path callbacks and startup registration. It is not a safe arbitrary-SVG upload API. |
| Selection | Implemented | Single, shift multi-select, marquee, and selection bounds. Rotated multi-selection remains approximate. |
| Move/resize/rotate | Implemented | Includes axis-constrained drag, aspect-constrained resize, and 15-degree rotation snap. |
| Grouping | Missing | No parent-child relationship or group record. |
| Frames | Partial | A `FrameUtil` exists, but no frame tool, parenting, containment, or reparent-on-drop behavior exists. |
| Arrange | Partial | Z-order commands exist; align, distribute, match size, flip, and tidy are absent. |
| Lock/visibility | Missing | Neither data model nor command enforcement exists. |
| Snapping/guides | Missing | Dot grid is visual only; connector anchor snap and rotation snap are special cases. |
| Clipboard | Partial | Process-local shape-only clipboard; no bindings, descendants, assets, or OS clipboard payload. |
| Styling | Implemented | Color, fill, stroke, font family, font size, text alignment, connector route, and arrowheads. |
| Text | Partial | Plain-text labels exist. The proposed rich-text path reuses a lightweight canvas profile extracted from `@durgakiran/editor`; it is not yet implemented. |
| Images/media | Missing | No image record, asset registry, upload, paste, drop, crop, or caching. |
| Asset libraries | Missing | No user/team libraries, search, groups, favorites, recent assets, or runtime asset registry. |
| Pages | Partial foundation | `PageId` and a private page index exist, but no page record, required page ownership, active-page state, or page UI. |
| Pan/zoom | Implemented | Wheel/trackpad navigation, zoom controls, reset, and fit-to-screen. |
| Minimap/search/bookmarks | Missing | No large-board navigation aids beyond fit and recenter. |
| Export | Engine only | SVG and PNG methods exist; no normal File/Export UI, PDF, or copy-as-image flow. |
| Import | Partial | Initial `GlideDocument` can be supplied; no file import workflow or safe SVG/image import. |
| Persistence | Partial | Host callbacks exist; autosave lifecycle, flush, retry, failure state, and recovery are incomplete. |
| Collaboration | Partial | Record sync and cursors exist; remote selections, field-level convergence, status, follow-user, and comments are absent. |
| Read-only | Partial | UI is hidden, but mutation is not enforced at the engine command boundary. |
| Version history | Missing | Local undo/redo is not durable, attributable version history. |
| Accessibility | Partial | Native buttons exist in places, but canvas object navigation, semantic menus, picker keyboard navigation, and announcements are absent. |
| Touch/stylus | Partial | Pointer events exist; no multi-touch state machine, palm rejection, long press, cancellation recovery, or pressure propagation. |
| Large-board rendering | Partial | RBush and viewport queries exist, but every shape component remains mounted. |

## 5. Immediate Correctness and Data-Safety Gaps

These are not optional polish. They should be addressed before hierarchy and asset work.

### COR-01. Board-scoped editor lifecycle

**Current gap**

- Glideboard exports and mutates a module-level `wbEditor` singleton.
- Save debounce state, tool server state, arrow settings, collaboration state, and history are also effectively global.
- Multiple mounted boards are unsupported.
- Resetting a session does not explicitly clear undo/redo history.

**Risk**

- Undo in a newly opened board can reference a previous session.
- Remounts and object-valued prop changes can clear or reinitialize the active board.
- Custom shape registration recreates a global editor while other modules retain state derived from the previous instance.

**Decision**

Introduce an instance-owned `GlideboardController` and React context. Every mounted board owns exactly one editor, command registry, save scheduler, collaboration adapter, and ephemeral UI state.

**Acceptance criteria**

- Two boards can mount simultaneously without sharing records, selection, history, tools, save timers, or presence.
- Unmount flushes or cancels the correct board's pending save according to an explicit policy.
- Undo in a new board cannot restore content from an old board.
- Custom startup plugins are provided when the instance is created; runtime uploaded assets do not recreate the editor.

### COR-02. Save lifecycle and empty-board overwrite

**Current gap**

The document-change debounce timer is global and is not cleared or flushed by unsubscribe. Cleanup then clears the editor. A pending callback can serialize the cleared state and save an empty board.

**Decision**

Create an instance-owned persistence adapter:

```ts
interface GlideboardPersistenceAdapter {
  load(): Promise<GlideDocument | null>;
  save(document: GlideDocument, revision?: string): Promise<{ revision: string }>;
  flush(): Promise<void>;
  cancel(): void;
  subscribeStatus(listener: (status: SaveStatus) => void): () => void;
}
```

**Acceptance criteria**

- Final edits are flushed before intentional navigation when allowed by the host.
- Unmount never emits a stale or post-clear document.
- Save failures surface through UI and host callbacks and are retryable.
- Concurrent saves use revision tokens or another explicit conflict policy.

### COR-03. Atomic history and drag previews

**Current gap**

- History batches monkey-patch store methods rather than using one atomic store transaction.
- If a command throws, partial writes can remain without a valid history entry.
- Some drag previews update live records with ignored history, so the final history snapshot may already contain previewed state.

**Decision**

- Use one store transaction/change-set primitive for commands, collaboration, history, and rollback.
- Capture the pointer-down snapshot separately from preview state.
- Commit exactly one history entry on pointer-up; Escape restores the snapshot without creating history.

**Acceptance criteria**

- A thrown batch restores all records and secondary indices.
- One undo after move, resize, rotation, route editing, grouping, alignment, or distribution restores the exact pre-command state.
- Pointer cancellation and lost capture restore or commit according to a documented rule.

### COR-04. Canonical z-order

**Current gap**

- Shapes contain `index`, and reorder commands rewrite it.
- Canvas z-index is derived from insertion-order `shapeIds`, not sorted shape indices.
- Point hits are not guaranteed topmost-first.
- Most creation tools reuse `index: 'a1'`; ordering keys are therefore not unique.

**Decision**

- Use parent-scoped fractional order keys.
- Maintain a reactive ordered-children query per parent.
- Render, hit test, export, layer display, and collaboration conflict resolution from the same order.
- Break equal-key ties deterministically by record ID.

**Acceptance criteria**

- New shapes appear above existing siblings.
- Bring forward/back/front/back changes rendering and hit testing immediately.
- Order survives serialization, migration, collaboration, and copy/paste.
- Reordering one child does not rewrite unrelated parents or the full document.

### COR-05. Canonical transforms and rotated geometry

**Current gap**

Rendering and export understand rotation, but spatial indexing, hit testing, selection bounds, connector anchors, and some multi-selection math largely translate unrotated local AABBs.

**Decision**

Add one authoritative transform and geometry service:

```ts
getLocalTransform(shapeId): Matrix2d
getWorldTransform(shapeId): Matrix2d
pageToLocal(shapeId, point): Vec2
localToPage(shapeId, point): Vec2
getWorldOutline(shapeId): Vec2[]
getWorldBounds(shapeId): Box2d
```

All selection, RBush indexing, snapping, routing, grouping, resize, export, and minimap logic must consume this service.

**Acceptance criteria**

- Rendered outline, point hit, marquee hit, selection handles, connector anchors, routing obstacles, export, and minimap agree for rotated and nested shapes.
- Transform composition and inversion have unit and property-based coverage.

### COR-06. Base record, binding, and index integrity

**Current gap**

- Schema validation focuses on registered shape props.
- Binding migrations are not fully represented in saved schema metadata.
- Core coordinates, rotation, IDs, order, metadata size, and relationship integrity are not comprehensively validated.
- Updating binding endpoints or page ownership can leave stale secondary-index entries.
- Unknown forward-compatible records may still crash geometry indexing.

**Decision**

- Add record-kind validation and store-level migrations in addition to per-util prop migrations.
- Update secondary indices by removing old index entries before adding new ones.
- Validate finite numbers, ID shape, relationship targets, parent cycles, duplicate terminal bindings, and size limits.
- Preserve unknown records opaquely without trying to index or render them.

**Acceptance criteria**

- Invalid changes fail atomically with actionable errors.
- Unknown and forward-versioned records survive load-save-load without crashing or being discarded.
- Binding/page/parent indices remain correct after endpoint and ownership changes.

### COR-07. Generic label capability

**Current gap**

Canvas rendering asks the util for label props, but SelectTool uses a hard-coded list of editable shape types. Engineering and custom path shapes can render labels but are not universally editable.

**Decision**

Add explicit util capabilities such as:

```ts
canEditLabel(shape): boolean
getEditableText(shape): string
setEditableText(shape, text): Partial<ShapeProps>
```

**Acceptance criteria**

- Every opted-in built-in or custom shape enters edit mode on double-click.
- Unlabeled shapes do not enter edit mode.
- Escape cancels; Cmd/Ctrl+Enter commits; collaboration and export show the committed value.

### COR-08. Real viewport virtualization

**Current gap**

Every shape mounts a React component, DOM wrapper, record subscription, and camera subscription. Offscreen shapes can be hidden, but panning and zooming remain O(N) in mounted UI work.

**Decision**

- Query visible shape IDs from RBush with an overscan margin.
- Always retain selected, editing, dragged, bound-preview, and newly created shapes even when just outside the viewport.
- Add level-of-detail rules later; first bound mounted DOM count.

**Acceptance criteria**

- A 10,000-shape board mounts only viewport plus overscan shapes.
- Pan/zoom frame time and mounted-node budgets are enforced in CI performance tests.
- Selection, clipboard, export, search, and collaboration still operate on offscreen records.

## 6. Foundational Document Model

### 6.1 Proposed record envelope

Structural fields must be first-class and validated. They must not be hidden in `meta`.

```ts
interface GlidePage extends BaseRecord {
  type: 'page';
  name: string;
  index: string;
  meta: Record<string, unknown>;
}

interface GlideShape<Props extends Record<string, unknown>> extends BaseRecord {
  id: ShapeId;
  parentId: PageId | ShapeId;
  x: number;
  y: number;
  index: string;
  rotation: number;
  isLocked: boolean;
  isHidden: boolean;
  name?: string;
  props: Props;
  meta: Record<string, unknown>;
}

interface GlideAsset extends BaseRecord {
  type: 'asset';
  assetType: 'image' | 'svg';
  hash: string;
  mimeType: string;
  width: number;
  height: number;
  source: AssetSource;
  meta: Record<string, unknown>;
}
```

### 6.2 Parent-local coordinates

**Decision:** Shape coordinates and rotation are relative to their parent.

- A page has the identity transform.
- A group and frame can parent shapes.
- World transforms are composed through ancestors.
- Reparenting computes `inverse(newParentWorld) * oldWorld` so the object does not jump.
- The store derives children through a `childrenByParent` index; records do not maintain mutable `childIds` arrays.

This is more invasive than storing every child in page coordinates, but it is the only coherent foundation for nested rotation, groups inside frames, layer trees, and reusable components.

### 6.3 Page ownership

Every root shape is parented to a page. This avoids separate `pageId` and `parentId` authorities and matches the flat-record hierarchy model.

Page UI can be delivered later, but the page record and default-page migration should be introduced with hierarchy so the record model is not migrated twice.

### 6.4 Core migration

Legacy document migration should:

1. create a default page;
2. assign every existing shape to that page;
3. preserve existing page-space positions as parent-local values because the page transform is identity;
4. initialize `isLocked` and `isHidden` to `false`;
5. normalize sibling order deterministically;
6. preserve unknown records and version headers unchanged;
7. validate all relationships before replacing the active document.

## 7. Grouping and Frames

### GRP-01. Structural group shape

Groups should be explicit non-visual shape records so they can be selected, named, ordered, locked, nested, copied, collaborated, and serialized.

Required commands:

```ts
groupShapes(ids: ShapeId[]): ShapeId
ungroupShapes(groupIds: ShapeId[]): ShapeId[]
enterGroup(groupId: ShapeId): void
selectGroupContents(groupId: ShapeId): void
```

**Grouping behavior**

- Require at least two compatible selected siblings.
- Create the group under their common parent.
- Preserve sibling order relative to surrounding shapes.
- Convert children into group-local coordinates without changing world geometry.
- Move and rotate the group through transform composition.
- Resize a group by applying a scale operation through each descendant's resize contract rather than persisting a transform that permanently distorts text and stroke widths.
- Treat grouping and ungrouping as one atomic history action.

**Ungrouping behavior**

- Move each child to the group's parent.
- Compose its local transform into the former parent coordinate space.
- Preserve visible order around the removed group.
- Delete the empty group.
- Preserve bindings and world geometry.

**Acceptance criteria**

- Group then ungroup is a world-geometry round trip for translated, resized, rotated, and nested shapes.
- Nested groups serialize, collaborate, copy, paste, duplicate, lock, hide, export, and undo correctly.
- Clicking selects the group first; a documented gesture or Enter drills into its contents.
- Deleting a group follows an explicit policy. Recommended default: delete descendants as one subtree; ungroup is a separate command.

### GRP-02. Frames as real containers

Frames use the same parent hierarchy but have different interaction semantics.

| Behavior | Group | Frame |
| --- | --- | --- |
| Visual chrome | None | Border, title, optional background |
| Created from selection | Yes | Optional |
| Move | Moves descendants | Moves descendants |
| Resize | Scales descendant layout | Changes container bounds; does not scale children by default |
| Drop containment | No automatic capture | Reparents eligible shapes on drop |
| Clip children | No | Optional property |
| Auto-layout | Future | Optional future capability |

**Acceptance criteria**

- Frame tool exists in the toolbar.
- Dropping a shape into or out of a rotated frame preserves world position.
- Frame movement carries descendants.
- Frame resize does not distort children unless a separate scale-content command is chosen.
- Frame title, background, clipping, and export behavior are consistent.

### GRP-03. Lock and visibility inheritance

- `isLocked` and `isHidden` are durable structural fields.
- A locked or hidden ancestor applies to descendants.
- Locked shapes remain renderable but are excluded from ordinary selection and mutation.
- Hidden shapes are excluded from rendering, hit testing, routing obstacles, normal export, and ordinary selection.
- Privileged migrations, remote authorized state, and administrative commands can use an explicit override.

## 8. Arrange, Precision, Snapping, and Layers

### 8.1 Alignment service

Required operations:

- align left, horizontal center, right;
- align top, vertical middle, bottom;
- distribute horizontal centers or gaps;
- distribute vertical centers or gaps;
- match width, height, or both;
- flip horizontal and vertical;
- tidy into a row or grid in a later increment.

**Decision:** Implement geometry in Glideline's `AlignmentService`; toolbar, context menu, keyboard, AI, and MCP call the same commands.

**Acceptance criteria**

- Align requires two or more shapes; distribute requires three or more.
- Mixed sizes and rotated bounds behave deterministically.
- Operations preserve parent hierarchy and execute as one history entry.

### 8.2 Precision controls and nudging

Expose editable X, Y, width, height, and rotation values for selection. Add:

- aspect-ratio lock;
- reset rotation;
- 1-pixel Arrow nudge;
- 10-pixel Shift+Arrow nudge;
- platform-correct Select All, Group, Ungroup, Lock, and Zoom shortcuts.

All commands must be disabled while text fields or label editing own keyboard focus.

### 8.3 Snap manager and guide descriptors

Snapping belongs in the engine, not in React components or individual tools.

```ts
interface SnapResult {
  delta: Vec2;
  rotation?: number;
  guides: SnapGuide[];
}
```

Required snap sources:

- grid intersections;
- object edges and centers;
- equal gaps and equal spacing;
- matching width and height;
- rotation increments;
- frame boundaries and page-local coordinates.

Rules:

- tolerance is measured in screen pixels and converted through zoom;
- show-grid and snap-to-grid are separate settings;
- Alt temporarily disables positional snapping;
- Shift retains its constraint/aspect/snap meanings where already established;
- guides are ephemeral UI state and disappear on pointer-up.

### 8.4 Layers panel

The Layers panel should expose the page/group/frame tree and support:

- selection and multi-selection;
- inline rename;
- drag reorder within a parent;
- drag reparent with cycle prevention;
- hide/show;
- lock/unlock;
- expand/collapse groups and frames;
- locate/reveal on canvas.

Layer order, render order, hit-test order, and export order must derive from the same ordered sibling query.

## 9. Command Architecture

Keyboard, toolbar, context menus, AI, MCP, and host integrations should not each implement their own mutations.

Introduce a command registry:

```ts
interface EditorCommand<Args = void> {
  id: string;
  label: string;
  shortcut?: Shortcut;
  canRun(editor: GlideEditor, args: Args): boolean;
  run(editor: GlideEditor, args: Args): void | Promise<void>;
}
```

Commands provide:

- one permission and read-only enforcement point;
- one history and transaction boundary;
- consistent enable/disable state across menus;
- shortcut discovery;
- telemetry and error reporting hooks;
- a safer public surface for AI and MCP.

Read-only mode must block every local mutation path, including keyboard, editor API, debug API, upload, import, and MCP. Hiding React controls is not an authorization boundary.

## 10. Clipboard and Duplication

### 10.1 Versioned graph fragment

Glideline should serialize and insert graph fragments. Glideboard should integrate them with the OS clipboard.

```ts
interface GlideboardClipboardFragment {
  version: number;
  rootIds: ShapeId[];
  records: Array<GlideShape | GlideBinding>;
  assets: GlideAsset[];
}
```

The fragment contains:

- selected shapes;
- all selected group/frame descendants;
- bindings whose required endpoints are included;
- referenced document assets;
- relative placement and sibling ordering.

Paste uses two-pass ID remapping, then repairs every parent, endpoint, asset, and metadata reference.

**External connector policy:** If only one bound target is copied, detach the missing endpoint while preserving its visible terminal position. Do not bind pasted content back to an object in the source board.

### 10.2 OS clipboard formats

- `application/x-glideboard+json` for lossless board fragments;
- `image/svg+xml` or PNG for pasting into other applications;
- `text/plain` fallback for copied text-only selections.

### 10.3 Acceptance criteria

- Copy/paste and duplicate preserve internal connectors, nested hierarchy, assets, order, and style.
- Cross-tab and cross-board paste works.
- Malformed or unsupported fragments fail without changing the board.
- Clipboard operations are one undoable transaction.

## 11. Images, SVG Assets, and Shape Libraries

### 11.1 Separate developer shapes from user assets

`createSvgPathShape` remains a developer extension for trusted, schema-registered shape behavior. It should not become the arbitrary upload mechanism.

User-uploaded icons should use one generic runtime shape type such as `svg-asset`. This avoids creating and registering a new schema type and drawing tool for every uploaded icon after the schema is frozen.

### 11.2 Document asset registry

Add immutable, content-addressed asset records. Shapes reference document-local asset IDs. Duplicate shapes share one asset record.

Recommended storage model:

- the host stores original binary files by content hash;
- the document contains immutable normalized metadata and a resolvable source;
- uploaded SVG assets store a sanitized normalized representation;
- exports can resolve all required assets without depending on a library entry that may later be deleted;
- collaboration syncs asset metadata, not large binary payloads on every drag.

### 11.3 Image shape

Support:

- file picker, drag/drop, and clipboard paste;
- PNG, JPEG, WebP, and optionally GIF;
- original-aspect placement;
- resize, crop, replace, download, and alt text;
- progress, cancellation, size limits, and recoverable missing-asset state.

### 11.4 SVG asset shape

The generic SVG asset must support a sanitized collection of paths and primitive SVG elements, not only one path string. Preserve:

- view box;
- paths and safe primitives;
- groups after transform flattening;
- fills and strokes under an explicit native-color or themeable-monochrome mode.

### 11.5 Shape libraries UI

Add an **Assets** toolbar entry with a searchable panel rather than placing hundreds of icons in the small built-in Shapes grid.

Suggested groups:

- Recent;
- Favorites;
- My Shapes;
- Team Library;
- AWS Architecture;
- Azure;
- Google Cloud;
- Kubernetes;
- additional installed libraries.

Selecting an asset updates the active asset thumbnail. Dragging uses one `svg-asset` tool with an active asset ID.

### 11.6 SVG security boundary

Never append uploaded SVG markup directly through the current rendering path.

Sanitization requirements:

- explicit element and attribute allowlist;
- remove scripts, event attributes, `foreignObject`, embedded HTML, CSS, animation, and unsafe filters;
- reject external `href`, network URLs, and data URLs outside an explicit image policy;
- flatten or safely normalize transforms and view boxes;
- reject NaN, Infinity, invalid dimensions, and malformed paths;
- cap file bytes, DOM nodes, path commands, nesting depth, dimensions, and decode time;
- use a malicious SVG corpus in automated tests;
- guarantee no script execution and no unexpected external request.

## 12. Text and Connectors

### 12.1 Text and rich-text editor decision

**Recommendation: provide rich text by extracting a canvas-specific profile from `@durgakiran/editor`. Do not embed the existing full document `<Editor>` component in text shapes.**

The existing editor is the right technology base because it already uses TipTap/ProseMirror, versionable JSON content, formatting commands, Yjs integration, and accessible React controls. The current component is nevertheless the wrong runtime boundary for a canvas:

- it always calls the full `getExtensions()` profile; consumers can add extensions but cannot remove the default document extensions;
- the default profile includes block IDs and drag/drop, tables, images, attachments, embeds, columns, math, comments, slash commands, and document-specific nodes;
- it initializes document block IDs and emits content through a two-second debounce rather than an explicit canvas edit transaction;
- its CSS assumes a page editor with block handles and document typography;
- the current build is one unsplit entry, approximately 1.3 MB of unminified JavaScript plus 124 KB of combined CSS at this audit;
- the package declares React 19 peers, while Glideboard currently advertises React 18 or newer;
- TipTap and ProseMirror packages must remain singleton-compatible with the host application.

The goal is therefore code and schema reuse without importing document-editor behavior into the whiteboard.

#### 12.1.1 Package boundary

Add a separately built public entry point rather than importing the root editor barrel:

```text
@durgakiran/editor/canvas-text
  CanvasTextEditor
  CanvasTextView
  CanvasTextToolbar
  createCanvasTextExtensions
  normalizeCanvasTextDocument
  canvasTextToPlainText
  validateCanvasTextDocument
  canvas-text.css
```

This entry must:

- have its own source entry, generated bundle, type declarations, and narrowly scoped CSS;
- avoid importing `Editor`, `getExtensions()`, the root barrel, document NodeViews, upload handlers, or document collaboration UI;
- expose a frozen, versioned canvas extension profile rather than inheriting whatever extensions the document editor adds later;
- keep React, TipTap, ProseMirror, and Yjs versions compatible with the host and avoid duplicate singleton instances;
- be lazy-loadable so the interactive editor code is fetched only when a user first edits rich text;
- include a bundle-size regression check.

If publishing the subpath still forces unacceptable installation weight from the root package's dependency list, extract its framework-neutral schema and codecs into `@durgakiran/editor-core`. The public contract should remain the same. Glideline itself must not depend on React, Radix, Hocuspocus, or a TipTap editor instance.

The existing `TextFormattingMenu` should not be reused directly. It assumes inline-math, comment, color, highlight, table-selection, and document menu behavior. Build a small canvas toolbar from shared visual primitives and commands.

#### 12.1.2 Version 1 feature profile

Enable the following for standalone text shapes:

- paragraphs and hard breaks;
- bold, italic, underline, strike, and inline code;
- safe external links;
- text color and highlight;
- left, center, and right paragraph alignment;
- plain-text and supported rich-text paste;
- keyboard shortcuts and an accessible floating formatting toolbar.

Keep base font family, base font size, line height, and default color as shape-level properties initially. This keeps geometry and Style Panel behavior predictable. Mixed font sizes/families and bullet or numbered lists can be added after version 1 layout and export are stable.

Exclude from the canvas profile initially:

- headings and document outline semantics;
- task lists and interactive checkboxes;
- tables and columns;
- images, attachments, embeds, and internal-resource cards;
- math, table of contents, status/date chips, notes, and custom document blocks;
- slash commands, block IDs, and block drag/drop;
- document comments;
- provider-owned collaboration and collaboration caret extensions.

The first rollout applies rich text only to the standalone `text` shape. Box, ellipse, sticky-note, frame, engineering/custom-shape, and connector labels remain plain text until the generic label capability, fixed-container layout, and export contracts are stable. They can later adopt a stricter `label` profile without lists or arbitrary block nodes.

#### 12.1.3 Engine-neutral data model

Persist versioned structured JSON, never HTML:

```ts
interface CanvasRichTextDocument {
  format: 'beskar-canvas-rich-text'
  version: 1
  profile: 'text' | 'label'
  doc: RichTextJson
}

interface TextProps {
  text: string // temporary synchronized plain-text projection during migration
  richText?: CanvasRichTextDocument
  w: number
  h: number
  sizeMode: 'auto' | 'fixed-width' | 'fixed'
  font: Font
  fontSize: FontSize
  color: string
  lineHeight: number
}
```

`richText.doc` is authoritative when present. The legacy `text` value is a temporary, derived compatibility projection used by older clients, search, AI context, accessibility, empty-shape detection, and degraded rendering. It must be generated from the rich document and updated in the same command; it must never be edited independently by a rich-text-capable client.

Before removing the compatibility projection, choose and enforce a minimum whiteboard client version. Otherwise an older client can edit `text` and leave `richText` stale. During the transition, detect projection mismatches and refuse silent overwrite.

Add an engine-neutral rich-text capability to `ShapeUtil` instead of adding more shape-type checks:

```ts
interface ShapeTextDescriptor {
  content: TextContent
  profile: 'plain' | 'text' | 'label'
  layout: TextLayout
  deleteWhenEmpty: boolean
}

getTextDescriptor(shape): ShapeTextDescriptor | null
onTextChange(shape, content, measuredBounds): Partial<Shape>
```

The selection tool asks the util whether text is editable. Canvas no longer guesses whether the property is named `text` or `label`, and runtime custom shapes can participate without being added to a hard-coded list.

Glideline needs a bounded recursive validator because the current `T` helpers only validate scalar, literal, optional, and union values. Validation must:

- allow only the approved nodes, marks, attributes, colors, alignments, and URL protocols;
- cap serialized bytes, characters, node count, nesting depth, and link length;
- reject non-finite or malformed attributes;
- normalize equivalent documents to a deterministic representation;
- preserve an unsupported future-version payload without allowing an older client to edit and destroy it;
- provide a safe plain-text fallback for unsupported content.

Avoid deep-validating an unchanged large rich-text document on every move or resize. Validate on ingestion and rich-text change, or add changed-property validation and a content-hash cache.

#### 12.1.4 Migration

The standalone text migration converts the existing string to one paragraph and adds explicit persisted bounds and sizing mode. Empty strings become a valid empty paragraph.

Migration requirements:

- the conversion is pure, deterministic, and reversible for version-support tooling;
- base `font`, `fontSize`, and `color` remain shape-level styles;
- `canvasTextToPlainText(richText)` exactly reproduces the legacy text, including line breaks;
- unsupported future nodes are preserved rather than stripped;
- copy/paste, duplicate, JSON round-trip, AI context, and accessibility use the same plain-text projection helper;
- old and new clients cannot concurrently edit the same board without explicit schema-version negotiation.

Later label migrations should be separate per shape util; do not bump every label-bearing shape merely to ship standalone rich text.

#### 12.1.5 Rendering and editing lifecycle

Do not mount a read-only ProseMirror instance for every text shape. Use:

- `CanvasTextView`, a lightweight static renderer for every non-editing visible shape;
- exactly one `CanvasTextEditor` per board, mounted only for `editingShapeId`;
- a top-level portal for the formatting toolbar so camera scaling, rotation, clipping, and z-order do not distort it.

The static renderer must consume validated JSON directly and create safe DOM/React nodes. It must not use unsanitized `innerHTML`. It shares normalization and typography rules with the editor but has no editor state, selection, plugins, or provider.

Editing is an input island inside the canvas:

1. Entering edit mode captures the current content and current bounds.
2. TipTap transactions update a local draft immediately for caret/layout feedback.
3. TipTap owns keystroke undo/redo while the editing island has focus.
4. `Escape` cancels and restores the snapshot without allowing a following blur to commit.
5. `Cmd/Ctrl+Enter` or an accepted click-away commits content, plain-text projection, and measured bounds in one `Edit Rich Text` history batch.
6. Canvas undo/redo sees the whole editing session as one action.
7. The commit reads the latest shape record and changes only text-related properties; it must not spread props captured when editing began and overwrite a concurrent move or style change.
8. Remote deletion while editing closes the editor without recreating the shape.

Pointer, wheel, keyboard, composition, selection, paste, and toolbar events must not leak into drawing, panning, deletion, or board shortcuts. IME composition must finish before commit. The editing shape remains mounted despite viewport culling until editing ends.

Links open only through an explicit action or `Cmd/Ctrl`-click in view mode. A normal click continues to select the shape, avoiding a conflict between navigation and canvas selection.

#### 12.1.6 Geometry and sizing

The current `CanvasRenderingContext2D.measureText` estimator cannot reproduce mixed marks, browser wrapping, paragraph spacing, or future lists. Rich-text geometry must use persisted rectangular bounds.

Recommended modes:

| Mode | Width | Height | Primary use |
| --- | --- | --- | --- |
| `auto` | Grows with content up to a configured maximum | Auto | Newly placed free text |
| `fixed-width` | User controlled | Auto | Wrapped free text |
| `fixed` | User controlled | User controlled with defined overflow | Labels inside fixed containers |

Measure the static/editor DOM in page-space using `ResizeObserver`. Commit the normalized document and final `w`/`h` atomically. Hit testing, selection, routing, grouping, and remote clients consume the persisted rectangle rather than remeasuring with local font metrics.

Define behavior for font loading, maximum auto width, minimum dimensions, overflow, resize handles, rotation, and group scaling before release. Font fallback or a late web-font load must not create an unbounded history loop.

#### 12.1.7 Formatting command behavior

Formatting commands must have one predictable target:

- while editing, apply marks or paragraph attributes to the current TipTap selection or stored marks;
- when one or more text shapes are selected but not being edited, shape-level font, size, default color, and line-height commands apply to the whole selected shapes;
- inline mark controls are disabled unless an editor selection/caret exists;
- changing a shape-level default must not erase explicit inline marks;
- read-only and capability policies are enforced by the command layer, not only by hiding the toolbar.

#### 12.1.8 Clipboard, search, AI, and accessibility

- Canvas fragments store structured JSON plus their plain-text projection.
- OS clipboard writes `text/plain`, a safe supported `text/html` representation, and the private Glideboard fragment MIME type.
- Paste filters unsupported nodes and marks through the canvas profile rather than accepting the full document schema.
- Search and AI context use `canvasTextToPlainText`; AI/MCP APIs may later expose structured content explicitly but must not pretend the JSON is a string.
- The static view exposes an accessible text name and link semantics without making the entire canvas accidentally tab through every text run.
- The active editor provides normal text-field semantics, selection announcements, formatting button states, and a reliable focus return to the canvas.

#### 12.1.9 Export

Export is a release gate for rich text. The current path writes plain text to an SVG `foreignObject`, then replaces `foreignObject` content with a single SVG `<text>` node, collapsing whitespace and formatting. It cannot preserve rich text.

For the intentionally small version 1 schema, add a schema-aware serializer that produces pure SVG `<text>`/`<tspan>` runs with deterministic line breaks, alignment, color, weight, decoration, and link metadata. SVG and PNG must consume the same normalized content and persisted bounds as the canvas.

If a future node cannot be represented faithfully, export must either use an explicit raster fallback or report degradation. It must not silently flatten content. PDF export uses the same intermediate text-run representation and embeds or substitutes fonts according to a documented policy.

Keep Glideline renderer-neutral by accepting a rich-text platform adapter for static DOM measurement and export serialization if necessary.

#### 12.1.10 Collaboration

There are two distinct release levels:

1. **Shape-level rich text:** commit one JSON snapshot when editing ends. This works with current persistence, but simultaneous edits to the same text shape are last-commit-wins. Use presence to show that another user is editing and avoid claiming character-level convergence.
2. **Collaborative rich text:** allocate a stable `Y.XmlFragment` per shape inside the board's shared `Y.Doc`. TipTap binds the active editor to that fragment; JSON is materialized for durable snapshots, export, and non-collaborative loading.

The current Yjs adapter places each complete shape object in a `Y.Map`; nesting rich-text JSON inside it does not create character-level CRDT behavior and can also lose concurrent text-versus-move/style changes.

Before enabling collaborative rich text:

- extend the Glideboard collaboration abstraction to address per-shape XML fragments;
- define fragment creation, deletion, copy/duplicate, restore, garbage collection, and schema negotiation;
- use the existing board provider rather than creating a provider per text shape;
- generalize the editor collaboration interface beyond its current Hocuspocus-specific provider type;
- keep rich-text undo scoped to TipTap/Yjs while editing and board history outside editing;
- separate rich-text caret awareness from Glideboard's existing `cursor` awareness payload so the two formats cannot collide;
- test offline edits, reconnect, remote delete, schema mismatch, and concurrent formatting.

#### 12.1.11 Rich-text acceptance criteria

- Only one TipTap/ProseMirror editor instance exists per mounted board.
- A board with at least 1,000 static rich-text shapes does not instantiate read-only editors and remains within the agreed pan/zoom budget.
- Existing plain text migrates and round-trips without changed text or bounds beyond documented tolerance.
- Format, type, cancel, commit, and canvas undo behave as distinct and predictable undo scopes.
- Rich text renders consistently in view, edit, SVG, PNG, clipboard, and read-only modes.
- Zoomed and rotated editing preserves caret placement, selection, toolbar positioning, and pointer isolation.
- Invalid or oversized JSON and unsafe links are rejected without mutating the board.
- Search, AI context, accessibility, and empty-text deletion use the same plain-text projection.
- Collaborative release tests prove character-level convergence; otherwise the UI and documentation explicitly state shape-level last-commit-wins behavior.

### 12.2 Connector labels and waypoints

Add:

- one or more labels positioned along a connector;
- label background and offset;
- additional endpoint styles: open/filled arrow, circle, diamond, bar, and none;
- manually editable orthogonal waypoints;
- add/remove waypoint commands;
- explicit manual versus automatic routing mode.

Bindings should be the single authority for bound relationships. Duplicating target IDs both in terminal props and binding records creates divergence risk; either derive terminal target identity from bindings or enforce both atomically with integrity checks.

## 13. Pages and Navigation

### 13.1 Page operations

Once page records exist, add:

- create, rename, duplicate, reorder, and delete;
- active-page state;
- per-page camera state;
- confirmation and deterministic fallback when deleting the active page;
- page-aware selection, hit testing, export, search, and collaboration.

### 13.2 Minimap

The minimap depends on page filtering, canonical world bounds, visibility, and viewport queries. It should:

- show active-page extents and the current viewport;
- support click and drag navigation;
- use simplified geometry or cached thumbnails;
- remain responsive at the large-board performance target.

### 13.3 Search, named views, and templates

After layers and pages:

- search labels, shape names, asset names, types, and metadata;
- reveal results in the layer tree and canvas;
- save named camera positions/bookmarks;
- save a selection or page as a reusable template;
- define template asset and plugin dependency behavior.

## 14. Import and Export

### 14.1 File menu

Expose normal product workflows for:

- import Glideboard JSON;
- export Glideboard JSON;
- export selection or page as PNG;
- export selection or page as SVG;
- transparent or colored background;
- scale/resolution and padding;
- copy as image;
- PDF after SVG/PNG correctness is established.

### 14.2 Import safety

- Parse and migrate into a temporary document.
- Validate record kinds, finite geometry, references, assets, limits, and required plugins.
- Show a preview or error summary.
- Replace or insert only after complete validation.
- A failed import must leave the current board untouched.

### 14.3 Export service

Move export behind a bounded, cancellable service with:

- deterministic z-order;
- hierarchy and visibility support;
- assets and labels;
- font policy;
- maximum pixel and memory guards;
- progress and cancellation;
- external-resource policy;
- empty-selection handling.

## 15. Collaboration, Permissions, and Durable History

### 15.1 Collaboration adapter

The current adapter stores whole JSON records as Y.Map values. Concurrent edits to different fields of one shape can overwrite one another, and remote writes bypass some editor invariants.

Replace store method monkey-patching with a supported change-set subscription and remote-apply API.

Required capabilities:

- stable transaction origins;
- schema compatibility negotiation;
- deterministic client-generated IDs;
- field-level or nested-map merging where independent property edits must converge;
- local-only undo semantics;
- remote application that invalidates routing and updates binding/index invariants;
- provider status, offline, reconnect, and bootstrap policies.

### 15.2 Presence

Presence is ephemeral and must remain outside durable document records. Add:

- remote selection;
- active tool;
- current label-edit target;
- viewport and follow-user;
- rendered collaborator avatars;
- throttled cursor updates;
- cleanup of user, cursor, selections, listeners, and awareness references.

### 15.3 Permissions

Recommended roles:

- owner;
- editor;
- commenter;
- viewer.

The host remains authoritative, but Glideline commands must receive a capability policy. Object locks are editing constraints, not substitutes for authorization.

### 15.4 Comments

Comments should be first-class host records anchored to a page location or shape ID, not embedded in shape metadata. Support threads, mentions, resolve/reopen, orphaned anchors, and permissions. Reuse Beskar's existing comments and notification infrastructure where practical.

### 15.5 Durable version history

Local undo/redo remains short-lived interaction history. Durable version history is a separate server concern with:

- revision ID and parent revision;
- timestamp and author;
- optional name/description;
- snapshot or compaction strategy;
- restore permission checks;
- restore creating a new revision rather than deleting later history;
- audit trail and recovery workflow.

## 16. Accessibility, Touch, and Platform Quality

### 16.1 Accessibility

Required work:

- semantic toolbar, menu, picker, dialog, and layer-tree roles;
- accessible names, pressed/expanded state, focus order, and roving tab index;
- keyboard navigation within shape/asset pickers and context menus;
- canvas object list or another accessible object model;
- selection and operation announcements through a live region;
- focus visibility, high contrast, reduced motion, and screen-reader tests;
- keyboard-operable selection, manipulation, label editing, layers, and export.

### 16.2 Touch and stylus

- single-pointer select/draw/resize;
- two-finger pan and pinch without creating shapes;
- long-press context menu;
- responsive/mobile toolbar and panels;
- pointer-cancel and lost-capture recovery;
- stylus pressure propagation;
- palm rejection policy;
- sufficiently large touch targets.

### 16.3 Reliability and observability

- React error boundary around each board;
- host-facing `onError`, save status, sync status, and diagnostic callbacks;
- structured logging without document-content leakage;
- corruption and missing-asset recovery UI;
- performance instrumentation for mounted shapes, frame time, route time, document size, and collaboration bandwidth.

## 17. Implementation Order

The sequence below is intentionally dependency-driven.

### Phase 0 — Correctness and lifecycle hardening

**Goals**

- make existing behavior safe enough to extend;
- eliminate cross-board and ordering inconsistencies;
- establish performance and test baselines.

**Work packages**

1. Board-scoped editor/controller and React context.
2. Instance-owned save scheduler with flush/cancel/status/error.
3. History/store transaction atomicity and correct drag preview snapshots.
4. Sorted unique parent/root order and topmost-first hit testing.
5. Generic label editing capability.
6. Replace-document semantics, immutable serialization, and history reset.
7. Binding/page secondary-index update correctness.
8. Base record and binding validation/migration.
9. Read-only command-boundary enforcement.
10. True viewport virtualization with budgets.

**Exit criteria**

- All COR acceptance criteria pass.
- Existing tools have no functional regression.
- Two-board lifecycle, failed-save, read-only, unknown-record, and 10k-board tests exist.

### Phase 1 — Hierarchy, transforms, groups, and frames

**Goals**

- introduce the durable model used by every later structural feature.

**Work packages**

1. Page and structural shape schema migration.
2. Parent/child store index and cycle prevention.
3. Canonical local/world transform and rotated-geometry service.
4. Structural group util and group/ungroup commands.
5. Hierarchy-aware selection, delete, copy, paste, duplicate, export, routing, and collaboration.
6. Frame tool and reparent-on-drop behavior.
7. Inherited lock and visibility.

**Exit criteria**

- Group/ungroup rotated nested content is a geometry-preserving round trip.
- Frames move descendants and resize without unintended scaling.
- Legacy documents migrate to a default page.
- All hierarchy operations are atomic, collaborative, and undoable.

### Phase 2 — Arrange, snapping, precision, commands, and layers

**Goals**

- deliver professional object manipulation on top of stable hierarchy.

**Work packages**

1. Command registry and shortcut map.
2. Align, distribute, match size, flip, and nudge.
3. Precision inspector.
4. Snap manager and overlay guides.
5. Grid settings.
6. Layers panel with rename, reorder, reparent, lock, and visibility.
7. Contextual multi-selection arrange toolbar.

**Exit criteria**

- Commands behave identically through keyboard, menus, toolbar, AI, and MCP.
- Layer order matches rendering and hit testing.
- Snapping remains visually consistent at all zoom levels.

### Phase 3 — Asset records, images, SVG assets, and libraries

**Goals**

- support user content without dynamic schema mutation.

**Work packages**

1. Asset record schema, resolver, cache, and host upload contract.
2. Image shape, tool, upload, paste, drop, crop, replace, and missing-state UI.
3. SVG sanitizer and normalized generic `svg-asset` shape.
4. Asset registry and active asset tool state.
5. Assets panel with search, groups, recent, favorites, personal, team, and vendor libraries.
6. Graph-aware asset copy/paste, collaboration, persistence, and export.

**Exit criteria**

- Uploaded images and SVGs remain stable across reload, collaboration, duplicate, copy/paste, and library deletion.
- Malicious SVG corpus produces no execution or network requests.
- Large libraries do not create one tool/schema class per asset.

### Phase 4 — Pages, navigation, import/export, and richer content

**Goals**

- complete file-level and large-board workflows.

**Work packages**

1. Page rail and page operations.
2. Minimap, search, and named views.
3. JSON import/export and PNG/SVG File menu.
4. System clipboard and copy-as-image.
5. PDF export.
6. Extract and separately build the `@durgakiran/editor/canvas-text` profile, static renderer, editor, toolbar, codecs, and isolated CSS.
7. Migrate standalone text shapes to versioned rich-text JSON, persisted bounds, and the single-active-editor lifecycle.
8. Add rich-text clipboard, search/AI projection, accessibility, link safety, and SVG/PNG/PDF export.
9. Connector labels, waypoint editing, and additional endpoints.
10. Plain-label sizing, wrapping, line height, vertical alignment, and hyperlinks.
11. Templates.

**Exit criteria**

- JSON round-trip is lossless.
- Export order and appearance match the canvas.
- Only active-page content renders, hit-tests, and exports unless explicitly requested otherwise.
- Static text shapes do not mount ProseMirror instances; at most one active canvas text editor exists per board.
- Plain-text migration, rich-text editing, cancel/commit, one-step canvas undo, zoom/rotation, and export pass browser tests.
- Shape-level collaboration behavior is explicitly disclosed or guarded until per-character CRDT support ships.

### Phase 5 — Collaboration, permissions, comments, and version history

**Goals**

- move from shared record transport to a complete collaborative product contract.

**Work packages**

1. Supported change-set collaboration adapter.
2. Merge/convergence rules and schema negotiation.
3. Connection, offline, reconnect, and conflict UI.
4. Remote selection, editing presence, avatars, viewport, and follow-user.
5. Command-level role/capability enforcement.
6. Shape/location comments and mentions.
7. Durable attributed revision history and restore.
8. Per-shape rich-text `Y.XmlFragment` lifecycle, schema negotiation, scoped undo, and collaborative caret presence.

**Exit criteria**

- Concurrency, delete/update, binding, hierarchy, undo, offline/reconnect, and schema-version scenarios converge in automated multi-client tests.
- Concurrent rich-text edits converge at character and mark granularity without overwriting simultaneous shape movement or styling.
- Viewer and commenter roles cannot mutate through any local API path.
- Restore is attributable, reversible, and creates a new revision.

### Phase 6 — Advanced diagramming and facilitation

Potential work after the general foundation is stable:

- tables and swimlanes;
- UML, BPMN, ERD, and architecture-specific shapes;
- mind maps and org charts;
- auto-layout and auto-layout containers;
- reusable components/symbols;
- data-bound shapes;
- presentation mode and page links;
- timers, voting, clustering, and facilitation workflows;
- richer canvas text blocks such as headings, mixed font sizes, task lists, tables, math, or embeds if required.

## 18. Test Strategy

### 18.1 Unit tests

- matrix composition, inversion, and transformed bounds;
- hierarchy cycle detection and derived children;
- fractional ordering;
- align/distribute/snap calculations;
- sanitizer parsing and limits;
- record and migration validation;
- fragment ID/reference remapping;
- permission and command predicates;
- rich-text normalization, validation limits, plain-text projection, safe links, and migration;
- schema-aware rich-text SVG run serialization and deterministic wrapping.

### 18.2 Property-based tests

- group then ungroup preserves world transforms;
- reparent to another rotated parent and back preserves geometry;
- serialize/migrate/deserialize is stable;
- arbitrary valid command batches either fully commit or fully roll back;
- clipboard remapping produces no duplicate or dangling IDs.

### 18.3 Integration tests

- nested group/frame selection, manipulation, and deletion;
- binding behavior through group, ungroup, duplicate, and paste;
- lock/visibility inheritance;
- page filtering and camera restoration;
- asset persistence and missing-asset recovery;
- import failure leaves document unchanged;
- save scheduler flush/cancel/error behavior;
- rich-text edit snapshot, cancel, commit, persisted bounds, and one-step canvas history;
- static rich-text rendering without per-shape ProseMirror instances;
- rich-text copy/paste, AI/search projection, export, and unsupported-version fallback.

### 18.4 Browser end-to-end tests

- keyboard-only object workflows;
- toolbar, context menu, layers, precision inspector, and asset library;
- rich-text formatting, IME composition, clipboard, toolbar focus, link activation, zoom, and rotated editing;
- image/SVG upload and drag/drop;
- export and download;
- two-board isolation;
- Chromium, Firefox, and WebKit;
- desktop, touch, and stylus-focused projects;
- visual regression for selection, guides, rotation, frames, and exports.

### 18.5 Collaboration tests

- two or more real clients;
- different fields edited concurrently;
- delete versus update;
- group/reparent versus remote move;
- bindings and assets;
- local undo after remote changes;
- offline changes and reconnect;
- schema compatibility mismatch;
- awareness cleanup and throttling;
- simultaneous rich-text characters, marks, undo, remote delete, offline edit, reconnect, and schema mismatch.

### 18.6 Performance budgets

Define and enforce targets for:

- mounted shape DOM count;
- pan/zoom frame time at 2k and 10k shapes;
- move/resize preview latency;
- smart-route latency;
- memory use and serialized document size;
- asset decode time;
- static rich-text render cost and lazy editor chunk/CSS size;
- collaboration bytes per second during drag and freehand drawing;
- export time and maximum dimensions.

### 18.7 Accessibility and security tests

- automated axe checks with no serious or critical violations;
- screen-reader and keyboard smoke flows;
- focus trapping and restoration;
- malicious SVG corpus;
- oversized/recursive asset rejection;
- permission bypass attempts through UI, editor API, debug API, and MCP;
- unsafe rich-text links, malformed/oversized documents, and unsupported schema versions.

## 19. Migration and Compatibility Strategy

1. Introduce explicit store-level schema versions in addition to per-shape versions.
2. Maintain immutable migration fixtures for every released document version.
3. Migrate into temporary records, validate, then atomically replace the active document.
4. Preserve unknown and forward-version records without geometry indexing or mutation.
5. Negotiate schema compatibility before joining collaborative sessions.
6. Prevent older clients from silently overwriting structural records they cannot understand.
7. Keep normalized asset snapshots versioned and immutable.
8. Treat restore/import as creation of a new current revision rather than rewriting historical state.
9. Migrate standalone plain text to versioned rich-text JSON only after client-version negotiation and downgrade behavior are defined.

## 20. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Hierarchy introduced without canonical transforms | Persistent selection, routing, and export bugs | Build and test transform service before group UI. |
| Group resize distorts text/strokes | Poor visual quality and incompatible shape behavior | Apply resize through descendant util contracts instead of persistent parent scale. |
| Whole-record collaboration loses concurrent edits | Silent data loss | Use supported changesets and nested/field-level merge rules. |
| Singleton removal touches most Glideboard modules | Regression risk | Introduce controller/context behind compatibility adapter, then migrate component by component. |
| SVG upload enables script or network access | Security incident | Strict server/client sanitization, allowlists, limits, isolated tests, no raw markup append. |
| Assets make documents non-portable | Broken historical boards | Content-addressed immutable document asset snapshots and explicit resolver policy. |
| Culling removes active offscreen objects | Interaction glitches | Overscan and always-retained active/selected/editing IDs. |
| Page and hierarchy migrations break old boards | Data loss | Fixture-based migrations, temporary validation, backups, and forward-compatibility tests. |
| Feature work expands before invariants stabilize | Rework | Enforce phase exit criteria and command/model ownership boundaries. |
| Full document editor is embedded in canvas shapes | Bundle, interaction, and performance regression | Extract a frozen canvas profile, static viewer, isolated CSS, and one active editor per board. |
| Rich-text JSON is mistaken for collaborative text | Silent last-writer-wins data loss | Disclose or guard shape-level editing, then use a per-shape `Y.XmlFragment` before claiming concurrent rich-text support. |
| Editor and Glideboard peer versions diverge | Duplicate TipTap/ProseMirror instances or install failure | Align React support, pin singleton peers, and test React 18/19 host matrices before publishing the canvas entry. |

## 21. Decisions and Open Questions

| Topic | Recommended decision | Status |
| --- | --- | --- |
| Shape hierarchy | `parentId: PageId | ShapeId`; parent-local coordinates | Proposed for approval |
| Children storage | Derived `childrenByParent`; no stored `childIds` | Proposed for approval |
| Group type | Explicit non-visual structural shape | Proposed for approval |
| Group resize | Apply scaling through descendants' resize contracts | Proposed for approval |
| Frame resize | Resize container only; do not scale children by default | Proposed for approval |
| Frame drop | Reparent eligible shapes while preserving world transform | Proposed for approval |
| Lock/visibility | First-class durable structural fields with ancestor inheritance | Proposed for approval |
| Page model | Page records introduced with hierarchy; page UI delivered later | Proposed for approval |
| Ordering | Unique fractional keys scoped to parent; deterministic ID tie-break | Proposed for approval |
| Dynamic uploads | Generic `svg-asset`/`image` shapes, not dynamic schema types | Proposed for approval |
| Asset portability | Immutable content-addressed document assets plus host binary storage | Proposed for approval |
| SVG colors | Support explicit native-color and themeable-monochrome asset modes | Open product decision |
| External clipboard binding | Detach missing target and preserve endpoint geometry | Proposed for approval |
| Editor ownership | One controller/editor per mounted board; no module singleton | Proposed for approval |
| Read-only/permissions | Enforce at command boundary; UI is only presentation | Proposed for approval |
| Collaboration merge | Supported changesets and field-level merge where needed | Requires technical spike |
| Comments | Host-owned first-class threads anchored to page point or shape | Proposed for approval |
| Version history | Server revisions distinct from local undo | Proposed for approval |
| Rich-text architecture | Extract a separately built `@durgakiran/editor/canvas-text` profile; never embed the full document editor | Proposed for approval |
| Rich-text rollout | Standalone text first; generic labels and richer block nodes later | Proposed for approval |
| Rich-text collaboration | Shape-level commit initially; per-shape `Y.XmlFragment` required for simultaneous character-level editing | Proposed for approval |

Questions requiring product confirmation:

1. Should selecting a group require one click with Enter/double-click to drill in, or should repeated click select children?
2. Should a frame clip overflowing children by default?
3. Should deleting a non-empty frame delete its descendants or move them to the parent page? Recommended: offer both, with normal Delete removing the subtree and an explicit Remove Frame preserving children.
4. Are pages part of the near-term Beskar whiteboard product, or only a model foundation for future use?
5. Which asset libraries ship by default, and which can users or administrators install?
6. Must uploaded AWS/vendor icons retain native colors, be recolorable, or support both modes?
7. What board size, asset size, and export size limits apply per account tier?
8. Do comments need view-mode creation and publish visibility rules identical to document comments?
9. What collaboration provider and authoritative persistence flow will production use?
10. What browser, tablet, and stylus support levels are release requirements?
11. Is temporary last-commit-wins editing acceptable when presence shows another active editor, or must rich text remain feature-gated until per-character collaboration is complete?

## 22. Success Metrics

Initial targets to formalize during Phase 0:

- zero known cross-board state leakage;
- zero stale or empty saves during navigation/unmount tests;
- one-step undo for every compound command;
- no mismatch between render order and hit-test order;
- group/ungroup and reparent world-transform error below floating-point tolerance;
- no dangling references after paste, duplicate, delete, import, or collaboration merge;
- bounded mounted DOM on a 10k-shape board;
- agreed 60 fps interaction target on the reference machine for typical boards;
- no serious or critical automated accessibility violations;
- no script execution or external requests from the malicious SVG suite;
- deterministic collaboration convergence in the supported concurrency matrix;
- no more than one mounted TipTap/ProseMirror editor per board and no editor instances for static rich-text shapes;
- lossless JSON round-trip for all released record versions.

## 23. Definition of Done for Every Feature

A whiteboard feature is not complete until it includes:

- documented user behavior and modifier keys;
- command-layer API and permission checks;
- one atomic history boundary;
- hierarchy, page, lock, visibility, and z-order behavior;
- serialization and migrations where data changes;
- collaboration and remote-apply behavior;
- copy, paste, duplicate, delete, import, and export behavior;
- read-only behavior;
- keyboard and accessibility behavior;
- touch behavior when applicable;
- unit/integration/browser coverage;
- performance impact and limits;
- error and recovery behavior;
- public API/export documentation when exposed to consumers.

## 24. Evidence from the Current Code

The key findings above are grounded in the active implementation:

- Flat `GlideShape` record without hierarchy, lock, visibility, or page parent: `packages/glideline/src/types.ts:53`.
- Frame containment capability without hierarchy implementation: `packages/glideline/src/shapes/FrameUtil.ts:54` and `packages/glideline/src/shapes/ShapeUtil.ts:74`.
- Shape-only process-local clipboard: `packages/glideline/src/editor.ts:394`.
- Reorder commands and sequential index rewrite: `packages/glideline/src/editor.ts:458`.
- Canvas rendering from insertion-order shape IDs: `packages/glideboard/src/Canvas.tsx:516`.
- Hard-coded editable label types: `packages/glideline/src/tools/SelectTool.ts:199`.
- Keyboard command coverage and missing Select All/nudge/group wiring: `packages/glideboard/src/WhiteboardApp.tsx:114`.
- Context menu limited to clipboard, ordering, and delete: `packages/glideboard/src/ContextMenu.tsx:62`.
- Engine-only SVG/PNG export surface: `packages/glideline/src/editor.ts:710`.
- Frozen startup schema registration: `packages/glideline/src/schema.ts:28`.
- Module-global Glideboard editor: `packages/glideboard/src/editor.ts:83`.
- Yjs whole-record synchronization adapter: `packages/glideboard/src/collaboration.ts:36`.
- Static built-in toolbar catalogs: `packages/glideboard/src/Toolbar.tsx:40`.
- All shape wrappers mounted by Canvas: `packages/glideboard/src/Canvas.tsx:525`.
- Plain-string `TextProps` and canvas-metric geometry: `packages/glideline/src/shapes/TextUtil.ts:20` and `packages/glideline/src/shapes/TextUtil.ts:40`.
- Native `contentEditable`, `textContent`, and shape-type-specific commit path: `packages/glideboard/src/Canvas.tsx:108` and `packages/glideboard/src/Canvas.tsx:148`.
- Plain-text export helper and formatting-losing `foreignObject` fallback: `packages/glideline/src/styles.ts:296` and `packages/glideline/src/editor.ts:827`.
- Full document extension profile: `packages/editor/src/extensions/index.ts:181`.
- Full editor initialization and two-second update debounce: `packages/editor/src/core/Editor.tsx:153` and `packages/editor/src/core/Editor.tsx:217`.
- Single-entry editor build and TipTap/ProseMirror singleton constraints: `packages/editor/tsup.config.ts:5` and `packages/editor/tsup.config.ts:18`.
- React peer-version mismatch between editor and Glideboard: `packages/editor/package.json:36` and `packages/glideboard/package.json:45`.

## 25. Recommended Next Action

Approve or amend the proposed decisions in Section 21, including the rich-text collaboration release level, then turn **Phase 0 — Correctness and lifecycle hardening** into stories and tasks. Grouping implementation should begin only after the Phase 0 exit criteria and the canonical transform design are accepted.

A time-boxed rich-text foundation spike may run alongside planning work without enabling the feature. It should prove the separate canvas build, React/TipTap singleton compatibility, versioned schema, static rendering, deterministic SVG output, and one-active-editor lifecycle before Phase 4 implementation is estimated.
