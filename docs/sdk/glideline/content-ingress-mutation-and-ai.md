# Content Ingress, Mutation Policy & AI/MCP

**Package:** `@durgakiran/glideline` · **Stability:** 🔴 Unstable (all APIs on this page)

Three security- and trust-boundary-shaped subsystems, grouped together because each one is about **what's allowed to enter or act on the document, and from where**.

## Content ingress (untrusted SVG/raster/clipboard input)

`content-ingress.ts` turns untrusted pasted or uploaded bytes into safe, storable assets. Every limit below is enforced, not advisory — inputs that exceed them throw `ContentIngressError` rather than being silently truncated.

```ts
sanitizeSvg(source: string): SanitizedSvg
createSanitizedSvgAsset(source: string, provenance?: AssetProvenance): Promise<PreparedSanitizedSvgAsset>
prepareRasterAsset(bytes: Uint8Array, declaredMimeType?: string, provenance?: AssetProvenance): Promise<PreparedRasterAsset>
normalizeClipboardText(input: { html?: string; text?: string }): string
validateAssetRecord(record: AnyRecord): void
```

- **`sanitizeSvg`** parses arbitrary SVG text into a `SanitizedSvg` (`{ width, height, viewBox, paths: SanitizedSvgPath[] }`) containing only whitelisted path/container attributes (`d`, `fill`, `stroke`, `stroke-width`, `opacity`, ..., `viewBox`, `width`, `height`) and a whitelisted paint-value shape (`SAFE_PAINT`: `none` / `currentColor` / hex / `rgb()`/`rgba()` / named color). Anything else — `<script>`, event handlers, external references, arbitrary attributes — is dropped, not escaped-and-kept. Bounded at 1 MiB, 2,000 elements, and 32 levels of nesting.
- **`createSanitizedSvgAsset`** wraps `sanitizeSvg` and produces a content-addressed `PreparedSanitizedSvgAsset` — the asset id is `asset:sha256:<hash of the canonical sanitized form>`, so identical SVG content always produces the same asset id (dedup for free).
- **`prepareRasterAsset`** validates the raster's *actual* encoded bytes (PNG magic bytes + IHDR, JPEG SOF marker, or WebP VP8X header) against a `declaredMimeType`, rejecting a mismatch — this is a real defense against MIME-type spoofing, not a filename/extension check. Bounded at 20 MiB, 16,384px per dimension, 64M pixels.
- **`normalizeClipboardText`** deliberately reduces pasted rich HTML to plain text ("until a structured rich-text model exists" — source comment): strips `script`/`style`/`iframe`/`object`/`embed`/`img`/`svg`/`video`/`audio`/`form` entirely and keeps only block-level line breaks. Bounded at 1 MiB per field.
- **`validateAssetRecord`** is the schema-level guard called when an asset record is written to the store directly (not through the ingress helpers above).
- **`AssetProvenance`** fields are capped at 2048 chars each and non-string values are dropped — provenance metadata is for display/audit, not for smuggling arbitrary data into a record.

`glideboard`'s `GlideboardHandle.importSvg`/`importRaster` and `GlideboardAssetStorage` are the consumer-facing wrapper around this layer — see the [glideboard docs](../glideboard/assets.md).

## Mutation policy

A capability-based gate in front of every store write, keyed by *where the mutation claims to originate*.

```ts
type MutationOrigin = 'local-user' | 'local-api' | 'remote' | 'load' | 'system';

interface MutationRequest {
  readonly origin: MutationOrigin;
  readonly command: string;
  readonly affectedIds: readonly string[];
}

interface MutationPolicy {
  authorize(request: MutationRequest): 'allow' | 'deny';
}

const allowAllMutations: MutationPolicy;   // authorize() → always 'allow'

interface MutationCapability { /* opaque, identity-checked, not forgeable by structural typing */ }
function createMutationCapability(): MutationCapability;

interface MutationCapabilityGrant {
  readonly capability: MutationCapability;
  readonly origins: readonly MutationOrigin[];
}

class MutationPermissionError extends Error {
  readonly code: 'MUTATION_PERMISSION_DENIED';
  readonly request: MutationRequest;
}
```

`MutationCapability` is branded with a `unique symbol` field — it can't be produced by an object literal that merely matches its shape, only by `createMutationCapability()`. This is the mechanism `glideboard`'s collaboration layer uses to distinguish "this write came from a locally-created, editor-trusted transaction" from "this write is a raw remote payload replaying into the store" — a remote peer is granted a capability scoped to `origins: ['remote']` and nothing else, so it cannot forge a `'local-user'`-origin write even if it controls the wire payload. Wire this up via `CreateEditorOptions.mutationPolicy` and `trustedMutationCapabilities` (see [Editor § Construction](./editor.md#construction)); a denied mutation throws `MutationPermissionError` (`code: 'MUTATION_PERMISSION_DENIED'`).

For most apps, `allowAllMutations` (the default) is correct — this layer exists for the collaborative/multi-trust-level case.

## AI / MCP integration

```ts
buildAIContext(editor: GlideEditor, opts?: { viewport?: boolean }): AIContextSnapshot
createCanvasToolServer(editor: GlideEditor): { callTool, generateToolManifest }
```

`buildAIContext` (also reachable as `editor.getAIContext(opts)`) serializes the canvas — shapes (`AIShapeContext`) and their connections (`AIConnectionContext`) — into a flat, LLM-friendly `AIContextSnapshot`, optionally scoped to the current viewport.

`createCanvasToolServer(editor)` returns an [MCP](https://modelcontextprotocol.io)-shaped tool server bound to a live editor:

```ts
const server = createCanvasToolServer(editor);
const manifest = server.generateToolManifest();   // CanvasToolManifestEntry[] — name, description, JSON Schema
const result = await server.callTool('create_shape', { type: 'box', x: 0, y: 0, props: { w: 100, h: 60 } });
```

- **Tools:** `create_shape`, `update_shape`, `delete_shapes`, `create_connection`, `get_canvas_state`, `create_diagram`, `layout_shapes`, `arrange_shapes`, `set_shape_geometry`, `reparent_shapes`, `get_canvas_image` (`CanvasToolName`).
- Each tool's input is validated with a `zod` schema (`createShapeInputSchema`, `updateShapeInputSchema`, `deleteShapesInputSchema`, `createConnectionInputSchema`, `getCanvasStateInputSchema`, `createDiagramInputSchema`, `layoutShapesInputSchema`, `getCanvasImageInputSchema`, and others exported internally); a schema mismatch returns `{ error, issues: [{ path, message }] }` (`CanvasToolError`) rather than throwing.
- A caught `MutationPermissionError` from the mutation-policy layer above surfaces through the same `CanvasToolError` shape with `code: 'MUTATION_PERMISSION_DENIED'` — so an AI agent driving the canvas through a restrictive mutation policy gets a structured denial, not an uncaught exception.
- `generateToolManifest()` returns `{ name, description, inputSchema }[]` with `inputSchema` as JSON Schema (via `z.toJSONSchema`) — suitable for registering directly with an MCP client or any tool-calling LLM API.

`create_diagram`/`layout_shapes`/`arrange_shapes` use `dagre` internally for automatic graph layout — this is the one place `glideline` takes a layout-algorithm dependency, scoped entirely to the AI tool surface (not used by interactive drawing).

## Related types

`SanitizedSvg`, `SanitizedSvgPath`, `SanitizedSvgAssetProps`, `PreparedSanitizedSvgAsset`, `RasterMetadata`, `PreparedRasterAsset`, `AssetProvenance`, `MutationRequest`, `AIShapeContext`, `AIConnectionContext`, `AIContextSnapshot`, `CanvasToolName`, `CanvasToolResult`, `CanvasToolError`, `CanvasToolManifestEntry`.
