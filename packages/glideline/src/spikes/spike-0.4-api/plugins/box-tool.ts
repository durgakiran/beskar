/**
 * Spike 0.4 — BoxTool
 *
 * Demonstrates the StateNode FSM pattern for a drawing tool.
 *
 * States:
 *   Idle → onPointerDown → Pointing
 *   Pointing → onPointerMove (moved > threshold) → Drawing
 *   Drawing → onPointerUp → commit box → Idle
 *   Pointing/Drawing → Escape → Idle
 */

import { StateNode, type PointerInfo, type GlidePlugin } from "../types.js";
import { sid } from "../types.js";

const DRAG_THRESHOLD = 4; // pixels

// ─────────────────────────────────────────────────────────────
// Child states
// ─────────────────────────────────────────────────────────────

class Idle extends StateNode {
  static readonly id = "idle";

  onPointerDown(info: PointerInfo): void {
    this.parent.transition("pointing", info);
  }
}

class Pointing extends StateNode {
  static readonly id = "pointing";

  private origin!: { x: number; y: number };

  onEnter(info: PointerInfo): void {
    this.origin = this.editor.screenToPage(info.point);
  }

  onPointerMove(info: PointerInfo): void {
    const current = this.editor.screenToPage(info.point);
    const dx = current.x - this.origin.x;
    const dy = current.y - this.origin.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      this.parent.transition("drawing", { origin: this.origin, current });
    }
  }

  onPointerUp(_info: PointerInfo): void {
    // Too small to be a drag — cancel
    this.parent.transition("idle");
  }

  onKeyDown(key: string): void {
    if (key === "Escape") this.parent.transition("idle");
  }
}

class Drawing extends StateNode {
  static readonly id = "drawing";

  private origin!: { x: number; y: number };
  private pendingId?: ReturnType<typeof sid>;

  onEnter(info: { origin: { x: number; y: number }; current: { x: number; y: number } }): void {
    this.origin = info.origin;

    // Create shape immediately so user sees live preview
    const x = Math.min(this.origin.x, info.current.x);
    const y = Math.min(this.origin.y, info.current.y);
    const w = Math.abs(info.current.x - this.origin.x) || 1;
    const h = Math.abs(info.current.y - this.origin.y) || 1;

    this.pendingId = this.editor.createShape({
      id: sid(`shape:box:${Date.now()}`),
      type: "box",
      x, y, rotation: 0, index: "a1",
      props: { w, h, color: "#3b82f6", label: "" },
      meta: {},
    });
  }

  onPointerMove(info: PointerInfo): void {
    if (!this.pendingId) return;
    const current = this.editor.screenToPage(info.point);
    const x = Math.min(this.origin.x, current.x);
    const y = Math.min(this.origin.y, current.y);
    const w = Math.abs(current.x - this.origin.x) || 1;
    const h = Math.abs(current.y - this.origin.y) || 1;

    this.editor.updateShape(this.pendingId, {
      x, y, props: { w, h, color: "#3b82f6", label: "" },
    });
  }

  onPointerUp(_info: PointerInfo): void {
    // Commit — add to history as named entry
    this.editor.batch("Create box", () => {
      // Shape already in store — nothing else to do
    });
    this.pendingId = undefined;
    this.parent.transition("idle");
  }

  onKeyDown(key: string): void {
    if (key === "Escape") {
      // Delete the preview shape
      if (this.pendingId) {
        this.editor.deleteShapes([this.pendingId]);
        this.pendingId = undefined;
      }
      this.parent.transition("idle");
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Root tool
// ─────────────────────────────────────────────────────────────

export class BoxTool extends StateNode {
  static readonly id = "box";
  static readonly children = () => [Idle, Pointing, Drawing];
  static readonly initial = "idle";
}

// ── Plugin ──────────────────────────────────────────────────

export const BoxToolPlugin: GlidePlugin = {
  id: "glideline/box-tool",
  tools: [BoxTool],
};
