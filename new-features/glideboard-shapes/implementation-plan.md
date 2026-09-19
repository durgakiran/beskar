# Glideboard P1 Shape Expansion — Agent Implementation Plan

## How to use this document

Execute steps in order. Each step specifies:
- **File**: Absolute path
- **Action**: `CREATE` (new file) or `MODIFY` (edit existing file)
- **Where**: Exact insertion point (line number or unique anchor string)
- **What**: The exact code to write — copy verbatim
- **Verify**: How to confirm the step is correct before continuing

Do not skip steps. Do not reorder steps. Run `vitest run` in `packages/glideline` after Step 12 and again after Step 19. Run `vitest run` in `packages/glideboard` after Step 23.

---

## Background: Codebase Contracts

Every ShapeUtil must satisfy these contracts (verified by the existing test suite):

| Contract | Implementation requirement |
|---|---|
| `static type: string` | Unique, kebab-case, matches tool `id` exactly |
| `static props: GlideProps<P>` | One validator per prop key — use `T.number`, `T.string`, or `StyleValidators.*` |
| `static migrations: GlideMigrations` | Built with `defineMigrations()` — version 1 `up` fn must set all props to defaults |
| `getDefaultProps(): P` | Returns a complete props object with reasonable defaults |
| `getGeometry(shape): Geometry2d` | Returns `Rectangle2d(0, 0, w, h)` for rectangular AABB shapes |
| `toSvg(shape): SVGElement` | Returns `<g>` containing geometry elements — **no `<text>` nodes** |
| `getLabelProps(shape): LabelProps \| null` | Returns label CSS config for the HTML overlay div |
| `toSvgExport(shape): SVGElement` | Returns `toSvg()` result + `<foreignObject>` for label text |

Every Tool must satisfy:
| Contract | Implementation requirement |
|---|---|
| `static id: string` | Must match the `ShapeUtil.type` exactly |
| `static shapeType: string` | Same as `id` — used by `BaseGeoShapeTool` to create the shape |
| `static children` | Inherited from `BaseGeoShapeTool` — do NOT override |

---

## Step 1: Understand GeoShapeProps (read-only, no changes)

`GeoShapeProps` in `packages/glideline/src/shapes/GeoShapeUtil.ts` is the shared props type
used by all geo shapes. All 7 new shapes will use the **exact same interface** and validators.
This avoids duplication. The interface is:

```ts
interface GeoShapeProps {
  w: number; h: number; color: string; opacity: number;
  fillStyle: FillStyle; strokeStyle: StrokeStyle; strokeWidth: SizeStyle;
  label: string; labelColor: string; font: Font; fontSize: FontSize; textAlign: TextAlign;
}
```

The migration used by all geo shapes (`GEO_SHAPE_MIGRATIONS`) sets all these to defaults in version 1.
New shapes will use `defineMigrations` with the same v1 structure.

---

## Step 2: Add `BasePathShapeUtil` to GeoShapeUtil.ts

**File**: `packages/glideline/src/shapes/GeoShapeUtil.ts`
**Action**: MODIFY
**Where**: Insert after line 175 (after the closing `}` of `BaseGeoShapeUtil`) and before line 177 (`export class TriangleUtil`).

Add the following block **between** `BaseGeoShapeUtil` and `TriangleUtil`:

```ts
// ─────────────────────────────────────────────────────────────
// BasePathShapeUtil — base for shapes rendered as SVG <path d=...>
// ─────────────────────────────────────────────────────────────

abstract class BasePathShapeUtil<S extends GlideShape<GeoShapeProps>> extends ShapeUtil<S> {
  static override readonly props = GEO_SHAPE_PROPS;
  static override readonly migrations = GEO_SHAPE_MIGRATIONS;

  override getDefaultProps(): GeoShapeProps {
    return getDefaultGeoShapeProps();
  }

  /**
   * Return the SVG path `d` attribute string for this shape,
   * normalized to the bounding box (0,0) → (w,h).
   * Called by toSvg() and getGeometry().
   */
  protected abstract getPathD(w: number, h: number): string;

  /**
   * For path-based shapes, geometry is the AABB of (w, h).
   * Hit-testing uses Rectangle2d (AABB), which is correct for most path shapes.
   * Subclasses with strongly non-rectangular silhouettes can override.
   */
  override getGeometry(shape: S): Geometry2d {
    return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
  }

  /** Geometry-only SVG — no text labels. For interactive canvas rendering. */
  toSvg(shape: S): SVGElement {
    const { props } = shape;
    const { w, h } = props;
    const strokeW = STROKE_WIDTHS[props.strokeWidth];
    const fillColor = svgFill(props.fillStyle, resolveColor(props.color), shape.id);
    const strokeColor = resolveColor(props.color);
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));

    const defs = inlinePatternDefs(props.fillStyle, props.color, shape.id);
    if (defs) g.appendChild(defs);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', this.getPathD(w, h));
    path.setAttribute('fill', fillColor);
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('stroke-width', String(strokeW));
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    if (dashArray !== 'none') {
      path.setAttribute('stroke-dasharray', dashArray);
    }
    g.appendChild(path);
    return g;
  }

  /** CSS label properties for the HTML overlay div. */
  override getLabelProps(shape: S): LabelProps | null {
    const { props } = shape;
    return {
      text:          props.label || '',
      fontFamily:    FONT_FAMILIES[props.font] ?? FONT_FAMILIES.sans,
      fontSize:      FONT_SIZES[props.fontSize] ?? FONT_SIZES.md,
      color:         resolveColor(props.labelColor),
      textAlign:     props.textAlign,
      verticalAlign: 'center',
      padding:       8,
    };
  }

  /** Full SVG for export — includes foreignObject text label. */
  override toSvgExport(shape: S): SVGElement {
    const g = this.toSvg(shape) as SVGGElement;
    const { props } = shape;
    if (props.label) {
      const fo = createTextForeignObjectForExport({
        x: 0, y: 0, w: props.w, h: props.h,
        text: props.label,
        font: props.font,
        fontSize: props.fontSize,
        textAlign: props.textAlign,
        color: props.labelColor,
        verticalAlign: 'center',
      });
      g.appendChild(fo);
    }
    return g;
  }
}
```

Also add `Rectangle2d` to the import at the top of `GeoShapeUtil.ts`. The current import is:
```ts
import { Geometry2d, Polygon2d } from '../geometry';
```
Change it to:
```ts
import { Geometry2d, Polygon2d, Rectangle2d } from '../geometry';
```

**Verify**: The file compiles without errors: `cd packages/glideline && npx tsc --noEmit`

---

## Step 3: Add `RoundedRectUtil`

**File**: `packages/glideline/src/shapes/GeoShapeUtil.ts`
**Action**: MODIFY
**Where**: After the 4 existing concrete classes (after `StarUtil`), before the `import type { GlidePlugin }` line.

```ts
// ─────────────────────────────────────────────────────────────
// RoundedRectUtil — rectangle with proportional corner radius
// Uses <rect rx> instead of <polygon> — extends BaseGeoShapeUtil
// for shared props but overrides toSvg() and getGeometry().
// ─────────────────────────────────────────────────────────────

export type RoundedRectShape = GlideShape<GeoShapeProps>;

export class RoundedRectUtil extends BaseGeoShapeUtil<RoundedRectShape> {
  static override readonly type = 'rounded-rect';

  // Vertices trace the AABB corners (for resize handles / hit test fallback).
  // Corner arcs are only visual; AABB hit-test is close enough.
  protected override getVertices(shape: RoundedRectShape): Vec2[] {
    const { w, h } = shape.props;
    return [
      { x: 0, y: 0 }, { x: w, y: 0 },
      { x: w, y: h }, { x: 0, y: h },
    ];
  }

  /** Override toSvg to emit <rect rx> instead of <polygon>. */
  override toSvg(shape: RoundedRectShape): SVGElement {
    const { props } = shape;
    const { w, h } = props;
    const rx = Math.min(w, h) * 0.15; // 15% proportional radius
    const strokeW = STROKE_WIDTHS[props.strokeWidth];
    const fillColor = svgFill(props.fillStyle, resolveColor(props.color), shape.id);
    const strokeColor = resolveColor(props.color);
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));

    const defs = inlinePatternDefs(props.fillStyle, props.color, shape.id);
    if (defs) g.appendChild(defs);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(h));
    rect.setAttribute('rx', String(rx));
    rect.setAttribute('ry', String(rx));
    rect.setAttribute('fill', fillColor);
    rect.setAttribute('stroke', strokeColor);
    rect.setAttribute('stroke-width', String(strokeW));
    if (dashArray !== 'none') {
      rect.setAttribute('stroke-dasharray', dashArray);
      if (props.strokeStyle === 'dotted') rect.setAttribute('stroke-linecap', 'round');
    }
    g.appendChild(rect);
    return g;
  }
}
```

**Verify**: `RoundedRectUtil` appears in file. `static type` is `'rounded-rect'`.

---

## Step 4: Add `ParallelogramUtil`

**File**: `packages/glideline/src/shapes/GeoShapeUtil.ts`
**Action**: MODIFY
**Where**: Immediately after `RoundedRectUtil`.

```ts
// ─────────────────────────────────────────────────────────────
// ParallelogramUtil — skewed quadrilateral (ISO 5807 I/O symbol)
// skew = 20% of width offset on top-right / bottom-left corners
// ─────────────────────────────────────────────────────────────

export type ParallelogramShape = GlideShape<GeoShapeProps>;

export class ParallelogramUtil extends BaseGeoShapeUtil<ParallelogramShape> {
  static override readonly type = 'parallelogram';

  protected override getVertices(shape: ParallelogramShape): Vec2[] {
    const { w, h } = shape.props;
    const skew = w * 0.2;
    return [
      { x: skew, y: 0 },
      { x: w,    y: 0 },
      { x: w - skew, y: h },
      { x: 0,    y: h },
    ];
  }
}
```

**Verify**: Four vertices returned by `getVertices` when `w=100, h=60`: `[{x:20,y:0},{x:100,y:0},{x:80,y:60},{x:0,y:60}]`.

---

## Step 5: Add `ChevronUtil`

**File**: `packages/glideline/src/shapes/GeoShapeUtil.ts`
**Action**: MODIFY
**Where**: Immediately after `ParallelogramUtil`.

```ts
// ─────────────────────────────────────────────────────────────
// ChevronUtil — right-pointing arrow polygon (process flow / BPMN)
// tip = rightmost point; notch = left-center indent
// ─────────────────────────────────────────────────────────────

export type ChevronShape = GlideShape<GeoShapeProps>;

export class ChevronUtil extends BaseGeoShapeUtil<ChevronShape> {
  static override readonly type = 'chevron';

  protected override getVertices(shape: ChevronShape): Vec2[] {
    const { w, h } = shape.props;
    const notch = w * 0.25; // depth of the indent on left side
    const mid = h / 2;
    return [
      { x: 0,          y: 0 },
      { x: w - notch,  y: 0 },
      { x: w,          y: mid },
      { x: w - notch,  y: h },
      { x: 0,          y: h },
      { x: notch,      y: mid },
    ];
  }
}
```

**Verify**: Six vertices. `getVertices` with `w=120, h=60` → the tip is at `{x:120, y:30}`.

---

## Step 6: Add `DocumentUtil`

**File**: `packages/glideline/src/shapes/GeoShapeUtil.ts`
**Action**: MODIFY
**Where**: Immediately after `ChevronUtil`.

```ts
// ─────────────────────────────────────────────────────────────
// DocumentUtil — rectangle with wavy bottom (ISO 5807 document)
// Uses BasePathShapeUtil — getPathD returns the complete d= string.
// ─────────────────────────────────────────────────────────────

export type DocumentShape = GlideShape<GeoShapeProps>;

export class DocumentUtil extends BasePathShapeUtil<DocumentShape> {
  static override readonly type = 'document';

  protected override getPathD(w: number, h: number): string {
    // Body: top-left → top-right → then down the right side to bottom-right.
    // Bottom: wavy S-curve from bottom-right to bottom-left.
    // Close back up the left side.
    const waveH = h * 0.12; // amplitude of the wave
    const waveY = h - waveH; // y-start of the wave
    return [
      `M 0 0`,
      `L ${w} 0`,
      `L ${w} ${waveY}`,
      // S-curve wave: two cubic bezier arcs
      `C ${w * 0.75} ${waveY} ${w * 0.75} ${h} ${w * 0.5} ${h}`,
      `C ${w * 0.25} ${h} ${w * 0.25} ${waveY} 0 ${waveY}`,
      `Z`,
    ].join(' ');
  }
}
```

**Verify**: `getPathD(100, 80)` returns a string starting with `M 0 0` and ending with `Z`.

---

## Step 7: Add `CylinderUtil`

**File**: `packages/glideline/src/shapes/GeoShapeUtil.ts`
**Action**: MODIFY
**Where**: Immediately after `DocumentUtil`.

```ts
// ─────────────────────────────────────────────────────────────
// CylinderUtil — database / storage symbol
// Consists of: ellipse-cap top, body sides, bottom arc.
// getPathD builds the full silhouette as a single closed path.
// ─────────────────────────────────────────────────────────────

export type CylinderShape = GlideShape<GeoShapeProps>;

export class CylinderUtil extends BasePathShapeUtil<CylinderShape> {
  static override readonly type = 'cylinder';

  protected override getPathD(w: number, h: number): string {
    const rx = w / 2;
    const ry = h * 0.12; // vertical radius of the top/bottom ellipse caps
    const topY = ry;     // centre-y of the top ellipse cap
    const botY = h - ry; // centre-y of the bottom ellipse cap

    return [
      // Start at top-left arc tangent point
      `M 0 ${topY}`,
      // Top ellipse arc (left → right, sweeping across the top)
      `A ${rx} ${ry} 0 0 1 ${w} ${topY}`,
      // Right side, straight down to bottom-right arc tangent
      `L ${w} ${botY}`,
      // Bottom ellipse arc (right → left, curving under)
      `A ${rx} ${ry} 0 0 1 0 ${botY}`,
      // Left side, straight back up to start
      `Z`,
    ].join(' ');
  }

  /**
   * Override toSvg to also draw the top ellipse outline
   * (the visible top rim of the cylinder) as a separate stroke.
   */
  override toSvg(shape: CylinderShape): SVGElement {
    const g = super.toSvg(shape) as SVGGElement;
    const { props } = shape;
    const { w, h } = props;
    const rx = w / 2;
    const ry = h * 0.12;
    const topY = ry;
    const strokeW = STROKE_WIDTHS[props.strokeWidth];
    const strokeColor = resolveColor(props.color);
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];

    // Top rim ellipse (drawn separately so it appears on top of the fill)
    const rim = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    rim.setAttribute('cx', String(rx));
    rim.setAttribute('cy', String(topY));
    rim.setAttribute('rx', String(rx));
    rim.setAttribute('ry', String(ry));
    rim.setAttribute('fill', 'none');
    rim.setAttribute('stroke', strokeColor);
    rim.setAttribute('stroke-width', String(strokeW));
    if (dashArray !== 'none') rim.setAttribute('stroke-dasharray', dashArray);
    g.appendChild(rim);
    return g;
  }
}
```

**Verify**: `getPathD(100, 80)` returns a string containing both `A` (arc) commands. `toSvg()` returns a `<g>` with 2 children (a `<path>` and an `<ellipse>`).

---

## Step 8: Add `NoteUtil`

**File**: `packages/glideline/src/shapes/GeoShapeUtil.ts`
**Action**: MODIFY
**Where**: Immediately after `CylinderUtil`.

```ts
// ─────────────────────────────────────────────────────────────
// NoteUtil — rectangle with folded top-right corner (UML note)
// The fold = a right-triangle cut from the top-right corner.
// ─────────────────────────────────────────────────────────────

export type NoteShape = GlideShape<GeoShapeProps>;

export class NoteUtil extends BasePathShapeUtil<NoteShape> {
  static override readonly type = 'note';

  protected override getPathD(w: number, h: number): string {
    const fold = Math.min(w * 0.2, h * 0.2, 24); // size of the corner fold
    return [
      `M 0 0`,
      `L ${w - fold} 0`,   // top edge, stopping before fold
      `L ${w} ${fold}`,    // fold diagonal
      `L ${w} ${h}`,       // right side
      `L 0 ${h}`,          // bottom edge
      `Z`,                 // close (left side)
    ].join(' ');
  }

  /**
   * Override toSvg to also draw the fold crease line.
   */
  override toSvg(shape: NoteShape): SVGElement {
    const g = super.toSvg(shape) as SVGGElement;
    const { props } = shape;
    const { w, h } = props;
    const fold = Math.min(w * 0.2, h * 0.2, 24);
    const strokeW = STROKE_WIDTHS[props.strokeWidth];
    const strokeColor = resolveColor(props.color);
    const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];

    // Fold crease — horizontal line from the fold-point to fold-corner
    const crease = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    crease.setAttribute('points', `${w - fold},0 ${w - fold},${fold} ${w},${fold}`);
    crease.setAttribute('fill', 'none');
    crease.setAttribute('stroke', strokeColor);
    crease.setAttribute('stroke-width', String(strokeW));
    if (dashArray !== 'none') crease.setAttribute('stroke-dasharray', dashArray);
    g.appendChild(crease);
    return g;
  }
}
```

**Verify**: `getPathD(120, 100)` contains 5 `L` commands and starts with `M 0 0`. `toSvg()` returns `<g>` with 2 children.

---

## Step 9: Add `CalloutUtil`

**File**: `packages/glideline/src/shapes/GeoShapeUtil.ts`
**Action**: MODIFY
**Where**: Immediately after `NoteUtil`.

```ts
// ─────────────────────────────────────────────────────────────
// CalloutUtil — rounded rectangle with a triangular tail
// Tail emerges from the bottom-left area pointing down-left.
// ─────────────────────────────────────────────────────────────

export type CalloutShape = GlideShape<GeoShapeProps>;

export class CalloutUtil extends BasePathShapeUtil<CalloutShape> {
  static override readonly type = 'callout';

  protected override getPathD(w: number, h: number): string {
    const rx = Math.min(w, h) * 0.12; // corner radius
    const tailW = w * 0.15;           // width of tail base on the bottom edge
    const tailH = h * 0.2;            // how far the tail extends below the box
    const tailX = w * 0.2;            // x-position of tail base centre

    // Body is the rounded rect occupying (0,0)→(w, h-tailH)
    const bodyH = h - tailH;

    return [
      // Top-left corner
      `M ${rx} 0`,
      `L ${w - rx} 0`,
      `Q ${w} 0 ${w} ${rx}`,         // top-right rounded corner
      `L ${w} ${bodyH - rx}`,
      `Q ${w} ${bodyH} ${w - rx} ${bodyH}`, // bottom-right rounded corner
      // Bottom edge: right side → tail base right
      `L ${tailX + tailW / 2} ${bodyH}`,
      // Tail point (below the box)
      `L ${tailX - tailW * 0.5} ${h}`,
      // Tail base left
      `L ${tailX - tailW / 2} ${bodyH}`,
      `L ${rx} ${bodyH}`,
      `Q 0 ${bodyH} 0 ${bodyH - rx}`, // bottom-left rounded corner
      `L 0 ${rx}`,
      `Q 0 0 ${rx} 0`,                // top-left rounded corner
      `Z`,
    ].join(' ');
  }
}
```

**Verify**: `getPathD(120, 100)` starts with `M` and contains `Q` (quadratic bezier) commands. The string ends with `Z`.

---

## Step 10: Add new shapes to `GeoShapePlugin` and create `P1ShapesPlugin`

**File**: `packages/glideline/src/shapes/GeoShapeUtil.ts`
**Action**: MODIFY
**Where**: Find the existing `GeoShapePlugin` export at the bottom of the file (currently around line 249–257). Replace it entirely with:

```ts
import type { GlidePlugin } from '../editor';

export const GeoShapePlugin: GlidePlugin = {
  id: 'geo-shapes',
  shapes: [
    TriangleUtil as any,
    DiamondUtil as any,
    HexagonUtil as any,
    StarUtil as any,
  ],
};

/** All P1 engineering diagram shapes — add to createEditor({ plugins }) */
export const P1ShapesPlugin: GlidePlugin = {
  id: 'p1-engineering-shapes',
  shapes: [
    RoundedRectUtil as any,
    ParallelogramUtil as any,
    ChevronUtil as any,
    DocumentUtil as any,
    CylinderUtil as any,
    NoteUtil as any,
    CalloutUtil as any,
  ],
};
```

**Verify**: File has two plugin exports: `GeoShapePlugin` and `P1ShapesPlugin`.

---

## Step 11: Add 7 new tool classes to GeoShapeTools.ts

**File**: `packages/glideline/src/tools/GeoShapeTools.ts`
**Action**: MODIFY
**Where**: After the `StarTool` class (after line 155 in current file), before the end of the file.

Append these 7 classes:

```ts
export class RoundedRectTool extends BaseGeoShapeTool {
  static override readonly id = 'rounded-rect';
  static override readonly shapeType = 'rounded-rect';
}

export class ParallelogramTool extends BaseGeoShapeTool {
  static override readonly id = 'parallelogram';
  static override readonly shapeType = 'parallelogram';
}

export class ChevronTool extends BaseGeoShapeTool {
  static override readonly id = 'chevron';
  static override readonly shapeType = 'chevron';
}

export class DocumentTool extends BaseGeoShapeTool {
  static override readonly id = 'document';
  static override readonly shapeType = 'document';
}

export class CylinderTool extends BaseGeoShapeTool {
  static override readonly id = 'cylinder';
  static override readonly shapeType = 'cylinder';
}

export class NoteTool extends BaseGeoShapeTool {
  static override readonly id = 'note';
  static override readonly shapeType = 'note';
}

export class CalloutTool extends BaseGeoShapeTool {
  static override readonly id = 'callout';
  static override readonly shapeType = 'callout';
}
```

**Verify**: File now exports 11 tool classes total (4 existing + 7 new). Each has matching `id` and `shapeType`.

---

## Step 12: Update `glideline/src/index.ts` exports

**File**: `packages/glideline/src/index.ts`
**Action**: MODIFY

**Change 1**: Find the existing Phase C export block (currently lines 132–138):
```ts
// Phase C — Additional geo shapes
export {
  TriangleUtil, DiamondUtil, HexagonUtil, StarUtil, GeoShapePlugin,
} from './shapes/GeoShapeUtil';
export type {
  GeoShapeProps, TriangleShape, DiamondShape, HexagonShape, StarShape,
} from './shapes/GeoShapeUtil';
```

Replace it with:
```ts
// Phase C — Geo shapes (polygon-based)
export {
  TriangleUtil, DiamondUtil, HexagonUtil, StarUtil, GeoShapePlugin,
  // P1 engineering shapes
  RoundedRectUtil, ParallelogramUtil, ChevronUtil,
  DocumentUtil, CylinderUtil, NoteUtil, CalloutUtil,
  P1ShapesPlugin,
} from './shapes/GeoShapeUtil';
export type {
  GeoShapeProps,
  TriangleShape, DiamondShape, HexagonShape, StarShape,
  RoundedRectShape, ParallelogramShape, ChevronShape,
  DocumentShape, CylinderShape, NoteShape, CalloutShape,
} from './shapes/GeoShapeUtil';
```

**Change 2**: Find the existing Phase B tool exports line (currently line 130):
```ts
export { TriangleTool, DiamondTool, HexagonTool, StarTool } from './tools/GeoShapeTools';
```

Replace with:
```ts
export {
  TriangleTool, DiamondTool, HexagonTool, StarTool,
  RoundedRectTool, ParallelogramTool, ChevronTool,
  DocumentTool, CylinderTool, NoteTool, CalloutTool,
} from './tools/GeoShapeTools';
```

**Change 3**: Add new export for the factory function (see Step 13). Add the following line to the end of the file after all existing exports:
```ts
// Custom shape factory
export { createSvgPathShape } from './shapes/createSvgPathShape';
```

**Verify**: Run `cd packages/glideline && npx tsc --noEmit` — zero errors.

---

## Step 13: Create `createSvgPathShape.ts` factory

**File**: `packages/glideline/src/shapes/createSvgPathShape.ts`
**Action**: CREATE (new file)

```ts
/**
 * createSvgPathShape — factory for external consumers
 *
 * Creates a complete ShapeUtil + Tool + GlidePlugin from just:
 *  - a unique `type` string
 *  - a `getPathD(w, h)` function returning an SVG path d= string
 *
 * Usage:
 *   const { plugin } = createSvgPathShape({
 *     type: 'heart',
 *     getPathD: (w, h) => `M ${w/2} ${h*0.3} C ...`,
 *   });
 *   <Glideboard customShapes={[plugin]} />
 *
 * Constraints:
 *  - getPathD must return geometry ONLY — no <text> or <foreignObject>.
 *  - The shape gets a standard editable label (same as all built-in shapes).
 *  - The geometry bounding box is always the AABB rectangle (0,0)→(w,h).
 */

import { ShapeUtil } from './ShapeUtil';
import { StateNode } from '../state-node';
import type { GlideShape, Vec2 } from '../types';
import { T } from '../validators';
import { defineMigrations } from '../migrations';
import { StyleValidators, STROKE_WIDTHS, STROKE_DASH_ARRAYS,
  svgFill, resolveColor, inlinePatternDefs, createTextForeignObjectForExport,
  FONT_FAMILIES, FONT_SIZES,
  type FillStyle, type StrokeStyle, type SizeStyle, type FontSize,
  type TextAlign, type Font, type LabelProps,
} from '../styles';
import { Geometry2d, Rectangle2d } from '../geometry';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node';
import { sid } from '../types';
import type { GlidePlugin } from '../editor';

// ─── Props interface (same for all custom path shapes) ────────

interface CustomPathProps {
  [key: string]: unknown;
  w: number; h: number;
  color: string; opacity: number;
  fillStyle: FillStyle; strokeStyle: StrokeStyle; strokeWidth: SizeStyle;
  label: string; labelColor: string;
  font: Font; fontSize: FontSize; textAlign: TextAlign;
}

type CustomPathShape = GlideShape<CustomPathProps>;

// ─── Factory ──────────────────────────────────────────────────

export interface CreateSvgPathShapeDef {
  /** Unique kebab-case type string. Must not collide with built-in types. */
  type: string;
  /** Default bounding box size when the shape is created. Defaults to 120×80. */
  defaultSize?: { w: number; h: number };
  /**
   * Return the SVG path `d` attribute scaled to the given (w, h).
   * MUST contain only path commands (M, L, C, Q, A, Z).
   * Do NOT embed <text> or other SVG elements here.
   */
  getPathD: (w: number, h: number) => string;
  /** Default stroke/fill color key. Defaults to 'black'. */
  defaultColor?: string;
}

export function createSvgPathShape(def: CreateSvgPathShapeDef): {
  util: typeof ShapeUtil;
  tool: typeof StateNode;
  plugin: GlidePlugin;
} {
  const { type, defaultSize = { w: 120, h: 80 }, getPathD, defaultColor = 'black' } = def;

  // ── Util ──────────────────────────────────────────────────

  class CustomUtil extends ShapeUtil<CustomPathShape> {
    static override readonly type = type;

    static override readonly props = {
      w: T.number, h: T.number,
      color: T.string, opacity: T.number,
      fillStyle: StyleValidators.fillStyle,
      strokeStyle: StyleValidators.strokeStyle,
      strokeWidth: StyleValidators.strokeWidth,
      label: T.string, labelColor: T.string,
      font: StyleValidators.font,
      fontSize: StyleValidators.fontSize,
      textAlign: StyleValidators.textAlign,
    };

    static override readonly migrations = defineMigrations({
      currentVersion: 1,
      migrators: {
        1: {
          up: r => ({
            ...r,
            props: {
              w: defaultSize.w, h: defaultSize.h,
              color: defaultColor, opacity: 1,
              fillStyle: 'none', strokeStyle: 'solid', strokeWidth: 'medium',
              label: '', labelColor: 'black',
              font: 'sans', fontSize: 'md', textAlign: 'center',
              ...(r['props'] as object),
            },
          }),
          down: r => r,
        },
      },
    });

    getDefaultProps(): CustomPathProps {
      return {
        w: defaultSize.w, h: defaultSize.h,
        color: defaultColor, opacity: 1,
        fillStyle: 'none', strokeStyle: 'solid', strokeWidth: 'medium',
        label: '', labelColor: 'black',
        font: 'sans', fontSize: 'md', textAlign: 'center',
      };
    }

    getGeometry(shape: CustomPathShape): Geometry2d {
      return new Rectangle2d(0, 0, shape.props.w, shape.props.h);
    }

    toSvg(shape: CustomPathShape): SVGElement {
      const { props } = shape;
      const strokeW = STROKE_WIDTHS[props.strokeWidth];
      const fillColor = svgFill(props.fillStyle, resolveColor(props.color), shape.id);
      const strokeColor = resolveColor(props.color);
      const dashArray = STROKE_DASH_ARRAYS[props.strokeStyle];

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      if (props.opacity < 1) g.setAttribute('opacity', String(props.opacity));

      const defs = inlinePatternDefs(props.fillStyle, props.color, shape.id);
      if (defs) g.appendChild(defs);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', getPathD(props.w, props.h));
      path.setAttribute('fill', fillColor);
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', String(strokeW));
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('stroke-linecap', 'round');
      if (dashArray !== 'none') path.setAttribute('stroke-dasharray', dashArray);
      g.appendChild(path);
      return g;
    }

    override getLabelProps(shape: CustomPathShape): LabelProps | null {
      const { props } = shape;
      return {
        text: props.label || '',
        fontFamily: FONT_FAMILIES[props.font] ?? FONT_FAMILIES.sans,
        fontSize: FONT_SIZES[props.fontSize] ?? FONT_SIZES.md,
        color: resolveColor(props.labelColor),
        textAlign: props.textAlign,
        verticalAlign: 'center',
        padding: 8,
      };
    }

    override toSvgExport(shape: CustomPathShape): SVGElement {
      const g = this.toSvg(shape) as SVGGElement;
      const { props } = shape;
      if (props.label) {
        const fo = createTextForeignObjectForExport({
          x: 0, y: 0, w: props.w, h: props.h,
          text: props.label, font: props.font,
          fontSize: props.fontSize, textAlign: props.textAlign,
          color: props.labelColor, verticalAlign: 'center',
        });
        g.appendChild(fo);
      }
      return g;
    }
  }

  // ── Tool (reuses the same Idle/Pointing/Drawing FSM pattern) ──

  const DRAG_THRESHOLD = 4;

  function distPt(a: Vec2, b: Vec2) {
    return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
  }

  class Idle extends StateNode {
    static override readonly id = 'idle';
    override onPointerDown(e: PointerDownEvent): void {
      this.parent!.transition('pointing', e);
    }
  }

  class Pointing extends StateNode {
    static override readonly id = 'pointing';
    private _origin!: Vec2;
    override onEnter(info: PointerDownEvent): void { this._origin = info.point; }
    override onPointerMove(e: PointerMoveEvent): void {
      if (distPt(this._origin, e.point) > DRAG_THRESHOLD) {
        this.parent!.transition('drawing', { origin: this._origin, current: e.point });
      }
    }
    override onPointerUp(): void { this.parent!.transition('idle'); }
  }

  class Drawing extends StateNode {
    static override readonly id = 'drawing';
    private _origin!: Vec2;
    private _previewId = sid(`__${type}-preview__`);

    override onEnter(info: { origin: Vec2; current: Vec2 }): void {
      this._origin = info.origin;
      const w = info.current.x - info.origin.x;
      const h = info.current.y - info.origin.y;
      this.editor.history.batch('Custom Shape Preview', () => {
        this.editor.createShape({
          id: this._previewId, type, x: Math.min(info.origin.x, info.origin.x + w),
          y: Math.min(info.origin.y, info.origin.y + h),
          index: 'a1', rotation: 0, meta: {},
          props: { ...(new CustomUtil()).getDefaultProps(), w: Math.max(1, Math.abs(w)), h: Math.max(1, Math.abs(h)) },
        });
      }, { history: 'ignore' });
    }

    override onPointerMove(e: PointerMoveEvent): void {
      const w = e.point.x - this._origin.x;
      const h = e.point.y - this._origin.y;
      this.editor.history.batch('Custom Shape Preview Update', () => {
        this.editor.updateShape(this._previewId, {
          x: Math.min(this._origin.x, this._origin.x + w),
          y: Math.min(this._origin.y, this._origin.y + h),
          props: { w: Math.max(1, Math.abs(w)), h: Math.max(1, Math.abs(h)) },
        });
      }, { history: 'ignore' });
    }

    override onPointerUp(e: PointerUpEvent): void {
      const w = e.point.x - this._origin.x;
      const h = e.point.y - this._origin.y;
      const finalId = sid(`${type}-${Date.now()}`);
      this.editor.history.batch('Custom Shape Cleanup', () => {
        this.editor.deleteShapes([this._previewId]);
      }, { history: 'ignore' });
      this.editor.history.batch(`Create ${type}`, () => {
        this.editor.createShape({
          id: finalId, type, x: Math.min(this._origin.x, this._origin.x + w),
          y: Math.min(this._origin.y, this._origin.y + h),
          index: 'a1', rotation: 0, meta: {},
          props: { ...(new CustomUtil()).getDefaultProps(), w: Math.max(1, Math.abs(w)), h: Math.max(1, Math.abs(h)) },
        });
      });
      this.editor.setCurrentTool('select');
      this.editor.setSelectedShapeIds([finalId]);
      this.parent!.transition('idle');
    }

    override onKeyDown(e: KeyDownEvent): void {
      if (e.key === 'Escape') {
        this.editor.history.batch('Custom Shape Cleanup', () => {
          this.editor.deleteShapes([this._previewId]);
        }, { history: 'ignore' });
        this.parent!.transition('idle');
      }
    }
  }

  class CustomTool extends StateNode {
    static override readonly id = type;
    static override children = () => [Idle, Pointing, Drawing];
  }

  // ── Plugin ────────────────────────────────────────────────

  const plugin: GlidePlugin = {
    id: `custom-shape-${type}`,
    shapes: [CustomUtil as any],
  };

  return { util: CustomUtil as any, tool: CustomTool as any, plugin };
}
```

**Verify**: File is valid TypeScript. `cd packages/glideline && npx tsc --noEmit` — zero errors.

---

## Step 14: Run glideline tests

```bash
cd packages/glideline && npx vitest run
```

All existing tests must pass. If any fail, the issue is in Steps 2–13.

---

## Step 15: Add new tests to `geo-shapes.test.ts`

**File**: `packages/glideline/src/geo-shapes.test.ts`
**Action**: MODIFY
**Where**: Append after the last existing test (after line 62).

```ts
import {
  RoundedRectUtil, ParallelogramUtil, ChevronUtil,
  DocumentUtil, CylinderUtil, NoteUtil, CalloutUtil,
  P1ShapesPlugin,
} from './shapes/GeoShapeUtil';
import {
  RoundedRectTool, ParallelogramTool, ChevronTool,
  DocumentTool, CylinderTool, NoteTool, CalloutTool,
} from './tools/GeoShapeTools';
import { createSvgPathShape } from './shapes/createSvgPathShape';

// Helper to build a minimal shape record for testing
function makeTestShape<P extends Record<string, unknown>>(
  util: { new(): { getDefaultProps(): P } },
  type: string,
  overrides: Partial<P> = {},
): GlideShape<P> {
  const inst = new util();
  return {
    id: sid(`${type}-test`),
    type,
    x: 0, y: 0,
    index: 'a1', rotation: 0, meta: {},
    props: { ...inst.getDefaultProps(), ...overrides },
  } as any;
}

const P1_UTILS: Array<{ Util: any; type: string }> = [
  { Util: RoundedRectUtil, type: 'rounded-rect' },
  { Util: ParallelogramUtil, type: 'parallelogram' },
  { Util: ChevronUtil, type: 'chevron' },
  { Util: DocumentUtil, type: 'document' },
  { Util: CylinderUtil, type: 'cylinder' },
  { Util: NoteUtil, type: 'note' },
  { Util: CalloutUtil, type: 'callout' },
];

describe('P1 shapes — getGeometry', () => {
  for (const { Util, type } of P1_UTILS) {
    it(`${type}: getBounds() returns w=120 h=80`, () => {
      const util = new Util();
      const shape = makeTestShape(Util, type, { w: 120, h: 80 });
      const bounds = util.getGeometry(shape).getBounds();
      expect(bounds.w).toBe(120);
      expect(bounds.h).toBe(80);
    });
  }
});

describe('P1 shapes — getLabelProps', () => {
  for (const { Util, type } of P1_UTILS) {
    it(`${type}: getLabelProps() returns non-null`, () => {
      const util = new Util();
      const shape = makeTestShape(Util, type);
      expect(util.getLabelProps(shape)).not.toBeNull();
    });
  }
});

describe('P1 shapes — tool drag creates shape', () => {
  const TOOL_MAP: Array<{ Tool: any; type: string }> = [
    { Tool: RoundedRectTool, type: 'rounded-rect' },
    { Tool: ParallelogramTool, type: 'parallelogram' },
    { Tool: ChevronTool, type: 'chevron' },
    { Tool: DocumentTool, type: 'document' },
    { Tool: CylinderTool, type: 'cylinder' },
    { Tool: NoteTool, type: 'note' },
    { Tool: CalloutTool, type: 'callout' },
  ];

  for (const { Tool, type } of TOOL_MAP) {
    it(`${type}: drag creates a shape of correct type`, () => {
      const editor = createEditor({
        plugins: [P1ShapesPlugin],
        tools: [SelectTool, Tool],
      });
      editor.setCurrentTool(type);
      editor.dispatchEvent({ type: 'pointerDown', point: { x: 10, y: 20 }, shiftKey: false, target: 'canvas' });
      editor.dispatchEvent({ type: 'pointerMove', point: { x: 90, y: 100 } });
      editor.dispatchEvent({ type: 'pointerUp', point: { x: 90, y: 100 } });

      const shapes = editor.getShapes();
      expect(shapes).toHaveLength(1);
      expect(shapes[0]?.type).toBe(type);
      expect((shapes[0]?.props as any).w).toBe(80);
      expect((shapes[0]?.props as any).h).toBe(80);
    });
  }
});

describe('createSvgPathShape factory', () => {
  it('creates a working plugin, util, and tool', () => {
    const { util: UtilClass, tool: ToolClass, plugin } = createSvgPathShape({
      type: 'test-custom',
      defaultSize: { w: 100, h: 60 },
      getPathD: (w, h) => `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`,
    });

    expect(plugin.id).toBe('custom-shape-test-custom');
    expect((UtilClass as any).type).toBe('test-custom');
    expect((ToolClass as any).id).toBe('test-custom');
  });

  it('created util returns correct geometry bounds', () => {
    const { util: UtilClass } = createSvgPathShape({
      type: 'test-custom-2',
      defaultSize: { w: 100, h: 60 },
      getPathD: (w, h) => `M 0 0 L ${w} ${h} Z`,
    });
    const util = new (UtilClass as any)();
    const shape = { id: sid('test'), type: 'test-custom-2', x: 0, y: 0, index: 'a1', rotation: 0, meta: {},
      props: util.getDefaultProps() };
    const bounds = util.getGeometry(shape).getBounds();
    expect(bounds.w).toBe(100);
    expect(bounds.h).toBe(60);
  });

  it('created util getLabelProps returns non-null', () => {
    const { util: UtilClass } = createSvgPathShape({
      type: 'test-custom-3',
      getPathD: (w, h) => `M 0 0 L ${w} ${h} Z`,
    });
    const util = new (UtilClass as any)();
    const shape = { id: sid('test'), type: 'test-custom-3', x: 0, y: 0, index: 'a1', rotation: 0, meta: {},
      props: util.getDefaultProps() };
    expect(util.getLabelProps(shape)).not.toBeNull();
  });
});
```

Note: Add `import type { GlideShape } from './types';` and `import { sid } from './types';` at the top of the test file if not already imported.

**Run**: `cd packages/glideline && npx vitest run` — all tests including new ones must pass.

---

## Step 16: Update `glideboard/src/editor.ts`

**File**: `packages/glideboard/src/editor.ts`
**Action**: MODIFY

**Change 1** — Add new imports. Find the existing import block from `@durgakiran/glideline`:
```ts
import {
  ArrowPlugin,
  BoxTool,
  ...
  StarTool,
  ...
  GeoShapePlugin,
  ...
} from '@durgakiran/glideline';
```

Add these to the import:
```ts
  P1ShapesPlugin,
  RoundedRectTool,
  ParallelogramTool,
  ChevronTool,
  DocumentTool,
  CylinderTool,
  NoteTool,
  CalloutTool,
```

**Change 2** — Update `createGlideboardEditorInstance`. Find:
```ts
export function createGlideboardEditorInstance() {
  return createEditor({
    plugins: [CoreShapesPlugin, GeoShapePlugin, ArrowPlugin],
    tools: [
      SelectTool,
      BoxTool,
      TriangleTool,
      DiamondTool,
      HexagonTool,
      StarTool,
      ArrowTool,
      HandTool,
      EllipseTool,
      TextTool,
      StickyNoteTool,
      DrawTool,
      EraserTool,
    ],
  });
}
```

Replace with:
```ts
export function createGlideboardEditorInstance(extraPlugins: import('@durgakiran/glideline').GlidePlugin[] = []) {
  return createEditor({
    plugins: [CoreShapesPlugin, GeoShapePlugin, ArrowPlugin, P1ShapesPlugin, ...extraPlugins],
    tools: [
      SelectTool,
      BoxTool,
      TriangleTool,
      DiamondTool,
      HexagonTool,
      StarTool,
      ArrowTool,
      HandTool,
      EllipseTool,
      TextTool,
      StickyNoteTool,
      DrawTool,
      EraserTool,
      // P1 engineering shapes
      RoundedRectTool,
      ParallelogramTool,
      ChevronTool,
      DocumentTool,
      CylinderTool,
      NoteTool,
      CalloutTool,
    ],
  });
}
```

**Verify**: `cd packages/glideboard && npx tsc --noEmit` — zero errors.

---

## Step 17: Update `glideboard/src/types.ts`

**File**: `packages/glideboard/src/types.ts`
**Action**: MODIFY

Add the import at the top:
```ts
import type { GlidePlugin } from '@durgakiran/glideline';
```

Find `GlideboardProps` interface and add one new optional field after `debugApiKey`:
```ts
export interface GlideboardProps {
  initialDocument?: GlideDocument | null;
  collaboration?: GlideboardCollaborationConfig | null;
  readOnly?: boolean;
  onDocumentChange?: (document: GlideDocument) => void;
  documentChangeDebounceMs?: number;
  debugApiKey?: string;
  /**
   * Additional shape plugins to register at startup.
   * Use `createSvgPathShape()` from `@durgakiran/glideline` to build plugins.
   * Changes after first mount are ignored.
   */
  customShapes?: GlidePlugin[];
}
```

**Verify**: File has `customShapes?: GlidePlugin[]` in `GlideboardProps`.

---

## Step 18: Update `glideboard/src/Glideboard.tsx`

**File**: `packages/glideboard/src/Glideboard.tsx`
**Action**: MODIFY

The `wbEditor` singleton is created at module load time in `editor.ts`. To support `customShapes`, we need to re-create the editor when custom plugins are provided **before first render**. Because `wbEditor` is a module-level singleton, we handle this with a one-time ref.

Find the current `Glideboard` component. Replace the entire file with:

```tsx
import React from 'react';
import { WhiteboardApp } from './WhiteboardApp';
import {
  attachDebugApi,
  initializeGlideboardSession,
  subscribeToDocumentChanges,
  teardownGlideboardSession,
  registerCustomShapes,
} from './editor';
import type { GlideboardProps } from './types';

export function Glideboard({
  initialDocument,
  collaboration,
  readOnly = false,
  onDocumentChange,
  documentChangeDebounceMs = 500,
  debugApiKey,
  customShapes,
}: GlideboardProps) {
  // Register custom shapes once on first mount (editor is a module singleton)
  const customShapesRegisteredRef = React.useRef(false);
  if (!customShapesRegisteredRef.current && customShapes && customShapes.length > 0) {
    customShapesRegisteredRef.current = true;
    registerCustomShapes(customShapes);
  }

  React.useEffect(() => {
    initializeGlideboardSession({
      initialDocument,
      collaboration,
      readOnly,
    });

    const detachDebugApi = debugApiKey ? attachDebugApi(debugApiKey) : () => {};
    const unsubscribeDocumentChanges = onDocumentChange
      ? subscribeToDocumentChanges(onDocumentChange, documentChangeDebounceMs)
      : () => {};

    return () => {
      detachDebugApi();
      unsubscribeDocumentChanges();
      teardownGlideboardSession();
    };
  }, [collaboration, debugApiKey, documentChangeDebounceMs, initialDocument, onDocumentChange, readOnly]);

  return <WhiteboardApp />;
}
```

---

## Step 19: Add `registerCustomShapes` to `glideboard/src/editor.ts`

**File**: `packages/glideboard/src/editor.ts`
**Action**: MODIFY
**Where**: After the `wbEditor` constant definition (after `export const wbEditor = createGlideboardEditorInstance();`).

Add this function:

```ts
/**
 * Register additional shape plugins and their tools into the existing wbEditor singleton.
 * Called once on Glideboard mount when `customShapes` prop is provided.
 * Safe to call multiple times — duplicate types will throw (same as createEditor).
 */
export function registerCustomShapes(plugins: import('@durgakiran/glideline').GlidePlugin[]) {
  for (const plugin of plugins) {
    // Register shape utils
    for (const UtilClass of plugin.shapes ?? []) {
      const instance = new (UtilClass as any)();
      wbEditor._registerUtil(instance);
      // Also register with the schema so serialization/deserialization works
      (wbEditor.schema as any).registerShapeUtil(UtilClass);
    }
    // Register binding utils
    for (const BindingClass of plugin.bindings ?? []) {
      const instance = new (BindingClass as any)();
      wbEditor._registerBindingUtil(instance);
    }
    // Run onInstall hook if present
    plugin.onInstall?.(wbEditor);
  }
}
```

> [!WARNING]
> `registerCustomShapes` must be called **before** `initializeGlideboardSession` on any given mount. The `Glideboard.tsx` ref-based guard in Step 18 ensures this. Do NOT move this call into a `useEffect`.

**Verify**: `cd packages/glideboard && npx tsc --noEmit` — zero errors.

---

## Step 20: Update `Toolbar.tsx` — expand SHAPE_TOOLS

**File**: `packages/glideboard/src/Toolbar.tsx`
**Action**: MODIFY

**Change 1** — Add new icon imports. Find the existing imports at the top of the file. The current icon imports from `react-icons/lu` are:
```ts
import { LuEraser, LuDiamond } from 'react-icons/lu';
```

Replace with:
```ts
import {
  LuEraser, LuDiamond,
  LuRectangleHorizontal,
  LuDatabase,
  LuMessageSquare,
  LuStickyNote,
  LuChevronsRight,
  LuFileOutput,
} from 'react-icons/lu';
```

> [!NOTE]
> If any of these icon names do not exist in the installed version of `react-icons`, use these fallbacks:
> - `LuRectangleHorizontal` → `FiSquare` (already imported)
> - `LuDatabase` → `FiServer` (add to fi imports)
> - `LuMessageSquare` → `FiMessageSquare` (add to fi imports)
> - `LuStickyNote` → `FiFileText` (already imported)
> - `LuChevronsRight` → `FiChevronRight` (add to fi imports, or use `FiArrowRight`)
> - `LuFileOutput` → `FiFileText` (already imported)
>
> Check which icons are available: `ls packages/glideboard/node_modules/react-icons/lu/ | grep -i "rectangle\|database\|message\|sticky\|chevron\|file"`

**Change 2** — Expand `SHAPE_TOOLS`. Find the existing array:
```ts
const SHAPE_TOOLS: ToolDef[] = [
  { id: 'box', label: 'Rectangle', shortcut: 'R', icon: FiSquare },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'E', icon: FiCircle },
  { id: 'triangle', label: 'Triangle', icon: FiTriangle },
  { id: 'diamond', label: 'Diamond', icon: LuDiamond },
  { id: 'hexagon', label: 'Hexagon', icon: FiHexagon },
  { id: 'star', label: 'Star', icon: FiStar },
];
```

Replace with:
```ts
const SHAPE_TOOLS: ToolDef[] = [
  // Primitives (existing)
  { id: 'box',          label: 'Rectangle',    shortcut: 'R', icon: FiSquare },
  { id: 'ellipse',      label: 'Ellipse',      shortcut: 'E', icon: FiCircle },
  { id: 'triangle',     label: 'Triangle',                    icon: FiTriangle },
  { id: 'diamond',      label: 'Diamond',                     icon: LuDiamond },
  { id: 'hexagon',      label: 'Hexagon',                     icon: FiHexagon },
  { id: 'star',         label: 'Star',                        icon: FiStar },
  // P1 engineering shapes
  { id: 'rounded-rect', label: 'Rounded Rect',               icon: LuRectangleHorizontal },
  { id: 'parallelogram',label: 'Parallelogram',              icon: FiSquare }, // fallback — no exact icon
  { id: 'chevron',      label: 'Chevron',                    icon: LuChevronsRight },
  { id: 'document',     label: 'Document',                   icon: LuFileOutput },
  { id: 'cylinder',     label: 'Cylinder',                   icon: LuDatabase },
  { id: 'note',         label: 'Note',                       icon: LuStickyNote },
  { id: 'callout',      label: 'Callout',                    icon: LuMessageSquare },
];
```

**Change 3** — Widen the shape picker grid to 3 columns (currently 2) so 13 shapes fit without scrolling.

Find in `ShapePickerButton`:
```ts
gridTemplateColumns: 'repeat(2, 48px)',
```
Replace with:
```ts
gridTemplateColumns: 'repeat(3, 48px)',
```

**Verify**: `SHAPE_TOOLS.length === 13`. TypeScript compiles. The shape picker popup renders with 3 columns.

---

## Step 21: Update `glideboard/src/index.ts`

**File**: `packages/glideboard/src/index.ts`
**Action**: MODIFY
**Where**: Append to the end of the file.

```ts
// Re-export createSvgPathShape so consumers import from glideboard only
export { createSvgPathShape } from '@durgakiran/glideline';
```

---

## Step 22: Run glideboard TypeScript check

```bash
cd packages/glideboard && npx tsc --noEmit
```

Zero errors required before continuing.

---

## Step 23: Run full test suite

```bash
# Engine tests
cd packages/glideline && npx vitest run

# UI package tests (if any exist)
cd packages/glideboard && npx vitest run
```

All tests must pass.

---

## Step 24: Build both packages

```bash
cd packages/glideline && npm run build
cd packages/glideboard && npm run build
```

Both builds must succeed with zero errors.

---

## Step 25: Manual smoke test in the demo app

Open the demo app (typically `packages/editor-demo` or `packages/whiteboard-demo`):

```bash
cd packages/editor-demo && npm run dev   # or whiteboard-demo
```

Verify in the browser:
1. Click the shape picker button in the toolbar — 13 shapes appear in a 3-column grid.
2. Click **Rounded Rect** → drag on canvas → a rounded rectangle appears.
3. Click **Cylinder** → drag → cylinder with ellipse top cap visible.
4. Click **Note** → drag → rectangle with folded corner visible.
5. Click **Callout** → drag → rounded rect with triangular tail visible.
6. Double-click any new shape → label editing activates (cursor appears inside shape).
7. Type text → press ⌘Enter → text is saved and visible.
8. Select a shape → open Style Panel → change color, fill, stroke → shape updates.
9. Rotate and resize each new shape → geometry scales correctly.

---

## Step 26: Verify `customShapes` prop (optional integration test)

In the demo app, add a custom heart shape:

```tsx
import { createSvgPathShape } from '@durgakiran/glideboard';

const { plugin: heartPlugin } = createSvgPathShape({
  type: 'heart',
  defaultSize: { w: 120, h: 110 },
  getPathD: (w, h) => `M ${w/2} ${h*0.35} C ${w*0.9} ${h*0.05} ${w*1.1} ${h*0.5} ${w/2} ${h} C ${-w*0.1} ${h*0.5} ${w*0.1} ${h*0.05} ${w/2} ${h*0.35} Z`,
});

// In JSX:
<Glideboard customShapes={[heartPlugin]} />
```

Verify:
- No console errors on mount.
- Manually call `wbEditor.setCurrentTool('heart')` from browser console.
- Drag on canvas — a heart shape appears.
- Double-click — label editable.

---

## Summary of all files changed

| Package | File | Action | Key Change |
|---|---|---|---|
| `glideline` | `src/shapes/GeoShapeUtil.ts` | MODIFY | Add `BasePathShapeUtil`; add 7 new shape util classes; update `GeoShapePlugin`; add `P1ShapesPlugin` |
| `glideline` | `src/shapes/createSvgPathShape.ts` | CREATE | Custom shape factory function |
| `glideline` | `src/tools/GeoShapeTools.ts` | MODIFY | Add 7 new tool classes |
| `glideline` | `src/index.ts` | MODIFY | Export new utils, tools, plugins, factory |
| `glideline` | `src/geo-shapes.test.ts` | MODIFY | Add tests for all 7 shapes + factory |
| `glideboard` | `src/editor.ts` | MODIFY | Import P1 tools/plugin; add `extraPlugins` param; add `registerCustomShapes()` |
| `glideboard` | `src/types.ts` | MODIFY | Add `customShapes?: GlidePlugin[]` to `GlideboardProps` |
| `glideboard` | `src/Glideboard.tsx` | MODIFY | Read `customShapes`; call `registerCustomShapes` before first mount |
| `glideboard` | `src/Toolbar.tsx` | MODIFY | Expand `SHAPE_TOOLS` to 13; add new icon imports; widen picker to 3 columns |
| `glideboard` | `src/index.ts` | MODIFY | Re-export `createSvgPathShape` |
