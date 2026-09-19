import type { GlideEditor } from './editor.js';
import type { Box2d, GlideShape, ShapeId } from './types.js';
import type { ArrowShape } from './shapes/ArrowUtil.js';

export interface AIShapeContext {
  id: ShapeId;
  type: string;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface AIConnectionContext {
  id: ShapeId;
  fromId: ShapeId;
  toId: ShapeId;
  label?: string;
  routeStyle: ArrowShape['props']['routeStyle'];
}

export interface AIContextSnapshot {
  shapes: AIShapeContext[];
  connections: AIConnectionContext[];
  viewport: Box2d;
}

export function buildAIContext(
  editor: GlideEditor,
  opts?: { viewport?: boolean },
): AIContextSnapshot {
  const viewport = editor.getViewportBounds();
  const shapes = (opts?.viewport ? editor.getShapesInViewport() : editor.getShapes(true))
    .filter(shape => shape.type !== 'arrow')
    .map(shape => toAIShape(editor, shape))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const visibleShapeIds = new Set(shapes.map(shape => shape.id));
  const connections = editor.getShapes(true)
    .filter(shape => shape.type === 'arrow')
    .map(shape => toAIConnection(editor, shape as ArrowShape))
    .filter((connection): connection is AIConnectionContext => Boolean(connection))
    .filter(connection => visibleShapeIds.has(connection.fromId) && visibleShapeIds.has(connection.toId))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    shapes,
    connections,
    viewport: { ...viewport },
  };
}

function toAIShape(editor: GlideEditor, shape: GlideShape): AIShapeContext {
  const bounds = editor.getShapeWorldBounds(shape.id as ShapeId);
  const label = extractLabel(shape);
  return {
    id: shape.id as ShapeId,
    type: shape.type,
    ...(label ? { label } : {}),
    x: bounds.minX,
    y: bounds.minY,
    w: bounds.w,
    h: bounds.h,
    rotation: shape.rotation,
  };
}

function toAIConnection(editor: GlideEditor, arrow: ArrowShape): AIConnectionContext | null {
  const bindings = editor.getBindingsFromShape(arrow.id as ShapeId);
  const startBinding = bindings.find(binding => (binding as any).props.terminal === 'start');
  const endBinding = bindings.find(binding => (binding as any).props.terminal === 'end');
  if (!startBinding || !endBinding) return null;

  const label = extractLabel(arrow);
  return {
    id: arrow.id as ShapeId,
    fromId: startBinding.toId as ShapeId,
    toId: endBinding.toId as ShapeId,
    ...(label ? { label } : {}),
    routeStyle: arrow.props.routeStyle,
  };
}

function extractLabel(shape: GlideShape): string | undefined {
  const props = shape.props as Record<string, unknown>;
  for (const key of ['label', 'text', 'title', 'name']) {
    const value = props[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}
