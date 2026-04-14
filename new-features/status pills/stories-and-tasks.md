# User Stories & Tasks: Status Pills (StatusBadge)

> **Strategy**: All work lives entirely in `packages/editor` and `packages/editor-demo`. No backend or `ui` changes needed — the badge is purely a client-side inline node with no upload or persistence concerns beyond standard document JSON.
>
> Full product spec: [`req-doc-blocks.md`](./req-doc-blocks.md).

---

## Architecture Decision Log

| # | Decision | Chosen approach |
| --- | --- | --- |
| 1 | **Node type** | `atom: true`, `selectable: true`, `inline: true`. Cursor can never enter the node; ProseMirror treats it as a single character. |
| 2 | **Edit interaction** | Clicking the pill opens a Radix `Popover` via React state in the NodeView. No BubbleMenu or separate ProseMirror plugin needed. |
| 3 | **Color model** | 5 named semantic colors (`gray`, `blue`, `green`, `yellow`, `red`) stored as an attribute string — not raw hex — so CSS can own the actual palette and dark-mode variants. |
| 4 | **Label casing** | Label is stored and displayed as uppercase. The input calls `.toUpperCase()` before committing. |
| 5 | **Popover close → cursor placement** | On popover close, dispatch a ProseMirror transaction that places the cursor immediately after the badge's end position via `getPos() + node.nodeSize`. |
| 6 | **Slash command grouping** | Add a new "Inline" group to `groups.ts` (separate from the existing block-level groups). StatusBadge is its first entry. |

---

## Epic: Status Pills

| Phase | Goal |
| --- | --- |
| **Phase 1 — Node & schema** | `StatusBadge` node definition, attributes, HTML serialization, `renderText` clipboard fallback, extension registration. |
| **Phase 2 — NodeView & UI** | React NodeView with pill rendering, popover editor (color swatches + label input), selected-state highlight, cursor placement on close. |
| **Phase 3 — Slash command** | "Inline" group + StatusBadge entry in the slash command palette. |
| **Phase 4 — Styles** | CSS for pill variants (all 5 colors), dark-mode overrides, selected ring, popover layout. |
| **Phase 5 — Edge cases & polish** | Empty-label guard, max-length enforcement, end-of-document paragraph insertion, accessibility attributes, undo/redo verification, editor-demo wiring. |

---

## Phase 1: Node & Schema

### Story 1 — StatusBadge node definition

**As a** developer,
**I want** a well-typed inline node extension for `StatusBadge`,
**So that** the document schema can represent status badges and serialize them correctly to HTML and plain text.

#### Task 1.1 — Create `packages/editor/src/nodes/StatusBadge.ts`

- Define the node with:
  - `name: 'statusBadge'`
  - `group: 'inline'`, `inline: true`, `atom: true`, `selectable: true`, `draggable: false`
- Attributes:
  - `label`: string, default `'IN PROGRESS'`
  - `color`: `'gray' | 'blue' | 'green' | 'yellow' | 'red'`, default `'gray'`
- `parseHTML`: match `span[data-type="status-badge"]`, reading `data-label` and `data-color`.
- `renderHTML`: emit `<span data-type="status-badge" data-label="…" data-color="…">LABEL</span>`.
- `renderText`: return `[LABEL]` for plain-text clipboard fallback.
- Wire up `ReactNodeViewRenderer` (NodeView created in Phase 2; use a placeholder stub for now).
- **File**: `packages/editor/src/nodes/StatusBadge.ts`
- **Verify**: `pnpm exec tsc --noEmit` in `packages/editor` passes.

#### Task 1.2 — Register the extension

- Import `StatusBadge` in `packages/editor/src/extensions/index.ts` and add it to the extensions array returned by `getExtensions`.
- Export the node from `packages/editor/src/nodes/index.ts` (or wherever nodes are barrel-exported).
- **Verify**: A minimal test doc with `{ type: 'statusBadge', attrs: { label: 'DONE', color: 'green' } }` round-trips through `editor.getHTML()` and back without data loss.

---

## Phase 2: NodeView & UI

### Story 2 — Pill rendering and popover editor

**As a** user,
**I want** status badges to render as styled pills and open a small editor when I click them,
**So that** I can quickly change a badge's label and color without breaking my writing flow.

#### Task 2.1 — Create `StatusBadgeView.tsx` (pill shell)

- **File**: `packages/editor/src/components/status-badge/StatusBadgeView.tsx`
- Render a `<NodeViewWrapper>` with `as="span"` and `contentEditable={false}`.
- Inside it, a `<span>` with the appropriate color classes (map `color` attr to CSS class `status-badge--{color}`).
- Display `node.attrs.label` as the text content.
- Add `role="img"` and `aria-label={`Status: ${node.attrs.label}`}` for accessibility.
- No popover yet — wire popover open state in Task 2.2.
- **Verify**: Inserting a badge via `editor.commands.insertContent({ type: 'statusBadge' })` renders a visible pill.

#### Task 2.2 — Add Radix Popover with color swatches

- Add `open` / `setOpen` state to `StatusBadgeView`.
- Wrap the pill in `<Popover.Root open={open}>`. The pill `<span>` is the `<Popover.Trigger>`.
- `<Popover.Content>` (inside `<Popover.Portal>`) contains:
  - A `div.status-badge-swatches` row of 5 buttons, one per color. Each button is a 16 px circle with its respective color. Clicking one calls `updateAttributes({ color })` — popover stays open.
  - Active color swatch shows a checkmark or inset ring to indicate current selection.
- Use `@floating-ui/react` or Radix's built-in positioning; set `side="top"` with `sideOffset={6}`.
- **File**: same `StatusBadgeView.tsx`.

#### Task 2.3 — Add label input to popover

- Below the swatches, add a `<input type="text">` inside the popover:
  - `maxLength={40}`, `style={{ textTransform: 'uppercase' }}`
  - Initialized to `node.attrs.label` on open; auto-focused with `select()` called via `useEffect`.
- On `Enter` key or `blur`:
  - If value is empty → add CSS class `status-badge-input--error` (red border), keep popover open, do **not** commit.
  - Otherwise → `updateAttributes({ label: value.toUpperCase() })`, close popover.
- On `Escape` key → discard input changes, close popover.
- On popover `onOpenChange(false)`: move the editor cursor to `getPos() + node.nodeSize` via a ProseMirror transaction using `editor.view.dispatch`.

#### Task 2.4 — Selected-state highlight

- While `open === true`, add `status-badge--selected` class to the pill `<span>` (CSS adds `ring-2 ring-blue-500 ring-offset-1`).
- Remove the class when the popover closes.

---

## Phase 3: Slash Command

### Story 3 — Insert badge via slash command

**As a** user,
**I want** to type `/status` (or `/badge`, `/pill`) and pick "Status Badge" from the menu,
**So that** I can insert a badge without taking my hands off the keyboard.

#### Task 3.1 — Add "Inline" group to `groups.ts`

- In `packages/editor/src/extensions/slash-command/groups.ts`, add a new group object (e.g. after the existing "Basic Blocks" group):
  ```ts
  {
    title: 'Inline',
    commands: [ /* Task 3.2 entry */ ],
  }
  ```

#### Task 3.2 — Add StatusBadge command entry

- Inside the new "Inline" group:
  ```ts
  {
    name: 'status',
    label: 'Status Badge',
    icon: '🏷️',
    description: 'Insert an inline status badge',
    aliases: ['badge', 'pill', 'state', 'status'],
    action: (editor) => {
      editor.chain().focus().insertContent({
        type: 'statusBadge',
        attrs: { label: 'IN PROGRESS', color: 'gray' },
      }).run();
    },
  }
  ```
- **Verify**: Typing `/status` in the editor shows the entry; pressing Enter inserts a gray "IN PROGRESS" badge inline.

---

## Phase 4: Styles

### Story 4 — Visual design implementation

**As a** user,
**I want** badges to be visually distinct and consistent with the editor's design language,
**So that** status information is scannable at a glance in both light and dark mode.

#### Task 4.1 — Pill base styles

Add to `packages/editor/src/styles/editor.css`:

```css
.status-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  padding: 0.1rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 700;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.05em;
  border-width: 1px;
  border-style: solid;
  vertical-align: middle;
  cursor: pointer;
  user-select: none;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

#### Task 4.2 — Color variants (light mode)

```css
.status-badge--gray   { background: #f3f4f6; color: #374151; border-color: #d1d5db; }
.status-badge--blue   { background: #dbeafe; color: #1d4ed8; border-color: #93c5fd; }
.status-badge--green  { background: #dcfce7; color: #15803d; border-color: #86efac; }
.status-badge--yellow { background: #fef9c3; color: #854d0e; border-color: #fde047; }
.status-badge--red    { background: #fee2e2; color: #b91c1c; border-color: #fca5a5; }
```

#### Task 4.3 — Dark mode variants

```css
.beskar-editor.dark .status-badge--gray   { background: #1f2937; color: #d1d5db; border-color: #374151; }
.beskar-editor.dark .status-badge--blue   { background: #1e3a5f; color: #93c5fd; border-color: #1d4ed8; }
.beskar-editor.dark .status-badge--green  { background: #052e16; color: #86efac; border-color: #166534; }
.beskar-editor.dark .status-badge--yellow { background: #422006; color: #fde047; border-color: #854d0e; }
.beskar-editor.dark .status-badge--red    { background: #450a0a; color: #fca5a5; border-color: #991b1b; }
```

#### Task 4.4 — Selected ring and ProseMirror node-selected override

```css
.status-badge--selected {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

/* Override ProseMirror's default blue selected-node highlight so our own ring is the only indicator */
.beskar-editor .ProseMirror-selectednode .status-badge {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}
```

#### Task 4.5 — Popover styles

```css
.status-badge-popover {
  background: var(--editor-surface, #fff);
  border: 1px solid var(--editor-border, #e5e7eb);
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 60;
}

.status-badge-swatches {
  display: flex;
  gap: 6px;
  align-items: center;
}

.status-badge-swatch {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.1s;
}

.status-badge-swatch--active {
  border-color: #3b82f6;
}

.status-badge-input {
  width: 140px;
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
  text-transform: uppercase;
  border: 1px solid var(--editor-border, #e5e7eb);
  border-radius: 4px;
  padding: 3px 6px;
  outline: none;
}

.status-badge-input:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59,130,246,0.2);
}

.status-badge-input--error {
  border-color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239,68,68,0.2);
}
```

---

## Phase 5: Edge Cases & Polish

### Story 5 — Robustness and accessibility

**As a** user,
**I want** the badge to behave predictably in all editing scenarios,
**So that** it never breaks the document or disrupts my workflow.

#### Task 5.1 — End-of-document paragraph insertion

- In `StatusBadgeView`, after the popover closes (inside `onOpenChange(false)`):
  - After placing the cursor via `getPos() + node.nodeSize`, check if the resolved position is at the very end of the document.
  - If so, insert an empty paragraph after the badge so the user can continue typing.

#### Task 5.2 — Empty label guard

- Already specced in Task 2.3, but add an explicit unit test: attempt to commit an empty string → confirm the label attribute does **not** change and the error class is applied.

#### Task 5.3 — Max-length enforcement

- Set `maxLength={40}` on the input element (Task 2.3 already covers this).
- Add CSS `max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` to `.status-badge` (covered in Task 4.1).

#### Task 5.4 — Accessibility audit

- Confirm `role="img"` and `aria-label="Status: LABEL"` are present on the pill `<span>` (Task 2.1).
- Confirm the popover input is auto-focused on open (no additional keyboard navigation needed to reach it).
- Confirm `Escape` closes the popover without committing (Task 2.3).

#### Task 5.5 — Editor-demo wiring and manual test checklist

- **File**: `packages/editor-demo/src/App.tsx` — no configuration needed (StatusBadge has no external handler unlike ImageBlock or AttachmentInline). Confirm the extension is active and the slash command appears.

**Manual test checklist:**

| # | Action | Expected result |
| --- | --- | --- |
| 1 | Type `/status`, select "Status Badge", press Enter | Gray "IN PROGRESS" badge inserted inline |
| 2 | Click the badge | Popover opens above the badge; label input is auto-focused and selected |
| 3 | Click the Blue swatch | Badge color updates to blue immediately; popover stays open |
| 4 | Change label to "DONE", press Enter | Badge reads "DONE"; cursor moves after the badge |
| 5 | Click badge, clear the input, press Enter | Commit blocked; input shows red border; label unchanged |
| 6 | Click badge, press Escape | Popover closes; label unchanged; cursor moves after badge |
| 7 | Press Backspace with cursor immediately after the badge | Entire badge deleted as a single unit |
| 8 | Press Ctrl/Cmd+Z after deletion | Badge restored |
| 9 | Copy paragraph with badge, paste into Slack / Notes | Pasted text reads `[DONE]` |
| 10 | Insert badge at the very end of the document, close popover | Empty paragraph inserted; cursor positioned there |
| 11 | Toggle dark mode | Badge colors and popover background update correctly |
| 12 | Multiple badges in one line | Each behaves independently; no interference |
