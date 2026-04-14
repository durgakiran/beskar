# Specification: Slash Command — Inline Mode (Non-Empty Nodes)

## 📝 Product Requirement

The slash command today only activates when `/` is typed at the very start of an empty paragraph. Users should also be able to type `/` in the **middle of existing text** to insert inline content (e.g. a Status Badge) without having to navigate to a new line first.

Block-level commands (headings, lists, tables, layouts, etc.) will remain restricted to empty/start-of-line contexts because they structurally replace the whole paragraph — they cannot be meaningfully inserted mid-sentence. Inline-safe commands, on the other hand, will appear whenever `/` is typed after a word or space anywhere in a paragraph.

---

## 🛠️ Technical Approach

### 1. Remove `startOfLine` restriction

In `SlashCommand.ts`, the `suggestion` config currently has `startOfLine: true`. This option is enforced by `@tiptap/suggestion` before `allow` is even evaluated — it silently suppresses any `/` typed anywhere other than position 0 of a text node.

**Change:** Remove `startOfLine: true` from the suggestion config entirely.

### 2. Update the `allow` callback

The current `allow` uses `isStartOfNode` (`$from.parent.textContent?.charAt(0) === '/'`) to verify the slash is at the front. This check must be replaced with a position-aware validation that:

- Allows `/` at the **very start** of the paragraph (empty node case — unchanged behaviour).
- Allows `/` **immediately after a space** (e.g. `"Hello /"`) — natural mid-sentence insertion.
- **Rejects `/` immediately after a non-space character** (e.g. `"http://"`, `"path/to/file"`) — prevents accidental trigger inside URLs, file paths, etc.

```
isValidPosition =
  textBeforeSlashInNode === ''          // start of node
  || textBeforeSlashInNode.endsWith(' ') // preceded by space
```

The `textBeforeSlashInNode` is derived from `range.from` (the position where the suggestion char was typed) and `$from.start()` (the start of the parent node):

```ts
const slashOffsetInNode = range.from - $from.start() - 1; // -1 for node boundary
const textBeforeSlash = $from.parent.textContent.slice(0, slashOffsetInNode);
const isValidPosition = textBeforeSlash === '' || textBeforeSlash.endsWith(' ');
```

All other existing `allow` checks (depth, `detailsContent`, `tableCell`, double-space dismissal) remain unchanged.

### 3. Add `blockOnly` flag to `Command` interface

Extend the `Command` type in `groups.ts`:

```ts
export interface Command {
  name: string;
  label: string;
  description: string;
  aliases?: string[];
  icon: string;
  action: (editor: Editor) => void;
  shouldBeHidden?: (editor: Editor) => boolean;
  blockOnly?: boolean; // when true, hidden if slash is typed mid-sentence
}
```

Mark every command in the `format` and `layout` groups as `blockOnly: true`. Commands in the `inline` group (Status Badge) and `media` group commands that can be inserted at a cursor position are left without the flag (default `false`).

| Group | Commands | `blockOnly` |
|---|---|---|
| Format | Heading 1–3, Bullet/Numbered/Task List, Quote, Code Block, Math, ToC, Table, Note Block, Divider, Details | `true` |
| Layout | 2 Columns, 3 Columns | `true` |
| Inline | Status Badge | _(unset / false)_ |
| Media | Image, File Attachment | _(unset / false — inserted at cursor)_ |

### 4. Context-aware `items` filtering

In the `items` function, detect whether the `/` was typed in a non-empty context by checking how much text precedes it in the paragraph:

```ts
items: ({ query, editor }) => {
  const { $from } = editor.state.selection;
  const paragraphText = $from.parent.textContent;
  const slashIndex = paragraphText.indexOf('/');
  const isNonEmptyContext = slashIndex > 0; // content exists before the /

  const withFilteredCommands = GROUPS.map((group) => ({
    ...group,
    commands: group.commands
      .filter((item) => !(isNonEmptyContext && item.blockOnly))
      // ... existing label/alias/shouldBeHidden filters unchanged
  }));

  return withFilteredCommands.filter((group) => group.commands.length > 0);
},
```

When `isNonEmptyContext` is true and all commands in a group are `blockOnly`, the entire group is omitted from the menu — no empty group headers are shown.

### 5. Fix the `command` range deletion

The current deletion logic manually re-computes the range via `$head.nodeBefore.text?.indexOf('/')`. This is fragile mid-paragraph: `nodeBefore` may contain all preceding text (e.g. `"Hello /"`) so the index math breaks.

**Replace it** with the `range` values provided directly by the suggestion plugin, which already track exactly the `/query` span:

```ts
command: ({ editor, range, props }) => {
  editor.chain()
    .deleteRange({ from: range.from, to: range.to })
    .run();

  props.action(editor);
  editor.view.focus();
},
```

---

## ⚠️ Corner Cases & Edge Handling

| Scenario | Handling |
|---|---|
| `/` typed at the start of an empty paragraph | Unchanged behaviour — full command menu (all groups). |
| `/` typed after a space mid-sentence (e.g. `"Hello /"`) | Menu opens showing only non-`blockOnly` commands (Inline, Media). |
| `/` typed immediately after a non-space character (e.g. `"url/"`) | `allow` returns false; menu does not open. |
| User types `/` then continues typing a query (e.g. `"Hello /sta"`) | Filtered to inline commands matching "sta" → shows Status Badge. |
| No inline commands match the query | Menu shows empty-state "No commands found" (existing behaviour). |
| Double space after `/` (`"Hello /  "`) | Existing double-space dismissal heuristic fires, menu closes. |
| `/` inside a table cell (non-empty) | Table cell is already an allowed depth context; inline-only filtering applies the same way. |
| `/` inside `detailsContent` (non-empty) | Same — depth is allowed, inline-only filter applies. |
| `/` inside a heading, codeBlock, or other non-paragraph node | `isParagraph` check in `allow` returns false; menu does not open. |
| Inserting a Status Badge mid-sentence | `insertContent` places the badge at the current cursor; the slash+query text is deleted via `deleteRange(range.from, range.to)`. Cursor lands just after the badge. |
| Undo after mid-sentence insertion | The `deleteRange` + `insertContent` are separate transactions; each is individually undoable. Consider wrapping in a single `chain()` so undo reverses both in one step. |
| Collaborative editing (Yjs) | No special handling needed — the deletion and insertion are both normal ProseMirror transactions that Yjs syncs as usual. |

---

## 🎨 UI / UX Details

- **No visual change to the menu itself** when opened inline — same popup, same keyboard nav.
- **Group header behaviour**: when opened in a non-empty context, only inline-compatible groups are present. If that results in a single group with no title needed, hide the group header (existing logic already hides headers when only one group is visible).
- **Menu position**: Tippy already positions relative to the cursor via `getReferenceClientRect`; mid-sentence positioning works without changes.
- **Placeholder hint** (optional / future): When the menu is in inline mode, the search placeholder could read *"Insert inline content…"* instead of the generic empty string, to signal to the user that only a subset of commands is available.
