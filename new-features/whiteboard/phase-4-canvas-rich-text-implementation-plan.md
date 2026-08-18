# Phase 4 Canvas Rich Text Implementation Plan

## 1. Goal

Deliver tldraw-level rich text for standalone canvas text shapes using an independent lightweight TipTap editor, without importing or embedding the full document editor.

## 2. Approved Decisions

- Create `@durgakiran/canvas-text-editor` as a separate package.
- Do not depend on or render the full `@durgakiran/editor` component.
- Keep model, static view, and active editor in separate package entry points so TipTap can be lazy-loaded.
- Store normalized, versioned JSON; never persist arbitrary HTML.
- Mount no editor for static text and at most one active editor per board.
- Ship standalone text first. Shape, note, frame, and connector labels remain plain text initially.
- Character-level collaboration is required before release.
- Reuse the board's existing `Y.Doc`, provider, and awareness channel.
- Reserve the full `@durgakiran/editor` for a future fixed-size embedded `document` shape.

## 3. Package Boundaries

```text
@durgakiran/canvas-text-editor/model
  JSON types, validation, normalization, projection, safe links; no React or TipTap
             |
             +----> /view: zero-editor React rendering
             |
             +----> /editor: TipTap UI and Yjs fragment binding
                               |
                               v
                           glideboard
                 overlay, lifecycle and lazy loading
```

Rules:

- The `model` entry has no React, DOM, TipTap, Yjs, or provider dependency.
- `canvas-text-editor` does not import the root editor barrel or document extensions.
- Glideline remains renderer-neutral.
- React, TipTap, ProseMirror, and Yjs versions remain singleton-compatible.
- Glideboard owns the adapter between canvas editing and the board collaboration runtime.

## 4. Version 1 Profile

Include:

- paragraphs and hard breaks;
- bold, italic, inline code, and highlight;
- safe external links;
- bullet and ordered lists;
- automatic left-to-right/right-to-left direction;
- plain-text and supported rich-text paste.

Keep at shape level:

- font family, base font size, base color, alignment, and line height.

Defer:

- headings, task lists, tables, images, attachments, embeds, math, comments;
- slash commands, block IDs, and block drag/drop;
- mixed font families/sizes and arbitrary inline colors;
- rich text in labels and embedded full-document editing.

## 5. Stored Model

```ts
interface CanvasRichTextDocument {
  format: 'beskar-canvas-rich-text'
  version: 1
  profile: 'text'
  doc: RichTextJson
}

interface TextProps {
  text: string // synchronized compatibility projection
  richText?: CanvasRichTextDocument
  w: number
  h: number
  sizeMode: 'auto' | 'fixed-width' | 'fixed'
  font: Font
  fontSize: FontSize
  color: string
  textAlign: 'left' | 'center' | 'right'
  lineHeight: number
}
```

`richText` is authoritative when present. Rich content and `text` projection must change atomically.

During collaboration, a stable `Y.XmlFragment` is authoritative for live character and mark edits. Versioned JSON remains the portable snapshot used by non-collaborative loading, static rendering, search, AI, clipboard, and export.

## 6. Implementation Stages

### Stage 0 - Architecture Spike

- Scaffold the package with independent `model`, `view`, and `editor` entries.
- Prove React 18/19 compatibility and singleton TipTap/ProseMirror resolution.
- Render one static document and edit it with the restricted profile.
- Record lazy chunk and CSS sizes.

Gate: no full-editor modules or document extensions appear in the bundle.

### Stage 1 - Model and Safety

- Define JSON types, limits, normalization, and deterministic serialization.
- Validate allowed nodes, marks, attributes, nesting, length, and URL protocols.
- Implement plain-text projection and unsupported-version fallback.
- Add plain text and safe HTML ingress.

Gate: malformed or oversized content is rejected without document mutation.

### Stage 2 - Static Rendering

- Build `CanvasTextView` without TipTap or ProseMirror editor state.
- Support all V1 marks, lists, links, alignment, and RTL direction.
- Share typography rules with the active editor.

Gate: 1,000 static rich-text shapes create zero editor instances.

### Stage 3 - Active Editor

- Build `CanvasTextEditor` with the frozen extension profile.
- Build a compact floating formatting toolbar.
- Isolate pointer, wheel, keyboard, paste, selection, and IME events from the canvas.
- Lazy-load editor code on first rich-text edit.

Gate: each board mounts at most one active editor.

### Stage 4 - Glideline Migration and Geometry

- Migrate legacy standalone text into one or more paragraphs.
- Add persisted bounds and sizing modes.
- Extend `ShapeUtil` with an engine-neutral text descriptor.
- Use persisted bounds for selection, hit testing, routing, grouping, and culling.

Gate: old documents round-trip with identical plain text and stable bounds.

### Stage 5 - Glideboard Editing Lifecycle

- Mount the editor for `editingShapeId` in a transformed overlay.
- Snapshot content and bounds on entry.
- `Escape` cancels; `Cmd/Ctrl+Enter` and accepted click-away commit.
- Commit rich JSON, plain projection, and measured bounds in one command.
- Keep TipTap undo inside editing and canvas undo outside editing.
- Close safely when the shape is remotely deleted.

Gate: one editing session produces one canvas undo entry.

### Stage 6 - Product Integrations

- Add private fragment, `text/html`, and `text/plain` clipboard formats.
- Use one projection helper for search, AI, accessibility, and empty-text checks.
- Add safe link activation through an explicit action or modified click.
- Add read-only and unsupported-version rendering.

Gate: copy/paste and degraded rendering never lose the plain-text meaning.

### Stage 7 - Export

- Convert normalized content into deterministic text runs.
- Render equivalent SVG `<text>/<tspan>` output.
- Reuse those runs for PNG and future PDF export.
- Define font substitution and unsupported-content degradation.

Gate: canvas, SVG, and PNG preserve content, wrapping, marks, lists, and order.

### Stage 8 - Collaborative Rich Text

- Store fragments in a dedicated map inside the existing board `Y.Doc`, keyed by shape ID.
- Bind the one active TipTap editor to that shape's fragment.
- Reuse the existing provider; never create a provider per text shape.
- Define fragment create, load, copy, duplicate, delete, restore, and garbage-collection behavior.
- Materialize normalized JSON for checkpoints and portable export without replacing the whole shape record.
- Keep TipTap/Yjs undo scoped to text editing and board undo scoped to shape operations.
- Publish rich-text caret presence separately from the canvas pointer payload.
- Close safely on remote shape deletion and reject incompatible rich-text schema versions.

Gate: concurrent characters and marks converge without overwriting simultaneous movement or styling.

### Stage 9 - Release Hardening

- Add security corpus tests for HTML, links, malformed JSON, and size limits.
- Test zoom, rotation, groups, frames, pages, mobile, IME, and accessibility.
- Benchmark static rendering, first-edit lazy load, typing, resize, and export.
- Test offline editing, reconnect, concurrent formatting, remote deletion, and schema mismatch.

Gate: all acceptance tests pass with character-level collaboration enabled.

## 7. Test Matrix

- Unit: normalization, validation, projection, migration, sizing, commands.
- Package: exports, peer resolution, bundle contents, CSS isolation.
- Engine: history, undo, copy, duplicate, import, pages, groups, deletion.
- Component: toolbar state, focus, cancel, commit, paste, links, read-only.
- Browser: formatting, IME, zoom, rotation, mobile, clipboard, SVG/PNG.
- Collaboration: simultaneous characters/marks, caret presence, undo, offline/reconnect, remote delete.
- Performance: 1,000 static shapes and one active editor.
- Security: unsafe links/HTML, malformed JSON, oversized content, future versions.

## 8. Definition of Done

- V1 formatting works on standalone text shapes.
- Static shapes mount no editor; one board mounts at most one active editor.
- Legacy text migrates without changing its plain-text value.
- Edit, cancel, commit, and undo behavior is deterministic.
- Concurrent rich-text edits converge at character and mark granularity.
- Rich-text edits do not overwrite simultaneous shape movement or styling.
- Search, AI, clipboard, accessibility, and export use the same projection/model.
- Canvas and exported output match within documented font tolerances.
- The demo uses the latest local package builds and passes desktop/mobile browser tests.

## 9. Later Work

- Rich text for shape, sticky-note, frame, and connector labels.
- Underline, strike, inline colors, mixed fonts and sizes.
- A fixed-size embedded `document` shape using the full `@durgakiran/editor`.
- Headings, task lists, code blocks, tables, embeds, and slash commands only after geometry and export contracts exist.
