/**
 * HandTool — pan the canvas by dragging (Phase B)
 *
 * FSM: Idle → Panning
 *
 * Idle:
 *   pointerDown → transition to Panning, capture camera origin
 *
 * Panning:
 *   pointerMove → update camera x/y relative to drag delta (in page space)
 *   pointerUp   → commit final camera position, back to Idle
 *   Escape      → cancel, restore original camera position
 *
 * The camera is mutated directly (no history entry) because panning is
 * not an undoable action — it only changes the viewport, not shape data.
 */

import { StateNode } from '../state-node';
import type { PointerDownEvent, PointerMoveEvent, PointerUpEvent, KeyDownEvent } from '../state-node';
import type { Vec2 } from '../types';
import type { CameraState } from '../camera';

// ─────────────────────────────────────────────────────────────
// Idle
// ─────────────────────────────────────────────────────────────

class Idle extends StateNode {
  static override readonly id = 'idle';

  override onPointerDown(e: PointerDownEvent): void {
    this.parent!.transition('panning', e);
  }
}

// ─────────────────────────────────────────────────────────────
// Panning
// ─────────────────────────────────────────────────────────────

class Panning extends StateNode {
  static override readonly id = 'panning';

  /** Page-space pointer position when pan started. */
  private _startPagePt!: Vec2;
  /** Screen-space pointer position when pan started. */
  private _startScreenPt: Vec2 | undefined;
  /** Camera state at pan start. */
  private _startCamera!: CameraState;

  override onEnter(info: PointerDownEvent): void {
    this._startPagePt = info.point;           // already in page space
    this._startScreenPt = info.screenPoint;
    this._startCamera = { ...this.editor.camera.getCamera() };
  }

  override onPointerMove(e: PointerMoveEvent): void {
    // Invariant: the page point under the cursor must stay fixed.
    // If the cursor moves right by Δ page units, the camera origin moves right by Δ too —
    // but we want the canvas to pan RIGHT (feel of dragging the canvas), so we subtract.
    let dx = 0;
    let dy = 0;

    if (e.screenPoint && this._startScreenPt) {
      const dxScreen = e.screenPoint.x - this._startScreenPt.x;
      const dyScreen = e.screenPoint.y - this._startScreenPt.y;
      dx = dxScreen / this._startCamera.z;
      dy = dyScreen / this._startCamera.z;
    } else {
      dx = e.point.x - this._startPagePt.x;
      dy = e.point.y - this._startPagePt.y;
    }

    this.editor.camera.setCamera({
      x: this._startCamera.x - dx,
      y: this._startCamera.y - dy,
    });
  }

  override onPointerUp(_e: PointerUpEvent): void {
    this.parent!.transition('idle');
  }

  override onKeyDown(e: KeyDownEvent): void {
    if (e.key === 'Escape') {
      this.editor.camera.setCamera(this._startCamera);
      this.parent!.transition('idle');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// HandTool (root)
// ─────────────────────────────────────────────────────────────

export class HandTool extends StateNode {
  static override readonly id = 'hand';
  static override children = () => [Idle, Panning];
}
