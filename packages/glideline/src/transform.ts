import type { Geometry2d } from './geometry';
import { STROKE_WIDTHS, type SizeStyle } from './styles';
import { makeBox, type Box2d, type EdgeName, type GlideShape, type ShapeId, type Vec2 } from './types';

/** Affine 2D matrix using the SVG/Canvas `a b c d e f` convention. */
export interface Matrix2d {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY_MATRIX: Matrix2d = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function multiplyMatrices(left: Matrix2d, right: Matrix2d): Matrix2d {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function translationMatrix(x: number, y: number): Matrix2d {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function rotationMatrix(radians: number): Matrix2d {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function invertMatrix(matrix: Matrix2d): Matrix2d {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < Number.EPSILON) throw new Error('Shape transform is not invertible.');
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

export function applyMatrixToPoint(matrix: Matrix2d, point: Vec2): Vec2 {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function matrixToSvg(matrix: Matrix2d): string {
  return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
}

interface TransformHost {
  getShape(id: ShapeId): GlideShape | undefined;
  getGeometry(shape: GlideShape): Geometry2d;
  getZoom(): number;
  hitTestLocal(shape: GlideShape, point: Vec2): boolean;
}

function boundsOfPoints(points: readonly Vec2[]): Box2d {
  if (points.length === 0) return makeBox(0, 0, 0, 0);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return makeBox(minX, minY, maxX - minX, maxY - minY);
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1,
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared));
  return Math.hypot(
    point.x - (start.x + ratio * (end.x - start.x)),
    point.y - (start.y + ratio * (end.y - start.y)),
  );
}

export class TransformService {
  constructor(private readonly host: TransformHost) {}

  getLocalGeometry(id: ShapeId): Geometry2d {
    return this.host.getGeometry(this.requireShape(id));
  }

  getLocalTransform(id: ShapeId): Matrix2d {
    const shape = this.requireShape(id);
    if (shape.type === 'arrow') return translationMatrix(shape.x, shape.y);
    const bounds = this.host.getGeometry(shape).getBounds();
    const centerX = bounds.minX + bounds.w / 2;
    const centerY = bounds.minY + bounds.h / 2;
    // Arrow path points already encode their orientation. Applying record
    // rotation as well would double-rotate them.
    const rotation = shape.rotation || 0;
    return multiplyMatrices(
      translationMatrix(shape.x, shape.y),
      multiplyMatrices(
        translationMatrix(centerX, centerY),
        multiplyMatrices(rotationMatrix(rotation), translationMatrix(-centerX, -centerY)),
      ),
    );
  }

  getWorldTransform(id: ShapeId): Matrix2d {
    // Current records store x/y in page space even when parentId is present.
    // Parent matrix composition belongs to the future hierarchy coordinate
    // migration; composing it here would move existing documents.
    return this.getLocalTransform(id);
  }

  getWorldTransformInverse(id: ShapeId): Matrix2d {
    return invertMatrix(this.getWorldTransform(id));
  }

  localToPage(id: ShapeId, point: Vec2): Vec2 {
    return applyMatrixToPoint(this.getWorldTransform(id), point);
  }

  pageToLocal(id: ShapeId, point: Vec2): Vec2 {
    return applyMatrixToPoint(this.getWorldTransformInverse(id), point);
  }

  getWorldOutline(id: ShapeId): readonly Vec2[] {
    const geometry = this.getLocalGeometry(id);
    return Object.freeze(geometry.getOutline().map(point => this.localToPage(id, point)));
  }

  getWorldBounds(id: ShapeId): Box2d {
    const geometry = this.getLocalGeometry(id);
    const bounds = geometry.getBounds();
    const corners = [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ].map(point => this.localToPage(id, point));
    return boundsOfPoints(corners);
  }

  getVisualWorldBounds(id: ShapeId): Box2d {
    const shape = this.requireShape(id);
    const bounds = this.getWorldBounds(id);
    const props = shape.props as Record<string, unknown>;
    const stroke = typeof props.strokeWidth === 'string'
      ? STROKE_WIDTHS[props.strokeWidth as SizeStyle] ?? 0
      : 0;
    const arrowhead = shape.type === 'arrow'
      && (props.arrowheadStart === 'arrow' || props.arrowheadEnd === 'arrow') ? 12 : 0;
    const padding = stroke / 2 + arrowhead;
    return makeBox(
      bounds.minX - padding,
      bounds.minY - padding,
      bounds.w + padding * 2,
      bounds.h + padding * 2,
    );
  }

  hitTestPagePoint(id: ShapeId, point: Vec2, marginPx = 0): boolean {
    const shape = this.requireShape(id);
    const localPoint = this.pageToLocal(id, point);
    if (this.host.hitTestLocal(shape, localPoint)) return true;
    if (marginPx <= 0) return false;
    const margin = marginPx / Math.max(this.host.getZoom(), Number.EPSILON);
    const outline = this.host.getGeometry(shape).getOutline();
    const close = shape.type !== 'arrow' && shape.type !== 'freehand';
    const segmentCount = Math.max(0, outline.length - 1) + (close && outline.length > 2 ? 1 : 0);
    for (let index = 0; index < segmentCount; index++) {
      const start = outline[index]!;
      const end = outline[(index + 1) % outline.length]!;
      if (distanceToSegment(localPoint, start, end) <= margin) return true;
    }
    return false;
  }

  normalizedAnchorToPage(id: ShapeId, anchor: Vec2): Vec2 {
    const bounds = this.getLocalGeometry(id).getBounds();
    return this.localToPage(id, {
      x: bounds.minX + bounds.w * anchor.x,
      y: bounds.minY + bounds.h * anchor.y,
    });
  }

  getConnectionAnchors(id: ShapeId): readonly { normalizedAnchor: Vec2; point: Vec2 }[] {
    const anchors = [
      { x: 0.5, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0.5 },
    ];
    return Object.freeze(anchors.map(normalizedAnchor => ({
      normalizedAnchor,
      point: this.normalizedAnchorToPage(id, normalizedAnchor),
    })));
  }

  getClosestConnectionAnchor(id: ShapeId, point: Vec2): { normalizedAnchor: Vec2; point: Vec2 } {
    const anchors = this.getConnectionAnchors(id);
    let closest = anchors[0]!;
    let distance = Number.POSITIVE_INFINITY;
    for (const anchor of anchors) {
      const candidateDistance = Math.hypot(anchor.point.x - point.x, anchor.point.y - point.y);
      if (candidateDistance < distance) {
        closest = anchor;
        distance = candidateDistance;
      }
    }
    return closest;
  }

  getAnchorPageEdge(id: ShapeId, anchor: Vec2): EdgeName {
    const center = this.normalizedAnchorToPage(id, { x: 0.5, y: 0.5 });
    const point = this.normalizedAnchorToPage(id, anchor);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'bottom' : 'top';
  }

  private requireShape(id: ShapeId): GlideShape {
    const shape = this.host.getShape(id);
    if (!shape) throw new Error(`Shape "${id}" not found.`);
    return shape;
  }
}
