import React, { useEffect, useRef } from 'react';
import { getOrthoRouteMenu, type ArrowShape, type OrthoRoutePoint, type ShapeId } from '@durgakiran/glideline';
import { useGlideboardController } from './GlideboardContext.js';
import { wbTheme } from './theme.js';

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
  const canGroup = editor.canGroupShapes(selectedIds);
  const allGroups = selectedShapes.length > 0 && selectedShapes.every(shape => shape!.type === 'group');
  const allFrames = selectedShapes.length > 0 && selectedShapes.every(shape => shape!.type === 'frame');
  const allLocked = selectedShapes.length > 0 && selectedShapes.every(shape => shape!.isLocked);
  const allHidden = selectedShapes.length > 0 && selectedShapes.every(shape => shape!.isHidden);
  const locked = selectedIds.some(id => editor.isShapeEffectivelyLocked(id));
  const selectedSet = new Set(selectedIds);
  const transformRootCount = selectedIds.filter(id => !editor.getAncestors(id)
    .some(shape => selectedSet.has(shape.id as ShapeId))).length;
  const arrow = selectedShapes.length === 1 && selectedShapes[0]?.type === 'arrow'
    ? selectedShapes[0] as ArrowShape : null;
  const canvasBounds = controller.getCanvasElement()?.getBoundingClientRect();
  const routeMenu = arrow && canvasBounds ? getOrthoRouteMenu(editor, arrow, editor.screenToPage({
    x: position.x - canvasBounds.left, y: position.y - canvasBounds.top,
  })) : null;
  const editRoute = (label: string, manualRoute: OrthoRoutePoint[] | null) => {
    const current = arrow && editor.getShape<ArrowShape>(arrow.id as ShapeId);
    if (current?.props.routeStyle === 'ortho' && !editor.isShapeEffectivelyLocked(current.id as ShapeId)) {
      editor.batch(label, () => {
        editor.updateShape<ArrowShape>(current.id as ShapeId, {
          props: { ...current.props, manualRoute, ...(manualRoute === null ? { bend: 0 } : {}) },
        });
      });
    }
    onClose();
  };

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
      {routeMenu && (routeMenu.add || routeMenu.remove !== undefined || routeMenu.canReset) && (
        <>
          {routeMenu.add && <MenuItem label="Add waypoint" shortcut="" disabled={false}
            onClick={() => editRoute('Add Connector Waypoint', routeMenu.add!)} />}
          {routeMenu.remove !== undefined && <MenuItem label="Remove waypoint" shortcut="" disabled={false}
            onClick={() => editRoute('Remove Connector Waypoint', routeMenu.remove ?? null)} />}
          {routeMenu.canReset && <MenuItem label="Reset route" shortcut="" disabled={false}
            onClick={() => editRoute('Reset Connector Route', null)} />}
          <div style={{ height: 1, background: wbTheme.border, margin: '6px 0' }} />
        </>
      )}
      <MenuItem label="Copy" shortcut="Cmd+C" disabled={!hasSelection} onClick={() => { editor.copy(selectedIds); onClose(); }} />
      <MenuItem label="Paste" shortcut="Cmd+V" disabled={false} onClick={handlePaste} />
      <MenuItem label="Duplicate" shortcut="Cmd+D" disabled={!hasSelection} onClick={() => { editor.duplicateShapes(selectedIds, { x: 20, y: 20 }); onClose(); }} />
      <div style={{ height: 1, background: wbTheme.border, margin: '6px 0' }} />
      {canGroup && <MenuItem label="Group" shortcut="Cmd+G" disabled={false} onClick={() => { editor.groupShapes(selectedIds); onClose(); }} />}
      {allGroups && !locked && <MenuItem label="Ungroup" shortcut="Cmd+Shift+G" disabled={false} onClick={() => { editor.ungroupShapes(selectedIds); onClose(); }} />}
      {allFrames && !locked && <MenuItem label="Remove Frame, Keep Content" shortcut="" disabled={false} onClick={() => { editor.removeFramesKeepContent(selectedIds); onClose(); }} />}
      <MenuItem label={allLocked ? 'Unlock' : 'Lock'} shortcut="Cmd+L" disabled={!hasSelection} onClick={() => { editor.setLocked(selectedIds, !allLocked); onClose(); }} />
      <MenuItem label={allHidden ? 'Show' : 'Hide'} shortcut="Cmd+Shift+H" disabled={!hasSelection} onClick={() => { editor.setHidden(selectedIds, !allHidden); onClose(); }} />
      <div style={{ height: 1, background: wbTheme.border, margin: '6px 0' }} />
      <MenuItem label="Bring to front" shortcut="Cmd+Shift+]" disabled={!hasSelection} onClick={() => { editor.reorderShapes(selectedIds, 'front'); onClose(); }} />
      <MenuItem label="Bring forward" shortcut="Cmd+]" disabled={!hasSelection} onClick={() => { editor.reorderShapes(selectedIds, 'forward'); onClose(); }} />
      <MenuItem label="Send backward" shortcut="Cmd+[" disabled={!hasSelection} onClick={() => { editor.reorderShapes(selectedIds, 'backward'); onClose(); }} />
      <MenuItem label="Send to back" shortcut="Cmd+Shift+[" disabled={!hasSelection} onClick={() => { editor.reorderShapes(selectedIds, 'back'); onClose(); }} />
      {!locked && hasSelection && <div style={{ height: 1, background: wbTheme.border, margin: '6px 0' }} />}
      {!locked && transformRootCount >= 2 && <MenuItem label="Align left" shortcut="" disabled={false} onClick={() => { editor.alignShapes(selectedIds, 'left'); onClose(); }} />}
      {!locked && transformRootCount >= 2 && <MenuItem label="Align top" shortcut="" disabled={false} onClick={() => { editor.alignShapes(selectedIds, 'top'); onClose(); }} />}
      {!locked && transformRootCount >= 3 && <MenuItem label="Distribute horizontally" shortcut="" disabled={false} onClick={() => { editor.distributeShapes(selectedIds, 'horizontal'); onClose(); }} />}
      {!locked && transformRootCount >= 3 && <MenuItem label="Distribute vertically" shortcut="" disabled={false} onClick={() => { editor.distributeShapes(selectedIds, 'vertical'); onClose(); }} />}
      {!locked && hasSelection && <MenuItem label="Flip horizontally" shortcut="" disabled={false} onClick={() => { editor.flipShapes(selectedIds, 'horizontal'); onClose(); }} />}
      {!locked && hasSelection && <MenuItem label="Flip vertically" shortcut="" disabled={false} onClick={() => { editor.flipShapes(selectedIds, 'vertical'); onClose(); }} />}
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
