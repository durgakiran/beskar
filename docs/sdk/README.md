# Glideline / Glideboard SDK Reference

Deep API reference for [`@durgakiran/glideline`](../../packages/glideline) (a headless canvas engine) and [`@durgakiran/glideboard`](../../packages/glideboard) (a React whiteboard UI built on it). For a shorter, install-and-go introduction to each package, see their package READMEs: [glideline](../../packages/glideline/README.md), [glideboard](../../packages/glideboard/README.md). This tree goes deeper — full method/type surfaces, worked examples, and an explicit stability rating per subsystem.

## Stability legend

Every API on every page in this tree carries one of these markers. **Everything is currently 🔴 Unstable** — this codebase is `0.0.x-alpha` and has one primary internal consumer (`ui`). The taxonomy is defined now so that promoting an API later is a documentation change (flip the badge, note it in a changelog), not a rewrite.

| Marker | Meaning | Consumer expectation |
|---|---|---|
| 🔴 **Unstable** | Shape may change without notice. Implemented and (for most pages) used by at least one real internal consumer, but not hardened or committed to for external callers. | Fine to build on inside this repo; expect to track breaking changes by reading diffs, not a changelog. |
| 🟡 **Experimental** | Shape is settling. Breaking changes are still possible but will be called out explicitly (changelog entry, deprecation note) rather than landing silently. | Safe for an early external adopter who can tolerate occasional migration work. |
| 🟢 **Stable** | Breaking changes follow semver (major-version bump only). | Safe for general external SDK consumers. |

A page's heading states its stability; where a page covers many symbols and only some differ, individual sections call out a narrower marker inline. Sections flagged with an additional **⚠️ Stability note** are, within "everything is Unstable," the ones most likely to actually change shape soon — usually because they're the least exercised by real usage (see each note for specifics).

## Start here: guides

[**Guides**](./guides/README.md) are task-oriented — "how do I add a custom shape," "how do I sanitize a pasted SVG," "how do I add real-time collaboration to a whiteboard." Each one walks a real scenario end-to-end, combining several APIs, and links into the reference below for exact type/method detail. Start here if you know what you're building; use the reference sections below when you already know which API you need and just want its full contract.

## `@durgakiran/glideline`

Headless canvas engine — record store, editor, tools/state-machine, shapes/bindings, content sanitization, AI/MCP integration. No rendering layer, no framework dependency.

- [Overview](./glideline/overview.md) — concepts, install, quick start, reactivity model.
- [Store & Schema](./glideline/store-and-schema.md) — `GlideStore`, `GlideSchema`, transactions, serialization, integrity checks.
- [Editor](./glideline/editor.md) — `GlideEditor`'s full surface: pages, shapes, bindings, selection, clipboard, portable fragments, camera, export.
- [History & Interaction](./glideline/history-and-interaction.md) — undo/redo, batching, conflict detection, the transient live-preview overlay.
- [Tools & State Machine](./glideline/tools-and-state-machine.md) — `StateNode`, the built-in tool library, writing a custom tool.
- [Shapes, Bindings & Styling](./glideline/shapes-and-bindings.md) — `ShapeUtil`/`BindingUtil`, built-in shapes, arrows/routing/binding, the style token system.
- [Content Ingress, Mutation Policy & AI/MCP](./glideline/content-ingress-mutation-and-ai.md) — untrusted SVG/raster/clipboard sanitization, the capability-based mutation gate, the MCP tool server for AI agents.

## `@durgakiran/glideboard`

React whiteboard UI built on `glideline` — a fixed default shape/tool bundle, the full component tree, and collaboration/asset/durability wiring.

- [Overview & Board Lifecycle](./glideboard/overview-and-lifecycle.md) — `<Glideboard>` props, `GlideboardHandle`, session lifecycle, `customShapes`.
- [Collaboration](./glideboard/collaboration.md) — real-time Yjs wiring, presence/awareness, the durability/publish-flow (`checkpoints`, `acquireMutationFence`).
- [Assets](./glideboard/assets.md) — `assetStorage` (user uploads) vs. `assetLibraryProvider` (browsable catalog), and why they're separate.
- [Controller & Theming](./glideboard/controller-and-theming.md) — driving `GlideboardController` headlessly, and the current (unofficial) CSS-variable theming mechanism.

## Hosting this reference

This tree is intentionally just relative-linked Markdown files under `docs/sdk/`, with `glideline/` and `glideboard/` as sibling sections — no build step, no generator-specific syntax. That's a deliberate choice so it can be pointed at by a static docs generator later with minimal rework: this page's structure maps directly to a sidebar/nav (Docusaurus `docs` folder + `sidebars.js`, VitePress `srcDir` + `themeConfig.sidebar`, Mintlify `docs.json` nav, or an mdBook `SUMMARY.md` generated from the same list above). No hosting is set up yet — this is purely written so that step, whenever it happens, is "point a generator at this folder," not "rewrite the docs."
