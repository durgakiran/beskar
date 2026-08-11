import React, { useEffect, useRef } from 'react';
import { useGlideboardController } from './GlideboardContext';
import { wbTheme } from './theme';

interface ContextMenuProps {
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export function ContextMenu({ position, onClose }: ContextMenuProps) {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [onClose, position]);

  if (!position) return null;

  const selectedIds = editor.getSelectedShapeIds();
  const hasSelection = selectedIds.length > 0;
  const selectedShapes = selectedIds.map(id => editor.getShape(id)).filter(Boolean);
  const canGroup = selectedShapes.length >= 2
    && selectedShapes.every(shape => shape!.parentId === selectedShapes[0]!.parentId);
  const allGroups = selectedShapes.length > 0 && selectedShapes.every(shape => shape!.type === 'group');
  const allFrames = selectedShapes.length > 0 && selectedShapes.every(shape => shape!.type === 'frame');
  const allLocked = selectedShapes.length > 0 && selectedShapes.every(shape => shape!.isLocked);
  const allHidden = selectedShapes.length > 0 && selectedShapes.every(shape => shape!.isHidden);

  const handlePaste = () => {
    const canvas = controller.getCanvasElement();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pagePoint = editor.screenToPage({
      x: position.x - rect.left,
      y: position.y - rect.top,
    });
    editor.paste(pagePoint);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        background: wbTheme.surface,
        border: `1px solid ${wbTheme.border}`,
        borderRadius: 8,
        boxShadow: wbTheme.shadowStrong,
        padding: '8px 0',
        zIndex: 9999,
        minWidth: 180,
        color: wbTheme.text,
        fontFamily: 'inherit',
        fontSize: 13,
        userSelect: 'none',
      }}
      onContextMenu={event => event.preventDefault()}
    >
      <MenuItem label="Copy" shortcut="Cmd+C" disabled={!hasSelection} onClick={() => { editor.copy(selectedIds); onClose(); }} />
      <MenuItem label="Paste" shortcut="Cmd+V" disabled={false} onClick={handlePaste} />
      <MenuItem label="Duplicate" shortcut="Cmd+D" disabled={!hasSelection} onClick={() => { editor.duplicateShapes(selectedIds, { x: 20, y: 20 }); onClose(); }} />
      <div style={{ height: 1, background: wbTheme.border, margin: '6px 0' }} />
      <MenuItem label="Group" shortcut="Cmd+G" disabled={!canGroup} onClick={() => { editor.groupShapes(selectedIds); onClose(); }} />
      <MenuItem label="Ungroup" shortcut="Cmd+Shift+G" disabled={!allGroups} onClick={() => { editor.ungroupShapes(selectedIds); onClose(); }} />
      <MenuItem label="Remove Frame, Keep Content" shortcut="" disabled={!allFrames} onClick={() => { editor.removeFramesKeepContent(selectedIds); onClose(); }} />
      <MenuItem label={allLocked ? 'Unlock' : 'Lock'} shortcut="Cmd+L" disabled={!hasSelection} onClick={() => { editor.setLocked(selectedIds, !allLocked); onClose(); }} />
      <MenuItem label={allHidden ? 'Show' : 'Hide'} shortcut="Cmd+Shift+H" disabled={!hasSelection} onClick={() => { editor.setHidden(selectedIds, !allHidden); onClose(); }} />
      <div style={{ height: 1, background: wbTheme.border, margin: '6px 0' }} />
      <MenuItem label="Bring to front" shortcut="Cmd+Shift+]" disabled={!hasSelection} onClick={() => { editor.reorderShapes(selectedIds, 'front'); onClose(); }} />
      <MenuItem label="Bring forward" shortcut="Cmd+]" disabled={!hasSelection} onClick={() => { editor.reorderShapes(selectedIds, 'forward'); onClose(); }} />
      <MenuItem label="Send backward" shortcut="Cmd+[" disabled={!hasSelection} onClick={() => { editor.reorderShapes(selectedIds, 'backward'); onClose(); }} />
      <MenuItem label="Send to back" shortcut="Cmd+Shift+[" disabled={!hasSelection} onClick={() => { editor.reorderShapes(selectedIds, 'back'); onClose(); }} />
      <div style={{ height: 1, background: wbTheme.border, margin: '6px 0' }} />
      <MenuItem label="Align left" shortcut="" disabled={selectedIds.length < 2} onClick={() => { editor.alignShapes(selectedIds, 'left'); onClose(); }} />
      <MenuItem label="Align top" shortcut="" disabled={selectedIds.length < 2} onClick={() => { editor.alignShapes(selectedIds, 'top'); onClose(); }} />
      <MenuItem label="Distribute horizontally" shortcut="" disabled={selectedIds.length < 3} onClick={() => { editor.distributeShapes(selectedIds, 'horizontal'); onClose(); }} />
      <MenuItem label="Distribute vertically" shortcut="" disabled={selectedIds.length < 3} onClick={() => { editor.distributeShapes(selectedIds, 'vertical'); onClose(); }} />
      <MenuItem label="Flip horizontally" shortcut="" disabled={selectedIds.length < 1} onClick={() => { editor.flipShapes(selectedIds, 'horizontal'); onClose(); }} />
      <MenuItem label="Flip vertically" shortcut="" disabled={selectedIds.length < 1} onClick={() => { editor.flipShapes(selectedIds, 'vertical'); onClose(); }} />
      <div style={{ height: 1, background: wbTheme.border, margin: '6px 0' }} />
      <MenuItem
        label="Delete"
        shortcut="Backspace"
        disabled={!hasSelection}
        color={wbTheme.dangerText}
        onClick={() => {
          editor.batch('Delete Shapes', () => editor.deleteShapes(selectedIds));
          onClose();
        }}
      />
    </div>
  );
}

function MenuItem({
  label,
  shortcut,
  disabled,
  onClick,
  color,
}: {
  label: string;
  shortcut: string;
  disabled: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        padding: '6px 16px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        color: color || 'inherit',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'transparent',
      }}
      onPointerEnter={event => {
        if (!disabled) event.currentTarget.style.background = wbTheme.surfaceInset;
      }}
      onPointerLeave={event => {
        if (!disabled) event.currentTarget.style.background = 'transparent';
      }}
    >
      <span>{label}</span>
      <span style={{ opacity: 0.5, fontSize: 11 }}>{shortcut}</span>
    </div>
  );
}
