# Table Node Fix Plan

## Overview

Four bugs are tracked in `table-issues.md`. This document details the exact files, locations, and changes required to fix each one, written to be actionable by any implementer.

---

## Issue 1 — Row selection breaks with merged cells

### Root cause

`getCellsInColumn(0)` in `packages/editor/src/nodes/table/utils.ts` returns one entry per *physical* cell in column 0. When rows are merged (rowspan > 1), fewer entries are returned than there are rows. For example, in a 4-row table where rows 2 and 3 are merged in column 0, only 3 cells come back.

The `forEach` array index (0, 1, 2) is passed directly as `rowIndex` to `RowDragHandle` and to `selectRow()`. Index 2 points to the merged cell's row in the TableMap, not row 3, so `selectRow(2)` selects the wrong cells.

### File

`packages/editor/src/nodes/table/TableCell.ts`

### Task 1.1 — Compute actual TableMap row index per grip handle

**Location**: Inside the second `Plugin`'s `decorations` function in `addProseMirrorPlugins()`, at the line reading `const cells = getCellsInColumn(0)(selection);`.

Before the `cells.forEach(...)` loop, add:

```typescript
const table = findTable(selection);
const map = table ? TableMap.get(table.node) : null;
```

Inside `cells.forEach`, add this block at the top of the callback to compute the actual row index:

```typescript
let actualRowIndex = index; // fallback if map unavailable
if (table && map) {
  const cellPosInTable = pos - table.start;
  const rect = map.findCell(cellPosInTable);
  if (rect) actualRowIndex = rect.top;
}
```

Then replace every use of `index` that feeds row-related logic:

| Old | New |
|---|---|
| `isRowSelected(index)(selection)` | `isRowSelected(actualRowIndex)(selection)` |
| `rowIndex: index` | `rowIndex: actualRowIndex` |
| `isFirst: index === 0` | `isFirst: actualRowIndex === 0` |
| `isLast: index === cells.length - 1` | `isLast: actualRowIndex === map.height - 1` |
| `selectRow(index)(...)` inside `onHighlight` | `selectRow(actualRowIndex)(...)` |
| `tr.setMeta('highlightRow', index)` inside `onHighlight` | `tr.setMeta('highlightRow', actualRowIndex)` |

`findTable` and `TableMap` are already imported at the top of `TableCell.ts`. No new imports are needed.

### Testable outcome

1. Create a 4-row × 3-column table.
2. Merge column 1 cells across rows 2 and 3 (rowspan merge via the table floating menu).
3. Click the row grip handle next to row 4.
4. Only the three cells of row 4 gain the blue `selectedCell` highlight outline.
5. No cells from rows 2 or 3 are highlighted.

---

## Issue 2 — Slash command doesn't work in table cells

### Root cause

The `allow` function in `packages/editor/src/extensions/slash-command/SlashCommand.ts` sets `isAllowedDepth = true` only when:
- `$from.depth === 1` (root-level paragraph), or
- a `detailsContent` ancestor is found.

A paragraph inside a `tableCell` sits at depth > 1 with neither of those ancestors, so `isAllowedDepth` stays `false` and the suggestion is suppressed entirely.

### File

`packages/editor/src/extensions/slash-command/SlashCommand.ts`

### Task 2.1 — Extend `allow` to include table cell context

**Location**: Inside the `allow` function, after the existing `else { for (...detailsContent...) }` block, still before the final `return` statement.

Add this block:

```typescript
// Also allow inside table cells
if (!isAllowedDepth) {
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      isAllowedDepth = true;
      break;
    }
  }
}
```

No new imports required.

### Testable outcome

1. Create a table.
2. Click into an empty cell and type `/`.
3. The slash command menu opens showing all available commands.
4. Typing a partial command name filters the list correctly.
5. Pressing Escape closes the menu and leaves the cursor in the cell.
6. Outside tables, slash command behaviour is unchanged.

---

## Issue 3 — Bubble menu doesn't open on text selection inside a table cell

### Root cause

`packages/editor/src/components/BubbleMenu.tsx` contains this early return inside `updateMenu`:

```typescript
// Don't show in tables or special nodes
if (editor.isActive('table') || editor.isActive('mermaid')) {
  setIsOpen(false);
  return;
}
```

`editor.isActive('table')` is `true` for any selection inside a table — including a plain text selection within a single cell. This blanket suppression prevents the bubble menu from ever appearing in table context.

### File

`packages/editor/src/components/BubbleMenu.tsx`

### Task 3.1 — Add `CellSelection` import

At the top of the file add:

```typescript
import { CellSelection } from '@tiptap/pm/tables';
```

### Task 3.2 — Replace the blanket table suppression with a `CellSelection`-only check

Replace:

```typescript
// Don't show in tables or special nodes
if (editor.isActive('table') || editor.isActive('mermaid')) {
  setIsOpen(false);
  return;
}
```

With:

```typescript
// Suppress on multi-cell (CellSelection) or special nodes; allow text selection inside cells
if (selection instanceof CellSelection || editor.isActive('mermaid')) {
  setIsOpen(false);
  return;
}
```

The existing `if (empty)` and `if (!text)` guards above this block already ensure the menu only appears when actual text characters are selected, so no further changes are needed.

### Testable outcome

1. Type text in a table cell, select part of it — the bubble menu appears above or below the selection, identical to selecting text in a normal paragraph.
2. Click-drag across multiple cells (CellSelection) — the bubble menu does not appear.
3. Click a cell without selecting text — menu does not appear.
4. Bubble menu behaviour outside tables is unchanged.

---

## Issue 4 — Header row/column has no default background colour

### Root cause

In `packages/editor/src/styles/editor.css`, the `th` rule (around line 883) only applies `font-weight: 700`:

```css
.beskar-editor .ProseMirror table th {
  font-weight: 700;
}
```

No background colour is set, so `th` cells are visually identical to `td` cells regardless of whether the header row or header column is toggled on.

### File

`packages/editor/src/styles/editor.css`

### Task 4.1 — Add background colour to the existing `th` rule

Extend the rule:

```css
.beskar-editor .ProseMirror table th {
  font-weight: 700;
  background-color: rgb(243, 244, 246);
}
```

### Task 4.2 — Add dark mode variant

Directly after the `th` rule, add:

```css
.beskar-editor.dark .ProseMirror table th {
  background-color: rgba(255, 255, 255, 0.06);
}
```

This covers all cases uniformly:
- Header row only: all `th` cells in that row get the background.
- Header column only: all `th` cells in that column get the background.
- Both active simultaneously: the intersection cell at `(0,0)` is a `th` in both cases and correctly inherits the same rule.

The existing `.selectedCell` override applies `background-color` via higher specificity, so there is no conflict when a header cell is also selected.

### Testable outcome

1. Create a table. Toggle "Header row: ON" from the row grip menu on row 1. Row 1 cells display a light gray background (`rgb(243, 244, 246)`), visually distinct from white `td` cells below.
2. Toggle the header row off — the background returns to white.
3. Toggle header row on and also toggle a header column on — both the header row and the first-column `th` cells display the gray background, including the corner cell at `(0,0)`.
4. In dark mode, header cells display a subtle white tint (`rgba(255, 255, 255, 0.06)`) instead of the light gray.

---

## Change summary

| Issue | File | Nature of change |
|---|---|---|
| 1 — Row selection with merged cells | `packages/editor/src/nodes/table/TableCell.ts` | Compute actual TableMap row index from `map.findCell()` instead of using forEach array index |
| 2 — Slash command in table cells | `packages/editor/src/extensions/slash-command/SlashCommand.ts` | Add `tableCell` / `tableHeader` ancestor check in the `allow` function |
| 3 — Bubble menu in table cells | `packages/editor/src/components/BubbleMenu.tsx` | Replace blanket `editor.isActive('table')` suppression with `CellSelection` instanceof check |
| 4 — Header background colour | `packages/editor/src/styles/editor.css` | Add `background-color` to `th` rule and dark mode override |
