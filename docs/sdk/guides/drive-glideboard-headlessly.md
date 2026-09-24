# Guide: Drive a glideboard session without the `<Glideboard>` component

**Use case:** you need `glideboard`'s default shape/tool bundle, asset/collaboration/durability wiring, and document lifecycle — but not its React component tree. Examples: a server-side job that opens a board's document, applies edits (e.g. bulk-inserting shapes from an import), and re-serializes it; a different UI framework than React; or a custom canvas host that only wants to borrow `glideboard`'s editor wiring, not its toolbar/panels.

**Reference:** [glideboard: Controller & Theming](../glideboard/controller-and-theming.md#glideboardcontroller).

If you don't need `glideboard`'s specific default shape/tool bundle at all, consider going straight to `glideline`'s `createEditor()` instead (see [glideline: Overview § Quick start](../glideline/overview.md#quick-start)) — `GlideboardController` is the right layer only when you specifically want glideboard's asset/collaboration/durability plumbing without its rendering.

## Construct and use a controller directly

```ts
import { GlideboardController } from '@durgakiran/glideboard';

const controller = new GlideboardController({
  sessionKey: 'batch-job-1',
  initialDocument: loadedDocument,
  initialDocumentDisposition: { kind: 'acknowledged-baseline', durableRevision: '42' },
  assetStorage: myAssetStorage,   // optional — only needed if the edits you're making touch assets
});

controller.editor.createShape({ type: 'box', x: 0, y: 0, props: { w: 100, h: 60 } });

const updated = controller.serialize();
await controller.dispose();   // always dispose when you're done — see below
```

`controller.editor` is the underlying `glideline` `GlideEditor` — every method from [glideline: Editor](../glideline/editor.md) is available on it directly. `GlideboardController` itself adds the glideboard-specific layer on top (asset import jobs, collaboration attach/detach, document-change tracking, arrow-style defaults) — see the reference page for the full method list.

## Always call `dispose()`

Unlike `<Glideboard>` (which disposes its controller automatically on unmount), a directly-constructed `GlideboardController` has nothing tearing it down for you. Skipping `dispose()` after you're done with a controller leaks whatever it attached — collaboration bindings, in-flight asset-import abort controllers, debug hooks:

```ts
try {
  const controller = new GlideboardController({ sessionKey: jobId, ... });
  await runBatchEdit(controller);
  return controller.serialize();
} finally {
  await controller.dispose({ pendingSave: 'cancel' });
}
```

This matters most in a long-running process (a server handling many jobs, a test suite creating many controllers) where leaked collaboration bindings or abort controllers accumulate across iterations rather than being caught by a page unload.

## Server-side batch document edits

```ts
async function bulkInsertFromImport(document: GlideDocument, rows: ImportRow[]): Promise<GlideDocument> {
  const controller = new GlideboardController({
    sessionKey: `import-${Date.now()}`,
    initialDocument: document,
    initialDocumentDisposition: { kind: 'acknowledged-baseline', durableRevision: '0' },
  });
  try {
    controller.editor.batch('Bulk import', () => {
      for (const row of rows) {
        controller.editor.createShape({ type: 'sticky-note', x: row.x, y: row.y, props: { text: row.label } });
      }
    });
    return controller.serialize();
  } finally {
    await controller.dispose();
  }
}
```

This gets you glideboard's exact default shape set (so a document produced this way opens identically in an interactive `<Glideboard>` later) without ever touching React, DOM, or a browser — useful for import pipelines, scheduled document maintenance, or generating starter templates.

## Driving collaboration without `<Glideboard>`

```ts
const cleanup = controller.attachCollaboration({
  doc: yDoc,
  provider: { awareness: provider.awareness, synced: provider.synced },
  user: currentUser,
});
// ... later
cleanup();   // or controller.detachCollaboration()
```

Same contract as `<Glideboard>`'s `collaboration` prop (see [Add real-time collaboration](./add-realtime-collaboration-to-glideboard.md)) — the component is a thin wrapper that calls exactly this on mount/prop-change/unmount, so if you're building a custom rendering layer around `glideboard`'s document/collaboration semantics, this is the seam to hook.

## What you don't get without `<Glideboard>`

No rendering, obviously — but also no default keyboard shortcuts, no toolbar/panel components, and no `GlideboardHandle`-style convenience wrapper (you call controller methods directly, which is a slightly different surface than the ref handle — see the [Controller & Theming reference](../glideboard/controller-and-theming.md#method-groups) for exactly what's controller-only vs. handle-exposed). If what you actually want is a different *rendering* of the same editing surface (not no UI at all), you're likely better off consuming `controller.editor` directly and building your own presentation layer against `glideline`'s reactive signals, rather than trying to make `GlideboardController` do UI-adjacent work it isn't designed for.
