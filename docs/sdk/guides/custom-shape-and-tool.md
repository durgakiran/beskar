# Guide: Add a custom shape with its own drawing tool

**Use case:** you need a shape type `glideline`'s built-ins don't cover (a database-table shape, a sticky-poll card, a custom connector-adjacent widget), plus a tool to draw it.

**Packages:** works identically whether you're driving `glideline` directly or extending `glideboard` via `customShapes` — same `GlidePlugin`, just registered differently. See [glideline: Shapes & Bindings](../glideline/shapes-and-bindings.md) and [glideline: Tools & State Machine](../glideline/tools-and-state-machine.md) for the full contract reference; this guide walks the pieces end-to-end together.

## 1. Define the shape (`ShapeUtil`)

```ts
import { ShapeUtil, T, type GlideProps, type GlideShape } from '@durgakiran/glideline';
import { Rectangle2d } from '@durgakiran/glideline';

interface PollCardProps {
  w: number;
  h: number;
  question: string;
  votes: number;
}

export class PollCardUtil extends ShapeUtil<GlideShape<PollCardProps>> {
  static readonly type = 'poll-card';
  static readonly props: GlideProps<PollCardProps> = {
    w: T.number, h: T.number, question: T.string, votes: T.number,
  };

  getDefaultProps(): PollCardProps {
    return { w: 240, h: 140, question: 'New question', votes: 0 };
  }

  getGeometry(shape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h });
  }

  // Optional: expose the question as an editable text label (double-click to edit).
  getLabelProps(shape) {
    return { text: shape.props.question, x: 12, y: 12, w: shape.props.w - 24, h: 24, padding: 0, fontSize: 14, textAlign: 'left', verticalAlign: 'center' } as any;
  }
  getEditableText(shape) {
    return { field: 'question', value: shape.props.question };
  }
}
```

`getGeometry` is the one method you must get right — it drives hit testing, bounds, and default resize scaling. Everything else (`onResize`, `hitTestPoint`, `toSvg`) has a workable default; override only what your shape needs to render or behave differently. Add versioned migrations later with `defineMigrations` if `PollCardProps` changes shape after you've shipped documents containing it — see [Shapes & Bindings § Migrations](../glideline/shapes-and-bindings.md#migrations).

## 2. Define the tool (`StateNode`)

The simplest useful tool is a single-click placement tool (no drag-to-size):

```ts
import { StateNode, type PointerDownEvent } from '@durgakiran/glideline';

export class PollCardTool extends StateNode {
  static readonly id = 'poll-card';

  override onPointerDown(e: PointerDownEvent): void {
    const id = this.editor.createShape({
      type: 'poll-card',
      x: e.point.x - 120,
      y: e.point.y - 70,
    });
    this.editor.setSelectedShapeIds([id]);
    this.editor.setCurrentTool('select');   // hand off to selection after placing
  }
}
```

For a drag-to-size tool instead (draw a box by dragging), follow `BoxTool`'s Idle → Pointing → Drawing pattern — see [Tools & State Machine § Worked example](../glideline/tools-and-state-machine.md#worked-example-boxtool). The key detail worth repeating: stage the in-progress shape under its **real, final id** via `editor.beginHistoryPreview()`/`recordHistoryPreview()` rather than creating-then-updating, and commit on both `pointerUp` *and* `pointerCancel` (trackpads can abort a fast short drag as a scroll gesture) so a quick draw never silently disappears.

## 3. Register the plugin

```ts
const PollCardPlugin = {
  id: 'poll-card',
  shapes: [PollCardUtil],
  tools: [PollCardTool],
};
```

**Directly with `glideline`:**

```ts
const editor = createEditor({
  plugins: [PollCardPlugin],
  tools: [SelectTool, PollCardTool],
});
```

**Extending `glideboard`'s default bundle:**

```tsx
<Glideboard sessionKey="board-1" customShapes={[PollCardPlugin]} />
```

`customShapes` only *adds* to glideboard's default shape/tool set — it can't remove or replace a built-in. `customShapes` is also startup-only; changing the array on a live `Glideboard` does nothing until you change `sessionKey` too (a new session = a new editor instance = a new boot). See [glideboard: Overview § Default shape & tool set](../glideboard/overview-and-lifecycle.md#default-shape--tool-set-and-customshapes).

## Gotchas

- **Type name collisions throw at boot**, not silently override — `createEditor`/`GlideboardController` construction fails immediately if two plugins register the same `type` string. Namespace your custom types (`'myapp:poll-card'`) if you might combine plugins from multiple sources.
- Every key in `props` needs a matching `T.*` validator, or writes containing that key throw at `store.put()` time, not at shape-creation call-site — a validator mismatch surfaces as a store error deep in a batch, so get this right early.
- If you need a custom UI panel (a poll-card-specific side panel, say) — `glideboard`'s panel components (`StylePanel`, `LayersPanel`, ...) aren't extensible today; you'd render your own overlay outside `<Glideboard>` and read/write the shape via `editor.getShapeSignal(id)`/`editor.updateShape` reactively.
