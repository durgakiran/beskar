import { AREA_ERASE_META_KEY, areaEraseBoundsTransform, getAreaEraseCuts, type AreaEraseCut } from '../area-erase-mask.js';
import { pencilStrokeRadius } from '../pencil-stroke.js';
import type { GlideEditor } from '../editor.js';
import { getFreehandStrokeWidth, type FreehandShape } from '../shapes/FreehandUtil.js';
import { getPlainLabelLayout } from '../shapes/TextUtil.js';
import { StateNode, type KeyDownEvent, type PointerCancelEvent, type PointerDownEvent, type PointerMoveEvent, type PointerUpEvent } from '../state-node.js';
import { measurePlainTextWidth, STROKE_WIDTHS, type LabelProps, type SizeStyle } from '../styles.js';
import { applyMatrixToPoint, invertMatrix, multiplyMatrices, type Matrix2d } from '../transform.js';
import type { Box2d, GlideShape, ShapeId, Vec2 } from '../types.js';
import { ERASER_RADIUS_PX } from './EraserTool.js';
import { interpolate } from './erase-freehand.js';

export interface AreaErasePreview {
  readonly shape: GlideShape;
  readonly cut: AreaEraseCut;
}

const CELL_PX = 0.75;
const RADIUS = ERASER_RADIUS_PX / CELL_PX;

function distanceSquaredToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const projection = length === 0 ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length));
  return (point.x - start.x - projection * dx) ** 2 + (point.y - start.y - projection * dy) ** 2;
}

function sameTransform(left: Matrix2d | undefined, right: Matrix2d): boolean {
  return !!left && left.a === right.a && left.b === right.b && left.c === right.c
    && left.d === right.d && left.e === right.e && left.f === right.f;
}

function createCutHitTest(cut: AreaEraseCut) {
  const determinant = cut.matrix.a * cut.matrix.d - cut.matrix.b * cut.matrix.c;
  if (Math.abs(determinant) < Number.EPSILON) return () => false;
  const inverse = invertMatrix(cut.matrix);
  const rows = new Map<number, number[]>();
  for (let i = 0; i < cut.spans.length; i += 3) {
    const row = cut.spans[i]!;
    const ranges = rows.get(row) ?? [];
    ranges.push(cut.spans[i + 1]!, cut.spans[i + 2]!);
    rows.set(row, ranges);
  }
  return (point: Vec2) => {
    const { x, y } = applyMatrixToPoint(inverse, point);
    const ranges = rows.get(Math.floor(y));
    if (ranges) {
      for (let i = 0; i < ranges.length; i += 2) {
        if (x >= ranges[i]! && x < ranges[i + 1]!) return true;
      }
    }
    return false;
  };
}

function createVectorHitTest(svg: SVGSVGElement | undefined, editor: GlideEditor, shape: GlideShape) {
  if (!svg || ['raster-image', 'text'].includes(shape.type)) return undefined;
  const node = editor.getShapeUtil(shape.type).toSvg(shape);
  svg.append(node);
  const geometry = [node, ...node.querySelectorAll<SVGElement>('path,rect,circle,ellipse,polygon,polyline,line')]
    .flatMap(element => {
      if (!(element instanceof SVGGeometryElement) || element.closest('defs')) return [];
      const matrix = element.getCTM();
      if (!matrix) return [];
      const style = getComputedStyle(element);
      if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return [];
      return [{ element, inverse: matrix.inverse(),
        fill: style.fill !== 'none' && Number(style.fillOpacity) > 0,
        stroke: style.stroke !== 'none' && Number(style.strokeOpacity) > 0 }];
    });
  if (geometry.length === 0) return undefined;
  return (local: Vec2) => geometry.some(({ element, inverse, fill, stroke }) => {
    const point = new DOMPoint(local.x, local.y).matrixTransform(inverse);
    return (fill && element.isPointInFill(point)) || (stroke && element.isPointInStroke(point));
  });
}

function createPlainLabelHitTest(label: LabelProps, bounds: Box2d) {
  const { x, y, w, h, lineHeight, lines, anchor, top } = getPlainLabelLayout(label, bounds);
  const lineBounds = lines.map(line => {
    const width = measurePlainTextWidth(line.trimEnd(), label.fontFamily, label.fontSize);
    const left = anchor - (label.textAlign === 'center' ? width / 2 : label.textAlign === 'right' ? width : 0);
    return { left, right: left + width };
  });
  return (point: Vec2) => {
    if (point.x < x || point.x >= x + w || point.y < y || point.y >= y + h) return false;
    const line = lineBounds[Math.floor((point.y - top) / lineHeight)];
    return Boolean(line && point.x >= line.left && point.x < line.right);
  };
}

function createTarget(editor: GlideEditor, shape: GlideShape, gridToPage: Matrix2d, svg?: SVGSVGElement) {
  const id = shape.id as ShapeId;
  const util = editor.getShapeUtil(shape.type);
  const geometry = util.getGeometry(shape);
  const pageToLocal = editor.getWorldTransformInverse(id);
  const normalize = invertMatrix(areaEraseBoundsTransform(util.getVisualBounds(shape)));
  const matrix = multiplyMatrices(normalize, multiplyMatrices(pageToLocal, gridToPage));
  const clips = editor.getClippingFrameAncestors(id).map(frame => ({
    transform: editor.getWorldTransformInverse(frame.id as ShapeId),
    geometry: editor.getShapeUtil(frame.type).getGeometry(frame),
  }));
  const previousCuts = getAreaEraseCuts(shape).map(createCutHitTest);
  const outline = geometry.getOutline();
  const open = ['line', 'arrow', 'freehand'].includes(shape.type) && shape.props['isClosed'] !== true;
  const fill = !open && shape.props['fillStyle'] !== 'none';
  const label = util.getLabelProps(shape);
  const labelHitTest = label?.text ? (
    shape.type === 'text' ? (point: Vec2) => util.hitTestLabel(shape, point)
      : createPlainLabelHitTest(label, geometry.getBounds())
  ) : undefined;
  const vectorHitTest = createVectorHitTest(svg, editor, shape);
  const strokeWidth = shape.type === 'freehand' ? getFreehandStrokeWidth((shape as FreehandShape).props)
    : STROKE_WIDTHS[shape.props['strokeWidth'] as SizeStyle] ?? 0;
  const strokeRadius = shape.props['isPencil'] === true ? pencilStrokeRadius(strokeWidth) : strokeWidth / 2;
  const segmentCount = open ? outline.length - 1 : outline.length;
  const rows = new Map<number, Set<number>>();

  return {
    id, shape, matrix, rows, bounds: editor.getShapeVisualWorldBounds(shape),
    world: editor.getWorldTransform(id),
    locked: editor.isShapeEffectivelyLocked(id),
    covers(pagePoint: Vec2): boolean {
      if (clips.some(clip => !clip.geometry.hitTestPoint(applyMatrixToPoint(clip.transform, pagePoint)))) return false;
      const local = applyMatrixToPoint(pageToLocal, pagePoint);
      const normalized = applyMatrixToPoint(normalize, local);
      if (previousCuts.some(cut => cut(normalized))) return false;
      if (labelHitTest?.(local)) return true;
      if (vectorHitTest) return vectorHitTest(local);
      if (fill && geometry.hitTestPoint(local)) return true;
      if (strokeRadius === 0) return false;
      if (outline.length === 1) return distanceSquaredToSegment(local, outline[0]!, outline[0]!) <= strokeRadius ** 2;
      for (let i = 0; i < segmentCount; i++) {
        if (distanceSquaredToSegment(local, outline[i]!, outline[(i + 1) % outline.length]!) <= strokeRadius ** 2) return true;
      }
      return false;
    },
  };
}

type Target = ReturnType<typeof createTarget>;

function buildCut(target: Target): AreaEraseCut {
  const spans: number[] = [];
  for (const [row, columns] of target.rows) {
    const runs = [...columns].sort((a, b) => a - b);
    let start = runs[0]!;
    let end = start + 1;
    for (const column of runs.slice(1)) {
      if (column > end) {
        spans.push(row, start, end);
        start = column;
      }
      end = column + 1;
    }
    spans.push(row, start, end);
  }
  return { matrix: target.matrix, spans };
}

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(event: PointerDownEvent): void {
    this.parent!.transition('erasing', event);
  }
}

class ErasingArea extends StateNode {
  static override readonly id = 'erasing';
  private pageId!: ReturnType<GlideEditor['getActivePageId']>;
  private gridToPage!: Matrix2d;
  private pageToGrid!: Matrix2d;
  private lastPoint!: Vec2;
  private readonly targets = new Map<ShapeId, Target>();
  private readonly visited = new Map<number, Set<number>>();
  private hitTestSvg?: SVGSVGElement;

  override onEnter(event: PointerDownEvent): void {
    this.pageId = this.editor.getActivePageId();
    const cell = CELL_PX / this.editor.camera.signal.peek().z;
    this.gridToPage = { a: cell, b: 0, c: 0, d: cell, e: event.point.x, f: event.point.y };
    this.pageToGrid = invertMatrix(this.gridToPage);
    this.lastPoint = event.point;
    if (typeof SVGGeometryElement !== 'undefined' && SVGGeometryElement.prototype.isPointInStroke) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('aria-hidden', 'true');
      Object.assign(svg.style, { position: 'fixed', left: '-10000px', top: '0', width: '1px', height: '1px',
        opacity: '0', pointerEvents: 'none' });
      document.body.append(svg);
      this.hitTestSvg = svg;
    }
    this.sweepTo(event.point);
  }

  override onPointerMove(event: PointerMoveEvent): void {
    this.sweepTo(event.point);
  }

  override onPointerUp(event: PointerUpEvent): void {
    this.sweepTo(event.point);
    this.finish();
  }

  override onPointerCancel(event: PointerCancelEvent): void {
    if (event.reason === 'unmount') this.parent!.transition('idle');
    else this.finish();
  }

  override onKeyDown(event: KeyDownEvent): void {
    if (event.key === 'Escape') this.parent!.transition('idle');
  }

  override onExit(): void {
    this.visited.clear();
    this.targets.clear();
    this.hitTestSvg?.remove();
    this.hitTestSvg = undefined;
    this.editor.areaErasePreviews.value = new Map();
  }

  private finish(): void {
    try {
      if (this.editor.getActivePageId() !== this.pageId) return;
      const previews = [...this.editor.areaErasePreviews.peek()].filter(([id, { shape }]) =>
        shape === this.editor.getShape(id) && !this.editor.isShapeEffectivelyHidden(id)
        && !this.editor.isShapeEffectivelyLocked(id)
        && sameTransform(this.targets.get(id)?.world, this.editor.getWorldTransform(id)));
      if (previews.length === 0) return;
      this.editor.batch('Erase Area', () => {
        for (const [id, { shape, cut }] of previews) {
          this.editor.updateShape(id, {
            meta: { ...shape.meta, [AREA_ERASE_META_KEY]: [...getAreaEraseCuts(shape), cut] },
          });
        }
      });
    } finally {
      this.parent!.transition('idle');
    }
  }

  private sweepTo(to: Vec2): void {
    if (this.editor.getActivePageId() !== this.pageId) return;
    const from = this.lastPoint;
    this.lastPoint = to;
    const radius = RADIUS * this.gridToPage.a;
    const targets = this.editor.getShapesInBox({
      minX: Math.min(from.x, to.x) - radius, minY: Math.min(from.y, to.y) - radius,
      maxX: Math.max(from.x, to.x) + radius, maxY: Math.max(from.y, to.y) + radius,
    }).filter(shape => shape.type !== 'group' && shape.props['opacity'] !== 0)
      .reverse().map(shape => {
        const id = shape.id as ShapeId;
        const previous = this.targets.get(id);
        if (previous?.shape === shape && sameTransform(previous.world, this.editor.getWorldTransform(id))) return previous;
        const target = createTarget(this.editor, shape, this.gridToPage, this.hitTestSvg);
        this.targets.set(id, target);
        return target;
      });
    if (targets.length === 0 || targets.every(target => target.locked)) return;
    const start = applyMatrixToPoint(this.pageToGrid, from);
    const end = applyMatrixToPoint(this.pageToGrid, to);
    const parts = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / RADIUS));
    const changed = new Set<Target>();
    // Short segments bound the work to the area swept by the brush, including fast diagonal moves.
    for (let i = 0; i < parts; i++) {
      this.collectCells(interpolate(start, end, i / parts), interpolate(start, end, (i + 1) / parts), targets, changed);
    }
    if (changed.size === 0) return;
    const previews = new Map(this.editor.areaErasePreviews.peek());
    for (const target of changed) previews.set(target.id, { shape: target.shape, cut: buildCut(target) });
    this.editor.areaErasePreviews.value = previews;
  }

  private collectCells(start: Vec2, end: Vec2, targets: Target[], changed: Set<Target>): void {
    const minX = Math.floor(Math.min(start.x, end.x) - RADIUS);
    const maxX = Math.ceil(Math.max(start.x, end.x) + RADIUS);
    const minY = Math.floor(Math.min(start.y, end.y) - RADIUS);
    const maxY = Math.ceil(Math.max(start.y, end.y) + RADIUS);
    for (let row = minY; row < maxY; row++) {
      const visited = this.visited.get(row) ?? new Set<number>();
      this.visited.set(row, visited);
      for (let column = minX; column < maxX; column++) {
        if (visited.has(column)) continue;
        const center = { x: column + 0.5, y: row + 0.5 };
        if (distanceSquaredToSegment(center, start, end) > RADIUS ** 2) continue;
        visited.add(column);
        const page = applyMatrixToPoint(this.gridToPage, center);
        const target = targets.find(({ bounds, covers }) =>
          page.x >= bounds.minX && page.x <= bounds.maxX && page.y >= bounds.minY && page.y <= bounds.maxY && covers(page));
        if (!target || target.locked) continue;
        const columns = target.rows.get(row) ?? new Set<number>();
        columns.add(column);
        target.rows.set(row, columns);
        changed.add(target);
      }
    }
  }
}

export class AreaEraserTool extends StateNode {
  static override readonly id = 'area-eraser';
  static override children = () => [Idle, ErasingArea];
}
