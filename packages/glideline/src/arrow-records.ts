import type { GlideEditor } from './editor';
import { type AnyRecord, type EdgeName, type ShapeId, sid, type Vec2 } from './types';
import { RecordIdService } from './id';
import {
  anchorToEdge,
  type ArrowRouteStyle,
  type ArrowShape,
  type ArrowTerminal,
  type ArrowheadStyle,
} from './shapes/ArrowUtil';

const DEFAULT_CURVE_BEND = 0.3;

export interface ResolvedConnectionTerminal {
  shapeId: ShapeId;
  normalizedAnchor: Vec2;
  point: Vec2;
  fromEdge: 'top' | 'right' | 'bottom' | 'left';
}

export function buildArrowShapeRecord(args: {
  id: ShapeId;
  startWorld: Vec2;
  endWorld: Vec2;
  routeStyle?: ArrowRouteStyle;
  arrowheadStart?: ArrowheadStyle;
  arrowheadEnd?: ArrowheadStyle;
  index?: string;
}): ArrowShape {
  const routeStyle = args.routeStyle ?? 'ortho';
  const arrowheadStart = args.arrowheadStart ?? 'none';
  const arrowheadEnd = args.arrowheadEnd ?? 'arrow';

  return {
    id: args.id,
    type: 'arrow',
    x: args.startWorld.x,
    y: args.startWorld.y,
    index: args.index ?? 'a1',
    rotation: 0,
    parentId: 'page:default' as any,
    isLocked: false,
    isHidden: false,
    meta: {},
    props: {
      start: makeTerminal({ x: 0, y: 0 }),
      end: makeTerminal({
        x: args.endWorld.x - args.startWorld.x,
        y: args.endWorld.y - args.startWorld.y,
      }),
      routeStyle,
      bend: routeStyle === 'curve' ? DEFAULT_CURVE_BEND : 0,
      arrowheadStart,
      arrowheadEnd,
      color: 'black',
      opacity: 1,
      strokeStyle: 'solid',
      strokeWidth: 'medium',
      label: '',
      labelPosition: 0.5,
      labelColor: 'black',
      font: 'sans',
      fontSize: 'md',
    },
  };
}

export function buildArrowBindingRecord(args: {
  id?: string;
  fromId: ShapeId;
  toId: ShapeId;
  terminal: 'start' | 'end';
  normalizedAnchor: Vec2;
  fromEdge?: EdgeName;
}): AnyRecord {
  return {
    ...(args.id ? { id: args.id } : {}),
    type: 'arrow',
    fromId: args.fromId,
    toId: args.toId,
    meta: {},
    props: {
      terminal: args.terminal,
      normalizedAnchor: args.normalizedAnchor,
      fromEdge: args.fromEdge ?? anchorToEdge(args.normalizedAnchor),
    },
  };
}

export function resolveConnectionTerminal(
  editor: GlideEditor,
  shapeId: ShapeId,
  point: Vec2,
): ResolvedConnectionTerminal | null {
  const shape = editor.getShape(shapeId);
  if (!shape) return null;

  const snapped = editor.transforms.getClosestConnectionAnchor(shapeId, point);
  return {
    shapeId,
    normalizedAnchor: snapped.normalizedAnchor,
    point: snapped.point,
    fromEdge: editor.transforms.getAnchorPageEdge(shapeId, snapped.normalizedAnchor),
  };
}

const compatibilityIds = new RecordIdService();

/** @deprecated Prefer editor.createShapeId() so collisions are checked against the board. */
export function createCanvasShapeId(prefix: string): ShapeId {
  return sid(compatibilityIds.create(`shape:${prefix}`));
}

/** @deprecated Shape indices are assigned by GlideEditor.createShape(). */
export function createTopIndex(): string {
  return `z${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeTerminal(point: Vec2, boundShapeId: ShapeId | null = null): ArrowTerminal {
  return {
    boundShapeId,
    normalizedAnchor: { x: 0.5, y: 0.5 },
    point,
  };
}
