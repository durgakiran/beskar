# User Stories & Tasks: Column Layout Block (2-Column & 3-Column)

> **Strategy**: All work lives in `packages/editor`. The existing `Columns` / `Column` / `ColumnsView` / `ColumnsFloatingMenu` files are modified in-place — no new top-level files are needed. The editor-demo is wired at the end to verify the full flow.
>
> Full product spec: [`req-column-layouts.md`](./req-column-layouts.md).

---

## Architecture Decision Log

| # | Decision | Chosen approach |
| --- | --- | --- |
| 1 | **`isolating: true` on `Column`** | Set on the `Column` node (not `Columns`) so backspace and delete are blocked at column boundaries. ProseMirror enforces this automatically — no custom key handlers needed for boundary prevention. |
| 2 | **`columnCount` attribute** | Stored on the `Columns` node for serialization and toolbar state. The actual child node count is always authoritative; `columnCount` is derived and kept in sync during conversion transactions. |
| 3 | **No drag-to-resize** | All resize dead code (`startResize`, `isResizing`, `latestWidthsRef`, CSS variables, the handle element) is deleted. Column proportions are set only via preset buttons on the toolbar. |
| 4 | **`blockId` at insertion** | UUIDs are generated in the slash command `command` handler (using `crypto.randomUUID()`) and passed as `attrs.blockId` for both the `columns` node and each `column` child. The NodeView never generates IDs. |
| 5 | **Tab navigation** | Implemented in `Columns.addKeyboardShortcuts()` (not in `Column`) because escaping from the last column requires knowledge of the parent `columns` node's position to insert a paragraph after it. |
| 6 | **3→2 content preservation** | When converting 3→2 columns, column 2's content is appended to column 1's content (separated by an empty paragraph), then the third `column` node is removed — all in one transaction. Content is never silently discarded. |
| 7 | **Clipboard copy** | Use `navigator.clipboard.write()` with `ClipboardItem` for HTML. Graceful fallback to `document.execCommand('copy')` for browsers that do not support `ClipboardItem`. |
| 8 | **Delete handler** | Replace the `setTimeout` workaround with a single synchronous chain: `editor.chain().setNodeSelection(pos).deleteSelection().run()`. |

---

## Epic: Column Layout Block

| Phase | Goal |
| --- | --- |
| **Phase 1 — Schema & dead code cleanup** | Fix `Column.ts` schema (`isolating`), remove all resize dead code from `ColumnsView`, fix the `isInside` selection check, fix the delete handler, assign `blockId` at insertion. |
| **Phase 2 — 3-column support** | Update `Columns.ts` to allow 2 or 3 columns, add `columnCount` attribute, update `ColumnsView` to be column-count-agnostic. |
| **Phase 3 — Floating toolbar overhaul** | Replace the minimal Copy + Delete toolbar with: column count toggle, distribution preset picker, copy (updated clipboard API), delete (fixed handler). |
| **Phase 4 — Keyboard navigation** | Add `Tab` / `Shift-Tab` keybindings in `Columns.addKeyboardShortcuts` for moving between columns and exiting the block. |
| **Phase 5 — Slash command & insertion** | Add the "3 Columns" slash command entry, create a "Layout" group in `groups.ts`, ensure `blockId` is assigned, cursor placed in first column after insertion. |
| **Phase 6 — Styles & CSS cleanup** | Remove resize CSS, add column separator border, `min-height` on empty columns, fix the `NodeViewContent` intermediate-div workaround comment. |
| **Phase 7 — Edge cases, accessibility & polish** | Nested-columns paste guard, narrow viewport, accessibility attributes, manual test checklist, editor-demo verification. |

---

## Phase 1: Schema & Dead Code Cleanup

### Story 1 — Fix the `Column` node schema

**As a** user,
**I want** the cursor to stay inside a column when I press Backspace or Delete at a column boundary,
**So that** I cannot accidentally merge column content or escape the layout block.

#### Task 1.1 — Set `isolating: true` on `Column`

- **File**: `packages/editor/src/nodes/layout/Column.ts`
- Add `isolating: true` to the node definition.
- Also add `selectable: false` (individual columns are not independently selectable — only the whole `columns` block is).
- **Verify**: With cursor at the very start of column 1, pressing Backspace does nothing. With cursor at the very end of column 1, pressing Delete does nothing. No content is merged across columns.

#### Task 1.2 — Fix `isInside` selection check in `ColumnsView`

- **File**: `packages/editor/src/components/layout/ColumnsView.tsx`
- The current check `from >= nodeStart && to <= nodeEnd` misses the `NodeSelection` case where `from === nodeStart` and `to === nodeStart + 1`.
- Replace with:
  ```ts
  const nodeStart = pos;
  const nodeEnd = pos + node.nodeSize;
  const isInside =
    (from >= nodeStart && to <= nodeEnd) ||  // text selection inside
    (from === nodeStart);                     // node selection on the block itself
  ```
- **Verify**: Clicking the block's left gutter to create a `NodeSelection` shows the toolbar. Clicking outside hides it.

#### Task 1.3 — Remove all resize dead code from `ColumnsView`

- **File**: `packages/editor/src/components/layout/ColumnsView.tsx`
- Delete:
  - `latestWidthsRef` ref
  - `isResizing` state and its `setIsResizing` calls
  - `startResize` callback (entire function)
  - The `<div className="columns-resize-handle" …>` element and its inner line div
  - The `resizing` class on the wrapper
- Remove the `leftWidth` / `rightWidth` derived values (they were only used by the resize handle).
- **Verify**: `pnpm exec tsc --noEmit` in `packages/editor` passes. The rendered block shows no handle element in the DOM.

#### Task 1.4 — Fix the delete handler in `ColumnsFloatingMenu`

- **File**: `packages/editor/src/components/layout/ColumnsFloatingMenu.tsx`
- Replace the `setTimeout`-based delete with a synchronous chain:
  ```ts
  const handleDelete = () => {
    if (typeof getPos !== 'function') return;
    const pos = getPos();
    if (pos === undefined || pos < 0) return;
    editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
  };
  ```
- Remove the `setTimeout` entirely.
- **Verify**: Clicking Delete removes the block immediately with no flicker or console errors. Ctrl/Cmd+Z restores it.

#### Task 1.5 — Assign `blockId` at slash-command insertion

- **File**: `packages/editor/src/extensions/slash-command/groups.ts`
- In the existing `twoColumns` command handler, add `blockId: crypto.randomUUID()` to the `columns` node attrs, and a separate `crypto.randomUUID()` to each `column` child's attrs.
- (The `threeColumns` command will be added in Phase 5; apply the same pattern there.)
- **Verify**: Inserting a 2-column block and checking `editor.getJSON()` shows non-null `blockId` on all three nodes.

---

## Phase 2: 3-Column Support

### Story 2 — Extend schema for 3 columns

**As a** developer,
**I want** the `Columns` node to accept 2 or 3 child `column` nodes,
**So that** a 3-column layout is a valid document structure.

#### Task 2.1 — Update `Columns.ts` schema

- **File**: `packages/editor/src/nodes/layout/Columns.ts`
- Change `content: 'column{2}'` to `content: 'column{2,3}'`.
- Add `columnCount` attribute:
  ```ts
  columnCount: {
    default: 2,
    parseHTML: (el) => parseInt(el.getAttribute('data-column-count') ?? '2', 10),
    renderHTML: (attrs) => ({ 'data-column-count': attrs.columnCount }),
  },
  ```
- Update `renderHTML` to include `data-column-count` in the output div.
- **Verify**: A document JSON with 3 `column` children inside a `columns` node is accepted without schema errors.

#### Task 2.2 — Update `ColumnsView` to be column-count-agnostic

- **File**: `packages/editor/src/components/layout/ColumnsView.tsx`
- Remove the hardcoded `leftWidth` / `rightWidth` derivations (already done in Task 1.3).
- The `NodeViewContent` renders all column children via `<NodeViewContent className="editor-columns columns-content" …/>` — this already works for any child count since Tiptap renders all children.
- Pass `columnCount={node.attrs.columnCount}` and `node={node}` as props to `ColumnsFloatingMenu` so the toolbar knows the current state.
- Update the `aria-label` on the wrapper to reflect the column count:
  ```tsx
  aria-label={`${node.attrs.columnCount}-column layout`}
  ```
- **Verify**: Inserting a 3-column block (via `editor.commands.insertContent(…)` for now, slash command in Phase 5) renders three equal-width columns.

---

## Phase 3: Floating Toolbar Overhaul

### Story 3 — Full-featured column toolbar

**As a** user,
**I want** a toolbar that lets me switch column count and set a distribution preset,
**So that** I can adjust the layout after insertion without deleting and re-inserting.

#### Task 3.1 — Rebuild `ColumnsFloatingMenu` with column count toggle

- **File**: `packages/editor/src/components/layout/ColumnsFloatingMenu.tsx`
- Add `columnCount: 2 | 3` and `node: Node` props.
- Add two toggle buttons: **2 Columns** and **3 Columns**. The active one (matching `columnCount`) is highlighted.
- **2 Columns handler** (when currently 3 columns):
  1. Build a transaction that merges column 2's content into column 1:
     - Collect column 2's block nodes.
     - Append an empty paragraph and then column 2's content to column 1 via `tr.insert`.
  2. Delete the third `column` node.
  3. Set `columnCount: 2` on the `columns` node via `tr.setNodeMarkup`.
  4. Dispatch the transaction.
- **3 Columns handler** (when currently 2 columns):
  1. Append a new `column` node (containing one empty paragraph) via `tr.insert` at the position after column 1.
  2. Set `columnCount: 3` on the `columns` node.
  3. Dispatch.
- Both handlers perform all steps in a **single transaction** so undo restores the full prior state.
- **Verify**: Switching 2→3 shows a new empty third column. Switching 3→2 preserves column 3's content appended to column 2. Ctrl/Cmd+Z fully undoes both.

#### Task 3.2 — Add distribution preset picker

- **File**: `packages/editor/src/components/layout/ColumnsFloatingMenu.tsx`
- Add a separator and a row of preset buttons below the column count toggle. Show only the presets valid for the current `columnCount`:

  | Label | 2-col widths | 3-col widths |
  | --- | --- | --- |
  | Equal | `[null, null]` | `[null, null, null]` |
  | Sidebar right | `[67, 33]` | — |
  | Sidebar left | `[33, 67]` | — |
  | Wide center | — | `[25, 50, 25]` |

- Each button, when clicked, dispatches a transaction that calls `tr.setNodeMarkup` on each `column` child with the corresponding `width` value (`null` → remove the `width` attribute entirely to use `flex: 1 1 0`).
- Highlight the currently active preset: compare each column's `width` attr to the preset values to determine a match. If no preset matches (e.g., legacy data), no button is highlighted.
- The transaction is one step → single undo.
- **Verify**: Clicking "Sidebar right" on a 2-column block makes the left column visually wider. Clicking "Equal" resets both to 50/50. Undo restores.

#### Task 3.3 — Update Copy button to use modern clipboard API

- **File**: `packages/editor/src/components/layout/utils.ts`
- In `copyColumnsBlock`, replace the `execCommand('copy')` path with:
  ```ts
  const html = /* serialize the columns node to HTML string */;
  const blob = new Blob([html], { type: 'text/html' });
  await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]);
  ```
- Fall back to the existing `execCommand('copy')` approach (select + copy) if `navigator.clipboard.write` is not available.
- Keep the function signature synchronous externally by not awaiting in the caller — use `.catch` on the promise for the fallback.
- **Verify**: Copying a columns block and pasting into a rich-text field (e.g., Gmail compose) produces the correct HTML structure.

#### Task 3.4 — Update toolbar layout and Separator

- **File**: `packages/editor/src/components/layout/ColumnsFloatingMenu.tsx`
- Render order: `[2col | 3col] | [Equal | Sidebar R | Sidebar L | Wide center] | [Copy] [Delete]`
- Use `<Separator.Root>` (already imported from Radix) between logical groups.
- Use icon-only buttons for the preset picker (small visual ratio diagrams as SVG or text representations).
- **Verify**: Toolbar renders correctly at both 2-col and 3-col states with the right presets visible.

---

## Phase 4: Keyboard Navigation

### Story 4 — Tab navigation between columns

**As a** keyboard user,
**I want** to press Tab to move between columns and exit the block when done,
**So that** I never need a mouse to navigate a column layout.

#### Task 4.1 — Add `Tab` keybinding to `Columns` extension

- **File**: `packages/editor/src/nodes/layout/Columns.ts`
- Add `addKeyboardShortcuts()` returning a `Tab` handler:
  ```ts
  Tab: ({ editor }) => {
    const { state } = editor;
    const { $from } = state.selection;

    // Walk up to find the columns node
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'columns') {
        const columnsNode = $from.node(d);
        const columnsStart = $from.start(d) - 1;
        const columnIndex = $from.index(d);
        const columnCount = columnsNode.childCount;

        if (columnIndex < columnCount - 1) {
          // Move to first position of next column
          const nextColumnStart = $from.start(d) + /* offset to next column */ ;
          editor.commands.setTextSelection(nextColumnStart);
          return true;
        } else {
          // On last column — exit the block
          const afterPos = columnsStart + columnsNode.nodeSize;
          if (afterPos < state.doc.nodeSize - 1) {
            editor.commands.setTextSelection(afterPos);
          } else {
            // Insert paragraph after block and move there
            editor
              .chain()
              .insertContentAt(afterPos, { type: 'paragraph' })
              .setTextSelection(afterPos + 1)
              .run();
          }
          return true;
        }
      }
    }
    return false; // not inside a columns block — let default Tab behavior proceed
  }
  ```
- **Verify**: Tab from column 1 moves to column 2. Tab from column 2 (last in 2-col) moves to the block below. Tab from last column when block is at document end inserts a paragraph and places cursor there.

#### Task 4.2 — Add `Shift-Tab` keybinding

- In the same `addKeyboardShortcuts()`, add a `'Shift-Tab'` handler that mirrors the logic: move to the first position of the previous column. If already in column 0, do nothing (let default behavior apply — this prevents escaping the block backwards, consistent with `isolating: true`).
- **Verify**: Shift-Tab from column 2 returns to column 1. Shift-Tab from column 0 does nothing (cursor stays).

---

## Phase 5: Slash Command & Insertion

### Story 5 — Insert column layouts via slash command

**As a** user,
**I want** to type `/2 columns` or `/3 columns` and insert a layout immediately,
**So that** I can set up multi-column content without breaking my writing flow.

#### Task 5.1 — Create a "Layout" group in `groups.ts`

- **File**: `packages/editor/src/extensions/slash-command/groups.ts`
- Add (or rename the existing ad-hoc entry to) a proper group:
  ```ts
  {
    title: 'Layout',
    commands: [ /* Task 5.2 & 5.3 */ ],
  }
  ```
- Place it after the "Media" group, before any "Advanced" group.

#### Task 5.2 — Update the existing `twoColumns` command entry

- Keep the existing structure but ensure:
  - `blockId` is generated via `crypto.randomUUID()` for the `columns` node and each `column` child (Task 1.5 covers the blockId; this task ensures cursor placement).
  - After insertion, the cursor is placed inside the first column at position `insertedPos + 2` (1 for the `columns` node, 1 for the first `column` node).
  - `columnCount: 2` is set on the `columns` node attrs.
- **Verify**: `/2 columns` (or any alias: `layout`, `grid`, `split`, `two`) shows the entry. After selection the cursor is inside the first column, not before/after the block.

#### Task 5.3 — Add the `threeColumns` command entry

- Under the "Layout" group:
  ```ts
  {
    name: 'threeColumns',
    label: '3 Columns',
    description: 'Create a 3-column layout',
    aliases: ['three', '3col', 'columns', 'layout', 'grid'],
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'columns',
          attrs: { columnCount: 3, blockId: crypto.randomUUID() },
          content: [
            { type: 'column', attrs: { width: null, blockId: crypto.randomUUID() }, content: [{ type: 'paragraph' }] },
            { type: 'column', attrs: { width: null, blockId: crypto.randomUUID() }, content: [{ type: 'paragraph' }] },
            { type: 'column', attrs: { width: null, blockId: crypto.randomUUID() }, content: [{ type: 'paragraph' }] },
          ],
        })
        .run();
      // Move cursor into first column
    },
  }
  ```
- **Verify**: `/3 columns` inserts three equal-width columns; cursor is in the first column.

---

## Phase 6: Styles & CSS Cleanup

### Story 6 — Clean CSS and correct visual treatment

**As a** user,
**I want** columns to render with a clear visual separator and an obvious empty-column indicator,
**So that** the layout structure is always apparent even before content is added.

#### Task 6.1 — Remove all resize CSS

- **File**: `packages/editor/src/styles/editor.css`
- Delete the following rules entirely:
  - `.columns-resize-handle { … }`
  - `.columns-resize-handle:hover > div, .columns-wrapper.resizing .columns-resize-handle > div { … }`
  - `.columns-wrapper.resizing .columns-content > div > .editor-column:first-child { … }`
  - `.columns-wrapper.resizing .columns-content > div > .editor-column:last-child { … }`
- Also remove `--left-column-width` and `--right-column-width` CSS variable references (they no longer exist in the JS).
- **Verify**: No resize-related CSS remains. The block renders correctly in 2-col and 3-col without visual artifacts.

#### Task 6.2 — Add column separator border and `min-height`

- **File**: `packages/editor/src/styles/editor.css`
- Update `.editor-column`:
  ```css
  .editor-column {
    flex: 1 1 0;
    min-width: 0;
    min-height: 2rem;
    padding: 0.25rem 0.5rem;
    border-left: 1px solid var(--editor-border, #e2e8f0);
  }

  .editor-column:first-child {
    border-left: none;
  }
  ```
- **Verify**: Adjacent columns are visually separated by a 1 px line. The first column has no left border. An empty column (single empty paragraph) is still visible and clickable.

#### Task 6.3 — Add comment explaining the `columns-content > div` CSS hack

- **File**: `packages/editor/src/styles/editor.css`
- The existing rule `.columns-content > div { display: flex !important; … }` works around an undocumented intermediate `<div>` injected by `NodeViewContent`.
- Add an explanatory comment above the rule so it is not accidentally removed:
  ```css
  /*
   * Tiptap's NodeViewContent injects an unstyled wrapper <div> between
   * .columns-content and the actual .editor-column children. This rule
   * forces that wrapper to be a flex container so columns lay out correctly.
   * Do not remove — tracked upstream: https://github.com/ueberdosis/tiptap/issues/XXXX
   */
  ```

#### Task 6.4 — Handle `width` attribute in column CSS

- When a column has a `width` attribute (set via preset), `Column.renderHTML` already emits `style="flex-basis: X%"`. Ensure the CSS does not fight this with an overly specific `flex` shorthand.
- Update `.editor-column` to use `flex-grow: 1; flex-shrink: 1; flex-basis: 0;` as individual properties rather than the shorthand `flex: 1 1 0` so that the inline `flex-basis` from the width attribute can override cleanly.
- **Verify**: A "Sidebar right" preset (67/33) renders the first column visually wider than the second.

---

## Phase 7: Edge Cases, Accessibility & Polish

### Story 7 — Robustness, accessibility, and end-to-end verification

**As a** user,
**I want** the column layout to behave correctly in all edge cases,
**So that** it never corrupts the document, traps keyboard focus, or produces inaccessible output.

#### Task 7.1 — Accessibility attributes on the wrapper

- **File**: `packages/editor/src/components/layout/ColumnsView.tsx`
- Add to the `<NodeViewWrapper>` element:
  ```tsx
  role="group"
  aria-label={`${node.attrs.columnCount}-column layout`}
  ```
- **Verify**: A screen reader announces "2-column layout group" when focus enters the block.

#### Task 7.2 — Guard against nested columns on paste

- **File**: `packages/editor/src/nodes/layout/Column.ts`
- The `content: 'block+'` rule currently allows any block, including `columns`. Restrict it:
  ```ts
  content: '(block - columns)+',
  ```
  This uses ProseMirror's content expression subtraction syntax to exclude `columns` from allowed children.
- **Verify**: Copying a 2-column block and pasting it inside a column either (a) unwraps the inner columns to their plain block content, or (b) does nothing. Confirm no nested `columns` node appears in `editor.getJSON()`.

#### Task 7.3 — Column count mismatch recovery

- **File**: `packages/editor/src/components/layout/ColumnsView.tsx`
- In a `useEffect`, compare `node.attrs.columnCount` to `node.childCount`. If they differ (corrupt paste or legacy data), dispatch a transaction to update `columnCount` to match `node.childCount`.
  ```ts
  useEffect(() => {
    if (node.attrs.columnCount !== node.childCount && typeof getPos === 'function') {
      const pos = getPos();
      if (pos !== undefined) {
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            columnCount: node.childCount,
          })
        );
      }
    }
  }, [node.attrs.columnCount, node.childCount]);
  ```
- **Verify**: Loading a document with a `columns` node where `columnCount=3` but only 2 `column` children automatically corrects the attribute to `2` on first render.

#### Task 7.4 — Verify narrow viewport behavior

- Confirm that `.editor-columns` has `overflow-x: auto` so horizontal scrolling occurs on narrow viewports instead of content clipping.
- No code change needed if the existing CSS already includes this — just verify and add if missing.

#### Task 7.5 — Editor-demo wiring and manual test checklist

- **File**: `packages/editor-demo/src/App.tsx`
- No configuration changes are needed — `Columns` and `Column` extensions are already registered. Confirm the "3 Columns" slash command appears and that the toolbar shows the full preset picker.

**Manual test checklist:**

| # | Action | Expected result |
| --- | --- | --- |
| 1 | Type `/2 columns`, press Enter | 2-column block inserted; cursor in first column |
| 2 | Type `/3 columns`, press Enter | 3-column block inserted; cursor in first column |
| 3 | Type content in each column | Each column grows independently; surrounding columns unaffected |
| 4 | Press Tab from column 1 (2-col) | Cursor moves to column 2 |
| 5 | Press Tab from column 2 (last in 2-col) | Cursor moves to block below the layout |
| 6 | Press Tab from last column when block is at document end | New empty paragraph inserted after block; cursor there |
| 7 | Press Shift-Tab from column 2 | Cursor moves to column 1 |
| 8 | Press Shift-Tab from column 0 | Cursor stays in column 0 (no escape) |
| 9 | Press Backspace at start of column 1 | Nothing happens; cursor stays |
| 10 | Press Delete at end of column 2 (last in 2-col) | Nothing happens; cursor stays |
| 11 | Click block gutter to create NodeSelection, press Backspace | Entire block deleted in one step |
| 12 | Ctrl/Cmd+Z after block deletion | Block fully restored |
| 13 | Click inside block, click "3 Columns" in toolbar | Third empty column appears; content in columns 1–2 preserved |
| 14 | With content in column 3, click "2 Columns" in toolbar | Column 3's content appended to column 2; third column removed |
| 15 | Ctrl/Cmd+Z after 2→3 or 3→2 conversion | Full prior layout restored in one undo step |
| 16 | Click "Sidebar right" preset (2-col) | Left column visually wider (67%) than right (33%) |
| 17 | Click "Equal" preset | Both columns return to equal width |
| 18 | Ctrl/Cmd+Z after preset change | Previous distribution restored |
| 19 | Click "Copy" in toolbar | Pasting into a rich-text field produces the correct HTML column structure |
| 20 | Click "Delete" in toolbar | Block deleted immediately, no flicker |
| 21 | Paste a columns block inside a column | Inner columns are unwrapped; no nested layout in `editor.getJSON()` |
| 22 | Load a doc with `columnCount=3` but 2 actual column children | `columnCount` auto-corrects to `2` with no console error |
| 23 | Switch editor to `editable: false` | Toolbar hidden; columns render as a static flex row |
| 24 | Verify `editor.getJSON()` on a 2-col block | `blockId` is non-null on `columns` and both `column` nodes |
