import { Geometry2d, Rectangle2d } from '../geometry/index.js';
import { makeBox, type GlideShape, type ShapeId, type Vec2 } from '../types.js';
import { ShapeUtil, type ResizeHandle } from './ShapeUtil.js';

export type GroupShape = GlideShape<Record<string, never>>;

export class GroupUtil extends ShapeUtil<GroupShape> {
  static override readonly type = 'group';
  static override readonly canContainChildren = true;
  static override readonly props = {};

  getDefaultProps(): Record<string, never> { return {}; }

  getGeometry(shape: GroupShape): Geometry2d {
    const children = this.editor.getChildren(shape.id as ShapeId);
    if (children.length === 0) return new Rectangle2d(0, 0, 0, 0);
    const points: Vec2[] = [];
    for (const child of children) {
      for (const point of this.editor.getShapeLocalOutline(child.id as ShapeId)) {
        points.push(this.editor.pageToLocal(shape.id as ShapeId,
          this.editor.localToPage(child.id as ShapeId, point)));
      }
    }
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x));
    const maxY = Math.max(...points.map(point => point.y));
    const bounds = makeBox(minX, minY, maxX - minX, maxY - minY);
    return new Rectangle2d(bounds.x, bounds.y, bounds.w, bounds.h);
  }

  override canContain(): boolean { return true; }
  override hitTestPoint(): boolean { return false; }
  override getResizeHandles(): readonly ResizeHandle[] { return ['nw', 'ne', 'se', 'sw']; }
}
