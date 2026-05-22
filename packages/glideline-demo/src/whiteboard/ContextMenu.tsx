import React, { useEffect, useRef } from 'react';
import { wbEditor } from './editor';

interface ContextMenuProps {
  position: { x: number; y: number } | null;
  onClose: () => void;
}

export function ContextMenu({ position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!position) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [position, onClose]);

  if (!position) return null;

  const selectedIds = wbEditor.getSelectedShapeIds();
  const hasSelection = selectedIds.length > 0;

  const handleCopy = () => {
    if (hasSelection) wbEditor.copy(selectedIds);
    onClose();
  };

  const handlePaste = () => {
    const pt = wbEditor.camera.pageToWorld(position);
    wbEditor.paste(pt);
    onClose();
  };

  const handleDuplicate = () => {
    if (hasSelection) wbEditor.duplicateShapes(selectedIds, { x: 20, y: 20 });
    onClose();
  };

  const handleBringToFront = () => {
    if (hasSelection) wbEditor.reorderShapes(selectedIds, 'front');
    onClose();
  };

  const handleBringForward = () => {
    if (hasSelection) wbEditor.reorderShapes(selectedIds, 'forward');
    onClose();
  };

  const handleSendBackward = () => {
    if (hasSelection) wbEditor.reorderShapes(selectedIds, 'backward');
    onClose();
  };

  const handleSendToBack = () => {
    if (hasSelection) wbEditor.reorderShapes(selectedIds, 'back');
    onClose();
  };

  const handleDelete = () => {
    if (hasSelection) wbEditor.deleteShapes(selectedIds);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        background: '#1e1e2e',
        border: '1px solid #313244',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        padding: '8px 0',
        zIndex: 9999,
        minWidth: '180px',
        color: '#cdd6f4',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '13px',
        userSelect: 'none',
      }}
      onContextMenu={e => e.preventDefault()}
    >
      <MenuItem label="Copy" shortcut="Cmd+C" disabled={!hasSelection} onClick={handleCopy} />
      <MenuItem label="Paste" shortcut="Cmd+V" disabled={false} onClick={handlePaste} />
      <MenuItem label="Duplicate" shortcut="Cmd+D" disabled={!hasSelection} onClick={handleDuplicate} />
      <div style={{ height: '1px', background: '#313244', margin: '6px 0' }} />
      <MenuItem label="Bring to front" shortcut="Cmd+Shift+]" disabled={!hasSelection} onClick={handleBringToFront} />
      <MenuItem label="Bring forward" shortcut="Cmd+]" disabled={!hasSelection} onClick={handleBringForward} />
      <MenuItem label="Send backward" shortcut="Cmd+[" disabled={!hasSelection} onClick={handleSendBackward} />
      <MenuItem label="Send to back" shortcut="Cmd+Shift+[" disabled={!hasSelection} onClick={handleSendToBack} />
      <div style={{ height: '1px', background: '#313244', margin: '6px 0' }} />
      <MenuItem label="Delete" shortcut="Backspace" disabled={!hasSelection} onClick={handleDelete} color="#f38ba8" />
    </div>
  );
}

function MenuItem({ label, shortcut, disabled, onClick, color }: any) {
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
      onPointerEnter={e => {
        if (!disabled) e.currentTarget.style.background = '#313244';
      }}
      onPointerLeave={e => {
        if (!disabled) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span>{label}</span>
      <span style={{ opacity: 0.5, fontSize: '11px' }}>{shortcut}</span>
    </div>
  );
}
