# Guide: Export a canvas, and copy/paste across documents

**Use case:** an "export as PNG/SVG" button, a thumbnail generator, or letting a user copy shapes from one board and paste them into a different one (different tab, different document, possibly a different app entirely) — as opposed to copy/paste within a single editor instance, which `editor.copy()`/`editor.paste()` already handle.

**Reference:** [glideline: Editor § Portable fragments](../glideline/editor.md#portable-fragments-cross-document-copypaste), [glideline: Editor § Serialize, import, export](../glideline/editor.md#serialize-import-export).

## Export to SVG or PNG

```ts
const svg = editor.exportToSvg(selectedShapeIds);           // string
const svgWholePage = editor.exportRegionToSvg(editor.getViewportBounds());
const png = await editor.exportToPng(selectedShapeIds, { scale: 2 });   // Blob
```

`exportToPng` renders through the SVG export path at the given `scale` — use `scale: 2`+ for retina-quality thumbnails, not just `scale: 1` and CSS-scaling the result. Both need a DOM (real or `happy-dom`/`jsdom` in a server context) — see [Headless automation § The DOM caveat](./headless-automation.md#the-dom-caveat) if you're calling this outside a browser.

If you need the export to embed asset bytes safely (an SVG that references an image asset, going somewhere outside your app's own asset-resolution context), use `exportToPortableSvg(...)` instead of `exportToSvg` — it produces `PortableRasterExport`/`PortableRasterPayload`-shaped output designed for that boundary rather than assuming the receiving context can resolve your internal asset URLs.

## Copy/paste within one editor instance

```ts
editor.copy(selectedShapeIds);
const pastedIds = editor.paste(pointerPosition);
```

Fine for "copy this, paste it back in the same board" — it's not size-bounded or schema-versioned the way portable fragments are, because it never has to leave the editor's own memory.

## Copy/paste across documents (or apps)

Anything crossing a document boundary — a real OS clipboard, a network hop, a different app entirely — needs the portable-fragment API instead, because it validates defensively on the way back in rather than trusting that whatever's on the clipboard is well-formed:

```ts
const fragment = await editorA.createPortableBoardFragment({ shapeIds: selectedShapeIds });
// fragment is a plain, JSON-serializable, schema-versioned, size-bounded object —
// put it on the system clipboard, send it over the wire, whatever your transport is.

const newShapeIds = await editorB.pastePortableBoardFragment(fragment, { point: dropPoint });
```

- The fragment is validated structurally on paste (exact key sets, bounded JSON size per section) — a corrupted or foreign-origin payload throws rather than partially applying.
- If the fragment references assets, the *pasting* editor needs its own way to materialize them — this is `PortableAssetMaterializer`/`PortableAssetExportHook` (in `glideboard`, this is `GlideboardAssetStorage.materializePortableAsset`/`retainReferences` — see [glideboard: Assets](../glideboard/assets.md#glideboardassetstorage-uploads)). If asset materialization fails partway through a paste, the whole paste rolls back — you get a `PortablePasteRollbackError` (carrying both the original failure and any rollback errors) rather than a half-pasted, asset-broken result.
- `PORTABLE_BOARD_FRAGMENT_LIMITS` caps the payload — a fragment with too many records or too much metadata throws when you try to *create* it, not silently truncating. If you're copying a very large selection, catch this and tell the user rather than assuming export always succeeds.

## Putting a fragment on the real system clipboard

`createPortableBoardFragment`/`pastePortableBoardFragment` produce/consume the data; they don't touch `navigator.clipboard` for you (there's no DOM/browser assumption baked into the editor layer). Serialize the fragment (`JSON.stringify`) into a custom MIME type on the clipboard event (or your own transport for a non-browser paste path), and parse it back out — the shape/size validation described above is what makes it safe to trust clipboard content you didn't produce yourself in the same session.
