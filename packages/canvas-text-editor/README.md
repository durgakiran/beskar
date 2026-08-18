# @durgakiran/canvas-text-editor

Lightweight, canvas-focused rich text. This package is independent of `@durgakiran/editor` and supports React 18.2 and React 19 through peer dependencies.

```tsx
import { CanvasTextEditor } from '@durgakiran/canvas-text-editor/editor';
import { CanvasTextView } from '@durgakiran/canvas-text-editor/view';
import '@durgakiran/canvas-text-editor/styles.css';

<CanvasTextView value={shape.props.richText} fallbackText={shape.props.text} />

<CanvasTextEditor
  value={shape.props.richText}
  onChange={richText => updateDraft(richText)}
  onCommit={richText => commitShape(richText)}
/>
```

The toolbar includes a selection-anchored safe URL bubble with open and remove actions.

For character-level collaboration, pass the shape's stable fragment from the board's existing `Y.Doc`. The package does not create a document or provider.

```tsx
<CanvasTextEditor
  collaboration={{ fragment, awareness: provider.awareness, user }}
  onChange={richText => updateCheckpointProjection(richText)}
/>
```

The collaboration fragment must be initialized by the board adapter before mounting the editor. This avoids package-owned provider lifecycle and multi-client seeding races.

Use `@durgakiran/canvas-text-editor/model` for normalization and plain-text projection without importing React or TipTap. The `editor` entry can be dynamically imported only when a text shape enters edit mode.
