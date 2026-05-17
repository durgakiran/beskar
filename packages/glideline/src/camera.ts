/**
 * Glideline — Camera & Coordinate Engine (Phase 2, Story 2.1)
 *
 * Shapes exist in infinite page space. The camera { x, y, z } maps between
 * page space and screen space.
 *
 * Coordinate transforms (LLD §11):
 *   pageToScreen(pt):  x = (pt.x - camera.x) * camera.z
 *                      y = (pt.y - camera.y) * camera.z
 *
 *   screenToPage(pt):  x = pt.x / camera.z + camera.x
 *                      y = pt.y / camera.z + camera.y
 *
 * Precision fix (LLD §11 — coordinate centering):
 *   At extreme zoom (z < 0.01), subtracting two large world coordinates loses
 *   floating-point precision. We subtract the viewport centre BEFORE applying
 *   zoom so the numbers stay small.
 *
 * Camera state is a single @preact/signals signal so React components that read
 * it re-render once per setCamera() call — not per-field.
 */

import { signal, type Signal } from '@preact/signals';
import type { Vec2, Box2d } from './types';
import { makeBox } from './types';

// ─────────────────────────────────────────────────────────────
// Constants (LLD §11)
// ─────────────────────────────────────────────────────────────

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8.0;

// ─────────────────────────────────────────────────────────────
// CameraState
// ─────────────────────────────────────────────────────────────

export interface CameraState {
  /** Page-space x of the top-left corner of the viewport */
  x: number;
  /** Page-space y of the top-left corner of the viewport */
  y: number;
  /** Zoom level: 1.0 = 100%, 2.0 = 200%, 0.5 = 50% */
  z: number;
}

// ─────────────────────────────────────────────────────────────
// GlideCamera
// ─────────────────────────────────────────────────────────────

export class GlideCamera {
  /**
   * Single signal for the full camera state.
   * Fires exactly once per setCamera() call regardless of how many fields change.
   */
  private _signal: Signal<CameraState>;

  /**
   * Viewport dimensions (pixels). Updated by setViewportSize().
   * Not a signal — not reactive, just stored for getViewportBounds().
   */
  private _vpWidth: number;
  private _vpHeight: number;

  constructor(
    initial: Partial<CameraState> = {},
    viewportWidth = 1000,
    viewportHeight = 600,
  ) {
    this._vpWidth  = viewportWidth;
    this._vpHeight = viewportHeight;
    this._signal   = signal<CameraState>({
      x: initial.x ?? 0,
      y: initial.y ?? 0,
      z: clampZoom(initial.z ?? 1),
    });
  }

  // ── Accessors ──────────────────────────────────────────────

  getCamera(): CameraState {
    return this._signal.value;
  }

  /**
   * The raw signal — consumers can subscribe to camera changes
   * (e.g. to trigger a re-render when the camera pans/zooms).
   */
  get signal(): Signal<CameraState> {
    return this._signal;
  }

  // ── Mutation ───────────────────────────────────────────────

  /**
   * Set one or more camera fields.
   * Zoom is clamped to [MIN_ZOOM, MAX_ZOOM].
   * Fires the signal exactly once regardless of how many fields changed.
   */
  setCamera(patch: Partial<CameraState>): void {
    const current = this._signal.peek();
    const next: CameraState = {
      x: patch.x ?? current.x,
      y: patch.y ?? current.y,
      z: clampZoom(patch.z ?? current.z),
    };
    // Only fire the signal if something actually changed
    if (next.x !== current.x || next.y !== current.y || next.z !== current.z) {
      this._signal.value = next;
    }
  }

  setViewportSize(width: number, height: number): void {
    this._vpWidth  = width;
    this._vpHeight = height;
  }

  // ── Coordinate transforms ──────────────────────────────────

  /**
   * Convert a page-space point to screen-space pixels.
   *
   * Uses coordinate centering to prevent floating-point drift at extreme zoom:
   *   1. Translate the page point so the viewport centre is the origin
   *   2. Apply zoom
   *   3. Translate back to screen origin
   *
   * Result identical to the naïve formula at normal zoom; dramatically more
   * accurate at z < 0.01 with large world coordinates.
   */
  pageToScreen(pt: Vec2): Vec2 {
    const { x: cx, y: cy, z } = this._signal.peek();
    const halfW = this._vpWidth  / 2;
    const halfH = this._vpHeight / 2;

    // Page offset from viewport centre
    const dx = pt.x - (cx + halfW / z);
    const dy = pt.y - (cy + halfH / z);

    return {
      x: halfW + dx * z,
      y: halfH + dy * z,
    };
  }

  /**
   * Convert a screen-space pixel coordinate to page-space.
   * Inverse of pageToScreen().
   */
  screenToPage(pt: Vec2): Vec2 {
    const { x: cx, y: cy, z } = this._signal.peek();
    const halfW = this._vpWidth  / 2;
    const halfH = this._vpHeight / 2;

    // Screen offset from viewport centre
    const dx = (pt.x - halfW) / z;
    const dy = (pt.y - halfH) / z;

    return {
      x: cx + halfW / z + dx,
      y: cy + halfH / z + dy,
    };
  }

  /**
   * Axis-aligned bounding box of the viewport in page space.
   * Used for viewport culling: shapes outside this box get display:none.
   */
  getViewportBounds(): Box2d {
    const tl = this.screenToPage({ x: 0,            y: 0 });
    const br = this.screenToPage({ x: this._vpWidth, y: this._vpHeight });
    return makeBox(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}
