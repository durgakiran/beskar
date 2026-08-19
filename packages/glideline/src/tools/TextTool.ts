/**
 * TextTool — click to place a standalone text label (Phase B)
 *
 * FSM: Idle → Placed
 *
 * Idle:
 *   pointerDown on canvas → create text shape at cursor, startEditing
 *   pointerDown on existing text shape → startEditing that shape
 *
 * The tool immediately switches back to the select tool after placing,
 * so the user can click elsewhere to deselect. The inline editor
 * (InlineEditor.tsx in the demo layer) listens to editingShapeId signal.
 */

import { StateNode } from '../state-node.js';
import type { PointerDownEvent } from '../state-node.js';
import type { ShapeId } from '../types.js';

// ─────────────────────────────────────────────────────────────
// Idle
// ─────────────────────────────────────────────────────────────

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(e: PointerDownEvent): void {
    // If clicking directly on an existing text shape, start editing it
    if (e.target === 'shape' && e.shapeId) {
      const shape = this.editor.getShape(e.shapeId);
      if (shape?.type === 'text') {
        this.editor.setCurrentTool('select');
        this.editor.setSelectedShapeIds([e.shapeId]);
        this.editor.startEditing(e.shapeId);
        return;
      }
    }

    // Create a new text shape at click position and start editing
    const newId: ShapeId = this.editor.createShapeId('text');
    this.editor.batch('Create Text', () => {
      this.editor.createShape({
        id:       newId,
        type:     'text',
        x:        e.point.x,
        y:        e.point.y,
        rotation: 0,
        meta:     {},
        props: {
          text:     '',
          textAlign: 'left',
        },
      });
    });

    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([newId]);
    this.editor.startEditing(newId);
  }
}

// ─────────────────────────────────────────────────────────────
// TextTool (root)
// ─────────────────────────────────────────────────────────────

export class TextTool extends StateNode {
  static override readonly id = 'text';
  static override children = () => [Idle];
}
