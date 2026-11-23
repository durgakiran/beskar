import { closestConnectionAnchor } from './connection-anchors.js';
import type { BindingPreviewCandidate, GlideEditor } from './editor.js';
import { makeBox, type ShapeId, type Vec2 } from './types.js';

const SNAP_RADIUS_PX = 12;

function enclosesEndpoint(editor: GlideEditor, targetId: ShapeId, endpointId: ShapeId | null): boolean {
  if (!endpointId || !editor.getShape(endpointId)) return false;
  if (editor.getAncestors(endpointId).some(shape => shape.id === targetId)) return true;

  // Shapes can also enclose one another without being parented.
  const outline = editor.transforms.getWorldOutline(endpointId);
  const geometry = editor.transforms.getLocalGeometry(targetId);
  return outline.length > 0 && outline.every(point => geometry.hitTestPoint(editor.pageToLocal(targetId, point)));
}

/** A nearby visible point wins over a shape body, including an enclosing shape. */
export function resolveBindingCandidate(
  editor: GlideEditor,
  point: Vec2,
  { oppositeTargetId = null, connectorId }: { oppositeTargetId?: ShapeId | null; connectorId?: ShapeId } = {},
): BindingPreviewCandidate | null {
  const radius = SNAP_RADIUS_PX / editor.camera.getCamera().z;
  const nearby = editor.getShapesInBox(makeBox(point.x - radius, point.y - radius, radius * 2, radius * 2));
  const bodyHits = new Set(editor.getShapesAtPoint(point).map(shape => shape.id));
  let nearest: BindingPreviewCandidate | null = null;
  let nearestDistance = radius;
  let edge: BindingPreviewCandidate | null = null;
  let edgeDistance = radius;
  let body: BindingPreviewCandidate | null = null;

  // Visit front to back so equal-distance points prefer the visually top shape.
  for (const shape of nearby.reverse()) {
    const id = shape.id as ShapeId;
    if (id === oppositeTargetId || id === connectorId) continue;
    const anchors = editor.transforms.getConnectionAnchors(id);
    if (anchors.length === 0) continue;
    const clips = editor.getClippingFrameAncestors(id);
    const isVisible = (anchor: { point: Vec2 }) =>
      clips.every(frame => editor.transforms.hitTestPagePoint(frame.id as ShapeId, anchor.point));
    const candidateAnchors = anchors.filter(isVisible);
    const anchor = closestConnectionAnchor(candidateAnchors, point);
    const target = { targetId: id, targetType: shape.type, candidateAnchors };
    const distance = anchor ? Math.hypot(anchor.point.x - point.x, anchor.point.y - point.y) : Infinity;
    if (anchor && distance <= radius) {
      if (!nearest || distance < nearestDistance) {
        nearest = { ...target, ...anchor };
        nearestDistance = distance;
      }
    } else if (!nearest && enclosesEndpoint(editor, id, oppositeTargetId)) {
      // The enclosing body stays free, but the border between fixed anchors can bind.
      const outlineAnchor = editor.transforms.getClosestOutlineAnchor(id, point);
      if (outlineAnchor && isVisible(outlineAnchor)) {
        const distance = Math.hypot(outlineAnchor.point.x - point.x, outlineAnchor.point.y - point.y);
        if (distance <= radius && (!edge || distance < edgeDistance)) {
          edge = { ...target, ...outlineAnchor };
          edgeDistance = distance;
        }
      }
    } else if (anchor && !body && bodyHits.has(id)) {
      body = { ...target, ...anchor };
    }
  }

  return nearest ?? edge ?? body;
}
