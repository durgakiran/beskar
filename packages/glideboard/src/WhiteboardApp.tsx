import React from 'react';
import { Canvas } from './Canvas';
import { ContextMenu } from './ContextMenu';
import {
  isCanvasDraggingRef,
  deferredToolRestoreRef,
  readOnlySignal,
  wbEditor,
} from './editor';
import { StylePanel } from './StylePanel';
import { wbTheme } from './theme';
import { Toolbar } from './Toolbar';
import { ZoomWidget, fitToScreen } from './ZoomWidget';
import { useSignalValue } from './useSignalValue';
import { BackToContentButton } from './BackToContentButton';

const TOOL_KEYS: Record<string, string> = {
  v: 'select',
  h: 'hand',
  r: 'box',
  e: 'ellipse',
  t: 'text',
  s: 'sticky-note',
  d: 'draw',
  x: 'eraser',
  a: 'arrow',
};

export function WhiteboardApp() {
  const shapeCount = useSignalValue(wbEditor.store.getShapeIdsSignal())?.length ?? 0;
  const camera = useSignalValue(wbEditor.camera.signal);
  const readOnly = useSignalValue(readOnlySignal) ?? false;
  const [contextMenuPosition, setContextMenuPosition] = React.useState<{ x: number; y: number } | null>(null);

  const isSpacebarHeldRef = React.useRef(false);
  const previousToolRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (readOnly) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLInputElement ||
        wbEditor.editingShapeId.peek()
      ) {
        return;
      }

      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();

        if (isSpacebarHeldRef.current) return;
        isSpacebarHeldRef.current = true;

        const currentTool = wbEditor.currentToolId.peek();
        if (currentTool !== 'hand') {
          previousToolRef.current = currentTool;
          wbEditor.setCurrentTool('hand');
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        if (isSpacebarHeldRef.current) {
          event.preventDefault();
          isSpacebarHeldRef.current = false;
          if (previousToolRef.current) {
            if (isCanvasDraggingRef.current) {
              // Pointer is still captured — defer restoration until pointerUp fires
              deferredToolRestoreRef.current = previousToolRef.current;
            } else {
              wbEditor.setCurrentTool(previousToolRef.current);
            }
            previousToolRef.current = null;
          }
        }
      }
    };

    const handleBlur = () => {
      if (isSpacebarHeldRef.current) {
        isSpacebarHeldRef.current = false;
        if (previousToolRef.current) {
          if (isCanvasDraggingRef.current) {
            deferredToolRestoreRef.current = previousToolRef.current;
          } else {
            wbEditor.setCurrentTool(previousToolRef.current);
          }
          previousToolRef.current = null;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      window.removeEventListener('blur', handleBlur);
    };
  }, [readOnly]);

  const onContextMenu = (event: React.MouseEvent) => {
    if (readOnly) return;
    event.preventDefault();
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    if (wbEditor.editingShapeId.peek()) return;

    if (!readOnly) {
      const toolId = TOOL_KEYS[event.key.toLowerCase()];
      if (toolId && !event.metaKey && !event.ctrlKey && !event.altKey) {
        wbEditor.setCurrentTool(toolId);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey) {
        const ids = wbEditor.getSelectedShapeIds();
        if (ids.length > 0) wbEditor.deleteShapes(ids);
      }

      if (event.metaKey || event.ctrlKey) {
        const ids = wbEditor.getSelectedShapeIds();
        if (event.key === 'c' && ids.length > 0) {
          wbEditor.copy(ids);
        } else if (event.key === 'x' && ids.length > 0) {
          wbEditor.copy(ids);
          wbEditor.deleteShapes(ids);
        } else if (event.key === 'v') {
          wbEditor.paste();
        } else if (event.key === 'd' && ids.length > 0) {
          event.preventDefault();
          wbEditor.duplicateShapes(ids, { x: 20, y: 20 });
        } else if (event.key === ']' && ids.length > 0) {
          event.preventDefault();
          wbEditor.reorderShapes(ids, event.shiftKey ? 'front' : 'forward');
        } else if (event.key === '[' && ids.length > 0) {
          event.preventDefault();
          wbEditor.reorderShapes(ids, event.shiftKey ? 'back' : 'backward');
        }
      }

      if (event.key === 'Escape') {
        wbEditor.setCurrentTool('select');
        wbEditor.setSelectedShapeIds([]);
      }
    }

    if (event.key === 'z' && (event.metaKey || event.ctrlKey)) {
      if (event.shiftKey) wbEditor.redo();
      else wbEditor.undo();
    }

    if (event.key === '1' && event.shiftKey) {
      fitToScreen();
    }
  };

  return (
    <div
      id="whiteboard-app"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        outline: 'none',
        overflow: 'hidden',
        background: wbTheme.appBg,
      }}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      <Canvas />
      {!readOnly ? <Toolbar /> : null}
      <ZoomWidget />
      {!readOnly ? <StylePanel /> : null}
      {!readOnly ? (
        <ContextMenu position={contextMenuPosition} onClose={() => setContextMenuPosition(null)} />
      ) : null}
      <BackToContentButton />
      <div
        id="wb-statusbar"
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          background: wbTheme.surface,
          border: `1px solid ${wbTheme.border}`,
          borderRadius: 10,
          padding: '4px 12px',
          fontSize: 11,
          color: wbTheme.textSoft,
          fontFamily: 'inherit',
          pointerEvents: 'none',
          userSelect: 'none',
          boxShadow: wbTheme.statusShadow,
        }}
      >
        {shapeCount} shape{shapeCount !== 1 ? 's' : ''}
        {camera && ` · ${Math.round(camera.z * 100)}%`}
        {' · '}
        <span style={{ color: wbTheme.accentText }}>
          {readOnly ? 'Read-only whiteboard' : 'Double-click to edit labels'}
        </span>
      </div>
    </div>
  );
}
