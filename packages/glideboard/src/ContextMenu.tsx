import React, { useEffect, useRef } from 'react';
import { wbEditor } from './editor';
import { wbTheme } from './theme';

interface ContextMenuProps {
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export function ContextMenu({ position, onClose }: ContextMenuProps) {
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

  const selectedIds = wbEditor.getSelectedShapeIds();
  const hasSelection = selectedIds.length > 0;

  const handlePaste = () => {
    const canvas = document.getElementById('wb-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pagePoint = wbEditor.screenToPage({
      x: position.x - rect.left,
      y: position.y - rect.top,
    });
    wbEditor.paste(pagePoint);
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
      <MenuItem label="Copy" shortcut="Cmd+C" disabled={!hasSelection} onClick={() => { wbEditor.copy(selectedIds); onClose(); }} />
      <MenuItem label="Paste" shortcut="Cmd+V" disabled={false} onClick={handlePaste} />
      <MenuItem label="Duplicate" shortcut="Cmd+D" disabled={!hasSelection} onClick={() => { wbEditor.duplicateShapes(selectedIds, { x: 20, y: 20 }); onClose(); }} />
      <div style={{ height: 1, background: wbTheme.border, margin: '6px 0' }} />
      <MenuItem label="Bring to front" shortcut="Cmd+Shift+]" disabled={!hasSelection} onClick={() => { wbEditor.reorderShapes(selectedIds, 'front'); onClose(); }} />
      <MenuItem label="Bring forward" shortcut="Cmd+]" disabled={!hasSelection} onClick={() => { wbEditor.reorderShapes(selectedIds, 'forward'); onClose(); }} />
      <MenuItem label="Send backward" shortcut="Cmd+[" disabled={!hasSelection} onClick={() => { wbEditor.reorderShapes(selectedIds, 'backward'); onClose(); }} />
      <MenuItem label="Send to back" shortcut="Cmd+Shift+[" disabled={!hasSelection} onClick={() => { wbEditor.reorderShapes(selectedIds, 'back'); onClose(); }} />
      <div style={{ height: 1, background: wbTheme.border, margin: '6px 0' }} />
      <MenuItem label="Delete" shortcut="Backspace" disabled={!hasSelection} color={wbTheme.dangerText} onClick={() => { wbEditor.deleteShapes(selectedIds); onClose(); }} />
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
