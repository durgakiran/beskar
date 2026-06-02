# Glideline Whiteboard Requirements

## Summary

Beskar already has:

- a published `@durgakiran/glideline` package at `0.0.1`
- a richer whiteboard demo implemented in [`packages/glideline-demo`](/Users/kiran/projects/beskar/packages/glideline-demo)
- an older `@durgakiran/whiteboard` integration wired into [`ui`](/Users/kiran/projects/beskar/ui), but currently hidden from the main whiteboard routes

The requirement is to build a new `glideboard` UI package on top of the published `@durgakiran/glideline` core package, achieve feature parity with the demo whiteboard, and replace the existing `@durgakiran/whiteboard` dependency in `ui`.

## Current State

- `packages/glideline-demo` contains the target whiteboard UX: tools, selection, resize/rotate, text editing, style panel, zoom controls, context menu, arrow routing, and smart routing/browser bridge coverage.
- `packages/glideline` exports the editor core, tools, shapes, routing, AI/MCP helpers, and export APIs. It is the core package, not the intended long-term React whiteboard UI package.
- `ui/app/components/WhiteboardEditor.tsx` still depends on `@durgakiran/whiteboard` and its Yjs store.
- `ui` edit/view routes currently return "Whiteboards are temporarily unavailable."
- `ui` space overview and layout filter whiteboard pages out of navigation.
- Server whiteboard CRUD endpoints already exist in [`server/editor/whiteboardController.go`](/Users/kiran/projects/beskar/server/editor/whiteboardController.go:1) and [`server/editor/whiteboardService.go`](/Users/kiran/projects/beskar/server/editor/whiteboardService.go:1).

## Problem Statement

The production app and the active whiteboard implementation have diverged:

- the best whiteboard experience lives only in demo code
- the production app does not yet have a dedicated `glideboard` package that turns the published `glideline` core into a reusable React whiteboard UI
- `ui` still carries an older tldraw-based whiteboard dependency
- whiteboard pages are not currently available through the main edit/view flows

The migration must unify these paths so `ui` uses one whiteboard system built as:

- `glideline` = core
- `glideboard` = reusable whiteboard UI
- `ui` = Beskar integration shell

## Goals

- Replace `@durgakiran/whiteboard` usage in `ui` with a new `@durgakiran/glideboard` package.
- Bring the demo whiteboard feature set into `ui`.
- Let authorized users create new whiteboard pages in the same milestone.
- Support live collaboration in whiteboard edit mode.
- Restore whiteboard page access in edit mode and view mode.
- Match the document editor’s route model for whiteboards: separate viewing and editing experiences with the correct permission boundaries.
- Re-enable whiteboard visibility in page trees and space navigation.
- Keep the existing server-side whiteboard page model and permission model.
- Keep `glideline` as the headless core package.
- Make `glideboard` consume the published `@durgakiran/glideline` package directly rather than using repo-relative imports.

## Non-Goals

- Rebuilding the Beskar page, space, or permission model.
- Keeping the old tldraw renderer inside `ui` after cutover.
- Designing brand-new whiteboard features beyond current demo scope.
- Solving generalized cross-product plugin extensibility in this milestone.
- Introducing a document-style publish/draft workflow for whiteboards in this milestone.

## Assumptions and Open Preconditions

- The server whiteboard endpoints remain the system of record for page creation, fetch, update, and delete.
- `glideline` remains the only core engine for newly created production whiteboards.
- `glideboard` becomes the only supported reusable whiteboard UI package for Beskar.
- `@durgakiran/whiteboard` was never enabled in production, so legacy whiteboard data compatibility is out of scope for this migration.

## User Stories

- As a user, I can open a whiteboard page in `ui` edit mode and use the `glideboard` whiteboard instead of the placeholder unavailable message.
- As a user, I can open a whiteboard page in `ui` view mode and see the same board in read-only mode.
- As a user with permission to create pages, I can create a new whiteboard page from the Beskar UI.
- As a user, I can collaborate with other editors on the same whiteboard in edit mode.
- As a user with view-only access, I can view a whiteboard but cannot edit it.
- As a user without edit permission, I cannot use the whiteboard edit experience.
- As a user, I can create, discover, and navigate to whiteboard pages from the normal Beskar page tree.
- As a user, I can use the same tools and editing interactions that exist in the demo whiteboard.
- As a product team, we can ship whiteboard UI changes through `glideboard` while keeping `glideline` as the stable core engine.

## Functional Requirements

### FR1. Single whiteboard implementation in `ui`

- `ui` must stop importing `@durgakiran/whiteboard`.
- `ui` must render whiteboards through `@durgakiran/glideboard`.
- The old `packages/whiteboard` integration must no longer be part of the active `ui` path.

### FR2. Package boundaries and dependency contract

- `glideboard` must consume the published `@durgakiran/glideline` package directly.
- `glideboard` must not import from `packages/glideline/src/*`.
- `ui` must not import from `packages/glideline/src/*` or from `packages/glideboard/src/*`.
- `glideline` remains the core package.
- `glideboard` becomes the UI package.
- The package contract must support:
  - creating a page-scoped editor instance
  - rendering the whiteboard canvas and chrome
  - loading and saving serialized board state
  - read-only rendering
  - selection, tool, and style state integration

### FR3. Demo whiteboard feature parity

The `ui` whiteboard must include the feature set proven in `glideline-demo`, including:

- tools: select, hand, rectangle, ellipse, triangle, diamond, hexagon, star, text, sticky note, draw, eraser, connector presets
- selection marquee
- resize handles
- rotation handle for eligible selections
- inline text editing
- style panel for shape and arrow properties
- zoom controls and fit-to-screen
- context menu actions
- clipboard actions
- undo and redo
- shape duplication and z-order changes
- arrow binding previews
- curve, ortho, and smart routing
- smart-route obstacle avoidance behavior covered by current browser tests

### FR4. Route restoration in `ui`

- Whiteboard edit routes must open the new `glideboard` editor in collaborative edit mode.
- Whiteboard view routes must open the new `glideboard` board in read-only mode.
- The current temporary unavailable states in:
  - [`ui/app/space/[spaceId]/edit/[page]/page.tsx`](/Users/kiran/projects/beskar/ui/app/space/[spaceId]/edit/[page]/page.tsx:1)
  - [`ui/app/space/[spaceId]/view/[page]/page.tsx`](/Users/kiran/projects/beskar/ui/app/space/[spaceId]/view/[page]/page.tsx:1)
  - [`ui/app/edit/[...slug]/page.tsx`](/Users/kiran/projects/beskar/ui/app/edit/[...slug]/page.tsx:1)
  must be removed for whiteboards.

### FR5. Permission boundaries and route semantics

- Whiteboards must support separate view and edit experiences in `ui`, analogous to the document editor route model.
- Users with whiteboard view permission must be able to load the read-only whiteboard route.
- Users with whiteboard edit permission must be able to load the collaborative edit route.
- Users with permission to create pages must be able to create new whiteboard pages from `ui`.
- Users without permission to create pages must not be able to create whiteboard pages.
- Users without whiteboard edit permission must not be able to mutate whiteboards through the edit experience.
- Whiteboard UI controls must respect mode and permission:
  - page creation entry points only appear or succeed for authorized users
  - edit mode shows editing tools for authorized users
  - view mode is read-only
  - unauthorized edit attempts must fail consistently with server permission checks
- The solution must use the existing Beskar page/whiteboard permission model rather than inventing a separate permission system.

### FR6. Whiteboard page discovery

- Whiteboard pages must appear in the page tree and other navigation surfaces where page type is supported.
- Current whiteboard filtering in:
  - [`ui/app/space/[spaceId]/page.tsx`](/Users/kiran/projects/beskar/ui/app/space/[spaceId]/page.tsx:1)
  - [`ui/app/space/[spaceId]/layout.tsx`](/Users/kiran/projects/beskar/ui/app/space/[spaceId]/layout.tsx:1)
  - [`ui/app/components/sidenav.tsx`](/Users/kiran/projects/beskar/ui/app/components/sidenav.tsx:1)
  must be removed or replaced with type-aware rendering.
- Whiteboard icons and type labels must remain consistent with the existing Beskar page model.

### FR7. Whiteboard creation flows

- `ui` must provide a way for authorized users to create whiteboard pages in the same milestone.
- The add-page flow must become type-aware so users can choose a whiteboard page type.
- Creating a whiteboard page must route through the existing server whiteboard creation path.
- A newly created whiteboard page must open successfully in the correct mode after creation.
- Whiteboard creation must respect the same permission boundaries as other page-creation flows.

### FR8. Collaboration

- Whiteboard edit mode must support multi-user collaboration.
- Collaboration must preserve shared board state across concurrent editors.
- Collaboration must include collaborator awareness sufficient for a production editing experience.
- The collaboration design must work within Beskar’s existing client/network model and permission boundaries.
- Collaboration must not grant edit ability to users who only have view access.

### FR9. Persistence and loading

- Whiteboards must load persisted server state when a page opens.
- Whiteboards must save state back through existing whiteboard update endpoints.
- Fresh whiteboards with no saved board data must still return enough metadata to open correctly, including page title.
- Read-only mode must not mutate persisted state.

### FR10. Data format/versioning

- Persisted `glideline` board data must use an explicit, versioned payload format.
- The implementation must define how to distinguish:
  - empty whiteboards
  - `glideline` whiteboards
- Legacy `@durgakiran/whiteboard` payload compatibility is not required.

### FR11. Beskar shell integration

- The whiteboard must fit the existing Beskar page shell in edit and view mode.
- The whiteboard header/chrome must follow `ui` navigation expectations for close/back actions.
- The final integration must work inside Next.js client rendering constraints.

### FR12. Testable production parity

- The feature set must be represented by automated tests against the production integration, not only against the demo.
- The current `glideline` browser coverage for routing, selection, and tool behavior must be portable to `ui` or equivalent shared harnesses.

### FR13. Dependency replacement

- `ui/package.json` must no longer depend on `@durgakiran/whiteboard`.
- `ui/package.json` must depend on `@durgakiran/glideboard`.
- `glideboard` must depend on the published `@durgakiran/glideline` package rather than repo-relative imports.
- If the published `glideline` surface is insufficient, the gap must be called out explicitly before deciding whether `glideline` needs additive exports in a later version.

## Acceptance Criteria

- Opening a whiteboard in `ui` edit mode shows the `glideboard` whiteboard, not an unavailable placeholder.
- Opening a whiteboard in `ui` view mode shows the same board in read-only mode.
- An authorized user can create a new whiteboard page from the UI and land in the correct whiteboard flow.
- Two authorized editors can collaborate on the same whiteboard in edit mode.
- A view-only user can open the whiteboard but cannot edit it.
- A user without edit permission cannot use the whiteboard editing route successfully.
- Whiteboard pages appear in the space page tree and can be navigated normally.
- The tool surface in `ui` matches the demo whiteboard tool set.
- Selection, resize, rotation, text editing, style editing, zoom, and context menu behavior work in `ui`.
- Connector creation, binding previews, and smart routing work in `ui`.
- `ui` no longer imports or depends on `@durgakiran/whiteboard`.
- `glideboard` consumes `glideline` through published package exports only.
- The persisted `glideline` board envelope is defined and used consistently.

## Launch Risks

- The new `glideboard` package does not yet exist.
- The currently published `glideline` package may not expose every symbol the new UI package needs.
- Collaboration adds state-synchronization complexity beyond the current single-editor demo wiring.
- Demo code currently relies on a singleton editor, `localStorage`, and window globals that are not production-safe as-is.
- Fresh whiteboard fetch behavior appears incomplete because the current whiteboard fetch path only returns rows when board data already exists.
