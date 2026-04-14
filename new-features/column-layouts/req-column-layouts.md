# Specification: Column Layout Block (2-Column & 3-Column)

## Product Requirement

Users can insert a multi-column layout block into the document — either **2 columns** or **3 columns** — to present content side-by-side. Each column is a full editor zone that can hold any block-level content (paragraphs, headings, images, lists, code blocks, nested layouts, etc.). Column proportions are set via a fixed set of preset distributions chosen from the floating toolbar. The block behaves as a first-class ProseMirror block node with all standard behaviors (selection, deletion, copy/paste, undo/redo, collaboration).

**Goals for this revision:**
- Fix the known bugs in the existing 2-column implementation.
- Extend the schema to support 3-column layouts.
- Make column count switchable after insertion.
- Harden all standard block-node behaviors and edge cases.

---

## Scope Clarification

- **In scope**: 2-column layout, 3-column layout, preset distribution ratios, column count switching, floating toolbar, slash command insertion, HTML serialization, clipboard, undo/redo, collaborative editing, read-only mode.
- **Out of scope**: 4+ column layouts (unless trivially supported by the same schema), nested column layouts (a column containing another columns block), drag-to-resize column widths, responsive/mobile auto-stacking layout (a future concern — but the block must not break on narrow viewports).

---

## Technical Approach

### Node Schema

#### `Columns` node (outer wrapper)

| Property | Value |
| --- | --- |
| `name` | `'columns'` |
| `group` | `'block'` |
| `content` | `'column{2,3}'` — allows exactly 2 or 3 child column nodes |
| `isolating` | `true` — prevents backspace/delete from escaping the block into surrounding content |
| `selectable` | `true` — the whole block can be selected as a unit |
| `draggable` | `false` — block drag is handled at the page level, not inside the node |

**Attributes:**

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `blockId` | `string \| null` | `null` | Stable ID for collaborative reference |
| `columnCount` | `2 \| 3` | `2` | Number of child columns; must match the actual child count |

**HTML serialization:** `<div data-type="columns" data-column-count="2">…</div>`

#### `Column` node (inner column)

| Property | Value |
| --- | --- |
| `name` | `'column'` |
| `content` | `'block+'` — one or more block-level nodes |
| `isolating` | `true` — Tab/Enter within a column stays inside it; backspace cannot cross column boundaries |

**Attributes:**

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `width` | `number \| null` | `null` (equal share) | Column width as a percentage of the parent container (e.g. `33.33`). Set only via a toolbar preset; `null` means equal distribution via `flex: 1 1 0`. |
| `blockId` | `string \| null` | `null` | Stable ID for collaborative reference |

**HTML serialization:** `<div data-type="column" data-width="33.33" style="flex-basis: 33.33%">…</div>`

### Node Registration

Register both `Columns` and `Column` extensions in `extensions/index.ts`. `Column` must be registered before `Columns` in the array so ProseMirror's schema processes the child type first.

### NodeView — `ColumnsView`

The React NodeView renders the columns container and the floating toolbar. There are no interactive resize handles — column widths are fixed to preset distributions chosen from the toolbar.

**Toolbar (floating menu):**
- Show when the editor selection is inside the columns block.
- Float below the block using `@floating-ui/react` with `flip` and `shift` middleware.
- Actions: see [Floating Toolbar](#floating-toolbar) section below.

**Selection highlight:**
- When `showToolbar` is true (i.e., cursor is inside the block), add a 2 px accent outline to the container.

**Read-only mode:**
- Hide the floating toolbar entirely.
- Columns render as a static flex row.

### Slash Command Entries

Add two entries in `groups.ts` under the **Layout** group (create the group if absent):

| Command | Label | Icon | Aliases | Inserted structure |
| --- | --- | --- | --- | --- |
| `twoColumns` | `2 Columns` | layout icon | `columns`, `layout`, `grid`, `split`, `two` | `columns(columnCount=2)` with two equal `column` children, each containing an empty paragraph |
| `threeColumns` | `3 Columns` | layout icon | `three`, `3col`, `columns`, `layout`, `grid` | `columns(columnCount=3)` with three equal `column` children, each containing an empty paragraph |

After insertion, the cursor must be placed inside the first column of the newly inserted block.

---

## Floating Toolbar

The toolbar appears below the block whenever the editor selection is inside it. It contains:

| Action | Behavior |
| --- | --- |
| **2 Columns** | Convert the current layout to 2 columns. If currently 3 columns, merge column 2's content into column 1 (append, separated by a paragraph break). Reset widths to equal. |
| **3 Columns** | Convert the current layout to 3 columns. If currently 2 columns, append a new empty column. Reset widths to equal. |
| **Copy block** | Copy the entire columns block as rich HTML + ProseMirror JSON to the clipboard. |
| **Delete block** | Delete the entire columns block node. No confirmation needed. |

**Distribution preset picker:**

A small set of visual preset buttons that set fixed column widths via `setNodeMarkup` on the affected `column` nodes:

| Preset | 2-col widths | 3-col widths |
| --- | --- | --- |
| Equal | 50 / 50 | 33 / 33 / 34 |
| Sidebar right | 67 / 33 | — |
| Sidebar left | 33 / 67 | — |
| Wide center | — | 25 / 50 / 25 |

Selecting a preset is a single undoable transaction. The active preset (if the current widths match one) is visually highlighted. "Equal" is the default and is always available.

---

## Standard Block-Node Behaviors

These must all work correctly regardless of column count:

| Behavior | Expected outcome |
| --- | --- |
| **Backspace at start of first column** | Cursor stays at start of the first column. Does NOT escape into the preceding block because `isolating: true`. |
| **Delete at end of last column** | Cursor stays at end of the last column. Does NOT pull in content from the following block. |
| **Enter at end of last column** | Inserts a new paragraph inside the last column. Does NOT create a block after the columns node. |
| **Tab between columns** | `Tab` moves the cursor to the first position in the next column. `Shift-Tab` moves to the previous column. When on the last column, `Tab` exits the block and moves to the block after the columns node (inserting an empty paragraph if none exists). |
| **Node selection (click gutter)** | Clicking the block's left gutter selects the entire `columns` node as a `NodeSelection`. The outline highlight reflects this state. |
| **Backspace with node selection** | When the entire `columns` node is selected (NodeSelection), pressing Backspace deletes the whole block in one step. |
| **Arrow keys across columns** | Left arrow from the start of column N moves to the end of column N-1 (ProseMirror default for adjacent siblings with `isolating: false` on the *inner* direction — verify). Right arrow from end of column N moves to start of column N+1. |
| **Select all (Ctrl/Cmd-A)** | First press selects content inside the focused column. Second press selects the entire document. |
| **Dragging the block** | When the page supports block-level drag-and-drop at the document level, the entire columns block (all columns) moves as a unit. |
| **Undo / Redo** | Every user-visible change (preset switch, convert to 3-col, delete) is a single undoable step. |
| **Read-only rendering** | In non-editable mode, the block renders correctly as a static flex row without the floating toolbar. |

---

## Column Content Behaviors

| Behavior | Expected outcome |
| --- | --- |
| **Empty column** | A column may not be truly empty — it must always contain at least one block (an empty paragraph). On schema validation, an empty `column` is invalid. The slash command and column addition always insert an empty paragraph as the initial child. |
| **All block types allowed** | Paragraphs, headings (h1–h6), bullet/ordered lists, task lists, code blocks, images, file attachments, callouts, dividers, and status badges are all valid inside a column. |
| **No nested column layouts** | A `columns` node is a block node but it must **not** be allowed inside another `column` (i.e., `column`'s content rule `block+` should explicitly exclude `columns`). Attempting to paste a columns block inside a column should unwrap it or reject it. |
| **Long content overflow** | If a column's content is taller than its sibling columns, the block height grows to match — all columns align their tops and the row grows to fit the tallest column. No vertical clipping. |
| **Wide content overflow** | If a single content item (e.g., a wide image or a pre block) overflows a column's flex width, it is constrained by `min-width: 0` and `overflow-x: auto` on the column. |

---

## Copy / Paste Behaviors

| Scenario | Expected outcome |
| --- | --- |
| **Copy whole block (toolbar)** | Clipboard contains: (1) `text/html` with the full `<div data-type="columns">` markup, (2) `application/pm-json` with the ProseMirror JSON slice. Both representations preserve column widths. |
| **Paste columns block inside another editor** | The pasted block is inserted as a `columns` node (if the target editor has the extension), or falls back to a flat sequence of paragraphs. |
| **Copy text from inside one column** | Standard ProseMirror text selection + copy. The clipboard contains only the selected text/nodes; no column wrapper is included. |
| **Paste plain text into a column** | Plain text pastes into the column at the cursor position, exactly as it would in a normal paragraph. |
| **Paste rich content (e.g., a heading + list) into a column** | The pasted content is inserted in the column as block nodes, as in a normal document body. |
| **Paste a columns block inside a column** | Unwrap the pasted columns to their content: insert each column's block content sequentially at the paste point. Do not allow nested columns. |
| **Copy a single column** | Not directly supported from UI; selecting all content in a column and copying gives the inner block content, not the `column` wrapper. |

---

## Collaboration (Yjs / collabserver)

| Scenario | Handling |
| --- | --- |
| **One user converts 2-col → 3-col while another edits column 2** | The conversion appends a new column; the concurrent edit to column 2 is preserved in column 2. The content of the new column 3 is an empty paragraph. |
| **One user deletes the columns block while another types in it** | The block deletion wins (Yjs GC removes the node). The typing user's changes are lost for that block — same behavior as any other concurrent block deletion. |
| **`blockId` attribute** | Both `columns` and `column` nodes carry a `blockId` attribute (stable UUID assigned at insertion) so Yjs can track identity across document edits. The `blockId` must be set at insertion time, not deferred. |

---

## Corner Cases & Edge Handling

| Scenario | Handling |
| --- | --- |
| **Columns node inserted at document start** | The slash command inserts the block and places the cursor in the first column. An empty paragraph must exist before the block in the document if the block is the very first node (ProseMirror requires the document to start with a valid block). |
| **Columns node at document end** | After the last column, ensure at least one empty paragraph follows so the user can place the cursor after the block. If absent, `Tab` from the last column should insert one. |
| **Backspace on the columns border (between columns)** | Because `column` nodes have `isolating: true`, backspace at the very start of column N stays in column N and does not merge it with column N-1. |
| **Deleting all content in a column** | The column must retain at least one empty paragraph. If the user deletes all content, ProseMirror's schema enforcement (via `isolating` and the `block+` content rule) should prevent the column from becoming empty. Validate this does not cause a crash. |
| **Very narrow viewport (< 400px)** | The columns block does not auto-stack in v1. It renders with `overflow-x: auto` so it is horizontally scrollable on small screens. A future requirement will define responsive stacking. |
| **Pasting a table inside a column** | Tables are block nodes and are allowed inside a column. They render with `max-width: 100%` to stay within the column bounds. |
| **`document.execCommand('copy')` deprecation** | Replace with the `navigator.clipboard.write()` API using `ClipboardItem` for HTML, with a graceful fallback to the legacy `execCommand` for browsers that do not support it. |
| **`setTimeout` hacks in delete handler** | The `setTimeout` workaround in `ColumnsFloatingMenu` for delete is fragile. Replace with a direct synchronous transaction after `setNodeSelection`. |
| **Column count mismatch (schema vs attribute)** | If `columnCount` attribute is `3` but only 2 `column` children are present (e.g., from a corrupt paste), treat the actual child count as authoritative and update the attribute to match. |
| **Converting 3-col → 2-col with content in column 3** | Do not silently discard column 3's content. Append it (with a separator paragraph) to column 2 before removing the node. Warn in the toolbar if column 3 has non-empty content. |
| **Focus trap on keyboard-only navigation** | A keyboard user pressing `Tab` from the last column exits the columns block and moves focus to the next focusable element in the document. They should never be trapped. |
| **Screen reader / accessibility** | The outer wrapper should carry `role="group"` and `aria-label="2-column layout"` (or "3-column layout"). |
| **Multiple rapid deletes** | Deleting the block multiple times in rapid succession (e.g., via keyboard macro) must not crash — the delete handler must check whether the node still exists before dispatching. |
| **Slash command mid-paragraph** | If `/2 columns` is triggered in the middle of a paragraph, the text before the slash stays in the preceding paragraph, the columns block is inserted after it, and the text after the cursor (if any) goes into the first column of the layout as a new paragraph. |

---

## Known Bugs in Current Implementation

These are the specific issues in the existing 2-column implementation that this revision must address:

| # | Bug | Root Cause | Fix |
| --- | --- | --- | --- |
| 1 | No 3-column support | `content: 'column{2}'` hardcodes exactly 2 children | Change to `column{2,3}` and add `columnCount` attribute |
| 2 | `document.execCommand('copy')` is deprecated | Legacy clipboard API | Replace with `navigator.clipboard.write()` + `ClipboardItem`, fallback to `execCommand` |
| 3 | `setTimeout` in delete handler is fragile | Race between `setNodeSelection` and `deleteSelection` | Dispatch both in one chained transaction: `editor.chain().setNodeSelection(pos).deleteSelection().run()` |
| 4 | `columns-content>div` CSS hack for intermediate NodeViewContent div | `NodeViewContent` injects an undocumented wrapper div | Keep the workaround but document it clearly; file upstream with Tiptap if not already reported |
| 5 | Missing `isolating: true` on `column` nodes | Not set in `Column.ts` | Set `isolating: true` on the `Column` node to prevent cursor escaping across column boundaries via backspace |
| 6 | No way to convert between 2-col and 3-col after insertion | Floating menu only has Copy + Delete | Add column count toggle and preset picker to the floating toolbar |
| 7 | No keyboard navigation between columns (Tab) | No keybinding defined | Add `Tab` / `Shift-Tab` keybindings in the `Columns` extension's `addKeyboardShortcuts` |
| 8 | `isInside` check may have off-by-one on exact node boundaries | `from >= nodeStart && to <= nodeEnd` — `NodeSelection.to` equals `nodeStart + 1`, not `nodeEnd` | Also handle `NodeSelection` case where `from === nodeStart`; use `nodeEnd = nodeStart + node.nodeSize` |
| 9 | Deleting all content in a column can leave it empty | No guard at the schema level | Set `isolating: true` and ensure the `block+` content rule causes ProseMirror to auto-insert an empty paragraph when the last block is deleted |
| 10 | No `blockId` assigned at insertion time | `blockId` defaults to `null` and is never set by the slash command | Generate a UUID in the slash command `command` handler and assign it as `attrs.blockId` on both the `columns` node and each `column` child |
| 11 | Entire `ColumnsView` resize logic is dead code | Drag-to-resize has been removed from scope | Delete `startResize`, all CSS variable manipulation, `isResizing` state, and `latestWidthsRef` from `ColumnsView.tsx`; remove the handle element and resize CSS |

---

## UI Design & Layout

### Outer Container (`.columns-wrapper`)

- `position: relative` — anchors resize handles and the floating toolbar.
- `display: block` — standard block-level box.
- `margin: 1.5rem 0` — vertical rhythm with surrounding content.
- When selected (cursor inside): 2 px accent `outline` on the `.columns-container`, `border-radius: 4px`, using `var(--editor-accent, #0ea5e9)`.

### Column Row (`.editor-columns`)

- `display: flex`, `gap: 1rem`, `width: 100%`, `overflow-x: auto`.
- Columns use `flex-basis` driven by their `width` attribute (as a percentage). If `width` is `null`, columns use `flex: 1 1 0` (equal share).

### Individual Column (`.editor-column`)

- `flex: 1 1 0` (equal default), `min-width: 0`, `min-height: 2rem` (so an empty column is always visible and clickable).
- A subtle left border (1 px `var(--editor-border, #e2e8f0)`) to visually separate adjacent columns; the leftmost column has no left border.
- Padding: `0.25rem 0.5rem`.

### Floating Toolbar

- Uses the existing `.editor-floating-toolbar` Radix Toolbar pattern.
- Rendered via `@floating-ui/react` with `placement: 'bottom'`, `offset(10)`, `flip`, `shift` middleware.
- Contains: column count toggle (2-col / 3-col), distribution preset picker, copy, delete.
- Only visible when `editor.isEditable` and cursor is inside the block.

---

## Serialization & Export

| Format | Output |
| --- | --- |
| **HTML (renderHTML)** | Equal distribution: `<div data-type="columns" data-column-count="2"><div data-type="column">…</div>…</div>` (no `data-width`). Preset: `<div data-type="column" data-width="67" style="flex-basis:67%">…</div>`. |
| **parseHTML** | Match `div[data-type="columns"]` for the outer; `div[data-type="column"]` for inner. Read `data-column-count` and `data-width` attributes. |
| **Markdown export** | No standard Markdown equivalent. Export as a sequence of indented block sections with an HTML comment header `<!-- columns:2 -->` or as raw HTML. |
| **Plain-text clipboard fallback** | Each column's content is serialized with a blank line between columns and a `---` separator after the block. |
| **ProseMirror JSON** | Standard document JSON. The `columnCount` attribute must be present and valid. |

---

## Out of Scope (Explicit)

- 4-column or wider layouts.
- Nested column layouts (a column block inside another column block).
- **Drag-to-resize column widths** — removed; column proportions are set via fixed presets only.
- Responsive breakpoint / auto-stacking on mobile (defined as a future requirement).
- Per-column background colors or borders beyond the default visual treatment.
- Column header rows (table-like behavior).
- Drag-and-drop reordering of individual columns within a layout.
- Column visibility toggle (show/hide a column).
