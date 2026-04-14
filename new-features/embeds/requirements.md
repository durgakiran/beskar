# Specification: Embeds

> Covers two distinct embed types that share a common insertion pattern but differ fundamentally in schema, rendering, and lifecycle:
> 1. **Rich Embeds** — iframe-based embeds from known external providers (YouTube, Loom, Figma, Miro, …) and arbitrary URLs.
> 2. **Internal Link Embeds** — live preview cards linking to other Beskar documents or whiteboards.

---

## Architecture Decision Log

| # | Decision | Chosen approach | Rationale |
|---|---|---|---|
| 1 | **One node type or two?** | Two separate TipTap nodes: `embedBlock` and `internalLinkBlock` | Their schemas, attributes, rendering, and lifecycle are entirely different. Merging them into one node would produce a bloated schema with many optional attributes and confusing branching in the NodeView. |
| 2 | **Provider resolution strategy** | Centralised `embed-providers.ts` registry: array of `{ id, name, regex, getEmbedUrl }` records — same pattern docmost uses | Each provider is a pure data record with a single regex and a URL-transform function. Adding a new provider is a one-line diff. No class hierarchies, no dynamic imports. |
| 3 | **URL auto-detection on paste** | A ProseMirror `handlePaste` plugin (one per node type) — identical pattern to the existing `image-paste-drop.ts` | Keeps paste interception co-located with the node that owns it. No global paste handler. Falls through to default paste if the URL is not recognised. |
| 4 | **Iframe loading strategy** | Embed URL is stored in the `src` attribute. The NodeView renders the `<iframe>` directly but **only after the user has confirmed a URL** (not before). An `IntersectionObserver` defers src assignment until the block enters the viewport. | Avoids loading offscreen iframes. No extra state management — the observer is set up once in a `useEffect` and cleans up on unmount. |
| 5 | **Internal link metadata** | `resourceTitle` and `resourceIcon` are stored as nullable attributes on the node (updated after first fetch). The NodeView shows a skeleton on first render, then writes fetched values back via `updateAttributes`. | Eliminates a blank flash on every re-mount. One fetch per block per session (cached in the attribute). Stale titles are acceptable — the page always links to the live resource. |
| 6 | **Resize** | Height-only resize via a drag handle at the bottom of the block; width stays full-column. Stored as `height` attribute (number, px). Minimum 120 px. | Width resize across a fixed-width editor column adds little value and introduces complex layout issues. Height resize covers the main use-case (expanding a short Figma frame). |
| 7 | **Security / CSP** | Embed `src` is validated through `sanitizeUrl` (already used in docmost's `embed.ts`). Only HTTPS URLs are accepted. The iframe receives `sandbox="allow-scripts allow-same-origin allow-popups allow-forms"` — no broader permissions. Arbitrary `iframe` provider is **disabled by default** and must be opted in by workspace admins. | Defence-in-depth without blocking legitimate embeds. The sandbox attribute prevents the most common XSS vectors. |
| 8 | **Slash command grouping** | Both embed types go into the existing `media` group in `groups.ts`. Internal link commands get their own `link` group. | Keeps the media group coherent (image, file, video, embed). Internal links are conceptually different — they reference content inside the app. |

---

## Feature 1: Rich Embeds (`embedBlock`)

### 1.1 Node Schema

**File**: `packages/editor/src/nodes/EmbedBlock.ts`

```ts
export interface EmbedBlockAttributes {
  src: string;           // raw user-supplied URL (stored for display + edit)
  embedUrl: string;      // transformed iframe-safe URL (may differ from src)
  provider: string;      // provider id, e.g. "youtube", "loom", "iframe"
  align: 'left' | 'center' | 'right';
  height: number;        // px, default 480
}
```

Node config:
- `group: 'block'`
- `atom: true`
- `draggable: true`
- `isolating: true`
- HTML tag: `div[data-type="embed-block"]`

The `blockId` attribute is automatically injected by the existing `block-id.ts` extension — no special handling needed beyond the standard ProseMirror plugin that syncs it to the wrapper DOM (same boilerplate as `ImageBlock.ts` and `NoteBlock.ts`).

### 1.2 Provider Registry

**File**: `packages/editor/src/nodes/embed/embed-providers.ts`

```ts
export interface IEmbedProvider {
  id: string;
  name: string;
  /** Regex to detect whether a URL belongs to this provider. */
  regex: RegExp;
  /** Pure function: given the regex match + raw URL, return the iframe-safe embed URL. */
  getEmbedUrl: (match: RegExpMatchArray, rawUrl: string) => string;
}
```

Initial provider set (mirrors docmost's list, cleaned up):

| `id` | `name` | Notes |
|---|---|---|
| `youtube` | YouTube | Uses `youtube-nocookie.com/embed/{id}` |
| `vimeo` | Vimeo | `player.vimeo.com/video/{id}` |
| `loom` | Loom | `loom.com/embed/{id}` |
| `figma` | Figma | `figma.com/embed?url=…` |
| `miro` | Miro | `miro.com/app/live-embed/{id}` |
| `airtable` | Airtable | `airtable.com/embed/…` |
| `typeform` | Typeform | raw URL (typeform handles its own embed) |
| `framer` | Framer | raw URL |
| `gdrive` | Google Drive | `/preview` suffix |
| `gsheets` | Google Sheets | raw URL |
| `excalidraw` | Excalidraw | raw `excalidraw.com` URL |
| `drawio` | Draw.io | raw `embed.diagrams.net` URL |

A `getEmbedUrlAndProvider(url: string): { embedUrl: string; provider: string } | null` helper iterates the list and returns the first match, or `null` if no provider recognises the URL. `null` should surface an error state in the NodeView (not silently fall back to `iframe`).

The generic `iframe` provider (accept-all) is intentionally absent from the default list. It can be added via a future workspace admin toggle.

### 1.3 Slash Command Entries

Add to the `media` group in `groups.ts`:

```ts
{
  name: 'embedVideo',
  label: 'Embed Video',
  description: 'Embed a YouTube or Vimeo video',
  icon: '▶',
  aliases: ['youtube', 'vimeo', 'video', 'embed'],
  blockOnly: true,
  action: (editor) => {
    editor.chain().focus().insertContent({
      type: 'embedBlock',
      attrs: { provider: '', src: '', embedUrl: '', align: 'center', height: 480 },
    }).run();
  },
},
{
  name: 'embedLink',
  label: 'Embed',
  description: 'Embed Figma, Miro, Loom, Airtable, and more',
  icon: '⊞',
  aliases: ['figma', 'miro', 'loom', 'airtable', 'framer', 'iframe', 'embed', 'link'],
  blockOnly: true,
  action: (editor) => {
    editor.chain().focus().insertContent({
      type: 'embedBlock',
      attrs: { provider: '', src: '', embedUrl: '', align: 'center', height: 480 },
    }).run();
  },
},
```

Both commands insert the same `embedBlock` node in its empty/input state.

### 1.4 URL Paste Auto-Detection

**File**: `packages/editor/src/extensions/embed-paste.ts`

A ProseMirror plugin (registered via `addProseMirrorPlugins` on the `EmbedBlock` node) intercepts `handlePaste`:

1. If the clipboard contains a single plain-text line that is a valid URL and `getEmbedUrlAndProvider` returns a match, **replace the current selection** with an `embedBlock` node pre-populated with `src`, `embedUrl`, and `provider`.
2. If the cursor is inside an existing `embedBlock` that is in input state (i.e., `src === ''`), and the user pastes a URL, fill in the attributes and switch to live state.
3. Otherwise, fall through to default paste behaviour.

URL detection: `URL.canParse(text)` (available in all modern browsers) or `new URL(text)` wrapped in try/catch as fallback.

### 1.5 NodeView UX

**File**: `packages/editor/src/components/embed/EmbedBlockView.tsx`

**Two rendering states:**

#### A — Input State (`src === ''`)

```
┌─────────────────────────────────────────────────────┐
│  [🌐]  Paste a link to embed…           [Embed]     │
└─────────────────────────────────────────────────────┘
```

- A single `<input type="url">` placeholder: `"Paste a YouTube, Loom, Figma, Miro link…"`
- An "Embed" button that commits the URL.
- On Enter or button click: validate the URL via `getEmbedUrlAndProvider`. If valid → call `updateAttributes` and transition to Live State. If invalid → show inline error.

#### B — Live State (`src !== ''`)

- A resizable `<iframe>` with `src={embedUrl}`, `sandbox="allow-scripts allow-same-origin allow-popups allow-forms"`, `loading="lazy"`.
- Height is set from the `height` attribute; width is always 100%.
- `IntersectionObserver` defers actual iframe `src` assignment until the block is within 200 px of the viewport. Before entering viewport, a lightweight placeholder with a provider logo and the domain is rendered.
- On block selection (ProseMirror `NodeSelection`): show a floating toolbar above the block with:
  - Provider name + icon (read-only label)
  - `[Open ↗]` — opens `src` in a new tab
  - `[Change]` — reverts to Input State, pre-filling the input with the current `src`
  - `[Align ← | ↔ | →]` — sets the `align` attribute
  - `[Delete]` — deletes the node
- **Resize handle**: A 24 px drag zone at the bottom centre of the block. On `pointerdown`, attach a `pointermove` listener on `document`. On `pointerup`, call `updateAttributes({ height })` with the final computed height (clamped to min 120 px). No live re-render during drag — only the handle position updates; the iframe height is set on release to avoid iframe interaction issues.

#### Error State (`src` set but provider returned `null` at paste time)

- Renders the block with a warning icon, the raw URL as text, and a "Remove" button.
- Does not render an iframe.

---

## Feature 2: Internal Link Embeds (`internalLinkBlock`)

### 2.1 Node Schema

**File**: `packages/editor/src/nodes/InternalLinkBlock.ts`

```ts
export interface InternalLinkBlockAttributes {
  resourceType: 'document' | 'whiteboard';
  resourceId: string;
  /** Cached from the last successful metadata fetch — avoids flash on re-render. */
  resourceTitle: string;
  /** Cached emoji/icon identifier for the resource — stored as a string. */
  resourceIcon: string;
}
```

Node config:
- `group: 'block'`
- `atom: true`
- `draggable: true`
- `isolating: true`
- HTML tag: `div[data-type="internal-link-block"]`

### 2.2 Slash Command Entries

Add a new `link` group in `groups.ts` (inserted after `layout`, before `inline`):

```ts
{
  name: 'link',
  title: 'Link',
  commands: [
    {
      name: 'linkDocument',
      label: 'Link to Doc',
      description: 'Embed a preview card linking to another document',
      icon: '📄',
      aliases: ['doc', 'page', 'link', 'internal'],
      blockOnly: true,
      action: (editor) => {
        editor.chain().focus().insertContent({
          type: 'internalLinkBlock',
          attrs: { resourceType: 'document', resourceId: '', resourceTitle: '', resourceIcon: '' },
        }).run();
      },
    },
    {
      name: 'linkWhiteboard',
      label: 'Link to Whiteboard',
      description: 'Embed a preview card linking to a whiteboard',
      icon: '🔲',
      aliases: ['whiteboard', 'canvas', 'board'],
      blockOnly: true,
      action: (editor) => {
        editor.chain().focus().insertContent({
          type: 'internalLinkBlock',
          attrs: { resourceType: 'whiteboard', resourceId: '', resourceTitle: '', resourceIcon: '' },
        }).run();
      },
    },
  ],
},
```

### 2.3 Beskar URL Paste Auto-Detection

**File**: `packages/editor/src/extensions/internal-link-paste.ts`

When a user pastes a Beskar application URL (e.g. `https://app.beskar.io/docs/abc123`), the paste plugin:

1. Detects the URL matches the application's own origin + a known resource path pattern.
2. Extracts `resourceType` and `resourceId` from the path.
3. Inserts an `internalLinkBlock` node with those attributes (title is empty on insert; the NodeView fetches it).
4. Falls through to default link paste otherwise.

The application base URL and path patterns should be injected as plugin options (not hardcoded), supplied by the host app at editor initialisation.

### 2.4 NodeView UX

**File**: `packages/editor/src/components/internal-link/InternalLinkBlockView.tsx`

**Three rendering states:**

#### A — Picker State (`resourceId === ''`)

A search/picker overlay UI is mounted directly inside the NodeView:
- A text `<input>` with placeholder `"Search documents…"`.
- Results list rendered below, populated by calling the `searchDocuments(query)` handler (injected via editor options — same pattern as `attachmentHandler`).
- Each result row: resource icon + title + last-edited relative time.
- On result selection: call `updateAttributes({ resourceId, resourceTitle, resourceIcon, resourceType })`.
- Pressing Escape or clicking outside deletes the node (user abandoned the picker).

#### B — Card State (`resourceId !== ''`)

Render a block-level preview card:

```
┌──────────────────────────────────────────────────────┐
│  [📄]  Document Title                                │
│        2-line content preview / whiteboard thumbnail │
│  ─────────────────────────────────────────────────── │
│  Last edited 2 days ago  [Avatar]                    │
└──────────────────────────────────────────────────────┘
```

Layout:
- Full-width block, `border border-muted rounded-xl shadow-sm`.
- **Header row**: resource type icon (coloured, 20 px) + title in bold primary text.
- **Body**: For documents — 2-line truncated excerpt of the document's plain-text content. For whiteboards — a small thumbnail snapshot (if available from the API). Falls back to a subtle "No preview available" label.
- **Footer**: `"Last edited N ago"` relative timestamp + contributor avatar.
- **Interaction**: `cursor-pointer`. Hover → `shadow-md` + slight background tint. Click → navigates to the resource (via the app router, not `window.location`). The navigation handler is injected via editor options.

Metadata is fetched from the API on first render using the injected `getResourceMetadata(resourceId, resourceType)` handler. On success: `updateAttributes({ resourceTitle, resourceIcon })`. Result is cached in the attribute so subsequent renders are instant.

#### C — Error / Access States

| API response | Rendered state |
|---|---|
| 404 / deleted | Card with muted styling + `"Document not found"` label + `[Remove]` button |
| 403 / no access | Card with lock icon + `"Private — Request Access"` label |
| Network error | Card with warning icon + `[Retry]` button |

### 2.5 Editor Options / Injection Contract

The host app must pass the following options when constructing the editor (similar to how `attachmentHandler` is injected today):

```ts
interface InternalLinkOptions {
  /** Search for documents/whiteboards by query string. */
  searchResources: (query: string, resourceType: 'document' | 'whiteboard') => Promise<ResourceResult[]>;
  /** Fetch metadata for a known resource (title, icon, last-edited, excerpt/thumbnail). */
  getResourceMetadata: (resourceId: string, resourceType: 'document' | 'whiteboard') => Promise<ResourceMetadata | null>;
  /** Navigate the app to a given resource without a full page reload. */
  navigateToResource: (resourceId: string, resourceType: 'document' | 'whiteboard') => void;
  /** The application's base URL, used by the paste plugin to detect internal links. */
  appBaseUrl: string;
}
```

---

## Corner Cases & Edge Handling

| Scenario | Handling |
|---|---|
| User pastes a URL that matches no provider | NodeView shows error state with raw URL text and `[Remove]` button. No iframe rendered. |
| User pastes a Beskar URL while in `read-only` mode | Paste plugin checks `editor.isEditable` and falls through if false. |
| `InternalLinkBlock` — Doc A embeds Doc B which embeds Doc A | Metadata fetch is capped at exactly one level: the NodeView only fetches title + excerpt metadata; it never renders an editor or another `InternalLinkBlock`. No recursion possible. |
| `InternalLinkBlock` — resource is deleted while the doc is open | `getResourceMetadata` returns `null`; the card transitions to "Document not found" state via local React state (no attribute update, since the node still holds the now-invalid `resourceId`). |
| `InternalLinkBlock` — user loses read access mid-session | API returns 403; card transitions to "Private" state. |
| `EmbedBlock` in read-only view | Input state is never shown. If `src === ''` (shouldn't happen in practice), render a muted empty placeholder. Floating toolbar is hidden. |
| `EmbedBlock` — same URL pasted twice on the page | Two independent nodes — no deduplication. |
| Collaborative editing (Yjs) | Both nodes are `atom: true`; attribute updates via `updateAttributes` emit normal ProseMirror transactions that Yjs syncs. No special handling required. |
| Drag-and-drop reordering | Both nodes set `draggable: true`. They integrate with the existing `block-drag-drop.ts` extension automatically via the `blockId`/`block-node` DOM marking pattern used by all other block nodes. |
| Mobile / narrow viewport | `EmbedBlock` iframe is always `width: 100%`. Height attribute is preserved but the block scrolls horizontally only if the embedded content itself overflows (the iframe container does not). `InternalLinkBlock` body wraps naturally at any width. |
| Undo after insertion from slash command | Insertion is a single ProseMirror transaction. One `Ctrl+Z` removes the node. Attribute updates from metadata fetch are separate transactions and are individually undoable (acceptable). |
| Export to Markdown / HTML | `EmbedBlock` `renderHTML` emits `<div data-type="embed-block" data-src="…" …><a href="…">…</a></div>` — a graceful degradation link for non-interactive contexts. `InternalLinkBlock` emits `<div data-type="internal-link-block" …><a href="[appBaseUrl]/[resourceType]/[resourceId]">[resourceTitle]</a></div>`. |

---

## Implementation Plan

### Phase 1 — Rich Embeds

| Task | File | Notes |
|---|---|---|
| 1.1 Create provider registry | `packages/editor/src/nodes/embed/embed-providers.ts` | Pure data, no React. |
| 1.2 Create `EmbedBlock` node | `packages/editor/src/nodes/EmbedBlock.ts` | Schema + `renderHTML` + `addProseMirrorPlugins` (blockId sync). |
| 1.3 Create `EmbedBlockView` component | `packages/editor/src/components/embed/EmbedBlockView.tsx` | Input state + live iframe + floating toolbar + resize handle. |
| 1.4 Create paste plugin | `packages/editor/src/extensions/embed-paste.ts` | Registered inside `EmbedBlock.addProseMirrorPlugins`. |
| 1.5 Register node in editor index | `packages/editor/src/extensions/index.ts` | Add `EmbedBlock` to the extensions array. |
| 1.6 Add slash commands | `packages/editor/src/extensions/slash-command/groups.ts` | `embedVideo` + `embedLink` in `media` group. |
| 1.7 CSS | `packages/editor/src/styles/editor.css` | Resize handle, skeleton, error state styles. |

### Phase 2 — Internal Link Embeds

| Task | File | Notes |
|---|---|---|
| 2.1 Create `InternalLinkBlock` node | `packages/editor/src/nodes/InternalLinkBlock.ts` | Schema + `renderHTML` + blockId sync plugin. |
| 2.2 Create `InternalLinkBlockView` component | `packages/editor/src/components/internal-link/InternalLinkBlockView.tsx` | Picker + card + error states. |
| 2.3 Create paste plugin | `packages/editor/src/extensions/internal-link-paste.ts` | Detects app-origin URLs. Registered inside `InternalLinkBlock.addProseMirrorPlugins`. |
| 2.4 Register node in editor index | `packages/editor/src/extensions/index.ts` | Add `InternalLinkBlock`. |
| 2.5 Add slash commands + new group | `packages/editor/src/extensions/slash-command/groups.ts` | New `link` group with `linkDocument` + `linkWhiteboard`. |
| 2.6 Wire up editor options | `packages/editor/src/extensions/index.ts` or options type | Expose `InternalLinkOptions` so host app can inject handlers. |
| 2.7 CSS | `packages/editor/src/styles/editor.css` | Card layout, skeleton, error/access states. |
| 2.8 Mock handlers in editor-demo | `packages/editor-demo/src/mockInternalLinkHandler.ts` | Enables local dev without a real backend. |
