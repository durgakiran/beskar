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

import { SelectTool } from '../../../glideline/src/tools/SelectTool';
import { BoxTool } from '../../../glideline/src/tools/BoxTool';
import { ArrowTool } from '../../../glideline/src/tools/ArrowTool';
import { HandTool } from '../../../glideline/src/tools/HandTool';
import { EllipseTool } from '../../../glideline/src/tools/EllipseTool';
import { TextTool } from '../../../glideline/src/tools/TextTool';
import { StickyNoteTool } from '../../../glideline/src/tools/StickyNoteTool';
import { DrawTool } from '../../../glideline/src/tools/DrawTool';
import { EraserTool } from '../../../glideline/src/tools/EraserTool';

import { effect } from '@preact/signals';

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
  plugins: [CoreShapesPlugin, ArrowPlugin],
  tools: [
    SelectTool,
    BoxTool,
    ArrowTool,
    HandTool,
    EllipseTool,
    TextTool,
    StickyNoteTool,
    DrawTool,
    EraserTool,
  ],
});

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
