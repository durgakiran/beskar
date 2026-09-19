# Guides: how to do X with glideline / glideboard

Task-oriented walkthroughs, organized by what you're trying to accomplish rather than by subsystem. Each guide combines several APIs into one worked scenario and links into the [reference docs](../README.md) for full type/method detail — read a guide first if you know what you're trying to build; go straight to the reference if you already know which API you need and just want its exact contract.

**Stability:** every API used in these guides is 🔴 Unstable, same as the reference — see the [stability legend](../README.md#stability-legend). A guide inherits its most-cautioned API's caveats; where that applies, the guide says so explicitly.

## Extending `glideline`

- [Add a custom shape with its own drawing tool](./custom-shape-and-tool.md)
- [Wire up undo/redo and a history UI](./undo-redo-and-history-ui.md)

## Trust, safety & AI

- [Safely import pasted/uploaded SVG, images, and rich text](./sanitize-untrusted-content.md)
- [Let an AI agent read and edit the canvas](./ai-agent-canvas-editing.md)
- [Restrict who can make which mutations](./restrict-mutations-by-trust-level.md)

## Data, export & automation

- [Drive glideline with no UI at all](./headless-automation.md) — server-side generation, migration, testing.
- [Export a canvas, and copy/paste across documents](./export-and-cross-document-copy.md)

## Building with `glideboard`

- [Embed a persistent whiteboard in a React app](./embed-a-persistent-whiteboard.md)
- [Add real-time collaboration to a glideboard whiteboard](./add-realtime-collaboration-to-glideboard.md)
- [Handle image/SVG uploads and a browsable asset catalog](./handle-asset-uploads-and-library.md)
- [Drive a glideboard session without the `<Glideboard>` component](./drive-glideboard-headlessly.md)
