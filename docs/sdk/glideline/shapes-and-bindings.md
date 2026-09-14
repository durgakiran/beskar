# Shapes, Bindings & Styling

**Package:** `@durgakiran/glideline` · **Stability:** 🔴 Unstable (all APIs on this page)

`ShapeUtil` and `BindingUtil` are the two extension points that define what a shape or binding type *is* — geometry, resize/rotate behavior, hit testing, SVG rendering, and text-label editing. Every built-in shape (box, ellipse, sticky note, arrow, ...) is implemented against exactly this contract, so it's also the API to implement a custom shape type.

## `ShapeUtil<S>`

> "Extend this class to register a new shape type with the engine. Static members (`type`, `props`, `migrations`) are read at editor init. Instance methods are called at runtime by the rendering pipeline." — source doc comment

```ts
abstract class ShapeUtil<S extends GlideShape<object> = GlideShape> {
  static readonly type: string;                                    // must match shape.type
  static readonly canContainChildren: boolean = false;              // frames/groups override to true
  static readonly props: GlideProps<Record<string, unknown>>;       // validated on every store.put()
  static readonly migrations?: GlideMigrations;
  static readonly references?: readonly RecordReferenceDescriptor[];

  abstract getDefaultProps(): S['props'];
  abstract getGeometry(shape: S): Geometry2d;                       // intrinsic, shape-local space

  hitTestPoint(shape: S, point: Vec2): boolean;                     // default: AABB + label area
  getVisualBounds(shape: S): Box2d;                                 // override when content exceeds geometry
  canContain(shape: S): boolean;                                    // default: false
  onBeforeDelete(shape: S): boolean | void;                         // return false to block deletion
  hideResizeHandles(shape: S): boolean;                             // arrows: true (use terminal handles instead)
  getResizeHandles(shape: S): readonly ResizeHandle[];               // default: all 8
  hideRotateHandle(shape: S): boolean;
  onResize(shape: S, info: ResizeInfo<S>): Partial<S>;              // default: proportional scale + text-min-height guard
  toSvg(shape: S): SVGElement;                                       // canvas rendering: geometry only, no labels
  toSvgExport(shape: S): SVGElement;                                 // export rendering: may include text; defaults to toSvg()
  getLabelProps(shape: S): LabelProps | null;                        // null = no text label
  getRichTextDescriptor(shape: S): RichTextDescriptor | null;        // renderer-neutral rich text; React/TipTap owned by glideboard
  hitTestLabel(shape: S, point: Vec2): boolean;
  canEditLabel(shape: S): boolean;
  getEditableText(shape: S): EditableTextValue | null;
  getTextEditProps(shape: S, pagePoint: Vec2): Readonly<Record<string, unknown>> | null;
  getTextCommitPatch(latestShape: S, draft: string, pendingProps?): Partial<S>;
}
```

### Minimal example

```ts
import { ShapeUtil, T, type GlideProps } from '@durgakiran/glideline';
import { Rectangle2d } from '@durgakiran/glideline'; // geometry helpers live under geometry/

interface StickerProps { w: number; h: number; emoji: string }

class StickerUtil extends ShapeUtil<GlideShape<StickerProps>> {
  static readonly type = 'sticker';
  static readonly props: GlideProps<StickerProps> = {
    w: T.number, h: T.number, emoji: T.string,
  };

  getDefaultProps(): StickerProps {
    return { w: 64, h: 64, emoji: '⭐' };
  }

  getGeometry(shape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h });
  }
}

const StickerPlugin = { id: 'stickers', shapes: [StickerUtil] };
```

`getGeometry` is the one method every shape must implement correctly — it drives hit testing, bounds, and the default `onResize` scaling. Everything else has a workable default.

## `BindingUtil<B>`

```ts
abstract class BindingUtil<B extends GlideBinding<object> = GlideBinding> {
  static readonly type: string;
  static readonly props: GlideProps<Record<string, unknown>>;
  static readonly migrations?: GlideMigrations;

  abstract getDefaultProps(): B['props'];

  onAfterChangeToShape?(binding: B): void;      // the binding's "to" shape changed
  onAfterChangeFromShape?(binding: B): void;     // the binding's "from" shape changed
  onBeforeDeleteToShape?(binding: B): void;      // "to" shape is about to be deleted
  onBeforeDeleteFromShape?(binding: B): void;    // "from" shape is about to be deleted
}
```

A binding is a first-class record connecting two shapes. `GlideEditor.updateShape`-triggered changes call `onAfterChangeToShape`/`onAfterChangeFromShape` for every binding attached to the changed shape; `deleteShapes` calls the `onBefore*` hooks before cascading the delete. This is the entire mechanism arrows use to stay attached and routed — see below.

## Prop validators (`T`)

```ts
T.number / T.string / T.boolean            // primitive validators
T.literal(expected)                         // exact-value validator (for discriminant fields)
T.optional(innerValidator)                  // allows undefined
```

Every key in a `ShapeUtil`/`BindingUtil`'s `props` type must have a matching validator — the schema validates props on every `store.put()`, so an invalid prop value throws at write time, not at render time.

## Migrations

```ts
defineMigrations({ currentVersion: N, migrators: { [version]: { up(record), down(record) } } })
migrateRecord(record, migrations)     // applies forward migrations up to currentVersion
migrateRecordDown(record, migrations)
```

Each `migrators[v]` step transforms a record from version `v-1`/`v` to `v`/`v-1`. The schema runs the full chain automatically when loading an older document (`GlideSchema.loadDocument`) — see [Store & Schema](./store-and-schema.md).

## Built-in shapes

`BoxUtil`, `FrameUtil` (+`FrameTool`), `GroupUtil`, `TextUtil`, `EllipseUtil` (+`EllipsePlugin`), `StickyNoteUtil` (+`StickyNotePlugin`, `STICKY_COLORS`, `wrapText`), `FreehandUtil` (+`FreehandPlugin`, `catmullRomPath`), `SanitizedSvgUtil` (+`SanitizedAssetPlugin`), `RasterImageUtil`, and the geo-shape family — `TriangleUtil`, `DiamondUtil`, `HexagonUtil`, `StarUtil`, `RoundedRectUtil`, `ParallelogramUtil`, `ChevronUtil`, `DocumentUtil`, `CylinderUtil`, `NoteUtil`, `CalloutUtil` (bundled as `GeoShapePlugin`/`P1ShapesPlugin`). `createSvgPathShape(def: CreateSvgPathShapeDef)` is a helper for defining a new shape whose geometry is an arbitrary SVG path, without writing a full `ShapeUtil` subclass by hand.

## Arrows & binding

> "`ArrowShape`: connector with two typed terminals (start, end). Each terminal carries `boundShapeId: ShapeId | null` (null = unbound/floating), `normalizedAnchor: Vec2` ([0..1, 0..1] within target bounds), and `point: Vec2` (absolute page-space position, computed). `ArrowBindingUtil.onAfterChangeToShape` recomputes the terminal point from `normalizedAnchor` against the target's current bounds and derives `fromEdge` from anchor position; `onBeforeDeleteToShape` detaches the terminal (`boundShapeId → null`)." — source doc comment

This is the concrete instance of the `BindingUtil` hooks above: an arrow stays visually attached to a moving/resizing shape because moving that shape triggers `onAfterChangeToShape` on every binding pointing at it, which recomputes the arrow's terminal position — no polling, no manual "reattach" step.

- `ArrowUtil`, `ArrowBindingUtil`, `ArrowPlugin` — the shape/binding/plugin bundle. `anchorToEdge`, `anchorToPoint` — anchor/edge conversion helpers.
- `ArrowTool` (+`ArrowIdle`) — the drawing tool.
- Routing: `computeArcPath`/`parseArcControlPoint`, `computeElbowPath`/`parseElbowPoints`/`countElbowSegments`, `resolveArrowRoute`, `getArrowBendHandlePoint`, `pointsToPath`, `sampleCurvePoints`.
- `SmartRouterCache`, `getWorldBounds`, `getArrowBindingEdge`, `getFallbackElbowPoints`, `offsetOrthogonalPolyline`, `routeSignature`, `simplifyCollinear` — the smart-routing layer that keeps elbow/orthogonal arrows from crossing through the shapes they connect, cached per-route to avoid recomputing on every render.
- Related types: `ArrowProps`, `ArrowShape`, `ArrowTerminal`, `ArrowBindingProps`, `ArrowBinding`, `ArrowRouteStyle`, `SmartRoutingSnapshot`, `SmartRouteResolution`.

## Styling

Shape utils don't hardcode colors/sizes — they read from a shared token system:

```ts
TLDRAW_COLORS, resolveColor, hexWithOpacity, svgFill
STROKE_WIDTHS, FONT_SIZES, FONT_FAMILIES, STROKE_DASH_ARRAYS, FILL_OPACITIES
inlinePatternDefs, getPatternId, getShapePatternId
createTextForeignObjectForExport
```

`GlideEditor` tracks an "active styles" signal (color, fill, stroke width, font, etc.) that new shapes inherit by default (see [Editor § Shapes: create, arrange, mutate](./editor.md#shapes-create-arrange-mutate)) — this is how "last used style carries to the next shape you draw" works without every tool re-implementing it.

Text editing itself is coordinated by `TextEditSessionController` (`EditableTextField`, `EditableTextValue`, `TextEditSession`, `RecoverableTextEditDraft`), which backs `GlideEditor`'s `startEditing`/`commitEditing`/`cancelEditing` methods — see [Editor § Text editing sessions](./editor.md#text-editing-sessions).

## Related types

`ResizeHandle`, `ResizeInfo`, `RichTextDescriptor`, `CanvasRichTextSnapshot`, `TextProps`, `TextShape`, `TextSizeMode`, `GroupShape`, `TldrawColor`, `FillStyle`, `StrokeStyle`, `SizeStyle`, `FontSize`, `TextAlign`, `Font`, `ShapeStyleProps`, `LabelProps`, `EllipseProps`, `EllipseShape`, `StickyNoteProps`, `StickyNoteShape`, `FreehandProps`, `FreehandShape`, `FreehandPoint`, `GeoShapeProps` and its per-shape variants, `SanitizedSvgShape(Props)`, `RasterImageShape(Props)`, `CreateSvgPathShapeDef`.
