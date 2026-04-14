# User Stories & Tasks: Block Drag Handle & Drag-and-Drop Fixes

> **Strategy**: All changes are confined to `packages/editor/src/extensions/block-drag-drop.ts` and `packages/editor/src/styles/editor.css`. No schema changes, no new files, no backend work.
>
> Bug analysis: [`bugs-and-fixes.md`](./bugs-and-fixes.md)

---

## Architecture Decision Log

| # | Decision | Chosen approach |
| --- | --- | --- |
| 1 | **Handle vertical centering** | Read `window.getComputedStyle(blockElement).lineHeight` at position time and compute `topOffset = (lineHeight − 20) / 2`. This is cheap (no layout thrash) and works for all font sizes without hardcoding per-node-type values. Tables and images get a fixed small nudge (`8px`) because their "line height" is the full block height which is not meaningful for this calculation. |
| 2 | **`dropBefore` fix** | Change the variable type to `boolean \| undefined` and compute it unconditionally inside the block-resolution loop — same pattern already used in the `dragover` handler — instead of relying on an `=== undefined` guard after initialization to `false`. |
| 3 | **`dragleave` strategy** | Use `event.relatedTarget` to distinguish a true editor exit from an intra-editor element crossing. Only clear indicators on a true exit. This avoids a full `querySelectorAll` scan on every mouse-enter/leave event for child elements. |
| 4 | **Gutter fallback in `dragover`** | When `posAtCoords` returns null (cursor in left gutter), fall back to Y-proximity block search — the same approach already used in the `drop` handler's fallback branch. Keeps the two codepaths consistent. |
| 5 | **Drag ghost background** | Remove the hardcoded `backgroundColor: "gray"`. The clone inherits the block's real background. Add a subtle `box-shadow` and `border-radius` to make it look like a floating card. |

---

## Epic: Block Drag Handle & DnD Fixes

| Phase | Goal |
| --- | --- |
| **Phase 1 — Handle alignment** | Fix vertical position of the drag handle so it is centred on the first text line of every block type. |
| **Phase 2 — Drop position correctness** | Fix the critical `dropBefore` bug so drops actually land where the indicator says; also tighten the `dragover` depth guard so tables aren't misidentified. |
| **Phase 3 — Indicator reliability** | Fix `dragleave` so indicators clear on editor exit; add gutter fallback in `dragover` so the indicator never flickers off in the left margin. |
| **Phase 4 — Polish** | Replace the hardcoded gray drag-ghost background with a proper themed card appearance. |

---

## Phase 1: Handle Alignment

### Story 1 — Handle is vertically centred on the block's first line

**As a** writer,  
**I want** the drag handle dots to sit level with the first line of text in a block,  
**So that** the handle feels visually attached to the content it controls and not awkwardly offset.

#### Task 1.1 — Replace the fixed `topOffset` with a computed line-height-based offset

- **File**: `packages/editor/src/extensions/block-drag-drop.ts`
- **Location**: `positionHandle()`, currently ~line 257.
- Remove `let topOffset = 18;`.
- After resolving `blockElement` (the per-type overrides above this point stay unchanged), read the element's computed line height:
  ```ts
  const computed = window.getComputedStyle(blockElement);
  const rawLineHeight = computed.lineHeight;
  const firstLineHeight =
    rawLineHeight === 'normal'
      ? parseFloat(computed.fontSize) * 1.2
      : parseFloat(rawLineHeight);
  const handleHeight = 20; // matches CSS height: 1.25rem
  const topOffset = Math.max(0, (firstLineHeight - handleHeight) / 2);
  ```
- **Verify**: Hover over a `<p>`, an `<h1>`, an `<h2>`, an `<h3>`, a `codeBlock`, and a `blockquote`. The centre of the six-dot icon should be visually level with the centre of the first line of text in each block.

#### Task 1.2 — Apply a separate fixed offset for tables and images

- **File**: `packages/editor/src/extensions/block-drag-drop.ts`
- **Location**: immediately after Task 1.1 code, before the `top` calculation.
- Use the already-declared (but currently unused) `isTable` and `isImage` booleans:
  ```ts
  const isTable = blockInfo.node.type.name === 'table';
  const isImage = blockInfo.node.type.name === 'imageBlock';
  const effectiveOffset = (isTable || isImage) ? 8 : topOffset;
  ```
- Replace `topOffset` with `effectiveOffset` in the `top` calculation:
  ```ts
  const top = blockRect.top - parentRect.top + parent.scrollTop + effectiveOffset;
  ```
- **Verify**: Hover over a table — the handle appears near the top-left corner of the table wrapper, not far below it. Hover over an image block — same behaviour.

---

## Phase 2: Drop Position Correctness

### Story 2 — Block drops land where the visual indicator says they will

**As a** writer,  
**I want** blocks to land above or below the highlighted target exactly as the blue indicator line suggests,  
**So that** I can predictably reorder content without having to undo and retry.

#### Task 2.1 — Fix `dropBefore` initialization in the `drop` handler

- **File**: `packages/editor/src/extensions/block-drag-drop.ts`
- **Location**: `drop` handler, ~line 700.
- **Root cause**: `let dropBefore = false` is initialised as a boolean. The only place it is subsequently computed in the normal code path is guarded by `if (dropBefore === undefined)`, which is never true (`false !== undefined`). Result: blocks always drop *after* the target, never before.
- Change the declaration:
  ```ts
  // Before
  let dropBefore = false;
  
  // After
  let dropBefore: boolean | undefined = undefined;
  ```
- In the normal block-resolution `for` loop (where `depth === 1` is checked), replace the `=== undefined` guard with an unconditional assignment:
  ```ts
  // Before
  if (dropBefore === undefined) {
    dropBefore = event.clientY < rect.top + rect.height / 2;
  }
  
  // After
  dropBefore = event.clientY < rect.top + rect.height / 2;
  ```
- In the insert-position calculation that follows, update the condition to handle `undefined` gracefully (treat as "drop after"):
  ```ts
  if (!dropBefore) {
    const targetNode = view.state.doc.nodeAt(targetPos);
    if (targetNode) {
      insertPos = targetPos + targetNode.nodeSize;
    }
  }
  ```
- **Verify**:
  1. Drag a paragraph. Hover over the **top half** of another block — the blue line appears above it. Release. The paragraph lands *above* the target. ✓
  2. Drag a paragraph. Hover over the **bottom half** of another block — the blue line appears below it. Release. The paragraph lands *below* the target. ✓
  3. Repeat with headings, lists, code blocks, and tables.

#### Task 2.2 — Add `depth === 1` guard to the `dragover` indicator loop

- **File**: `packages/editor/src/extensions/block-drag-drop.ts`
- **Location**: `dragover` handler, ~line 649.
- **Root cause**: The depth loop in `dragover` has no `depth === 1` constraint, so hovering over content inside a table (e.g. a paragraph at depth 3+) can cause the indicator to light up on an inner node instead of the table block itself.
- Add the guard to match what the `drop` handler already does:
  ```ts
  // Before
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (
      this.options.types.includes(node.type.name) &&
      node.attrs.blockId
    ) { ... }
  }
  
  // After
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (
      depth === 1 &&
      this.options.types.includes(node.type.name) &&
      node.attrs.blockId
    ) { ... }
  }
  ```
- **Verify**: Drag a block and hover slowly over a table. The blue indicator line appears on the table block as a whole, not on individual cells or the paragraphs inside them.

---

## Phase 3: Indicator Reliability

### Story 3 — The drop indicator clears cleanly when the cursor leaves the editor

**As a** writer,  
**I want** the blue drop-target line to disappear when I move the cursor outside the editor,  
**So that** the UI does not leave a phantom indicator visible after an abandoned drag.

#### Task 3.1 — Fix the `dragleave` handler

- **File**: `packages/editor/src/extensions/block-drag-drop.ts`
- **Location**: `dragleave` handler, ~line 863.
- **Root cause**: The handler checks `event.target.classList.contains("block-node")`, but `event.target` is almost always an inner element (a `<p>`, `<span>`, table cell). The block-level indicator classes are never removed.
- Replace the handler body:
  ```ts
  // Before
  dragleave: (view, event) => {
    const target = event.target as HTMLElement;
    if (target.classList?.contains("block-node")) {
      target.classList.remove("drag-over", "drag-over-top", "drag-over-bottom");
    }
    return false;
  },
  
  // After
  dragleave: (view, event) => {
    const relatedTarget = event.relatedTarget as HTMLElement | null;
    // Only clear indicators when the cursor is truly leaving the editor container.
    // Intra-editor element crossings (child → child) are handled by dragover.
    if (!relatedTarget || !view.dom.contains(relatedTarget)) {
      view.dom
        .querySelectorAll(".drag-over, .drag-over-top, .drag-over-bottom")
        .forEach((el) => {
          el.classList.remove("drag-over", "drag-over-top", "drag-over-bottom");
        });
    }
    return false;
  },
  ```
- **Verify**: Start a drag. Move the cursor out of the browser window or to another app. The blue indicator line is gone. Move back in — the indicator correctly reappears on the first `dragover` event.

### Story 4 — The drop indicator stays visible while dragging along the left gutter

**As a** writer,  
**I want** the drop indicator to remain visible when I drag through the left margin where the handle lives,  
**So that** I can smoothly position a block without the visual feedback flickering off.

#### Task 3.2 — Add a gutter fallback in the `dragover` handler

- **File**: `packages/editor/src/extensions/block-drag-drop.ts`
- **Location**: `dragover` handler, ~line 640, immediately after the `if (!pos) return true;` check.
- **Root cause**: `posAtCoords` returns `null` when the cursor is in the left gutter (the area `44px` to the left of block content where the handle is positioned). The early `return true` clears all indicators and shows nothing.
- Replace the early exit with a Y-proximity fallback:
  ```ts
  // Before
  if (!pos) return true;
  
  // After
  if (!pos) {
    // Cursor is in the gutter or outside the content rectangle.
    // Use Y-proximity to identify the target block and show the indicator.
    let bestEl: HTMLElement | null = null;
    let bestDist = Infinity;
    view.dom
      .querySelectorAll<HTMLElement>('.block-node:not(.dragging)')
      .forEach((el) => {
        const r = el.getBoundingClientRect();
        const dist = Math.abs(event.clientY - (r.top + r.height / 2));
        if (dist < bestDist) {
          bestDist = dist;
          bestEl = el;
        }
      });
    if (bestEl) {
      const rect = bestEl.getBoundingClientRect();
      bestEl.classList.add(
        'drag-over',
        event.clientY < rect.top + rect.height / 2
          ? 'drag-over-top'
          : 'drag-over-bottom'
      );
    }
    return true;
  }
  ```
- **Verify**: Drag a block and move the cursor slowly into the left gutter. The blue indicator line stays visible and tracks correctly to the nearest block boundary as the cursor moves up and down.

---

## Phase 4: Polish

### Story 5 — The drag ghost looks like a floating card, not a gray rectangle

**As a** writer,  
**I want** the block I am dragging to appear as a semi-transparent copy of itself,  
**So that** I can see what I am moving while I position it.

#### Task 4.1 — Replace the hardcoded gray ghost background

- **File**: `packages/editor/src/extensions/block-drag-drop.ts`
- **Location**: `handleDragStart`, the drag-image clone, ~line 456.
- Remove `clone.style.backgroundColor = "gray";`.
- Add a shadow and radius so the clone reads as a floating card:
  ```ts
  // Remove this line entirely:
  // clone.style.backgroundColor = "gray";
  
  // Add these instead:
  clone.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.15)";
  clone.style.borderRadius = "0.25rem";
  clone.style.overflow = "hidden";
  ```
- **Verify**: Start a drag on a paragraph, a heading, a table, and a code block. The ghost in each case is a semi-transparent copy of the actual block content, not a gray rectangle. On dark theme it should still look correct (no hardcoded colors).

---

## Acceptance Checklist (end-to-end)

Run these manual tests after all phases are complete:

| # | Test | Expected |
| --- | --- | --- |
| 1 | Hover over a `<p>` | Handle dots are vertically centred on the text line |
| 2 | Hover over an `<h1>`, `<h2>`, `<h3>` | Handle dots are vertically centred on the heading text |
| 3 | Hover over a table | Handle dots appear near the top-left of the table, not far below |
| 4 | Drag a block to the **top half** of another block | Blue line appears **above** target; block lands above it |
| 5 | Drag a block to the **bottom half** of another block | Blue line appears **below** target; block lands below it |
| 6 | Drag a block, hover over a cell inside a table | Blue line appears on the **table** block, not on an inner cell |
| 7 | Drag a block, move cursor out of the browser window | Blue line disappears; no phantom indicator left |
| 8 | Drag a block, move slowly through the left gutter | Blue indicator stays visible and tracks correctly |
| 9 | Start a drag on any block | Ghost is a semi-transparent copy of the block, not a gray box |
| 10 | Drag within a dark-theme editor | Handle, indicator, and ghost all respect the dark theme |
