import { StateNode } from '../state-node';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node';
import type { ShapeId, Vec2 } from '../types';
import { sid } from '../types';

const DRAG_THRESHOLD = 4;

type GeoShapeToolClass = typeof BaseGeoShapeTool & {
  id: string;
  shapeType: string;
};

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function getToolClass(node: StateNode): GeoShapeToolClass {
  return (node.parent?.constructor ?? node.constructor) as GeoShapeToolClass;
}

function getPreviewId(node: StateNode): ShapeId {
  return sid(`__${getToolClass(node).shapeType}-preview__`);
}

function makeShape(node: StateNode, id: ShapeId, x: number, y: number, w: number, h: number) {
  const shapeType = getToolClass(node).shapeType;
  const util = node.editor.getShapeUtil(shapeType as any) as any;
  return {
    id,
    type: shapeType,
    x: Math.min(x, x + w),
    y: Math.min(y, y + h),
    index: 'a1',
    rotation: 0,
    meta: {},
    props: {
      ...util.getDefaultProps(),
      w: Math.max(1, Math.abs(w)),
      h: Math.max(1, Math.abs(h)),
    },
  };
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

  override onEnter(info: PointerDownEvent): void {
    this._origin = info.point;
  }

  override onPointerMove(e: PointerMoveEvent): void {
    if (dist(this._origin, e.point) > DRAG_THRESHOLD) {
      this.parent!.transition('drawing', { origin: this._origin, current: e.point });
    }
  }

  override onPointerUp(): void {
    this.parent!.transition('idle');
  }
}

class Drawing extends StateNode {
  static override readonly id = 'drawing';

  private _origin!: Vec2;

  override onEnter(info: { origin: Vec2; current: Vec2 }): void {
    this._origin = info.origin;
    const w = info.current.x - info.origin.x;
    const h = info.current.y - info.origin.y;

    this.editor.history.batch('Geo Shape Preview', () => {
      this.editor.createShape(makeShape(this, getPreviewId(this), info.origin.x, info.origin.y, w, h));
    }, { history: 'ignore' });
  }

  override onPointerMove(e: PointerMoveEvent): void {
    const w = e.point.x - this._origin.x;
    const h = e.point.y - this._origin.y;

    this.editor.history.batch('Geo Shape Preview Update', () => {
      this.editor.updateShape(getPreviewId(this), {
        x: Math.min(this._origin.x, this._origin.x + w),
        y: Math.min(this._origin.y, this._origin.y + h),
        props: {
          w: Math.max(1, Math.abs(w)),
          h: Math.max(1, Math.abs(h)),
        },
      });
    }, { history: 'ignore' });
  }

  override onPointerUp(e: PointerUpEvent): void {
    const w = e.point.x - this._origin.x;
    const h = e.point.y - this._origin.y;
    const shapeType = getToolClass(this).shapeType;
    const finalId = sid(`${shapeType}-${Date.now()}`);

    this.editor.history.batch('Geo Shape Preview Cleanup', () => {
      this.editor.deleteShapes([getPreviewId(this)]);
    }, { history: 'ignore' });

    this.editor.history.batch(`Create ${shapeType}`, () => {
      this.editor.createShape(makeShape(this, finalId, this._origin.x, this._origin.y, w, h));
    });

    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([finalId]);
    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.history.batch('Geo Shape Preview Cleanup', () => {
        this.editor.deleteShapes([getPreviewId(this)]);
      }, { history: 'ignore' });
      this.parent!.transition('idle');
    }
  }
}

abstract class BaseGeoShapeTool extends StateNode {
  static readonly shapeType: string;
  static override children = () => [Idle, Pointing, Drawing];
}

export class TriangleTool extends BaseGeoShapeTool {
  static override readonly id = 'triangle';
  static override readonly shapeType = 'triangle';
}

export class DiamondTool extends BaseGeoShapeTool {
  static override readonly id = 'diamond';
  static override readonly shapeType = 'diamond';
}

export class HexagonTool extends BaseGeoShapeTool {
  static override readonly id = 'hexagon';
  static override readonly shapeType = 'hexagon';
}

export class StarTool extends BaseGeoShapeTool {
  static override readonly id = 'star';
  static override readonly shapeType = 'star';
}

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
