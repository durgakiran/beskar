# Glideline Whiteboard Design

## Summary

The chosen design is to keep `@durgakiran/glideline` as the core engine and build a separate `@durgakiran/glideboard` package for the reusable React whiteboard UI. `ui` should then consume `glideboard` as a thin Beskar-specific shell. The target production behavior includes whiteboard creation, collaborative edit mode, and read-only view mode with the same route and permission expectations users already have for the document editor.

## Why This Design

Two facts drive the design:

- the target UX already exists in `packages/glideline-demo`
- `ui` is still bound to a different whiteboard implementation

Copying demo code straight into `ui` would create a second long-lived implementation. Extending `packages/whiteboard` would keep the wrong package in place. Moving the React UI into `glideline` would also blur the core/UI boundary. The correct move is:

- `glideline` as the core source of truth
- `glideboard` as the reusable UI layer built on top of the published `glideline` package

## Current Architecture

### Demo path

- [`packages/glideline-demo/src/whiteboard/editor.ts`](/Users/kiran/projects/beskar/packages/glideline-demo/src/whiteboard/editor.ts:1) creates a singleton `wbEditor`.
- [`packages/glideline-demo/src/whiteboard/WhiteboardApp.tsx`](/Users/kiran/projects/beskar/packages/glideline-demo/src/whiteboard/WhiteboardApp.tsx:1) composes canvas, toolbar, style panel, zoom widget, and context menu.
- Persistence is demo-only through `localStorage`.
- The browser bridge is exposed through `window.__GLIDELINE_WHITEBOARD__`.
- The demo currently uses repo-relative imports into `glideline/src/*`, which is an implementation shortcut, not the desired package contract.

### Package path

- [`packages/glideline/src/index.ts`](/Users/kiran/projects/beskar/packages/glideline/src/index.ts:1) exports editor core, tools, shapes, styles, routing, and MCP helpers.
- `glideline` is already published and should be treated as the consumable core dependency for the new UI package.
- There is no `glideboard` package yet.

### Production `ui` path

- [`ui/app/components/WhiteboardEditor.tsx`](/Users/kiran/projects/beskar/ui/app/components/WhiteboardEditor.tsx:1) uses `@durgakiran/whiteboard`, Yjs, and `y-webrtc`.
- Main whiteboard routes are disabled and return placeholder unavailable states.
- Space navigation filters out whiteboard pages.
- `ui` already has signaling and collaborative editor patterns elsewhere, which can be reused for the new whiteboard integration.

### Server path

- Whiteboard CRUD already exists and is separate from document content CRUD.
- The storage column is effectively opaque binary payload storage.
- Fresh-board fetch behavior needs improvement because the current fetch query depends on an existing `core.whiteboard_data` row.

## Target Architecture

### 1. `glideboard` becomes the UI package

`@durgakiran/glideboard` should own:

- a React whiteboard integration layer
- a CSS entrypoint for whiteboard chrome
- optional test/dev helpers for browser automation

Suggested exports:

- `@durgakiran/glideboard`
- `@durgakiran/glideboard/styles.css`

`@durgakiran/glideline` remains the headless core dependency.

### 2. `glideboard` consumes the published `glideline` package

The new UI package should depend on the published core package, not local repo paths.

Target contract:

- `glideboard` imports `@durgakiran/glideline`
- `glideboard` does not import `../glideline/src/*`
- `ui` imports `@durgakiran/glideboard`

This keeps the package boundary real during development and production.

Current caveat:

- if the published `glideline` package does not export everything `glideboard` needs, then either `glideboard` must avoid those internals or `glideline` may need additive export cleanup in a later release

### 3. Page-scoped editor instances

The demo singleton must be replaced with a factory model.

Target pattern:

- one editor instance per mounted whiteboard page
- no global singleton shared across route changes
- no implicit `localStorage` writes
- editor state owned by the consuming surface

Suggested primitives:

```ts
type CreateGlidelineWhiteboardOptions = {
  initialDocument?: GlideDocument | null;
  readOnly?: boolean;
  boardId: string;
};

function createGlidelineWhiteboard(options: CreateGlidelineWhiteboardOptions): GlideEditor;
```

This factory can live in `glideboard` while creating `GlideEditor` instances from the published core package.

### 4. Collaboration architecture

Collaboration is required in whiteboard edit mode.

Recommended split of responsibilities:

- `glideline` remains collaboration-agnostic core logic
- `glideboard` exposes collaboration-aware UI hooks or adapters
- `ui` owns session lifecycle, provider wiring, signaling config, and permission-aware mode selection

Recommended practical direction:

- reuse the existing Yjs/WebRTC-style collaboration approach already present in `ui`
- keep transport/provider concerns outside `glideline`
- let `glideboard` accept a collaboration/session adapter rather than hard-coding Beskar route details

Target behavior:

- edit mode is collaborative for authorized editors
- view mode is read-only
- collaboration awareness is visible in edit mode
- permission boundaries remain enforced by route mode and server checks

### 5. First-party React surface in `glideboard`

The demo whiteboard composition should be moved into reusable React components inside `glideboard`.

Suggested component surface:

```ts
type GlideboardProps = {
  editor: GlideEditor;
  readOnly?: boolean;
  title?: string;
  onRequestClose?: () => void;
  chrome?: "full" | "canvas-only";
};
```

Internal subcomponents can stay package-private or be selectively exported:

- `GlideboardCanvas`
- `GlideboardToolbar`
- `GlideboardStylePanel`
- `GlideboardZoomControls`
- `GlideboardContextMenu`

The important boundary is:

- `glideline` provides the engine
- `glideboard` provides the React UI
- `ui` consumes package exports instead of copied demo files

### 6. Persistence adapter instead of demo `localStorage`

The `glideboard` package should not know Beskar HTTP routes directly. It should accept load/save data from the caller.

Suggested data contract:

```ts
type GlidelineBoardEnvelope = {
  format: "glideline/v1";
  document: GlideDocument;
};
```

`ui` should:

1. fetch the whiteboard payload from the server
2. decode the payload into a `GlidelineBoardEnvelope`
3. create the editor
4. call `editor.deserialize(...)`
5. autosave serialized updates back through existing endpoints

This keeps Beskar-specific routing in `ui`, not in the library.

### 7. Whiteboard data scope

`@durgakiran/whiteboard` was never enabled in production, so this migration does not need a legacy renderer, a migration path, or dual-format compatibility.

Design consequence:

- make the persisted `glideline` payload format explicit for all production boards
- handle only:
  - empty whiteboards
  - `glideline` whiteboards

### 8. Fresh-board server response fix

Current fetch behavior returns empty data when no whiteboard state row exists, which can hide title metadata for new boards.

Required server-side design change:

- fetch whiteboard page metadata even when no `core.whiteboard_data` row exists
- return page title, page id, space id, and nullable board payload

This avoids broken empty-board loads in `ui`.

### 9. Permission and route model

Whiteboards should follow the same broad interaction model users already know from the document editor:

- a read-only viewing experience
- a collaborative editing experience
- server-enforced permission boundaries

Design implications:

- the whiteboard view route must render a read-only board
- the whiteboard edit route must render the collaborative editing board
- edit controls must not be available in read-only mode
- unauthorized edits must fail consistently with server permission checks

If `ui` needs richer whiteboard capability metadata for buttons or actions, that metadata should be added explicitly to the whiteboard-facing APIs rather than inferred ad hoc on the client.

Whiteboards do not need to inherit the document draft/publish workflow in this milestone. "Like the editor" here means route and permission behavior, not document publishing semantics.

### 10. Whiteboard creation model

Whiteboard creation is in scope for the same milestone as view/edit support.

Design implications:

- the add-page flow in `ui` must become type-aware
- users must be able to choose a whiteboard page type when authorized
- whiteboard creation should use the existing server whiteboard create endpoint
- after creation, the user should land in the appropriate whiteboard experience, typically edit mode when they have edit access
- creation UI must respect the existing page-creation permission boundaries

This should be implemented as part of the normal Beskar page creation surfaces rather than as a separate hidden flow.

### 11. `ui` integration shape

`ui` should keep a thin wrapper component responsible for:

- route params
- page title/header behavior
- read-only versus edit mode
- permission-aware route behavior
- whiteboard creation entry flows
- Beskar fetch and save calls
- collaboration provider/session wiring
- optional throttled autosave
- any future collaboration adapter

Target `ui` responsibilities:

- create editor instance
- decode/load persisted state
- select view or edit mode based on route and permission context
- attach collaboration session in edit mode
- flush serialized board changes
- render `<Glideboard ... />`

Target `glideline` responsibilities:

- editor core
- tools and shapes
- geometry/routing
- serialization
- export helpers

Target `glideboard` responsibilities:

- rendering
- tool chrome
- selection overlays
- inline editing UI
- style/zoom/context menu UI
- collaboration-aware UI bindings
- test bridge helpers where needed

### 12. Navigation and page-tree integration

The following `ui` areas must stop filtering out whiteboards:

- [`ui/app/space/[spaceId]/page.tsx`](/Users/kiran/projects/beskar/ui/app/space/[spaceId]/page.tsx:1)
- [`ui/app/space/[spaceId]/layout.tsx`](/Users/kiran/projects/beskar/ui/app/space/[spaceId]/layout.tsx:1)
- [`ui/app/components/sidenav.tsx`](/Users/kiran/projects/beskar/ui/app/components/sidenav.tsx:1)

The add-page flow should become type-aware so Beskar can create whiteboard pages intentionally instead of only document pages.

### 13. Read-only mode

The same `glideboard` renderer should support both modes:

- edit mode: full tool and mutation surface
- view mode: read-only canvas, no mutating controls

This keeps parity between view and edit without maintaining separate renderers while still respecting permission boundaries.

### 14. Browser/test bridge

The demo’s `window.__GLIDELINE_WHITEBOARD__` bridge is useful for automation and regression tests, but it should not be the only integration path.

Recommended design:

- keep a test helper bridge behind a dev/test flag
- do not rely on ad hoc globals as the primary package API
- expose equivalent programmatic hooks through the package for tests

## Rejected Alternatives

### Copy the demo into `ui`

Rejected because it duplicates the implementation and keeps `glideline` underpowered as a published package.

### Extend `packages/whiteboard` instead of creating `glideboard`

Rejected because it keeps the wrong package boundary and does not satisfy the goal of integrating `glideline` with `ui`.

### Put the React UI directly into `glideline`

Rejected because it collapses the core/UI boundary. The desired package split is explicit.

### Keep whiteboards disabled and only swap dependencies later

Rejected because it does not produce a production whiteboard experience and prolongs divergence.

## Testing Design

The migration should preserve the existing `glideline` behavior contracts by moving or duplicating coverage into production-facing tests:

- unit tests for React integration and persistence adapters
- route-level `ui` tests for whiteboard edit/view flows
- whiteboard creation flow tests
- collaboration tests for multi-user edit behavior and awareness
- permission tests for view-only and edit-only paths
- browser tests for:
  - tool creation
  - selection and transforms
  - connector creation and binding previews
  - smart routing
  - read-only rendering

## Rollout Design

Recommended rollout:

1. Build the new `glideboard` package on top of the published `glideline` package.
2. Add the collaboration/session adapter and mode-aware UI surface.
3. Integrate it into `ui` behind a whiteboard-specific feature flag if needed.
4. Finalize the `glideline` board envelope and empty-board handling.
5. Re-enable whiteboard routes and creation flows.
6. Remove `@durgakiran/whiteboard` from `ui`.
7. Publish `glideboard` and pin `ui` to it.
