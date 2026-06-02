# Glideline Whiteboard Implementation Plan

## Summary

This plan moves the whiteboard from demo code to production in four tracks:

1. build `glideboard` on top of the published `glideline` package
2. integrate `glideboard` into `ui`
3. resolve storage and server alignment concerns
4. cut over and remove the old whiteboard dependency

## Phase 0: Decision Gates

Deliverables:

- explicit collaboration/session design choice
- explicit permission/capability contract for whiteboard view and edit routes
- final package/versioning targets for `glideboard`

## Phase 1: Build `glideboard`

### Goals

- move whiteboard UI composition out of demo-only code
- create a dedicated UI package that `ui` can consume
- make the new package use the published `glideline` package directly
- make the package collaboration-capable in edit mode

### Work

- Create `packages/glideboard`.
- Refactor demo whiteboard code into package-owned React components and hooks.
- Replace singleton assumptions with page-scoped editor instance creation.
- Remove direct `localStorage` persistence from the reusable package path.
- Make `glideboard` depend on published `@durgakiran/glideline`.
- Add a collaboration-aware adapter surface for edit mode.
- Bundle and export whiteboard CSS from `glideboard`.
- Preserve the current tool/shape bundle used by the demo.

### Exit Criteria

- `glideline-demo` can consume the new `glideboard` surface instead of private local demo wiring.
- `glideboard` does not use repo-relative imports into `glideline/src/*`.
- `glideboard` exposes a collaboration-capable edit surface and a read-only view surface.
- No required consumer imports `packages/glideline/src/*`.

## Phase 2: Server and persistence alignment

### Goals

- make Beskar whiteboard fetch/save work for the new renderer
- remove empty-board metadata gaps
- support permission-aware view/edit integration in `ui`

### Work

- Update the server whiteboard fetch contract so new boards return title and metadata even before first save.
- Add or expose whatever whiteboard capability/permission metadata `ui` needs for clean route behavior, if current metadata is insufficient.
- Define the persisted `glideline` board envelope format.
- Implement payload encode/decode helpers in `ui`.

### Exit Criteria

- a newly created whiteboard opens successfully before any board state has been saved
- persisted `glideline` boards reload correctly

## Phase 3: `ui` integration

### Goals

- make Beskar routes and navigation use the new whiteboard
- make whiteboard creation available in the same milestone

### Work

- Replace `ui/app/components/WhiteboardEditor.tsx` with a `glideboard`-backed wrapper.
- Wire collaborative edit sessions into the whiteboard edit experience.
- Route whiteboard edit/view pages to the new component instead of unavailable placeholders.
- Remove whiteboard filtering from page trees and side navigation.
- Update add-page flows so authorized users can create whiteboard pages in this same milestone.
- Keep Beskar shell behaviors such as close/back navigation and read-only presentation.

### Exit Criteria

- whiteboard pages are visible in navigation
- authorized users can create new whiteboard pages from the UI
- whiteboard edit mode works in `/space/.../edit/...` and `/edit/...`
- whiteboard view mode works in `/space/.../view/...`
- collaboration works for authorized editors
- view/edit permission boundaries behave correctly

## Phase 4: Validation and cutover

### Goals

- prove production parity and remove the old dependency safely

### Work

- Port or recreate the current glideline whiteboard browser coverage against `ui`.
- Add tests for load/save, empty board, and read-only mode.
- Add tests for whiteboard creation flows.
- Add tests for collaborative editing and permission boundaries.
- Run manual QA against the production shell:
  - tool switching
  - shape creation
  - text editing
  - selection, resize, rotation
  - arrow routes and smart routing
  - whiteboard creation
  - multi-user collaboration
  - view-only versus edit-capable access
  - page navigation and refresh persistence
- Remove `@durgakiran/whiteboard` from `ui/package.json`.
- Add `@durgakiran/glideboard` to `ui/package.json`.
- Publish `glideboard` and update `ui` to consume it.

### Exit Criteria

- feature parity checklist passes
- dependency removal is complete
- whiteboard routes are enabled in `ui`

## Suggested Task Breakdown

### Track A: `glideboard` package work

- scaffold `packages/glideboard`
- extract reusable whiteboard React components from demo
- add stable exports
- add CSS export
- add instance factory and remove singleton assumptions
- ensure all imports use the published `@durgakiran/glideline` package
- add collaboration/session adapter APIs
- add tests around the React integration layer

### Track B: `ui` integration work

- replace `WhiteboardEditor`
- wire edit-mode collaboration
- re-enable routes
- restore whiteboards in page trees
- enforce view/edit permission behavior in the route flows
- update page creation flows to support whiteboards

### Track C: server/persistence work

- fix fresh-board fetch response
- expose whiteboard capability metadata if needed by `ui`
- finalize board envelope format

### Track D: QA and rollout work

- production browser coverage
- whiteboard creation validation
- multi-user collaboration validation
- permission boundary validation
- manual regression pass
- publish and version pinning

## Risks

### R1. Demo code is not package-ready

Impact:

- singleton editor, `localStorage`, and window globals can leak state across pages
- current demo imports are not aligned with the intended published-package contract

Mitigation:

- treat refactoring into a dedicated `glideboard` package as mandatory, not optional cleanup

### R2. Published `glideline` surface may be insufficient

Impact:

- `glideboard` may discover that some required core APIs are not available from `@durgakiran/glideline@0.0.1`

Mitigation:

- verify the package contract early in Phase 1
- if gaps exist, decide explicitly whether to adapt `glideboard` or make additive core exports in a later `glideline` release

### R3. Collaboration integration complexity

Impact:

- collaboration is required, but `glideline` today is a core editor package rather than a CRDT-native collaboration package

Mitigation:

- make the collaboration/session adapter design explicit in Phase 0
- validate multi-client behavior early rather than after the full UI cutover

### R4. Hidden production route assumptions

Impact:

- re-enabling whiteboards may uncover shell/layout issues not visible in the demo

Mitigation:

- validate edit mode and view mode inside the actual Beskar route structure early

### R5. Permission-model mismatches between route UX and API responses

Impact:

- `ui` may need richer whiteboard capability metadata than current endpoints provide

Mitigation:

- identify the required capability contract in Phase 0 and add API support if needed

## Verification Checklist

- New empty whiteboard opens with correct page title.
- Existing `glideline` whiteboard reloads after refresh.
- Authorized users can create a new whiteboard page from the UI.
- Whiteboards are visible in navigation.
- Edit mode and view mode both render correctly.
- Authorized users can collaborate on the same board in edit mode.
- View-only users cannot mutate the board.
- Demo tool surface exists in `ui`.
- Smart routing and binding previews still behave correctly.
- `ui` has no `@durgakiran/whiteboard` dependency.
- `glideboard` consumes the published `glideline` package directly.
- `ui` consumes `glideboard` only, not demo code.

## Recommended Sequence

1. Build `glideboard` on top of the published `glideline` package.
2. Define and validate the collaboration/session adapter.
3. Fix server fetch semantics for fresh boards and any needed capability metadata.
4. Implement storage envelope and empty-board handling.
5. Swap `ui` routes to `glideboard`.
6. Re-enable whiteboard navigation and creation flows.
7. Port browser coverage and collaboration/permission/creation tests to `ui`.
8. Remove the old dependency and publish `glideboard`.
