/**
 * whiteboard/WhiteboardApp.tsx
 *
 * Root component for the Whiteboard tab.
 * Composes: Canvas, Toolbar, ZoomWidget.
 * Handles:
 *  - Global keyboard shortcuts (tool switching)
 *  - Active-tool signal tracking (for Toolbar highlight)
 *  - Persistence status indicator
 */

import React from 'react';
import { wbEditor } from './editor';
import { Canvas, InlineEditor } from './Canvas';
import { Toolbar } from './Toolbar';
import { ZoomWidget, fitToScreen as fitToScreenFromApp } from './ZoomWidget';
import { StylePanel } from './StylePanel';
import { ContextMenu } from './ContextMenu';
import { useSignalValue } from '../useSignalValue';

// ── Keyboard shortcuts (global, when whiteboard is focused) ──

const TOOL_KEYS: Record<string, string> = {
  'v': 'select',
  'h': 'hand',
  'r': 'box',
  'e': 'ellipse',
  't': 'text',
  's': 'sticky-note',
  'd': 'draw',
  'x': 'eraser',
  'a': 'arrow',
};

export default function WhiteboardApp() {
  const shapeCount = useSignalValue(wbEditor.store.getShapeIdsSignal())?.length ?? 0;
  const camera     = useSignalValue(wbEditor.camera.signal);
  const [contextMenuPosition, setContextMenuPosition] = React.useState<{ x: number; y: number } | null>(null);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  // Global key handler for tool shortcuts
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Skip if the user is typing in an input
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    // Skip if editing inline
    if (wbEditor.editingShapeId.peek()) return;

    // Tool shortcuts
    const toolId = TOOL_KEYS[e.key.toLowerCase()];
    if (toolId && !e.metaKey && !e.ctrlKey && !e.altKey) {
      wbEditor.setCurrentTool(toolId);
      return;
    }

    // Undo / Redo
    if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      if (e.shiftKey) wbEditor.history.redo();
      else wbEditor.history.undo();
    }

    // Delete / Backspace
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey) {
      const ids = wbEditor.getSelectedShapeIds();
      if (ids.length > 0) wbEditor.deleteShapes(ids);
    }

    // Clipboard
    if (e.metaKey || e.ctrlKey) {
      const ids = wbEditor.getSelectedShapeIds();
      if (e.key === 'c' && ids.length > 0) {
        wbEditor.copy(ids);
      } else if (e.key === 'x' && ids.length > 0) {
        wbEditor.copy(ids);
        wbEditor.deleteShapes(ids);
      } else if (e.key === 'v') {
        // Find cursor position if we tracked it, else paste slightly offset
        wbEditor.paste();
      } else if (e.key === 'd' && ids.length > 0) {
        e.preventDefault();
        wbEditor.duplicateShapes(ids, { x: 20, y: 20 });
      } else if (e.key === ']') {
        e.preventDefault();
        if (ids.length > 0) wbEditor.reorderShapes(ids, e.shiftKey ? 'front' : 'forward');
      } else if (e.key === '[') {
        e.preventDefault();
        if (ids.length > 0) wbEditor.reorderShapes(ids, e.shiftKey ? 'back' : 'backward');
      }
    }

    // Escape → select tool + clear selection
    if (e.key === 'Escape') {
      wbEditor.setCurrentTool('select');
      wbEditor.setSelectedShapeIds([]);
    }

    // Fit to screen: Shift+1 — handled by ZoomWidget's fitToScreen export
    if (e.key === '1' && e.shiftKey) {
      // ZoomWidget's fitToScreen is called directly since it's statically imported
      fitToScreenFromApp();
    }
  };

  return (
    <div
      id="whiteboard-app"
      style={{
        width:    '100%',
        height:   'calc(100vh - 42px)', // subtract tab bar
        display:  'flex',
        position: 'relative',
        outline:  'none',
        overflow: 'hidden',
        background: '#181825',
      }}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      {/* Main canvas */}
      <Canvas />

      {/* Inline editor — rendered OUTSIDE Canvas so pointer capture on
          the canvas div does not steal focus from the textarea. */}
      <InlineEditor />

      {/* Left toolbar */}
      <Toolbar />

      {/* Bottom-right zoom widget */}
      <ZoomWidget />

      {/* Floating Style Panel (Right) */}
      <StylePanel />

      {/* Context Menu (Right Click) */}
      <ContextMenu position={contextMenuPosition} onClose={() => setContextMenuPosition(null)} />

      {/* Status bar */}
      <div
        id="wb-statusbar"
        style={{
          position:   'absolute',
          bottom:      16,
          left:        '50%',
          transform:   'translateX(-50%)',
          zIndex:      50,
          background:  '#1e1e2e',
          border:      '1px solid #313244',
          borderRadius: 8,
          padding:     '4px 12px',
          fontSize:    11,
          color:       '#6c7086',
          fontFamily:  'Inter, system-ui, sans-serif',
          pointerEvents: 'none',
          userSelect:  'none',
        }}
      >
        {shapeCount} shape{shapeCount !== 1 ? 's' : ''}
        {camera && ` · ${Math.round(camera.z * 100)}%`}
        {' · '}
        <span style={{ color: '#89b4fa' }}>
          Double-click to edit labels
        </span>
      </div>
    </div>
  );
}
