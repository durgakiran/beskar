import { effect, signal } from '@preact/signals';
import {
  ArrowPlugin,
  BoxTool,
  DrawTool,
  EllipseTool,
  EllipseUtil,
  EraserTool,
  FreehandUtil,
  GeoShapePlugin,
  HandTool,
  SelectTool,
  StickyNoteTool,
  StickyNoteUtil,
  TextTool,
  TriangleTool,
  DiamondTool,
  HexagonTool,
  StarTool,
  ArrowTool,
  createCanvasToolServer,
  createEditor,
  resolveArrowRoute,
  BoxUtil,
  FrameUtil,
  TextUtil,
  type Box2d,
  type CanvasToolName,
  type GlideDocument,
  type Vec2,
} from '@durgakiran/glideline';
import { bindGlideboardCollaboration } from './collaboration';
import type { GlideboardCollaborationConfig } from './types';

const CoreShapesPlugin = {
  id: 'glideboard-core-shapes',
  shapes: [
    BoxUtil as any,
    TextUtil as any,
    FrameUtil as any,
    EllipseUtil as any,
    StickyNoteUtil as any,
    FreehandUtil as any,
  ],
};

export function createGlideboardEditorInstance() {
  return createEditor({
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
}

export const wbEditor = createGlideboardEditorInstance();

const wbToolServer = createCanvasToolServer(wbEditor);
export const readOnlySignal = signal(false);
export const awarenessSignal = signal<any | null>(null);

/**
 * Set to true while a pointer is captured on the canvas (pointerdown → pointerup).
 * Read by WhiteboardApp's spacebar keyup handler to know whether to defer tool restoration.
 */
export const isCanvasDraggingRef = { current: false };

/**
 * When the spacebar is released while isCanvasDraggingRef is true, the previous tool id
 * is stored here. Canvas.tsx clears it and restores the tool on the next pointerUp.
 */
export const deferredToolRestoreRef = { current: null as string | null };

export type ConnectorPreset = 'line' | 'arrow' | 'double-arrow';
export type ArrowheadStyle = 'none' | 'arrow';
export type ArrowRouteStyle = 'curve' | 'ortho' | 'smart';

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

function setArrowheads(arrowheadStart: ArrowheadStyle, arrowheadEnd: ArrowheadStyle) {
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

function getAllRecordIds() {
  return wbEditor.serialize().records
    .map(record => String(record.id ?? ''))
    .filter(Boolean);
}

export function clearWhiteboardState() {
  const ids = getAllRecordIds();
  if (ids.length > 0) {
    wbEditor.run(() => {
      wbEditor.store.remove(ids);
    }, { history: 'ignore' });
  }
  wbEditor.setSelectedShapeIds([]);
  wbEditor.stopEditing();
  wbEditor.clearBindingPreview();
  wbEditor.camera.setCamera({ x: 0, y: 0, z: 1 });
}

let collaborationCleanup: (() => void) | null = null;

function detachCollaboration() {
  collaborationCleanup?.();
  collaborationCleanup = null;
}

export function initializeGlideboardSession(opts: {
  initialDocument?: GlideDocument | null;
  collaboration?: GlideboardCollaborationConfig | null;
  readOnly?: boolean;
}) {
  detachCollaboration();
  clearWhiteboardState();

  readOnlySignal.value = Boolean(opts.readOnly);

  if (opts.initialDocument) {
    wbEditor.deserialize(opts.initialDocument);
  }

  if (opts.collaboration) {
    collaborationCleanup = bindGlideboardCollaboration(wbEditor, opts.collaboration);
    awarenessSignal.value = opts.collaboration.provider?.awareness || null;
  }

  wbEditor.setCurrentTool(readOnlySignal.value ? 'hand' : 'select');
}

export function teardownGlideboardSession() {
  detachCollaboration();
  clearWhiteboardState();
  readOnlySignal.value = false;
  wbEditor.setCurrentTool('select');
}

declare global {
  interface Window {
    [key: string]: unknown;
  }
}

export function attachDebugApi(debugApiKey: string) {
  if (typeof window === 'undefined' || !debugApiKey) return () => {};

  window[debugApiKey] = {
    reset: clearWhiteboardState,
    setCurrentTool: (id: string) => wbEditor.setCurrentTool(id),
    getCurrentToolId: () => wbEditor.currentToolId.peek(),
    callTool: async (name: CanvasToolName, input: unknown) => wbToolServer.callTool(name, input),
    getToolManifest: () => wbToolServer.generateToolManifest(),
    getAIContext: (opts?: { viewport?: boolean }) => wbEditor.getAIContext(opts),
    takeScreenshot: (box?: Box2d) => wbEditor.takeScreenshot(box),
    select: (ids: string[]) => wbEditor.setSelectedShapeIds(ids as any),
    getSmartRoutingSnapshot: () => wbEditor.getSmartRoutingSnapshot(),
    getArrowRoutePoints: (id: string): Vec2[] | null => {
      const shape = wbEditor.getShape(id as any);
      if (!shape || shape.type !== 'arrow') return null;
      return resolveArrowRoute(wbEditor as any, shape as any).worldPoints;
    },
  };

  return () => {
    delete window[debugApiKey];
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function subscribeToDocumentChanges(
  onDocumentChange: (document: GlideDocument) => void,
  debounceMs = 500,
) {
  const dispose = effect(() => {
    wbEditor.store.getVersionSignal().value;

    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      onDocumentChange(wbEditor.serialize());
    }, debounceMs);
  });
  return () => dispose();
}
