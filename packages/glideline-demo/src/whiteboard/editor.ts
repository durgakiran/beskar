/**
 * whiteboard/editor.ts
 *
 * Singleton GlideEditor for the Whiteboard tab.
 * Created once, lives for the entire session.
 * Persists to localStorage on every change.
 */

import { createEditor } from '../../../glideline/src/editor';
import { BoxUtil } from '../../../glideline/src/shapes/BoxUtil';
import { TextUtil } from '../../../glideline/src/shapes/TextUtil';
import { FrameUtil } from '../../../glideline/src/shapes/FrameUtil';
import { ArrowPlugin } from '../../../glideline/src/shapes/ArrowUtil';
import { EllipseUtil } from '../../../glideline/src/shapes/EllipseUtil';
import { StickyNoteUtil } from '../../../glideline/src/shapes/StickyNoteUtil';
import { FreehandUtil } from '../../../glideline/src/shapes/FreehandUtil';
import { GeoShapePlugin } from '../../../glideline/src/shapes/GeoShapeUtil';

import { SelectTool } from '../../../glideline/src/tools/SelectTool';
import { BoxTool } from '../../../glideline/src/tools/BoxTool';
import { ArrowTool } from '../../../glideline/src/tools/ArrowTool';
import { HandTool } from '../../../glideline/src/tools/HandTool';
import { EllipseTool } from '../../../glideline/src/tools/EllipseTool';
import { TextTool } from '../../../glideline/src/tools/TextTool';
import { StickyNoteTool } from '../../../glideline/src/tools/StickyNoteTool';
import { DrawTool } from '../../../glideline/src/tools/DrawTool';
import { EraserTool } from '../../../glideline/src/tools/EraserTool';
import { TriangleTool, DiamondTool, HexagonTool, StarTool } from '../../../glideline/src/tools/GeoShapeTools';
import type { ArrowheadStyle, ArrowRouteStyle } from '../../../glideline/src/shapes/ArrowUtil';
import { createCanvasToolServer, type CanvasToolName } from '../../../glideline/src/mcp';
import type { Box2d, Vec2 } from '../../../glideline/src/types';
import { resolveArrowRoute } from '../../../glideline/src/arrow-routing';

import { effect, signal } from '@preact/signals';

// ── Storage key ──────────────────────────────────────────────

const STORAGE_KEY = 'glideline-whiteboard-v1';

// ── Plugin bundles ───────────────────────────────────────────

const CoreShapesPlugin = {
  id: 'core-shapes',
  shapes: [
    BoxUtil as any,
    TextUtil as any,
    FrameUtil as any,
    EllipseUtil as any,
    StickyNoteUtil as any,
    FreehandUtil as any,
  ],
};

// ── Create editor ─────────────────────────────────────────────

export const wbEditor = createEditor({
  plugins: [CoreShapesPlugin, GeoShapePlugin, ArrowPlugin],
  tools: [
    SelectTool,
    BoxTool,
    TriangleTool,
    DiamondTool,
    HexagonTool,
    StarTool,
    ArrowTool,
    HandTool,
    EllipseTool,
    TextTool,
    StickyNoteTool,
    DrawTool,
    EraserTool,
  ],
});
export const wbToolServer = createCanvasToolServer(wbEditor);

declare global {
  interface Window {
    __GLIDELINE_WHITEBOARD__?: {
      reset(): void;
      callTool(name: CanvasToolName, input: unknown): unknown;
      getToolManifest(): unknown;
      getAIContext(opts?: { viewport?: boolean }): unknown;
      takeScreenshot(box?: Box2d): Promise<string>;
      select(ids: string[]): void;
      getSmartRoutingSnapshot(): unknown;
      getArrowRoutePoints(id: string): Vec2[] | null;
    };
  }
}

export type ConnectorPreset = 'line' | 'arrow' | 'double-arrow';

function getConnectorPreset(arrowheadStart: ArrowheadStyle, arrowheadEnd: ArrowheadStyle): ConnectorPreset {
  if (arrowheadStart === 'arrow' && arrowheadEnd === 'arrow') return 'double-arrow';
  if (arrowheadStart === 'none' && arrowheadEnd === 'none') return 'line';
  return 'arrow';
}

function getPresetArrowheads(preset: ConnectorPreset): { arrowheadStart: ArrowheadStyle; arrowheadEnd: ArrowheadStyle } {
  switch (preset) {
    case 'line':
      return { arrowheadStart: 'none', arrowheadEnd: 'none' };
    case 'double-arrow':
      return { arrowheadStart: 'arrow', arrowheadEnd: 'arrow' };
    default:
      return { arrowheadStart: 'none', arrowheadEnd: 'arrow' };
  }
}

export const arrowRouteStyleSignal = signal<ArrowRouteStyle>(wbEditor.arrowRouteStyle);
export const arrowPresetSignal = signal<ConnectorPreset>(getConnectorPreset(wbEditor.arrowheadStart, wbEditor.arrowheadEnd));
export const arrowheadStartSignal = signal<ArrowheadStyle>(wbEditor.arrowheadStart);
export const arrowheadEndSignal = signal<ArrowheadStyle>(wbEditor.arrowheadEnd);

export function setArrowRouteStyle(routeStyle: ArrowRouteStyle) {
  wbEditor.arrowRouteStyle = routeStyle;
  arrowRouteStyleSignal.value = routeStyle;
}

export function setArrowheads(arrowheadStart: ArrowheadStyle, arrowheadEnd: ArrowheadStyle) {
  wbEditor.arrowheadStart = arrowheadStart;
  wbEditor.arrowheadEnd = arrowheadEnd;
  arrowheadStartSignal.value = arrowheadStart;
  arrowheadEndSignal.value = arrowheadEnd;
  arrowPresetSignal.value = getConnectorPreset(arrowheadStart, arrowheadEnd);
}

export function setArrowheadStart(arrowheadStart: ArrowheadStyle) {
  setArrowheads(arrowheadStart, wbEditor.arrowheadEnd);
}

export function setArrowheadEnd(arrowheadEnd: ArrowheadStyle) {
  setArrowheads(wbEditor.arrowheadStart, arrowheadEnd);
}

export function setConnectorPreset(preset: ConnectorPreset) {
  const { arrowheadStart, arrowheadEnd } = getPresetArrowheads(preset);
  setArrowheads(arrowheadStart, arrowheadEnd);
}

function resetWhiteboardState() {
  const ids = wbEditor.getShapes().map(shape => shape.id);
  if (ids.length > 0) {
    wbEditor.run(() => {
      wbEditor.deleteShapes(ids);
    }, { history: 'ignore' });
  }

  wbEditor.setSelectedShapeIds([]);
  wbEditor.stopEditing();
  wbEditor.clearBindingPreview();
  wbEditor.camera.setCamera({ x: 0, y: 0, z: 1 });
  localStorage.removeItem(STORAGE_KEY);
}

if (typeof window !== 'undefined') {
  window.__GLIDELINE_WHITEBOARD__ = {
    reset: resetWhiteboardState,
    callTool: (name, input) => wbToolServer.callTool(name, input),
    getToolManifest: () => wbToolServer.generateToolManifest(),
    getAIContext: (opts) => wbEditor.getAIContext(opts),
    takeScreenshot: (box) => wbEditor.takeScreenshot(box),
    select: (ids) => wbEditor.setSelectedShapeIds(ids as any),
    getSmartRoutingSnapshot: () => wbEditor.getSmartRoutingSnapshot(),
    getArrowRoutePoints: (id) => {
      const shape = wbEditor.getShape(id as any);
      if (!shape || shape.type !== 'arrow') return null;
      return resolveArrowRoute(wbEditor as any, shape as any).worldPoints;
    },
  };
}

// ── Restore from localStorage ─────────────────────────────────

const saved = localStorage.getItem(STORAGE_KEY);
if (saved) {
  try {
    const doc = JSON.parse(saved);
    wbEditor.deserialize(doc);
  } catch (e) {
    console.warn('[Whiteboard] Failed to restore session:', e);
    localStorage.removeItem(STORAGE_KEY);
  }
}

// ── Persist on every shape change ────────────────────────────
// Debounced 500ms to avoid thrashing localStorage on every pointer move.

let persistTimer: ReturnType<typeof setTimeout> | null = null;

effect(() => {
  // Subscribe to version signal — fires on any put/remove
  wbEditor.store.getVersionSignal().value;

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      const doc = wbEditor.serialize();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch (e) {
      console.warn('[Whiteboard] Failed to persist:', e);
    }
  }, 500);
});
