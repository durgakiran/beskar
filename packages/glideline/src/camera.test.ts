/**
 * Unit tests: GlideCamera — Coordinate Engine (Story 2.1)
 * Covers spec test IDs: T2.1-01 through T2.1-06
 */

import { describe, it, expect } from 'vitest';
import { effect } from '@preact/signals';
import { GlideCamera, MIN_ZOOM, MAX_ZOOM } from './camera';

// ─────────────────────────────────────────────────────────────
// T2.1-01 Round-trip precision
// ─────────────────────────────────────────────────────────────

describe('T2.1-01: pageToScreen(screenToPage(pt)) round-trips with < 0.001px error', () => {
  it('round-trips at standard zoom', () => {
    const cam = new GlideCamera({ x: 100, y: 50, z: 2 }, 1000, 600);
    const original = { x: 450, y: 300 };
    const screen = cam.pageToScreen(original);
    const back   = cam.screenToPage(screen);
    expect(Math.abs(back.x - original.x)).toBeLessThan(0.001);
    expect(Math.abs(back.y - original.y)).toBeLessThan(0.001);
  });

  it('round-trips with fractional zoom', () => {
    const cam = new GlideCamera({ x: -50, y: 30, z: 0.75 }, 800, 500);
    const pts = [
      { x: 0, y: 0 },
      { x: 999, y: -999 },
      { x: 12345, y: 6789 },
    ];
    for (const pt of pts) {
      const back = cam.screenToPage(cam.pageToScreen(pt));
      expect(Math.abs(back.x - pt.x)).toBeLessThan(0.001);
      expect(Math.abs(back.y - pt.y)).toBeLessThan(0.001);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// T2.1-02 Zoom clamped low
// ─────────────────────────────────────────────────────────────

describe('T2.1-02: zoom clamped to MIN_ZOOM when set below minimum', () => {
  it('setCamera({z:0.001}) → getCamera().z === MIN_ZOOM (0.1)', () => {
    const cam = new GlideCamera();
    cam.setCamera({ z: 0.001 });
    expect(cam.getCamera().z).toBe(MIN_ZOOM);
  });

  it('setCamera({z:0}) → clamped to MIN_ZOOM', () => {
    const cam = new GlideCamera();
    cam.setCamera({ z: 0 });
    expect(cam.getCamera().z).toBe(MIN_ZOOM);
  });

  it('constructor clamps initial z below minimum', () => {
    const cam = new GlideCamera({ z: 0.001 });
    expect(cam.getCamera().z).toBe(MIN_ZOOM);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.1-03 Zoom clamped high
// ─────────────────────────────────────────────────────────────

describe('T2.1-03: zoom clamped to MAX_ZOOM when set above maximum', () => {
  it('setCamera({z:100}) → getCamera().z === MAX_ZOOM (8.0)', () => {
    const cam = new GlideCamera();
    cam.setCamera({ z: 100 });
    expect(cam.getCamera().z).toBe(MAX_ZOOM);
  });

  it('setCamera({z:Infinity}) → clamped to MAX_ZOOM', () => {
    const cam = new GlideCamera();
    cam.setCamera({ z: Infinity });
    expect(cam.getCamera().z).toBe(MAX_ZOOM);
  });

  it('constructor clamps initial z above maximum', () => {
    const cam = new GlideCamera({ z: 999 });
    expect(cam.getCamera().z).toBe(MAX_ZOOM);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.1-04 Camera signal fires exactly once per setCamera()
// ─────────────────────────────────────────────────────────────

describe('T2.1-04: camera signal fires exactly once per setCamera()', () => {
  it('single setCamera fires subscriber once', () => {
    const cam = new GlideCamera();
    let callCount = 0;
    const cleanup = effect(() => {
      cam.signal.value; // subscribe
      callCount++;
    });
    callCount = 0; // reset the initial effect run

    cam.setCamera({ z: 2 });
    expect(callCount).toBe(1);
    cleanup();
  });

  it('setCamera with multiple fields fires subscriber once', () => {
    const cam = new GlideCamera();
    let callCount = 0;
    const cleanup = effect(() => {
      cam.signal.value;
      callCount++;
    });
    callCount = 0;

    cam.setCamera({ x: 50, y: 100, z: 1.5 });
    expect(callCount).toBe(1);
    cleanup();
  });

  it('setCamera with no change does NOT fire subscriber', () => {
    const cam = new GlideCamera({ x: 0, y: 0, z: 1 });
    let callCount = 0;
    const cleanup = effect(() => {
      cam.signal.value;
      callCount++;
    });
    callCount = 0;

    cam.setCamera({ x: 0, y: 0, z: 1 }); // no change
    expect(callCount).toBe(0);
    cleanup();
  });
});

// ─────────────────────────────────────────────────────────────
// T2.1-05 getViewportBounds() returns correct Box2d
// ─────────────────────────────────────────────────────────────

describe('T2.1-05: getViewportBounds() returns correct Box2d for camera + viewport', () => {
  it('camera {x:0,y:0,z:1}, window 1000×600 → bounds {x:0,y:0,w:1000,h:600}', () => {
    const cam = new GlideCamera({ x: 0, y: 0, z: 1 }, 1000, 600);
    const bounds = cam.getViewportBounds();
    expect(bounds.w).toBeCloseTo(1000, 2);
    expect(bounds.h).toBeCloseTo(600, 2);
    expect(bounds.x).toBeCloseTo(0, 2);
    expect(bounds.y).toBeCloseTo(0, 2);
  });

  it('panned camera: viewport bounds shift by pan amount', () => {
    const cam = new GlideCamera({ x: 200, y: 100, z: 1 }, 800, 600);
    const bounds = cam.getViewportBounds();
    expect(bounds.x).toBeCloseTo(200, 1);
    expect(bounds.y).toBeCloseTo(100, 1);
    expect(bounds.w).toBeCloseTo(800, 1);
    expect(bounds.h).toBeCloseTo(600, 1);
  });

  it('2× zoom: viewport covers half the page area', () => {
    const cam = new GlideCamera({ x: 0, y: 0, z: 2 }, 1000, 600);
    const bounds = cam.getViewportBounds();
    // At 2× zoom the viewport shows half the world units
    expect(bounds.w).toBeCloseTo(500, 1);
    expect(bounds.h).toBeCloseTo(300, 1);
  });

  it('minX/maxX/minY/maxY are populated correctly', () => {
    const cam = new GlideCamera({ x: 0, y: 0, z: 1 }, 400, 300);
    const bounds = cam.getViewportBounds();
    expect(bounds.minX).toBeCloseTo(bounds.x, 2);
    expect(bounds.minY).toBeCloseTo(bounds.y, 2);
    expect(bounds.maxX).toBeCloseTo(bounds.x + bounds.w, 2);
    expect(bounds.maxY).toBeCloseTo(bounds.y + bounds.h, 2);
  });
});

// ─────────────────────────────────────────────────────────────
// T2.1-06 Precision at extreme zoom — coordinate centering
// ─────────────────────────────────────────────────────────────

describe('T2.1-06: coordinate centering prevents drift at extreme zoom', () => {
  it('z=MIN_ZOOM (0.1), shape at (1e6,1e6): round-trip error < 0.1 page units', () => {
    // Use minimum clamped zoom (0.1) — as extreme as the system allows
    const cam = new GlideCamera({ x: 0, y: 0, z: MIN_ZOOM }, 1000, 600);
    const pt = { x: 1e6, y: 1e6 };
    const back = cam.screenToPage(cam.pageToScreen(pt));
    expect(Math.abs(back.x - pt.x)).toBeLessThan(0.1);
    expect(Math.abs(back.y - pt.y)).toBeLessThan(0.1);
  });

  it('large negative coordinates also round-trip cleanly', () => {
    const cam = new GlideCamera({ x: -5e5, y: -5e5, z: MIN_ZOOM }, 1000, 600);
    const pt = { x: -1e6, y: -1e6 };
    const back = cam.screenToPage(cam.pageToScreen(pt));
    expect(Math.abs(back.x - pt.x)).toBeLessThan(0.1);
    expect(Math.abs(back.y - pt.y)).toBeLessThan(0.1);
  });

  it('naive formula would fail but coordinate centering passes', () => {
    // Coordinate centering keeps intermediate numbers small,
    // so we can verify the approach works for very large world coords + small zoom.
    const cam = new GlideCamera({ x: 0, y: 0, z: MIN_ZOOM }, 1920, 1080);
    for (const coord of [1e5, 5e5, 1e6]) {
      const pt = { x: coord, y: coord };
      const back = cam.screenToPage(cam.pageToScreen(pt));
      expect(Math.abs(back.x - pt.x)).toBeLessThan(0.1);
      expect(Math.abs(back.y - pt.y)).toBeLessThan(0.1);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Additional: setCamera partial updates preserve other fields
// ─────────────────────────────────────────────────────────────

describe('setCamera partial update', () => {
  it('updating only z leaves x and y unchanged', () => {
    const cam = new GlideCamera({ x: 100, y: 200, z: 1 });
    cam.setCamera({ z: 2 });
    const { x, y, z } = cam.getCamera();
    expect(x).toBe(100);
    expect(y).toBe(200);
    expect(z).toBe(2);
  });

  it('updating only x/y leaves z unchanged', () => {
    const cam = new GlideCamera({ x: 0, y: 0, z: 3 });
    cam.setCamera({ x: 50, y: -25 });
    expect(cam.getCamera().z).toBe(3);
  });
});
