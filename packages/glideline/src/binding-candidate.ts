import { closestConnectionAnchor } from './connection-anchors.js';
import type { BindingPreviewCandidate, GlideEditor } from './editor.js';
import { makeBox, type ShapeId, type Vec2 } from './types.js';

const SNAP_RADIUS_PX = 12;

/** A nearby visible point wins over a shape body, including an enclosing shape. */
export function resolveBindingCandidate(
  editor: GlideEditor,
  point: Vec2,
  excludedIds: readonly (ShapeId | null)[] = [],
): BindingPreviewCandidate | null {
  const radius = SNAP_RADIUS_PX / editor.camera.getCamera().z;
  const nearby = editor.getShapesInBox(makeBox(point.x - radius, point.y - radius, radius * 2, radius * 2));
  const bodyHits = new Set(editor.getShapesAtPoint(point).map(shape => shape.id));
  let nearest: BindingPreviewCandidate | null = null;
  let nearestDistance = radius;
  let body: BindingPreviewCandidate | null = null;

  // Visit front to back so equal-distance points prefer the visually top shape.
  for (const shape of nearby.reverse()) {
    const id = shape.id as ShapeId;
    if (excludedIds.includes(id)) continue;
    const clips = editor.getClippingFrameAncestors(id);
    const candidateAnchors = editor.transforms.getConnectionAnchors(id).filter(anchor =>
      clips.every(frame => editor.transforms.hitTestPagePoint(frame.id as ShapeId, anchor.point)),
    );
    const anchor = closestConnectionAnchor(candidateAnchors, point);
    if (!anchor) continue;

    const candidate = { ...anchor, targetId: id, targetType: shape.type, candidateAnchors };
    if (!body && bodyHits.has(id)) body = candidate;
    const distance = Math.hypot(anchor.point.x - point.x, anchor.point.y - point.y);
    if (distance <= radius && (!nearest || distance < nearestDistance)) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest ?? body;
}
