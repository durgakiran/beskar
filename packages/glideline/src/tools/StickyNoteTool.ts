/**
 * StickyNoteTool — click to place a sticky note (Phase B)
 *
 * FSM: Idle
 *
 * Idle:
 *   pointerDown on canvas → create sticky note at cursor, startEditing
 *   pointerDown on existing sticky-note → startEditing that shape
 *
 * The sticky note is created with default dimensions (200×200).
 * The demo layer's InlineEditor handles the actual text input.
 */

import { StateNode } from '../state-node';
import type { PointerDownEvent } from '../state-node';
import type { ShapeId } from '../types';

// ─────────────────────────────────────────────────────────────
// Idle
// ─────────────────────────────────────────────────────────────

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(e: PointerDownEvent): void {
    // Clicking on an existing sticky note → start editing it
    if (e.target === 'shape' && e.shapeId) {
      const shape = this.editor.getShape(e.shapeId);
      if (shape?.type === 'sticky-note') {
        this.editor.setCurrentTool('select');
        this.editor.setSelectedShapeIds([e.shapeId]);
        this.editor.startEditing(e.shapeId);
        return;
      }
    }

    // Place a new sticky note centred on click
    const newId: ShapeId = this.editor.createShapeId('sticky-note');
    const W = 200;
    const H = 200;

    this.editor.batch('Create Sticky Note', () => {
      this.editor.createShape({
        id:       newId,
        type:     'sticky-note',
        x:        e.point.x - W / 2,
        y:        e.point.y - H / 2,
        rotation: 0,
        meta:     {},
        props: {
          w:         W,
          h:         H,
          color:     'yellow',
          opacity:   1,
          text:      '',
          font:      'sans',
          fontSize:  'md',
          textAlign: 'left',
          textColor: '#1e1e1e',
        },
      });
    });

    this.editor.setCurrentTool('select');
    this.editor.setSelectedShapeIds([newId]);
    this.editor.startEditing(newId);
  }
}

// ─────────────────────────────────────────────────────────────
// StickyNoteTool (root)
// ─────────────────────────────────────────────────────────────

export class StickyNoteTool extends StateNode {
  static override readonly id = 'sticky-note';
  static override children = () => [Idle];
}
