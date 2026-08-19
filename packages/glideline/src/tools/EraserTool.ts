/**
 * EraserTool — delete shapes by dragging over them (Phase B)
 *
 * FSM: Idle → Erasing
 *
 * Idle:
 *   pointerDown → transition to Erasing, hit-test the initial point
 *
 * Erasing:
 *   pointerMove → hit-test each new point, accumulate erased IDs
 *   pointerUp   → deleteShapes(erasedIds) as single batch, back to Idle
 *   Escape      → cancel without deleting, back to Idle
 *
 * Hit-tested shapes are marked in erasedSet to avoid redundant queries.
 * The demo layer can read `eraser.current.erasedIds` to highlight shapes
 * being erased (visual feedback before commit).
 */

import { StateNode } from '../state-node.js';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node.js';
import type { ShapeId } from '../types.js';

// ─────────────────────────────────────────────────────────────
// Idle
// ─────────────────────────────────────────────────────────────

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(e: PointerDownEvent): void {
    this.parent!.transition('erasing', e);
  }
}

// ─────────────────────────────────────────────────────────────
// Erasing
// ─────────────────────────────────────────────────────────────

class Erasing extends StateNode {
  static override readonly id = 'erasing';

  /** Accumulates IDs of shapes hit so far. Public for demo-layer highlight. */
  erasedIds: Set<ShapeId> = new Set();

  override onEnter(info: PointerDownEvent): void {
    this.erasedIds = new Set();
    this._hitTest(info.point);
  }

  override onPointerMove(e: PointerMoveEvent): void {
    this._hitTest(e.point);
  }

  override onPointerUp(_e: PointerUpEvent): void {
    if (this.erasedIds.size > 0) {
      this.editor.batch('Erase Shapes', () => {
        this.editor.deleteShapes(Array.from(this.erasedIds));
      });
    }
    this.erasedIds = new Set();
    this.editor.erasingShapeIds.value = new Set();
    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      // Cancel: shapes are not deleted
      this.erasedIds = new Set();
      this.editor.erasingShapeIds.value = new Set();
      this.parent!.transition('idle');
    }
  }

  private _hitTest(point: { x: number; y: number }): void {
    const hits = this.editor.getShapesAtPoint(point);
    let changed = false;
    for (const shape of hits) {
      const id = this.editor.getSelectableShapeId(shape.id as ShapeId);
      if (id && !this.editor.isShapeEffectivelyLocked(id) && !this.erasedIds.has(id)) {
        this.erasedIds.add(id);
        changed = true;
      }
    }
    // Only update the signal when new shapes are added (avoids redundant renders)
    if (changed) {
      this.editor.erasingShapeIds.value = new Set(this.erasedIds);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// EraserTool (root)
// ─────────────────────────────────────────────────────────────

export class EraserTool extends StateNode {
  static override readonly id = 'eraser';
  static override children = () => [Idle, Erasing];
}
