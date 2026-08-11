import React from 'react';
import {
  FiChevronDown,
  FiChevronRight,
  FiChevronUp,
  FiCrosshair,
  FiEye,
  FiEyeOff,
  FiLock,
  FiUnlock,
} from 'react-icons/fi';
import type { GlideShape, ShapeId } from '@durgakiran/glideline';
import { useGlideboardController } from './GlideboardContext';
import { useSignalValue } from './useSignalValue';
import { wbTheme } from './theme';

const iconButton: React.CSSProperties = {
  width: 24,
  height: 24,
  border: 0,
  padding: 0,
  background: 'transparent',
  color: wbTheme.textSoft,
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
};

export function LayersPanel() {
  const { editor } = useGlideboardController();
  useSignalValue(editor.getShapeIdsSignal());
  useSignalValue(editor.getDocumentVersionSignal());
  const selectedIds = useSignalValue(editor.getSelectionSignal()) ?? [];
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const pageId = editor.getDefaultPageId();
  const page = editor.store.get(pageId) as { name?: string } | undefined;
  const roots = editor.getChildren(pageId);

  const toggleExpanded = (id: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const locate = (shape: GlideShape) => {
    const bounds = editor.getShapeVisualWorldBounds(shape);
    const viewport = editor.getViewportBounds();
    editor.camera.setCamera({
      x: (bounds.minX + bounds.maxX) / 2 - viewport.w / 2,
      y: (bounds.minY + bounds.maxY) / 2 - viewport.h / 2,
    });
  };

  return (
    <aside id="glideboard-layers" data-glideboard-role="layers-panel" style={{
      position: 'absolute', left: 78, top: 12, bottom: 54, width: 280, zIndex: 95,
      display: 'flex', flexDirection: 'column', background: wbTheme.surface,
      border: `1px solid ${wbTheme.border}`, borderRadius: 8, boxShadow: wbTheme.shadow,
      color: wbTheme.text, fontFamily: 'inherit', overflow: 'hidden',
    }} onPointerDown={event => event.stopPropagation()}>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${wbTheme.border}`,
        fontSize: 12, fontWeight: 650 }}>Layers</div>
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault();
          const id = event.dataTransfer.getData('application/x-glideboard-shape');
          if (id) editor.reparentShapes([id as ShapeId], pageId);
        }}>
        <div style={{ height: 30, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, fontWeight: 600, color: wbTheme.textMuted }}>
          <FiChevronDown size={13} />
          <span>{page?.name ?? 'Page 1'}</span>
        </div>
        {roots.map(shape => (
          <LayerRow key={shape.id} shape={shape} depth={1} expanded={expanded}
            selectedIds={selectedIds} toggleExpanded={toggleExpanded} locate={locate} />
        ))}
        {roots.length === 0 ? <div style={{ padding: 16, color: wbTheme.textSoft, fontSize: 11 }}>No layers</div> : null}
      </div>
    </aside>
  );
}

function LayerRow({ shape, depth, expanded, selectedIds, toggleExpanded, locate }: {
  shape: GlideShape;
  depth: number;
  expanded: Set<string>;
  selectedIds: readonly ShapeId[];
  toggleExpanded: (id: string) => void;
  locate: (shape: GlideShape) => void;
}) {
  const { editor } = useGlideboardController();
  const children = editor.getChildren(shape.id);
  const container = shape.type === 'group' || shape.type === 'frame';
  const isExpanded = expanded.has(shape.id);
  const selected = selectedIds.includes(shape.id as ShapeId);
  const displayName = shape.name?.trim()
    || (typeof (shape.props as any).label === 'string' ? (shape.props as any).label.trim() : '')
    || shape.type;
  const [name, setName] = React.useState(displayName);
  React.useEffect(() => setName(displayName), [displayName]);

  return <>
    <div draggable={!shape.isLocked}
      onDragStart={event => event.dataTransfer.setData('application/x-glideboard-shape', shape.id)}
      onDragOver={event => { if (container) event.preventDefault(); }}
      onDrop={event => {
        if (!container) return;
        event.preventDefault();
        event.stopPropagation();
        const id = event.dataTransfer.getData('application/x-glideboard-shape');
        if (id && id !== shape.id) editor.reparentShapes([id as ShapeId], shape.id as ShapeId);
      }}
      onClick={event => {
        if (shape.isHidden) return;
        const id = shape.id as ShapeId;
        if (event.shiftKey) {
          const next = selectedIds.includes(id) ? selectedIds.filter(selectedId => selectedId !== id) : [...selectedIds, id];
          editor.setSelectedShapeIds([...next]);
        } else {
          editor.setSelectedShapeIds([id]);
        }
      }}
      style={{ height: 32, display: 'flex', alignItems: 'center', gap: 2,
        paddingLeft: 6 + depth * 14, paddingRight: 4,
        background: selected ? wbTheme.accentSurface : 'transparent',
        opacity: shape.isHidden ? 0.55 : 1, cursor: 'default' }}>
      <button title={isExpanded ? 'Collapse' : 'Expand'} style={iconButton}
        disabled={!container || children.length === 0}
        onClick={event => { event.stopPropagation(); toggleExpanded(shape.id); }}>
        {container && children.length > 0
          ? isExpanded ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />
          : <span style={{ width: 13 }} />}
      </button>
      <input value={name} aria-label={`Rename ${shape.type}`} disabled={shape.isLocked}
        onClick={event => event.stopPropagation()}
        onChange={event => setName(event.target.value)}
        onBlur={() => { if (name.trim() && name !== shape.name) editor.updateShape(shape.id as ShapeId, { name: name.trim() }); }}
        style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent',
          color: wbTheme.text, fontSize: 11 }} />
      <button title="Locate" style={iconButton} onClick={event => { event.stopPropagation(); locate(shape); }}><FiCrosshair size={12} /></button>
      <button title={shape.isHidden ? 'Show' : 'Hide'} style={iconButton}
        onClick={event => { event.stopPropagation(); editor.setHidden([shape.id as ShapeId], !shape.isHidden); }}>
        {shape.isHidden ? <FiEyeOff size={12} /> : <FiEye size={12} />}
      </button>
      <button title={shape.isLocked ? 'Unlock' : 'Lock'} style={iconButton}
        onClick={event => { event.stopPropagation(); editor.setLocked([shape.id as ShapeId], !shape.isLocked); }}>
        {shape.isLocked ? <FiLock size={12} /> : <FiUnlock size={12} />}
      </button>
      <button title="Move forward" style={iconButton} onClick={event => { event.stopPropagation(); editor.reorderShapes([shape.id as ShapeId], 'forward'); }}><FiChevronUp size={12} /></button>
      <button title="Move backward" style={iconButton} onClick={event => { event.stopPropagation(); editor.reorderShapes([shape.id as ShapeId], 'backward'); }}><FiChevronDown size={12} /></button>
    </div>
    {container && isExpanded ? children.map(child => (
      <LayerRow key={child.id} shape={child} depth={depth + 1} expanded={expanded}
        selectedIds={selectedIds} toggleExpanded={toggleExpanded} locate={locate} />
    )) : null}
  </>;
}
