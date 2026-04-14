# Block Drag Handle & DnD — Bug Analysis & Fixes

**File under investigation:** `packages/editor/src/extensions/block-drag-drop.ts`  
**Styles:** `packages/editor/src/styles/editor.css`

---

## Bug 1 — Drag Handle Vertical Misalignment

### What's wrong

`positionHandle()` uses a **hardcoded `topOffset = 18`** (px) for every block type:

```ts
// block-drag-drop.ts  lines 257–264
let topOffset = 18;

const top = blockRect.top - parentRect.top + parent.scrollTop + topOffset;
const left = blockRect.left - parentRect.left + parent.scrollLeft - 44;

dragHandle.style.top = `${top}px`;
dragHandle.style.left = `${left}px`;
```

The handle button is `1.25rem` (20 px) tall. To look vertically centred with the **first line of text**, the top of the handle should be offset by:

```
topOffset = (firstLineHeight - handleHeight) / 2
```

A paragraph with `line-height: 1.625` at 16 px base → ~26 px first line → `topOffset ≈ 3 px`.  
A heading (`h2`, ~24 px font) with `line-height: 1.3` → ~31 px → `topOffset ≈ 5–6 px`.

At 18 px the handle centre ends up **well below** the text baseline for most node types, which is exactly what the screenshot shows.

Additionally, `isTable` and `isImage` are computed but **never used**. They were clearly meant to branch into different offsets but the branching was never written:

```ts
const isTable = blockInfo.node.type.name === 'table';   // declared, never read
const isImage = blockInfo.node.type.name === 'imageBlock'; // declared, never read
```

### Fix

Read the element's computed `line-height` and use it to centre the handle. For multi-line blocks (e.g., a long paragraph) align with the **first line** only.

```ts
const positionHandle = (blockInfo: BlockInfo) => {
  if (!dragHandle) return;

  let blockElement = blockInfo.dom;
  // ... (existing per-type element overrides stay the same) ...

  const blockRect = blockElement.getBoundingClientRect();
  const parent = container.parentElement;
  if (!parent) return;
  const parentRect = parent.getBoundingClientRect();

  // Derive the visual first-line height from computed style
  const computed = window.getComputedStyle(blockElement);
  const rawLineHeight = computed.lineHeight;
  const firstLineHeight =
    rawLineHeight === 'normal'
      ? parseFloat(computed.fontSize) * 1.2
      : parseFloat(rawLineHeight);

  const handleHeight = 20; // 1.25rem in px
  // Centre handle vertically within the first line of the block
  const topOffset = Math.max(0, (firstLineHeight - handleHeight) / 2);

  // For tables and images the entire block is the "visual unit" — align to top with a small nudge
  const isTable = blockInfo.node.type.name === 'table';
  const isImage = blockInfo.node.type.name === 'imageBlock';
  const effectiveOffset = (isTable || isImage) ? 8 : topOffset;

  const top = blockRect.top - parentRect.top + parent.scrollTop + effectiveOffset;
  const left = blockRect.left - parentRect.left + parent.scrollLeft - 44;

  dragHandle.style.top = `${top}px`;
  dragHandle.style.left = `${left}px`;
};
```

---

## Bug 2 — `dropBefore` is Never Set for the Normal Drop Path (Critical)

### What's wrong

In the `drop` handler, `dropBefore` is initialised as `false` (boolean), and the only place it is subsequently computed is guarded by `=== undefined` — which **can never be true**:

```ts
// block-drag-drop.ts  lines 700, 750–752
let dropBefore = false;         // ← initialised as false

// ... normal path (closest('.block-node') found): ...
if (dropBefore === undefined) { // ← false !== undefined → NEVER executes
  dropBefore = event.clientY < rect.top + rect.height / 2;
}
```

Only the **fallback path** (when `closest()` fails and we search by Y proximity) sets `dropBefore` correctly. In the normal case `dropBefore` is always `false`, meaning every drop always inserts the block **after** the target, never before it.

This creates a mismatch: the visual `drag-over-top` indicator might show "you will drop above this block" but the actual transaction always places the block below it.

### Fix

Change the type/initial value so the condition works:

```ts
let dropBefore: boolean | undefined = undefined;  // was: false

// ... later, in the depth-loop inside the normal path ...
if (targetPos !== null) {
  const rect = blockElement.getBoundingClientRect();
  dropBefore = event.clientY < rect.top + rect.height / 2; // always compute it
}
```

Then guard the final insert-position calculation:

```ts
if (dropBefore === false || dropBefore === undefined) {
  // treat undefined (no target found) as "drop after"
  const targetNode = view.state.doc.nodeAt(targetPos);
  if (targetNode) insertPos = targetPos + targetNode.nodeSize;
}
```

---

## Bug 3 — `dragleave` Does Not Clear the Drop Indicator

### What's wrong

```ts
// block-drag-drop.ts  lines 863–873
dragleave: (view, event) => {
  const target = event.target as HTMLElement;
  if (target.classList?.contains("block-node")) {
    target.classList.remove("drag-over", "drag-over-top", "drag-over-bottom");
  }
  return false;
},
```

`dragleave` fires for **every** DOM element the cursor crosses — paragraphs, spans, table cells, etc. `event.target` is almost never the `.block-node` wrapper itself; it is typically an inner child. The `classList.contains("block-node")` check therefore **almost always fails**, leaving stale drop-indicator bars on screen when the cursor leaves the editor area entirely.

The `dragover` handler does clear and reset indicators, so during an active hover-drag this is masked. The problem surfaces when:
- The user drags out of the editor window without dropping (the last indicator bar stays visible).
- The cursor moves rapidly and `posAtCoords` returns null, clearing all indicators via the early `return true` — but the dragleave handler does not restore a clean state for the skipped block.

### Fix

Use `relatedTarget` to detect when the cursor is genuinely leaving the editor, and clear from the ancestor `.block-node`:

```ts
dragleave: (view, event) => {
  const relatedTarget = event.relatedTarget as HTMLElement | null;
  // Only clear when the cursor is actually leaving the editor container
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

---

## Bug 4 — Drop Indicator Not Shown When Cursor Is in the Gutter

### What's wrong

`dragover` resolves a document position with `posAtCoords`. When the cursor is in the **left gutter** (where the drag handle itself lives — `left - 44px` from the block) ProseMirror returns `null` because that area is outside the editor content rectangle:

```ts
const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
if (!pos) return true;  // ← exits with no indicator
```

A user dragging slowly along the left margin sees the indicator flicker off whenever the cursor passes through the gutter, making it feel buggy.

### Fix

When `posAtCoords` returns null, fall back to finding the nearest block by Y position (same approach used in the `drop` handler's fallback):

```ts
if (!pos) {
  // Cursor is in gutter or outside content; use Y-proximity to pick target block
  let bestEl: HTMLElement | null = null;
  let bestDist = Infinity;
  view.dom.querySelectorAll<HTMLElement>('.block-node:not(.dragging)').forEach((el) => {
    const r = el.getBoundingClientRect();
    const dist = Math.abs(event.clientY - (r.top + r.height / 2));
    if (dist < bestDist) { bestDist = dist; bestEl = el; }
  });
  if (bestEl) {
    const rect = bestEl.getBoundingClientRect();
    bestEl.classList.add('drag-over', event.clientY < rect.top + rect.height / 2
      ? 'drag-over-top' : 'drag-over-bottom');
  }
  return true;
}
```

---

## Bug 5 — `dragover` Can Highlight Inner Blocks (Inside Tables / Lists)

### What's wrong

The `dragover` depth loop does not enforce `depth === 1`:

```ts
for (let depth = $pos.depth; depth > 0; depth--) {
  const node = $pos.node(depth);
  if (this.options.types.includes(node.type.name) && node.attrs.blockId) {
    // ← matches paragraph inside a table cell (depth 3+)
    ...
    break;
  }
}
```

When the cursor hovers over content inside a table, the first match could be a `paragraph` inside a table cell (which is in `options.types` and has a `blockId`), not the `table` block itself. This makes the wrong block light up with the drop indicator.

The `drop` handler already has `depth === 1` to guard against this — `dragover` does not.

### Fix

Add the same `depth === 1` guard to `dragover`:

```ts
for (let depth = $pos.depth; depth > 0; depth--) {
  const node = $pos.node(depth);
  if (
    depth === 1 &&                                      // ← add this
    this.options.types.includes(node.type.name) &&
    node.attrs.blockId
  ) {
    ...
    break;
  }
}
```

---

## Bug 6 — Drag Ghost Image Uses Hardcoded Gray Background

### What's wrong

```ts
// block-drag-drop.ts  line 456
clone.style.backgroundColor = "gray";
```

The ghost image shown while dragging has an opaque gray background regardless of the block's actual appearance. This looks jarring on both light and dark themes.

### Fix

Remove the hardcoded colour and let the clone inherit from the source element, or apply a subtle semi-transparent overlay matching the theme:

```ts
clone.style.backgroundColor = ""; // inherit from source
clone.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)";
clone.style.borderRadius = "0.25rem";
```

---

## Summary Table

| # | Location | Severity | Description |
|---|----------|----------|-------------|
| 1 | `positionHandle()` | High | Fixed `topOffset = 18` misaligns handle on every block type; `isTable`/`isImage` unused |
| 2 | `drop` handler | **Critical** | `dropBefore` initialized `false`, `=== undefined` check never fires → always drops after target |
| 3 | `dragleave` handler | Medium | Checks `event.target` for `.block-node` class which almost never matches; indicator not cleared on editor exit |
| 4 | `dragover` handler | Medium | `posAtCoords` returns null in gutter → indicator disappears mid-drag |
| 5 | `dragover` handler | Medium | Missing `depth === 1` guard → highlights inner paragraphs inside tables instead of the table block |
| 6 | `handleDragStart` | Low | Drag ghost uses hardcoded gray background |
