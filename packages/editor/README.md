# @beskar/editor

A rich text editor built on TipTap v3 with Radix UI components for better accessibility and modern design patterns.

## Features

- 🎨 Built on TipTap v3 (latest) with full ProseMirror power
- ♿ Accessible UI components using Radix UI
- 🤝 Real-time collaboration support with Y.js and Hocuspocus
- 📐 **Math formulas** - LaTeX support (inline & block) via KaTeX 🆕
- 📑 **Table of Contents** - Auto-updating TOC from headings 🆕
- 📝 Rich text formatting (bold, italic, underline, strike, code)
- 📋 Lists (bullet, ordered, task lists)
- 📊 Tables with advanced operations
- 🎯 Text alignment and text styling
- 🎨 Color picker
- 💬 Bubble menu for text formatting with inline math 🆕
- 💾 Auto-save with debouncing
- ⚡ TypeScript support
- 🔧 Extensible architecture

## Installation

```bash
npm install @beskar/editor
```

## Usage

### Choosing extensions

All built-in features are enabled by default. Disable selected groups, or start
with `minimal` and opt in to what your client needs:

```tsx
<Editor features={{ tables: false, math: false, comments: false }} />

<Editor
  features={{ preset: 'minimal', formatting: true, lists: true, slashCommands: true }}
  extensions={[MyCustomExtension]}
/>
```

The same `features` option is accepted by `getExtensions({ features, additionalExtensions })`.
`EditorFeatureOptions` and `EditorFeature` provide public TypeScript types.
Explicit feature flags override the preset. Related extensions toggle together:
`tables` includes rows and cells, `lists` includes list items and keyboard support,
`images` includes block/inline images and paste/drop, and `comments` includes the
comment mark and decorations. Slash commands and the supplied text formatting
menu hide actions that are unavailable.

Available flags: `formatting`, `heading`, `blockquote`, `codeBlock`, `lists`,
`horizontalRule`, `details`, `notes`, `images`, `attachments`, `status`, `date`,
`embeds`, `externalLinks`, `internalLinks`, `childPages`, `math`, `tableOfContents`,
`textAlign`, `color`, `highlight`, `typography`, `emoji`, `tables`, `columns`,
`slashCommands`, `comments`, `dragAndDrop`, and `links` (standard hyperlink marks).
`EDITOR_FEATURE_EXTENSIONS` exports the full group-to-extension mapping.

Mandatory core extensions are always retained: document, text, block paragraph,
custom attributes, block IDs, editor UI storage, placeholders, hard breaks,
cursors, and trailing paragraphs (including their StarterKit container).
`MANDATORY_EDITOR_EXTENSIONS` exports their names. Local undo/redo is retained;
when `collaboration` is provided, collaboration and caret extensions are included
and collaboration manages history instead.

`extensions` remains additive. Duplicate extension names, including those inside
custom kits, throw a descriptive error. To replace an optional built-in, disable
its feature group and supply the complete replacement and dependencies. Mandatory
extensions cannot be replaced.

Choose features when mounting the editor. To change the schema, remount with a
new React `key`. Stored content and collaborating clients must use a compatible
schema; disabling a node/mark is not a content migration. This option controls
registration and behavior, not bundle size. Client-owned toolbars should also
check the editor schema or available commands before showing actions.

Run extension configuration checks with `npm test` from this package.

### Basic Editor

```tsx
import { Editor } from '@beskar/editor';
import '@beskar/editor/styles.css';

function MyEditor() {
  return (
    <Editor
      initialContent={{
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello World!' }],
          },
        ],
      }}
      editable={true}
      placeholder="Start writing..."
      onUpdate={(content) => {
        console.log('Content updated:', content);
      }}
      onReady={(editor) => {
        console.log('Editor ready:', editor);
      }}
    />
  );
}
```

### Collaborative Editor

```tsx
import { Editor } from '@beskar/editor';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import '@beskar/editor/styles.css';

function CollaborativeEditor() {
  const doc = new Y.Doc();
  
  const provider = new HocuspocusProvider({
    url: 'ws://localhost:1234',
    name: 'document-name',
    document: doc,
  });

  return (
    <Editor
      editable={true}
      placeholder="Start collaborating..."
      collaboration={{
        provider,
        user: {
          id: 'user-123',
          name: 'John Doe',
          color: '#3b82f6',
        },
      }}
      onUpdate={(content) => {
        console.log('Content updated:', content);
      }}
    />
  );
}
```

## API Reference

### Editor Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `initialContent` | `JSONContent` | `undefined` | Initial content for the editor |
| `editable` | `boolean` | `true` | Whether the editor is editable |
| `placeholder` | `string` | `'Write something....'` | Placeholder text |
| `collaboration` | `CollaborationConfig` | `undefined` | Collaboration configuration |
| `onUpdate` | `(content: any) => void` | `undefined` | Callback when content updates (debounced) |
| `onReady` | `(editor: Editor) => void` | `undefined` | Callback when editor is ready |
| `extensions` | `Extensions` | `[]` | Additional TipTap extensions |
| `className` | `string` | `''` | Additional CSS classes |
| `autoFocus` | `boolean \| 'start' \| 'end' \| number` | `false` | Auto-focus configuration |

### CollaborationConfig

```typescript
interface CollaborationConfig {
  provider: HocuspocusProvider;
  user: {
    id: string;
    name: string;
    email?: string;
    username?: string;
    color?: string;
  };
  field?: string; // Default: 'default'
}
```

## Custom Extensions

You can add custom TipTap extensions:

```tsx
import { Editor } from '@beskar/editor';
import { Link } from '@tiptap/extension-link';

function MyEditor() {
  return (
    <Editor
      initialContent={content}
      extensions={[
        Link.configure({
          openOnClick: false,
        }),
      ]}
    />
  );
}
```

## Styling

The editor comes with default styles that you need to import:

```tsx
import '@beskar/editor/styles.css';
```

The editor uses CSS classes prefixed with `beskar-editor` for easy customization.

## Requirements

- React 19+
- Node.js 22+
- TypeScript 5.3+ (for type support)

## Development

```bash
# Install dependencies
npm install

# Build the package
npm run build

# Watch mode
npm run dev

# Type check
npm run type-check
```

## Math Formulas 📐

The editor supports beautiful LaTeX math formulas with KaTeX!

### Inline Math (within text)
```tsx
import { Editor, EditorContent, TextFormattingMenu } from '@beskar/editor';

function MathEditor() {
  const editor = useEditor({ extensions: getExtensions() });
  
  return (
    <>
      <EditorContent editor={editor} />
      <TextFormattingMenu editor={editor} />
    </>
  );
}
```

**Usage:**
- Select text → Press `Cmd+Shift+M` (Mac) or `Ctrl+Shift+M` (Windows)
- Or use the ∑ button in the bubble menu

### Block Math (centered formulas)
- Type `/math` in the editor
- Enter your LaTeX formula
- Press `Esc` or `Cmd+Enter` to save

**Examples:**
```latex
# Inline: E = mc^2
# Block:  \int_{a}^{b} f(x) dx
```

See `MATH_COMPLETE_GUIDE.md` for full documentation!

## Table of Contents 📑

Auto-generate a table of contents from your document's headings!

### Insert TOC
```tsx
// Type / and search for "toc" or "contents"
// Or use the editor API:
editor.chain().focus().setTableOfContents().run();

// With custom settings:
editor.chain().focus().setTableOfContents({
  title: 'On this page',
  maxLevel: 3  // Include H1-H3
}).run();
```

### Features
- ✅ **Auto-updates** in real-time as you edit headings
- ✅ **Clickable links** - scroll to any heading
- ✅ **Hierarchical** - properly indented by level
- ✅ **Configurable** - control which heading levels to show
- ✅ **Draggable** - move anywhere in your document
- ✅ **Theme-neutral** - style with CSS variables

### Customization
```css
:root {
  --toc-border-color: rgba(0, 0, 0, 0.1);
  --toc-background: rgba(0, 0, 0, 0.02);
  --toc-link-background-hover: rgba(0, 0, 0, 0.05);
  /* ... more CSS variables */
}
```

See `TABLE_OF_CONTENTS.md` for complete documentation!

## License

MIT

## Contributing

Contributions are welcome! Please read the contributing guidelines first.


### Shared edit/view styling

The package owns document typography in both modes. Import `styles.css` and
`index.css`, then set content tokens on a host around the editor when needed:

```css
.document-editor-surface {
  --editor-font-family: Geist, Inter, system-ui, sans-serif;
  --editor-font-size: 1rem;
  --editor-line-height: 1.625;
  --editor-block-gap: 0.75rem;
  --editor-section-gap: 1.5rem;
  --editor-divider-gap: 1rem;
  --editor-code-padding: 0.75rem 1rem;
  --editor-code-radius: 0.5rem;
}
```

Do not add a second `.beskar-editor` around the component. Its root exposes
`data-editor-mode="edit"` or `"view"` for interaction-specific styles. Keep
content metrics shared; the host may independently control page width and chrome.
Dark styling accepts `.dark` or `[data-theme="dark"]` on the editor or an ancestor,
including a Radix Theme. Document lists carry `data-editor-list`, keeping their
spacing and markers separate from table-of-contents and child-page navigation.

The browser fixture at `tests/style-preview.html` loads the built package and
checks divider gaps, heading hierarchy, list isolation, captions, code surfaces,
and column edges across four contexts. After building, serve this package with
Vite (the adjacent `editor-demo` installation can supply it), open the fixture,
and run checks in light/dark and wide/narrow modes. UI-context fixtures share the
host tokens; additionally verify the deployed application's edit and published
routes because application CSS can introduce new overrides.

### External link previews

Preview requests are shared per handler instance and URL, including across node
remounts. Keep `externalLinkHandler` stable to share this cache. Successful results
are cached for 30 minutes; failures (including empty responses) for one minute.
Requests time out after 10 seconds. Handlers may accept an optional second
`AbortSignal` argument to cancel the underlying fetch.

Links remain usable while loading or when metadata is unavailable. Select a link
in editing mode for **Retry preview** or **Refresh preview**. Manual requests bypass
settled cache entries but share any request already in flight. Reopening a document
uses saved metadata; read-only previews never write metadata or errors into it.
Loading/error state is local. Failed previews are retried on a later mount after
the cooldown, not by a background polling loop. The cache is in memory, so a full
browser reload starts a new cache.

### Math equations

Block and inline equations share a multiline LaTeX editor with syntax highlighting and a live preview. Click an equation to edit it. Shift+Enter inserts a source newline; Done, Enter, Escape, or clicking outside saves the draft. Empty formulas display an Equation placeholder; invalid formulas display an error without retaining the previous rendering.

Typing `$$formula$$ ` creates inline math. Typing `$$ ` creates an empty inline equation; `$$$$ ` at the start of an empty paragraph creates a block equation. Smart typography leaves the LaTeX source intact while the dollar shortcut is being typed.

Wide formulas scroll horizontally within their available width, including columns and table cells. Rendering follows document updates, including undo and collaboration. If another update arrives while a draft is open, a notice explains that saving a changed draft replaces that update; closing an unchanged draft retains the update.

Manual browser regression fixture: rebuild the package, then serve `packages/editor` with Vite and open `/tests/math-preview.html`. It covers editable/read-only layouts, narrow widths, themes, tables, columns, invalid/empty formulas, external document updates, undo, and a typing sandbox.

### Reordering document blocks

Hover or tap a block to show its gutter handle. Drag it to a highlighted boundary,
click the handle for **Move up / Move down**, or use **Cmd/Ctrl+Alt+↑/↓**.
**Alt+F10** opens block actions for the current editor selection. The menu supports
arrow keys, Enter, and Escape. Boundary actions are disabled.

The commands `editor.commands.moveBlockUp(blockId?)`, `moveBlockDown(blockId?)`,
and `openBlockMenu()` are also available to integrations. With no ID, movement
uses the top-level block containing the selection. Lists, tables, quotes and
columns move as complete blocks; their structural children stay intact. Moves
preserve block identity and text selection and form one undoable operation.

Block identities are normalized after document changes, including old documents
containing duplicate IDs from splits/pastes. Dragging resolves the live source
at drop time, so edits received during a drag are retained. Source dimming and
completion highlights are editor decorations; controls/preview/indicator live
outside editable content and do not suspend ProseMirror's DOM observer.

### Code blocks

Code blocks include their own themed controls in editable and read-only editors.
No separate `CodeBlockFloatingMenu` is needed; its deprecated export remains as a
no-op for existing integrations. The `codeBlock` feature flag includes the code
node and its keyboard extension.

- Search languages by name or alias; the five most recent selections are remembered locally.
- Copy plain code with success/failure feedback, preserving the document selection.
- Wrap lines, show logical line numbers, collapse long snippets, add captions, or duplicate a block.
- Tab / Shift+Tab indents whole selected lines by two spaces, including in tables and columns.
- Escape focuses block controls. Ctrl/Cmd+Enter continues in a paragraph after the block.
- HTML/XML blocks offer a static HTML preview in a sandboxed iframe. Scripts and external resources are disabled.
- `wrap`, `lineNumbers`, `collapsed`, and `caption` are saved as node attributes and survive JSON/HTML round trips. Reader display toggles are local and do not edit the document.

Browser regression fixture: `tests/code-blocks.html`. Build the package, serve it
with Vite (use `--force` after rebuilding to invalidate the cached bundle), then
run the Playwright CLI bodies in `tests/code-block-workflow.js` followed by
`tests/code-block-edge-cases.js`. The fixture includes independent edit/view
editors, long lines, columns, tables, and light/dark theme controls.

### PDF export

PDF generation is available through the separate, lazy-loadable `@durgakiran/editor/pdf` entry point:

```ts
const { createDocumentPdf } = await import('@durgakiran/editor/pdf');
const { blob, fileName, warnings } = await createDocumentPdf(editor.getJSON(), {
  title: 'My document',
  pageSize: 'A4',
  orientation: 'portrait',
  resolveImage: async (src) => resolveAuthenticatedImageAsPngDataUrl(src),
  baseUrl: window.location.href,
});
// Save blob through the host application and display any export warnings.
```

The host owns authenticated image access and file saving. Fonts are bundled; block equations render as SVG. See [document PDF export](../../docs/pdf-export.md) for supported blocks, font coverage, fallbacks and build instructions.

### Attachment integration contract

`attachmentHandler.uploadAttachment(file, { signal? })` must reject on failure and
resolve with `{ attachmentId, url, fileName, fileSize, mimeType }` after the file is
available. IDs, names, MIME types and URLs must be nonempty; size must be a finite,
nonnegative number. URLs must use HTTP(S), a root-relative path, or a browser
blob/data URL (the latter are intended for local demos, not persisted documents).
The package validates results before storing a successful attachment. Implement
`getAttachmentUrl` when returned URLs need application-specific resolution.

`downloadAttachment({ url, fileName })` must return a Promise and reject with a
user-facing error if fetching or handing the download to the browser fails. The
package displays errors and prevents overlapping actions. Without this hook it
fetches the URL with credentials and saves a Blob. Browser download completion
cannot be confirmed by this contract.

Optional `previewAttachment: { supports(attachment), open(attachment) }` declares
preview capability explicitly. `supports` must be synchronous, pure, and return
false for unsupported types. `open` must return a Promise that resolves when the
viewer is dismissed and rejects on failure; the application owns authenticated fetching,
viewer accessibility, supported formats, and Blob URL cleanup. Without this
capability, Preview is hidden; downloading remains available in view mode.

The package owns keyboard activation, action feedback, permission gating, retry,
file reselection, and replacement. Replacement uploads first and commits only on
success, keeping the old reference on failure. Removing a chip removes its document
reference, not the stored file. Replacement does not overwrite the old stored file
or promise storage cleanup. Retry data is local to the current session; after a
reload users can choose the file again. Shared pending uploads may belong to another
editor session. Mutations are hidden in read-only mode and recheck editability
before applying asynchronous results. Server authorization remains the application's
responsibility.

Attachment actions use the shared image-style floating toolbar. Hover, focus, or
select the chip to reveal it; clicking the chip selects it instead of downloading.
Arrow Down moves from the chip into the toolbar, Left/Right moves between actions,
and Escape dismisses it. Download and supported Preview remain available to readers.
