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
import type { GlideEditor } from '../editor.js';
import type { PointerDownEvent } from '../state-node.js';
import type { ShapeId, Vec2 } from '../types.js';

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

    TextTool.createAndEdit(this.editor, e.point);
  }
}

export class TextTool extends StateNode {
  static override readonly id = 'text';
  static override children = () => [Idle];

  static createAndEdit(editor: GlideEditor, point: Vec2): void {
    const id = editor.createShapeId('text');
    editor.batch('Create Text', () => {
      editor.createShape({
        id,
        type: 'text',
        x: point.x,
        y: point.y,
        props: {
          text: '',
          textAlign: editor.activeStyles.peek()['standaloneTextAlign'] ?? 'left',
        },
      });
    });

    if (editor.currentToolId.peek() !== 'select') editor.setCurrentTool('select');
    editor.setSelectedShapeIds([id]);
    editor.startEditing(id);
  }
}
