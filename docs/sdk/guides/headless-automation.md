# Guide: Drive glideline with no UI at all

**Use case:** generate or transform documents server-side (bulk-create diagrams from data, migrate a batch of saved documents to a new schema version), test business logic against the editor without mounting any component, or build a rendering/export pipeline that never shows a canvas on screen.

**Reference:** [glideline: Editor](../glideline/editor.md), [glideline: Store & Schema](../glideline/store-and-schema.md).

`glideline` has no DOM dependency in its core editor/store logic (SVG *export* functions do use browser SVG APIs — see the caveat at the end). A headless editor is exactly the same `createEditor()` call as an interactive one; you simply never wire pointer events into it.

## Generate a document from data

```ts
import { createEditor, BoxUtil, TextUtil, SelectTool } from '@durgakiran/glideline';

function buildOrgChart(people: { id: string; name: string; managerId: string | null }[]) {
  const editor = createEditor({
    plugins: [{ id: 'org-chart', shapes: [BoxUtil, TextUtil] }],
    tools: [SelectTool],
  });

  const shapeIdByPersonId = new Map<string, string>();
  editor.batch('Generate org chart', () => {
    for (const [i, person] of people.entries()) {
      const id = editor.createShape({
        type: 'box', x: (i % 5) * 160, y: Math.floor(i / 5) * 100,
        props: { w: 140, h: 60, label: person.name },
      });
      shapeIdByPersonId.set(person.id, id);
    }
    // ...create arrow bindings between manager/report shapes here, if needed.
  });

  return editor.serialize();   // GlideDocument — persist this, or return it from an API route
}
```

Wrap the whole generation in one `editor.batch(label, fn)` — not for undo purposes (nobody's going to hit Ctrl+Z on a server), but because it means every intermediate write is staged and validated as one transaction rather than N separate store commits, which is both faster and means a mid-generation failure doesn't leave a partially-written document sitting in the store (`editor.batch`'s `fn` running to completion, or the whole transaction rolling back on a thrown error, is the same guarantee interactive code relies on — see [History & Interaction](../glideline/history-and-interaction.md)).

## Migrate a batch of saved documents

```ts
import { createEditor } from '@durgakiran/glideline';

async function migrateDocument(doc: GlideDocument, plugins: GlidePlugin[]) {
  const editor = createEditor({ plugins, tools: [] });   // no tools needed — we're not drawing
  const report = editor.replaceDocument(doc);             // runs schema validation + migrations
  if (report.warnings.length > 0 || report.repairs.length > 0 || report.opaqueRecordIds.length > 0) {
    console.warn(`Document ${doc}: ${report.migrations.length} migration(s), ` +
      `${report.repairs.length} repair(s), ${report.opaqueRecordIds.length} unrecognized record(s)`, report);
  }
  return editor.serialize();   // re-save the migrated form
}
```

`replaceDocument`'s `LoadReport` (`sourceStoreVersion`, `targetStoreVersion`, `recordCount`, `migrations`, `opaqueRecordIds`, `repairs`, `warnings`) tells you what happened during load — check it in a batch job rather than assuming every stored document loads cleanly, especially `opaqueRecordIds` (records of a type the current schema doesn't recognize — often a sign you're migrating a document written by a newer or differently-plugin'd version of your app) and `repairs` (integrity issues the loader fixed automatically), not just outright validation failures. `tools: []` is legitimate here: you only need tools if you're going to call `editor.setCurrentTool()`/`dispatchEvent()`; pure data manipulation (`createShape`, `updateShape`, `serialize`) doesn't touch the tool layer at all.

## Testing business logic against a real editor

```ts
import { createEditor, BoxUtil, SelectTool } from '@durgakiran/glideline';

test('deleting a frame keeps its children on the page', () => {
  const editor = createEditor({ plugins: [{ id: 't', shapes: [BoxUtil, FrameUtil] }], tools: [SelectTool] });
  const frameId = editor.createShape({ type: 'frame', x: 0, y: 0, props: { w: 400, h: 300 } });
  const childId = editor.createShape({ type: 'box', x: 20, y: 20, parentId: frameId, props: { w: 40, h: 40 } });

  editor.removeFramesKeepContent([frameId]);

  expect(editor.getShapePageId(childId)).toBe(editor.getActivePageId());
});
```

Every built-in shape/tool in this repo is tested exactly this way — `createEditor()` + direct method calls, no rendering, no `jsdom`/`happy-dom` required unless the specific code path you're testing touches the DOM (SVG export, below). This is meaningfully faster and more deterministic than mounting `glideboard` in a test environment when what you're actually testing is editor/document logic.

## The DOM caveat

`ShapeUtil.toSvg()`/`toSvgExport()` and `editor.exportToSvg()`/`exportToPng()` call browser SVG DOM APIs (`document.createElementNS`, ...) — these need a DOM, real or polyfilled (`happy-dom`/`jsdom`, which is what this repo's own test suite uses for export-path tests). Pure document manipulation (create/update/delete/serialize/replaceDocument) has no such requirement and runs fine in plain Node.
