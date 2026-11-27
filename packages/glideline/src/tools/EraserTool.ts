import { pencilStrokeRadius } from '../pencil-stroke.js';
import { StateNode } from '../state-node.js';
import { AREA_ERASE_META_KEY, areaEraseBoundsTransform, getAreaEraseCuts } from '../area-erase-mask.js';
import { invertMatrix, multiplyMatrices, translationMatrix } from '../transform.js';
import type { KeyDownEvent, PointerCancelEvent, PointerDownEvent, PointerMoveEvent, PointerUpEvent } from '../state-node.js';
import { STROKE_WIDTHS } from '../styles.js';
import { getFreehandStrokeWidth, type FreehandPoint, type FreehandShape } from '../shapes/FreehandUtil.js';
import type { PartialErasePreview } from '../editor.js';
import type { PageId, ShapeId, Vec2 } from '../types.js';
import { boxInterval, interpolate, splitFreehandStroke, type EraserSweep } from './erase-freehand.js';

export const ERASER_RADIUS_PX = 8;

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(event: PointerDownEvent): void {
    this.parent!.transition('erasing', event);
  }
}

class Erasing extends StateNode {
  static override readonly id = 'erasing';

  /** Elements highlighted for removal. */
  readonly erasedIds = new Set<ShapeId>();
  private lastPoint!: Vec2;
  private pageId!: PageId;

  private get partial(): boolean {
    return this.parent instanceof PartialEraserTool;
  }

  private get allElements(): boolean {
    return this.parent instanceof EraserTool;
  }

  override onEnter(event: PointerDownEvent): void {
    this.pageId = this.editor.getActivePageId();
    this.lastPoint = event.point;
    this.sweepTo(event.point);
  }

  override onPointerMove(event: PointerMoveEvent): void {
    this.sweepTo(event.point);
  }

  override onPointerUp(event: PointerUpEvent): void {
    this.finishGesture(event.point);
  }

  override onKeyDown(event: KeyDownEvent): void {
    if (event.key === 'Escape') this.parent!.transition('idle');
  }

  override onPointerCancel(event: PointerCancelEvent): void {
    if (this.partial && event.reason !== 'unmount') {
      // The browser may end capture without delivering a final pointer sample.
      // Save the cuts already shown to the user.
      this.finishGesture();
      return;
    }
    this.parent!.transition('idle');
  }

  private finishGesture(point?: Vec2): void {
    try {
      if (point) this.sweepTo(point);
      if (this.pageId !== this.editor.getActivePageId()) return;
      const removals = [...this.erasedIds].filter(id => this.allElements
        ? this.canEraseElement(id)
        : this.getEditableStroke(id));
      const cuts = [...this.editor.partialErasePreviews.peek()].flatMap(([id, { stroke, fragments }]) => {
        // A collaborative edit can replace or lock a stroke during the gesture.
        if (this.getEditableStroke(id) !== stroke) return [];
        if (fragments.length === 0) {
          removals.push(id);
          return [];
        }
        return [{ shape: stroke, fragments }];
      });
      if (cuts.length === 0 && removals.length === 0) return;
      this.editor.batch(this.allElements ? 'Erase Shapes' : 'Erase Freehand', () => {
        for (const { shape, fragments } of cuts) this.replaceWithFragments(shape, fragments);
        if (removals.length > 0) this.editor.deleteShapes(removals, { pruneEmptyGroups: this.allElements });
      });
    } finally {
      this.parent!.transition('idle');
    }
  }

  override onExit(): void {
    this.erasedIds.clear();
    if (this.editor.erasingShapeIds.peek().size > 0) this.editor.erasingShapeIds.value = new Set();
    if (this.editor.partialErasePreviews.peek().size > 0) this.editor.partialErasePreviews.value = new Map();
  }

  private getEditableStroke(id: ShapeId): FreehandShape | undefined {
    const shape = this.editor.getShape<FreehandShape>(id);
    if (shape?.type === 'freehand' && this.editor.getShapePageId(id) === this.pageId
      && !this.editor.isShapeEffectivelyHidden(id) && !this.editor.isShapeEffectivelyLocked(id)
      && this.editor.getChildren(id).length === 0) {
      return shape;
    }
  }

  private canEraseElement(id: ShapeId): boolean {
    if (this.editor.getShapePageId(id) !== this.pageId || this.editor.isShapeEffectivelyHidden(id)
      || this.editor.isShapeEffectivelyLocked(id)) return false;
    const descendants = [...this.editor.getChildren(id)];
    for (let i = 0; i < descendants.length; i++) {
      const child = descendants[i]!;
      if (child.isLocked) return false;
      descendants.push(...this.editor.getChildren(child.id));
    }
    return true;
  }

  private markElement(id: ShapeId): void {
    const target = this.editor.getSelectableShapeId(id);
    if (target && !this.erasedIds.has(target) && this.canEraseElement(target)) {
      this.erasedIds.add(target);
    }
  }

  private sweepTo(to: Vec2): void {
    if (this.pageId !== this.editor.getActivePageId()) return;
    const from = this.lastPoint;
    this.lastPoint = to;
    const radius = ERASER_RADIUS_PX / this.editor.camera.signal.peek().z;
    const previousCount = this.erasedIds.size;
    if (this.allElements) {
      // Retain normal hit testing and group selection while covering gaps between events.
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (radius / 2)));
      for (let i = 1; i <= steps; i++) {
        for (const shape of this.editor.getShapesAtPoint(interpolate(from, to, i / steps))) {
          this.markElement(shape.id as ShapeId);
        }
      }
    }
    const padding = radius + STROKE_WIDTHS.xl / 2;
    const candidates = this.editor.getShapesInBox({
      minX: Math.min(from.x, to.x) - padding,
      minY: Math.min(from.y, to.y) - padding,
      maxX: Math.max(from.x, to.x) + padding,
      maxY: Math.max(from.y, to.y) + padding,
    });
    const previews = this.editor.partialErasePreviews.peek();
    let nextPreviews: Map<ShapeId, PartialErasePreview> | undefined;
    for (const candidate of candidates) {
      const id = candidate.id as ShapeId;
      if (candidate.type !== 'freehand' || this.erasedIds.has(id)) continue;
      const shape = this.getEditableStroke(id);
      if (!shape) continue;
      const sweep = { from, to, radius };
      const prior = previews.get(id);
      const fragments = this.split(shape, sweep, prior?.stroke === shape ? prior.fragments : undefined);
      if (fragments === null) continue;
      if (this.partial) {
        nextPreviews ??= new Map(previews);
        nextPreviews.set(id, { stroke: shape, fragments });
      } else if (this.allElements) {
        this.markElement(id);
      } else {
        this.erasedIds.add(id);
      }
    }
    if (nextPreviews) this.editor.partialErasePreviews.value = nextPreviews;
    if (this.erasedIds.size !== previousCount) {
      this.editor.erasingShapeIds.value = new Set(this.erasedIds);
    }
  }

  private split(shape: FreehandShape, sweep: EraserSweep, prior?: readonly FreehandPoint[][]): FreehandPoint[][] | null {
    const localSweep = this.toLocalSweep(shape, sweep);
    if (!localSweep) return null;
    if (prior) {
      // Each sample only cuts the ink that is still visible.
      let changed = false;
      const fragments = prior.flatMap(points => {
        const remaining = splitFreehandStroke(points, localSweep, false);
        if (remaining === null) return [points];
        changed = true;
        return remaining;
      });
      return changed ? fragments : null;
    }
    const points = shape.props.points.map(point => ({
      ...point, x: point.x - shape.x, y: point.y - shape.y, pressure: point.pressure ?? 0.5,
    }));
    return splitFreehandStroke(points, localSweep, shape.props.isClosed);
  }

  private toLocalSweep(shape: FreehandShape, sweep: EraserSweep): EraserSweep | null {
    const id = shape.id as ShapeId;
    let start = 0;
    let end = 1;
    for (const frame of this.editor.getClippingFrameAncestors(id)) {
      const frameId = frame.id as ShapeId;
      const { minX, minY, maxX, maxY } = this.editor.getShapeLocalBounds(frameId);
      const from = this.editor.pageToLocal(frameId, sweep.from);
      const to = this.editor.pageToLocal(frameId, sweep.to);
      const interval = boxInterval(from, to, minX, minY, maxX, maxY);
      if (!interval) return null;
      start = Math.max(start, interval[0]);
      end = Math.min(end, interval[1]);
      if (end <= start) return null;
    }
    const width = getFreehandStrokeWidth(shape.props);
    return {
      from: this.editor.pageToLocal(id, interpolate(sweep.from, sweep.to, start)),
      to: this.editor.pageToLocal(id, interpolate(sweep.from, sweep.to, end)),
      radius: sweep.radius + (shape.props.isPencil ? pencilStrokeRadius(width) : width / 2),
    };
  }

  private replaceWithFragments(shape: FreehandShape, fragments: readonly FreehandPoint[][]): void {
    const id = shape.id as ShapeId;
    const cuts = getAreaEraseCuts(shape);
    const util = this.editor.getShapeUtil(shape.type);
    const cutSpace = cuts.length ? multiplyMatrices(
      this.editor.getLocalTransform(id), areaEraseBoundsTransform(util.getVisualBounds(shape)),
    ) : null;
    const placements = fragments.map(fragment => {
      // Flatten the old shape's rotation into the points before deriving new bounds.
      // Otherwise a fragment would rotate around its own, different center.
      const points = fragment.map(point => ({
        ...point,
        ...this.editor.pageToParent(shape.parentId, this.editor.localToPage(id, point)),
      }));
      let x = Infinity;
      let y = Infinity;
      for (const point of points) {
        x = Math.min(x, point.x);
        y = Math.min(y, point.y);
      }
      const placement = { x, y, rotation: 0, props: { ...shape.props, points, isClosed: false } };
      if (!cutSpace) return { ...placement, meta: shape.meta };

      // A fragment has a different origin and bounds. Keep any existing area
      // cutouts in the same parent coordinates as the ink it replaces.
      const fragmentBounds = util.getVisualBounds({ ...shape, ...placement });
      const parentToFragment = multiplyMatrices(
        invertMatrix(areaEraseBoundsTransform(fragmentBounds)), translationMatrix(-x, -y),
      );
      const remap = multiplyMatrices(parentToFragment, cutSpace);
      return { ...placement, meta: { ...shape.meta, [AREA_ERASE_META_KEY]: cuts.map(cut => ({
        ...cut, matrix: multiplyMatrices(remap, cut.matrix),
      })) } };
    });

    const [first, ...rest] = placements;
    this.editor.updateShape<FreehandShape>(id, first!);
    let after = id;
    for (const placement of rest) {
      after = this.editor.createShape({
        ...placement, type: 'freehand', parentId: shape.parentId,
      }, { after });
    }
  }
}

export class EraserTool extends StateNode {
  static override readonly id = 'eraser';
  static override children = () => [Idle, Erasing];
}

export class WholeStrokeEraserTool extends StateNode {
  static override readonly id = 'whole-stroke-eraser';
  static override children = EraserTool.children;
}

export class PartialEraserTool extends StateNode {
  static override readonly id = 'partial-eraser';
  static override children = EraserTool.children;
}
