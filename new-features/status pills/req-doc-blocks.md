# Specification: Status Pills (StatusBadge)

## 📝 Product Requirement

An inline node (`StatusBadge`) that renders a compact, styled badge (e.g. `IN PROGRESS`, `DONE`) directly inside a line of text. Clicking a badge opens a small popover to edit its label and color; the badge cannot be typed into like normal text.

---

## 🛠️ Technical Approach

### Node Definition
- Create `StatusBadge` as a **custom inline node** extension in `packages/editor/src/nodes/StatusBadge.ts`.
- Mark it `atom: true` and `selectable: true` so ProseMirror treats it as a single unit — the cursor can never be placed *inside* it.
- Attributes: `label` (string, default `'IN PROGRESS'`) and `color` (one of `'gray' | 'blue' | 'green' | 'yellow' | 'red'`, default `'gray'`).
- Parsing: `<span data-type="status-badge">` in HTML; plain-text fallback for clipboard via `renderText` returning `[LABEL]`.
- Register in `extensions/index.ts` alongside the other node extensions.

### NodeView
- Render via `ReactNodeViewRenderer` so the pill UI can use React state and Radix UI.
- The wrapper `<NodeViewWrapper>` must have `contentEditable={false}` to block text cursor entry.
- On click: show a Radix `Popover` anchored to the badge. Set `selected` highlight (blue ring) while the popover is open.
- The popover contains:
  - A row of 5 color swatches (Gray, Blue, Green, Yellow, Red) — clicking one calls `updateAttributes({ color })`.
  - A text `<input>` pre-filled with the current label (auto-selected on open). `Enter` or blur commits the change via `updateAttributes({ label: value.toUpperCase() })`. `Escape` discards.
- When the popover closes, move the editor selection to just *after* the badge so typing resumes naturally.

### Slash Command
- Add a new group entry in `groups.ts` (under "Inline"):
  - name: `status`, label: `Status Badge`, icon: `🏷️`
  - aliases: `badge`, `pill`, `state`, `status`
  - Inserts `{ type: 'statusBadge', attrs: { label: 'IN PROGRESS', color: 'gray' } }` at the current position.

---

## ⚠️ Corner Cases & Edge Handling

| Scenario | Handling |
|---|---|
| Clicking inside the pill | `atom: true` prevents text cursor placement. Click opens the popover instead. |
| Copy-pasting pill to plain text (e.g. Slack, email) | `renderText` returns `[LABEL]` (e.g. `[IN PROGRESS]`). Full HTML clipboard includes the styled `<span>`. |
| Pressing Delete/Backspace when cursor is adjacent to the badge | ProseMirror's standard atom handling removes the entire node as one unit — no partial deletion. |
| Empty label submission | If the text input is cleared and Enter is pressed, reject the update and keep the previous label. Show a brief validation state (red border on input). |
| Very long label text | Cap input at 40 characters. Overflow is clipped visually with `text-overflow: ellipsis` on the pill. |
| Badge at the top of the viewport | The popover must flip to the bottom if there's not enough room above; handled by Floating UI's `flip` middleware. |
| Badge at the end of a document | After the popover closes, if no node follows the badge, insert an empty paragraph to allow continued typing. |
| Multiple badges in one paragraph | Each badge is fully independent; no interaction between them. |
| Collaborative editing (Yjs/collabserver) | Because the badge is an atomic node with `atom: true`, concurrent edits on the same badge are serialized by Yjs as whole-attribute updates — no partial conflict possible. |
| Undo/Redo | Each `updateAttributes` call creates a ProseMirror transaction that is fully undoable. Label and color changes are each undoable steps. |
| Screen reader / accessibility | The rendered `<span>` should carry `role="img"` and `aria-label="Status: IN PROGRESS"` so screen readers announce it correctly. |
| Drag and drop | Badges inside dragged blocks move with the block. A badge itself cannot be dragged independently (it is inline). |
| Exporting to HTML / Markdown | HTML: `<span data-type="status-badge" data-label="IN PROGRESS" data-color="blue">IN PROGRESS</span>`. Markdown: `[IN PROGRESS]` (no standard Markdown equivalent; text fallback). |

---

## 🎨 UI Design & Layout Details

### Pill Container
An inline `<span>` with `contentEditable={false}`:
- Shape: `rounded-full px-2 py-0.5`
- Typography: `text-[0.7rem] font-bold font-mono tracking-wider`
- Alignment: `align-middle border`
- Colors per `color` attribute:
  - `gray` → `bg-gray-100 text-gray-700 border-gray-300`
  - `blue` → `bg-blue-100 text-blue-700 border-blue-300`
  - `green` → `bg-green-100 text-green-700 border-green-300`
  - `yellow` → `bg-yellow-100 text-yellow-700 border-yellow-300`
  - `red` → `bg-red-100 text-red-700 border-red-300`
- **Selected highlight**: While the popover is open, add `ring-2 ring-blue-500 ring-offset-1` to the pill.
- **Dark mode**: Use dark-mode-aware CSS variables or Tailwind dark variants for each color variant.

### Popover Editor
Radix `Popover` anchored to the pill, `placement: 'top'` with `flip` fallback:
- A row of 5 colored circles (16 px diameter), one per color option. Clicking one immediately updates the badge color and keeps the popover open.
- A text `<input>` below the swatches: `width: 140px`, `font-mono`, `text-sm`, uppercase display. Pre-filled with the current label, auto-focused and fully selected on open.
- `Enter` or blur → commit (blocked if input is empty; show red border).
- `Escape` → discard changes and close.
- Clicking outside → commit if input is non-empty, otherwise discard.
- On close: move editor cursor to just after the badge.
