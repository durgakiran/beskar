# Overview

**Package:** `@durgakiran/glideline` · **Stability:** 🔴 Unstable

A headless, framework-agnostic canvas engine: a reactive record store, a shape/binding schema system, a state-machine-driven tool layer, undo/redo history, arrow routing/bindings, and a plugin system for adding custom shapes and tools. It has no rendering layer of its own — [`@durgakiran/glideboard`](../glideboard/overview-and-lifecycle.md) is a React UI built on top of it, but you can drive `glideline` directly to build a different UI (canvas/SVG renderer, a non-React framework, headless automation/AI tooling) on the same document model.

Install: `npm install @durgakiran/glideline`. No peer dependencies — pure TypeScript, no DOM requirement (some export paths, like `toSvg`, do call browser SVG APIs).

## Core concepts

| Concept | What it is |
|---|---|
| **Record** | The atomic unit of persisted state: a `GlideShape`, `GlideBinding`, `GlidePage`, or `GlideAsset`. |
| **`GlideSchema`** | Registers which shape/binding types exist, their prop validators, and migrations. Built once, then frozen. |
| **`GlideStore`** | The reactive, transactional record store, backed by [`@preact/signals`](https://preactjs.com/guide/v10/signals/). |
| **`GlideEditor`** | The public API brain — "all mutations flow through it." Created via `createEditor()`. |
| **`GlidePlugin`** | The unit of extension: a bundle of `ShapeUtil`/`BindingUtil` classes and `StateNode` tool classes, installed at editor-creation time. |
| **`ShapeUtil` / `BindingUtil`** | One per record type — geometry, rendering, resize/rotate behavior, prop validation. |
| **`StateNode`** | A hierarchical finite-state-machine node. Tools are `StateNode` subclasses. |

## Quick start

```ts
import { createEditor, BoxUtil, SelectTool, BoxTool } from '@durgakiran/glideline';

const editor = createEditor({
  plugins: [{ id: 'my-app-shapes', shapes: [BoxUtil] }],
  tools: [SelectTool, BoxTool],
  viewport: { width: 1024, height: 768 },
});

editor.createShape({ type: 'box', x: 100, y: 100, props: { w: 200, h: 120 } });
editor.setCurrentTool('select');
editor.undo();
editor.redo();

const doc = editor.serialize();   // JSON-safe GlideDocument
```

`createEditor()` runs a fixed boot sequence: build the schema from your plugins' shapes/bindings (throwing on a duplicate type), freeze it, construct the store/camera/editor, then call each plugin's `onInstall(editor)`. **The shape/binding type set is fixed for the lifetime of an editor instance** — there's no dynamic registration after boot; construct a new editor to change it.

`glideline` ships a full library of shapes and tools, but `createEditor()` starts with nothing installed — you choose the subset via `plugins`. `glideboard`'s internal `createGlideboardEditorInstance()` (see [glideboard: Overview § Default shape & tool set](../glideboard/overview-and-lifecycle.md#default-shape--tool-set-and-customshapes)) is a good reference for the "batteries-included" combination.

## Reactivity

`GlideStore` exposes a `@preact/signals` signal per record via `store.getSignal(id)` (or `editor.getShapeSignal(id)`). Subscribe with `effect()`, or read `.peek()` for a one-off value. `glideboard`'s React layer is built entirely on this pattern — a shape component subscribes only to its own signal, so one shape changing doesn't re-render the whole canvas.

## Page index

- [Store & Schema](./store-and-schema.md) — `GlideStore`, `GlideSchema`, transactions, serialization, integrity.
- [Editor](./editor.md) — `GlideEditor`'s full method surface: pages, shapes, bindings, selection, clipboard, camera, export.
- [History & Interaction](./history-and-interaction.md) — undo/redo, batching, conflict detection, the live-preview overlay.
- [Tools & State Machine](./tools-and-state-machine.md) — `StateNode`, the built-in tools, writing a custom tool.
- [Shapes, Bindings & Styling](./shapes-and-bindings.md) — `ShapeUtil`/`BindingUtil`, built-in shapes, arrows/routing, the style token system.
- [Content Ingress, Mutation Policy & AI/MCP](./content-ingress-mutation-and-ai.md) — untrusted SVG/raster/clipboard sanitization, the capability-based mutation gate, the MCP tool server.
