# Guide: Safely import pasted/uploaded SVG, images, and rich text

**Use case:** a user pastes an SVG from a design tool, drags an image file onto the canvas, or pastes rich HTML from a webpage — and none of that content should be trusted at face value before it becomes part of your document.

**Reference:** [glideline: Content Ingress](../glideline/content-ingress-mutation-and-ai.md#content-ingress-untrusted-svgrasterclipboard-input).

If you're using `glideboard`, most of this is already wired for you through `GlideboardHandle.importSvg`/`importRaster` and paste handling — read this guide if you're driving `glideline` directly, writing a custom paste/drop handler, or just want to understand what's actually being checked.

## SVG

```ts
import { sanitizeSvg, createSanitizedSvgAsset, ContentIngressError } from '@durgakiran/glideline';

async function handlePastedSvg(rawSvgText: string) {
  try {
    const { asset, canonical } = await createSanitizedSvgAsset(rawSvgText, {
      source: 'clipboard-paste',
    });
    editor.createShape({
      type: 'sanitized-svg',
      x: dropPoint.x, y: dropPoint.y,
      props: { assetId: asset.id /* ...see SanitizedSvgAssetProps */ },
    });
  } catch (err) {
    if (err instanceof ContentIngressError) {
      toast(`Couldn't import that SVG: ${err.message}`);
      return;
    }
    throw err;
  }
}
```

`createSanitizedSvgAsset` doesn't escape or "clean up" the input — it re-parses it and rebuilds a new SVG from only a fixed whitelist of container/path attributes and a whitelisted paint-value pattern (hex/`rgb()`/named colors/`none`/`currentColor`). A `<script>` tag, an `onload` handler, an external `<image href="https://...">`, or any attribute not on the whitelist is simply **not present** in the output — there's nothing to bypass because nothing gets a pass-through path. Size/complexity limits (1 MiB, 2,000 elements, 32 levels of nesting) throw `ContentIngressError` rather than hanging on a pathological input.

The resulting asset id is content-addressed (`asset:sha256:<hash>`) — pasting the same SVG twice produces the same asset id, so you get deduplication for free if your `assetStorage` treats asset ids as the identity key.

## Raster images

```ts
import { prepareRasterAsset, ContentIngressError } from '@durgakiran/glideline';

async function handleDroppedFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const prepared = await prepareRasterAsset(bytes, file.type, { source: 'file-drop' });
    // prepared.asset.props.{width,height,mimeType}, prepared.bytes — now safe to upload via your assetStorage
  } catch (err) {
    if (err instanceof ContentIngressError) {
      toast(`Couldn't import "${file.name}": ${err.message}`);
      return;
    }
    throw err;
  }
}
```

`prepareRasterAsset` reads the image's **actual encoded magic bytes** (PNG signature + IHDR chunk, JPEG SOF marker, or WebP VP8X header) and rejects a mismatch against the `declaredMimeType` you pass in (typically `file.type` from a browser `File`). This defends against a real attack class — a file renamed or served with a spoofed `Content-Type` — not just a filename-extension check. It also rejects anything over 20 MiB, larger than 16,384px on a side, or over 64M total pixels, before you spend bandwidth uploading it.

If you're using `glideboard`, this whole flow — plus the actual upload to your storage backend — is `GlideboardHandle.importRaster(bytes, declaredMimeType?)`; see [glideboard: Assets](../glideboard/assets.md#glideboardassetstorage-uploads) for the upload-transaction contract (`prepare`/`stage`/`commit`/`rollback`) it drives.

## Pasted rich text / HTML

```ts
import { normalizeClipboardText } from '@durgakiran/glideline';

function handlePaste(e: ClipboardEvent) {
  const text = normalizeClipboardText({
    html: e.clipboardData?.getData('text/html'),
    text: e.clipboardData?.getData('text/plain'),
  });
  // text is now plain, block-structure-preserved text — safe to drop into a text shape's label
}
```

This is a deliberate design choice, not a temporary shortcut you need to work around: rich HTML pasted from elsewhere (a webpage, a doc) is reduced to plain text with paragraph/line breaks preserved, and `<script>`/`<style>`/`<iframe>`/`<img>`/`<svg>`/`<video>`/`<audio>`/`<form>` are stripped entirely before any text extraction happens. If you need actual rich formatting preserved from paste, that's a real gap against a structured rich-text model that doesn't exist yet in `glideline` — see the source comment on `normalizeClipboardText` — not something to bypass by reaching for the raw `html` field yourself.

## General pattern

Every function in this module throws a single error type, `ContentIngressError`, for every kind of rejection (size, malformed structure, mismatched MIME type). Catch that one type at your paste/drop handler boundary and show the user a message; let anything else propagate as a real bug. Don't pre-validate with your own heuristics (file extension, `<svg` string match) before calling these — that's exactly the class of check these functions replace with something that can't be bypassed by a mismatched extension or a crafted payload.
