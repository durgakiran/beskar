import React from 'react';
import type { ShapeId } from '@durgakiran/glideline';
import {
  FiCopy,
  FiMousePointer,
  FiSquare,
  FiCircle,
  FiTriangle,
  FiHexagon,
  FiStar,
  FiType,
  FiMinus,
  FiArrowRight,
  FiRotateCcw,
  FiRotateCw,
  FiTrash2,
  FiLayout,
  FiLayers,
  FiImage,
  FiGrid,
} from 'react-icons/fi';
import {
  LuEraser,
  LuHand,
  LuPencil,
  LuHighlighter,
  LuDiamond,
  LuRectangleHorizontal,
  LuDatabase,
  LuMessageSquare,
  LuStickyNote,
  LuChevronsRight,
  LuFileOutput,
  LuGrid2X2Check,
  LuGrid3X3,
  LuMagnet,
} from 'react-icons/lu';
import { useGlideboardController } from './GlideboardContext.js';
import type { ConnectorPreset } from './GlideboardController.js';
import { wbTheme } from './theme.js';
import { useSignalValue } from './useSignalValue.js';
import { useSelectedShapes } from './hooks/useSelectedShapes.js';
import type { GlideboardToolbarLayout } from './types.js';

interface ToolDef {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ComponentType<any>;
}

function ParallelogramIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 5h14l-4 14H3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>;
}

function PlainConnectorIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 17h9V7h9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function DoubleArrowIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 12h18M8 7l-5 5 5 5m8-10 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function EraserIcon({ partial = false, area = false }: { partial?: boolean; area?: boolean }) {
  return (
    <span aria-hidden="true" style={{
      display: 'grid', gridTemplateRows: '16px 7px', justifyItems: 'center', gap: 1, width: 22,
    }}>
      <LuEraser size={16} />
      {area ? (
        <svg viewBox="0 0 22 8" width={22} height={8} fill="currentColor">
          <path d="M3 1h4.5a3.5 3.5 0 0 0 7 0H19a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1Z" />
        </svg>
      ) : <span style={{
        boxSizing: 'border-box', width: 20, height: 7, borderTop: '2px solid currentColor',
        borderRadius: '75% 38% 0 0 / 95% 72% 0 0', transform: 'rotate(-10deg)',
        maskImage: partial
          ? 'linear-gradient(to right, currentColor 0 36%, transparent 36% 64%, currentColor 64% 100%)'
          : undefined,
      }} />}
    </span>
  );
}

const ERASER_MODES = [
  { id: 'eraser', label: 'All elements', shortcut: 'X' },
  { id: 'whole-stroke-eraser', label: 'Whole stroke', shortcut: 'X1' },
  { id: 'partial-eraser', label: 'Partial stroke', shortcut: 'X2' },
  { id: 'area-eraser', label: 'Erase area', shortcut: 'X3' },
] as const;
const ERASER_PICKER_WIDTH = 144;
const ERASER_PICKER_HEIGHT = 42;

const SHAPE_TOOLS: ToolDef[] = [
  { id: 'box', label: 'Rectangle', shortcut: 'R', icon: FiSquare },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'E', icon: FiCircle },
  { id: 'triangle', label: 'Triangle', icon: FiTriangle },
  { id: 'diamond', label: 'Diamond', icon: LuDiamond },
  { id: 'hexagon', label: 'Hexagon', icon: FiHexagon },
  { id: 'star', label: 'Star', icon: FiStar },
  { id: 'rounded-rect', label: 'Rounded Rect', icon: LuRectangleHorizontal },
  { id: 'parallelogram', label: 'Parallelogram', icon: ParallelogramIcon },
  { id: 'chevron', label: 'Chevron', icon: LuChevronsRight },
  { id: 'document', label: 'Document', icon: LuFileOutput },
  { id: 'cylinder', label: 'Cylinder', icon: LuDatabase },
  { id: 'note', label: 'Note', icon: LuStickyNote },
  { id: 'callout', label: 'Callout', icon: LuMessageSquare },
  { id: 'line', label: 'Line', icon: FiMinus },
];

const SHAPE_TOOL_IDS = new Set(SHAPE_TOOLS.map(tool => tool.id));

const ARROW_TOOLS: Array<ToolDef & { preset: ConnectorPreset }> = [
  { id: 'connector-line', label: 'Plain Connector', shortcut: 'A', icon: PlainConnectorIcon, preset: 'line' },
  { id: 'connector-arrow', label: 'Arrow', icon: FiArrowRight, preset: 'arrow' },
  { id: 'connector-double-arrow', label: 'Double Arrow', icon: DoubleArrowIcon, preset: 'double-arrow' },
];

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: FiMousePointer },
  { id: 'hand', label: 'Hand', shortcut: 'H', icon: LuHand },
  { id: 'shape-picker', label: 'Shapes', shortcut: 'R', icon: FiSquare },
  { id: 'text', label: 'Text', shortcut: 'T', icon: FiType },
  { id: 'sticky-note', label: 'Sticky', shortcut: 'S', icon: LuStickyNote },
  { id: 'frame', label: 'Frame', shortcut: 'F', icon: FiLayout },
  { id: 'draw', label: 'Draw', shortcut: 'D', icon: LuPencil },
  { id: 'highlighter', label: 'Highlighter', shortcut: 'M', icon: LuHighlighter },
  { id: 'eraser', label: 'Eraser', shortcut: 'X', icon: LuEraser },
  { id: 'arrow-picker', label: 'Arrow', shortcut: 'A', icon: FiArrowRight },
];

export function creationShapeType(tool: string): string | null {
  if (tool === 'draw' || tool === 'highlighter') return 'freehand';
  if (SHAPE_TOOL_IDS.has(tool) || ['arrow', 'text', 'sticky-note', 'frame'].includes(tool)) return tool;
  return null;
}

export function boardObjectName(type: string): string {
  if (type === 'arrow') return 'Connector';
  if (type === 'sticky-note') return 'Sticky note';
  if (type === 'raster-image') return 'Image';
  if (type === 'sanitized-svg') return 'SVG';
  if (type === 'freehand' || type === 'draw') return 'Draw';
  return SHAPE_TOOLS.find(tool => tool.id === type)?.label
    ?? TOOLS.find(tool => tool.id === type)?.label
    ?? type.replace(/[-_]/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

const buttonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 6,
  border: 0,
  background: 'transparent',
  color: wbTheme.textSoft,
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  position: 'relative',
  padding: 0,
  flex: '0 0 auto',
};

function ToolbarButtonStyles() {
  return (
    <style>{`
      .glideboard-toolbar-button {
        position: relative;
        outline: none;
      }
      .glideboard-toolbar-button::after {
        content: '';
        position: absolute;
        inset: 2px;
        z-index: 0;
        border-radius: 5px;
        background: var(--gray-3, #f3f4f6);
        opacity: 0;
        pointer-events: none;
      }
      .glideboard-toolbar-button > * {
        position: relative;
        z-index: 1;
      }
      .glideboard-toolbar-button[data-isactive='true']::after {
        background: var(--accent-a3, rgba(37, 99, 235, 0.12));
        opacity: 1;
      }
      @media (hover: hover) {
        .glideboard-toolbar-button:not(:disabled):hover::after {
          opacity: 1;
        }
      }
      .glideboard-toolbar-button:focus-visible {
        border-radius: 6px;
        outline: 2px solid var(--accent-9, #2563eb);
        outline-offset: -4px;
      }
    `}</style>
  );
}

function ToolButton({ tool, active, disabled = false, onClick }: {
  tool: ToolDef;
  active: boolean;
  disabled?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const controller = useGlideboardController();
  const Icon = tool.icon;
  return (
    <button
      className="glideboard-toolbar-button"
      data-isactive={active}
      id={controller.domId(`tool-${tool.id}`)}
      data-glideboard-tool={tool.id}
      aria-label={tool.label}
      title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...buttonStyle,
        color: active ? wbTheme.accentText : wbTheme.textSoft,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : buttonStyle.cursor,
      }}
    >
      <Icon size={16} />
    </button>
  );
}

function ShapePickerButton({
  active,
  currentShapeTool,
  isOpen,
  onToggle,
  onSelectShape,
}: {
  active: boolean;
  currentShapeTool: ToolDef;
  isOpen: boolean;
  onToggle: () => void;
  onSelectShape: (toolId: string) => void;
}) {
  const controller = useGlideboardController();
  const Icon = currentShapeTool.icon;
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="glideboard-toolbar-button"
        data-isactive={active}
        id={controller.domId('tool-shape-picker')}
        data-glideboard-control="shape-picker"
        aria-label="Shapes"
        aria-expanded={isOpen}
        title={`Shapes (${currentShapeTool.label})`}
        onClick={onToggle}
        style={{
          ...buttonStyle,
          color: active ? wbTheme.accentText : wbTheme.textSoft,
        }}
      >
        <Icon size={16} />
      </button>

      {isOpen ? (
        <div
          id={controller.domId('shape-picker')}
          data-glideboard-role="shape-picker"
          style={{
            position: 'absolute',
            left: 40,
            top: -4,
            zIndex: 120,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 32px)',
            gap: 2,
            padding: 4,
            background: wbTheme.surface,
            border: `1px solid ${wbTheme.border}`,
            borderRadius: 8,
            boxShadow: wbTheme.shadow,
          }}
        >
          {SHAPE_TOOLS.map(tool => {
            const selected = currentShapeTool.id === tool.id;
            const ToolIcon = tool.icon;
            return (
              <button
                className="glideboard-toolbar-button"
                data-isactive={selected}
                key={tool.id}
                id={controller.domId(`shape-option-${tool.id}`)}
                data-glideboard-shape-option={tool.id}
                title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                aria-label={tool.label}
                onClick={() => onSelectShape(tool.id)}
                style={{
                  ...buttonStyle,
                  color: selected ? wbTheme.accentText : wbTheme.text,
                }}
              >
                <ToolIcon size={16} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ArrowPickerButton({
  active,
  currentArrowTool,
  isOpen,
  onToggle,
  onSelectArrow,
}: {
  active: boolean;
  currentArrowTool: (typeof ARROW_TOOLS)[number];
  isOpen: boolean;
  onToggle: () => void;
  onSelectArrow: (preset: ConnectorPreset) => void;
}) {
  const controller = useGlideboardController();
  const Icon = currentArrowTool.icon;
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="glideboard-toolbar-button"
        data-isactive={active}
        id={controller.domId('tool-arrow-picker')}
        data-glideboard-control="arrow-picker"
        aria-label="Arrow"
        aria-expanded={isOpen}
        title={`Connector (${currentArrowTool.label})`}
        onClick={onToggle}
        style={{
          ...buttonStyle,
          color: active ? wbTheme.accentText : wbTheme.textSoft,
        }}
      >
        <Icon size={16} />
      </button>

      {isOpen ? (
        <div
          id={controller.domId('arrow-picker')}
          data-glideboard-role="arrow-picker"
          style={{
            position: 'absolute',
            left: 40,
            top: -4,
            zIndex: 120,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 32px)',
            gap: 2,
            padding: 4,
            background: wbTheme.surface,
            border: `1px solid ${wbTheme.border}`,
            borderRadius: 8,
            boxShadow: wbTheme.shadow,
          }}
        >
          {ARROW_TOOLS.map(tool => {
            const selected = currentArrowTool.preset === tool.preset;
            const ToolIcon = tool.icon;
            return (
              <button
                className="glideboard-toolbar-button"
                data-isactive={selected}
                key={tool.id}
                id={controller.domId(`arrow-option-${tool.preset}`)}
                data-glideboard-arrow-option={tool.preset}
                title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                aria-label={tool.label}
                onClick={() => onSelectArrow(tool.preset)}
                style={{
                  ...buttonStyle,
                  color: selected ? wbTheme.accentText : wbTheme.text,
                }}
              >
                <ToolIcon size={16} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Toolbar({
  layout = 'split',
  layersOpen = false,
  assetsOpen = false,
  assetsAvailable = false,
  readOnly = false,
  onToggleLayers,
  onToggleAssets,
  onRequestAssetImport,
  onCopy,
}: {
  layout?: GlideboardToolbarLayout;
  layersOpen?: boolean;
  assetsOpen?: boolean;
  assetsAvailable?: boolean;
  readOnly?: boolean;
  onToggleLayers?: () => void;
  onToggleAssets?: () => void;
  onRequestAssetImport?: (trigger: HTMLElement) => void;
  onCopy?: (ids: readonly ShapeId[]) => void;
}) {
  const controller = useGlideboardController();
  const { editor } = controller;
  const activeTool = useSignalValue(editor.currentToolId) ?? 'select';
  const eraserTool = useSignalValue(controller.eraserToolSignal) ?? 'eraser';
  const eraserActive = ERASER_MODES.some(mode => mode.id === activeTool);
  const currentArrowPreset = useSignalValue(controller.arrowPresetSignal) ?? 'arrow';
  const snapSettings = useSignalValue(editor.snapping.settings)!;
  const selectedShapes = useSelectedShapes();
  const editingSession = useSignalValue(editor.textEditing.session);
  const labelTargetId = useSignalValue(controller.textStyleTargetIdSignal);
  const selectedIds = selectedShapes.map(shape => shape.id as ShapeId);
  const targetsLabel = selectedShapes.length === 1
    && selectedShapes[0]!.type !== 'text' && selectedShapes[0]!.id === labelTargetId;
  const canActOnSelection = selectedIds.length > 0 && !editingSession && !targetsLabel;
  const canDeleteShape = (id: ShapeId): boolean => !editor.isShapeEffectivelyLocked(id)
    && editor.getChildren(id).every(child => canDeleteShape(child.id as ShapeId));
  const canDelete = canActOnSelection && selectedIds.every(canDeleteShape);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const eraserTriggerRef = React.useRef<HTMLButtonElement>(null);
  const eraserPickerRef = React.useRef<HTMLDivElement>(null);
  const [eraserPicker, setEraserPicker] = React.useState<{ left: number; top: number } | null>(null);
  const [isShapePickerOpen, setIsShapePickerOpen] = React.useState(false);
  const [isArrowPickerOpen, setIsArrowPickerOpen] = React.useState(false);
  const [currentShapeToolId, setCurrentShapeToolId] = React.useState('box');

  React.useEffect(() => {
    if (SHAPE_TOOL_IDS.has(activeTool)) {
      setCurrentShapeToolId(activeTool);
    } else if (isShapePickerOpen) {
      setIsShapePickerOpen(false);
    }
    if (activeTool !== 'arrow' && isArrowPickerOpen) {
      setIsArrowPickerOpen(false);
    }
    if (!eraserActive || readOnly) setEraserPicker(null);
  }, [activeTool, eraserActive, isArrowPickerOpen, isShapePickerOpen, readOnly]);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!toolbarRef.current?.contains(target)) {
        setIsShapePickerOpen(false);
        setIsArrowPickerOpen(false);
      }
      if (!eraserTriggerRef.current?.contains(target) && !eraserPickerRef.current?.contains(target)) {
        setEraserPicker(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const currentShapeTool = SHAPE_TOOLS.find(tool => tool.id === currentShapeToolId) ?? SHAPE_TOOLS[0]!;
  const currentArrowTool = ARROW_TOOLS.find(tool => tool.preset === currentArrowPreset) ?? ARROW_TOOLS[1]!;

  const selectTool = (toolId: string) => {
    controller.setCurrentTool(toolId);
    setIsShapePickerOpen(false);
    setIsArrowPickerOpen(false);
    setEraserPicker(null);
  };

  const toggleEraserPicker = () => {
    if (eraserPicker) {
      setEraserPicker(null);
      return;
    }
    const toolbar = toolbarRef.current!.getBoundingClientRect();
    const trigger = eraserTriggerRef.current!.getBoundingClientRect();
    const compact = window.matchMedia('(max-width: 600px)').matches;
    const left = compact ? trigger.left : trigger.right + 8;
    const top = compact ? trigger.bottom + 8 : trigger.top;
    controller.activateEraser();
    setIsShapePickerOpen(false);
    setIsArrowPickerOpen(false);
    setEraserPicker({
      left: Math.max(8, Math.min(left - toolbar.left, toolbar.width - ERASER_PICKER_WIDTH - 8)),
      top: Math.max(8, Math.min(top - toolbar.top, toolbar.height - ERASER_PICKER_HEIGHT - 8)),
    });
  };

  const separator = (
    <div data-glideboard-role="toolbar-separator" style={{
      width: layout === 'vertical' ? 24 : 1,
      height: layout === 'vertical' ? 1 : 24,
      alignSelf: 'center',
      flex: '0 0 auto',
      background: wbTheme.border,
      margin: layout === 'vertical' ? '3px 0' : '4px 3px',
    }} />
  );

  const drawingControls = TOOLS.map(tool => {
    if (tool.id === 'eraser') {
      return (
        <button key={tool.id} ref={eraserTriggerRef} type="button"
          className="glideboard-toolbar-button"
          id={controller.domId('tool-eraser')}
          data-glideboard-tool="eraser"
          data-isactive={eraserActive}
          aria-label="Eraser" aria-expanded={eraserPicker !== null}
          aria-controls={eraserPicker ? controller.domId('eraser-picker') : undefined}
          title="Eraser (X)" onClick={toggleEraserPicker}
          style={{ ...buttonStyle, color: eraserActive ? wbTheme.accentText : wbTheme.textSoft }}>
          {eraserTool === 'eraser' ? <LuEraser size={16} />
            : <EraserIcon partial={eraserTool === 'partial-eraser'} area={eraserTool === 'area-eraser'} />}
        </button>
      );
    }
    if (tool.id === 'shape-picker') {
      return (
        <ShapePickerButton
          key={tool.id}
          active={SHAPE_TOOL_IDS.has(activeTool)}
          currentShapeTool={currentShapeTool}
          isOpen={isShapePickerOpen}
          onToggle={() => {
            setIsArrowPickerOpen(false);
            setIsShapePickerOpen(open => !open);
            if (!SHAPE_TOOL_IDS.has(activeTool)) controller.setCurrentTool(currentShapeTool.id);
          }}
          onSelectShape={(toolId) => {
            setCurrentShapeToolId(toolId);
            selectTool(toolId);
          }}
        />
      );
    }
    if (tool.id === 'arrow-picker') {
      return (
        <ArrowPickerButton
          key={tool.id}
          active={activeTool === 'arrow'}
          currentArrowTool={currentArrowTool}
          isOpen={isArrowPickerOpen}
          onToggle={() => {
            setIsShapePickerOpen(false);
            setIsArrowPickerOpen(open => !open);
            controller.setCurrentTool('arrow');
          }}
          onSelectArrow={(preset) => {
            controller.setConnectorPreset(preset);
            controller.setCurrentTool('arrow');
            setIsArrowPickerOpen(false);
          }}
        />
      );
    }
    return <ToolButton key={tool.id} tool={tool} active={activeTool === tool.id} onClick={() => selectTool(tool.id)} />;
  });

  const actionControls = (
    <>
      {!readOnly ? <ToolButton tool={{ id: 'import-image', label: 'Import image', icon: FiImage }} active={false} onClick={event => onRequestAssetImport?.(event.currentTarget)} /> : null}
      {!readOnly ? separator : null}
      {!readOnly ? <ToolButton tool={{ id: 'undo', label: 'Undo', shortcut: '⌘Z', icon: FiRotateCcw }} active={false} onClick={() => editor.undo()} /> : null}
      {!readOnly ? <ToolButton tool={{ id: 'redo', label: 'Redo', shortcut: '⌘⇧Z', icon: FiRotateCw }} active={false} onClick={() => editor.redo()} /> : null}
      {!readOnly && <>
        <ToolButton tool={{ id: 'copy', label: 'Copy', icon: FiCopy }} active={false}
          disabled={!canActOnSelection} onClick={() => {
            if (onCopy) onCopy(selectedIds);
            else editor.copy(selectedIds);
          }} />
        <ToolButton tool={{ id: 'delete', label: 'Delete', icon: FiTrash2 }} active={false}
          disabled={!canDelete} onClick={() => editor.deleteShapes(selectedIds)} />
      </>}
      {assetsAvailable ? <ToolButton tool={{ id: 'assets', label: 'Assets', icon: FiGrid }} active={assetsOpen} onClick={() => onToggleAssets?.()} /> : null}
      {!readOnly ? <ToolButton tool={{ id: 'layers', label: 'Layers', icon: FiLayers }} active={layersOpen} onClick={() => onToggleLayers?.()} /> : null}
      {separator}
      <ToolButton
        tool={{ id: 'show-grid', label: 'Show grid', icon: LuGrid3X3 }}
        active={snapSettings.showGrid}
        onClick={() => editor.snapping.updateSettings({ showGrid: !snapSettings.showGrid })}
      />
      <ToolButton
        tool={{ id: 'snap-to-grid', label: 'Snap to grid', icon: LuGrid2X2Check }}
        active={snapSettings.snapToGrid}
        onClick={() => editor.snapping.updateSettings({ snapToGrid: !snapSettings.snapToGrid })}
      />
      <ToolButton
        tool={{ id: 'snap-to-objects', label: 'Snap to objects', icon: LuMagnet }}
        active={snapSettings.snapToObjects}
        onClick={() => editor.snapping.updateSettings({ snapToObjects: !snapSettings.snapToObjects })}
      />
      <input
        data-glideboard-ignore-shortcuts
        aria-label="Grid size"
        title="Grid size"
        type="number"
        min={2}
        value={snapSettings.gridSize}
        onChange={event => editor.snapping.updateSettings({ gridSize: Math.max(2, Number(event.target.value) || 2) })}
        style={{
          width: 42,
          height: 28,
          boxSizing: 'border-box',
          border: `1px solid ${wbTheme.border}`,
          borderRadius: 5,
          background: wbTheme.surface,
          color: wbTheme.text,
          fontSize: 12,
          textAlign: 'center',
          padding: '0 2px',
          margin: '0 2px',
          flex: '0 0 auto',
        }}
      />
    </>
  );

  const surfaceStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 0, padding: 4,
    background: wbTheme.surface, border: 'none',
    borderRadius: 8, boxShadow: wbTheme.shadow, pointerEvents: 'auto',
  };

  return (
    <div
      ref={toolbarRef}
      id={controller.domId('toolbar')}
      data-glideboard-role="toolbar"
      data-toolbar-layout={layout}
      style={{
        position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none',
      }}
    >
      <ToolbarButtonStyles />
      <div
        data-glideboard-role="toolbar-tools"
        data-glideboard-toolbar-part="primary"
        style={{
          ...surfaceStyle, position: 'absolute', left: 12, top: 12,
          display: readOnly && layout === 'split' ? 'none' : 'flex',
          flexDirection: 'column', maxHeight: 'calc(100% - 24px)', boxSizing: 'border-box',
          overflowX: 'visible', overflowY: layout === 'vertical' ? 'auto' : 'visible',
        }}
      >
        {layout === 'vertical' ? actionControls : null}
        {layout === 'vertical' && !readOnly ? separator : null}
        {!readOnly ? drawingControls : null}
      </div>
      {layout === 'split' ? (
        <div data-glideboard-role="toolbar-actions" data-glideboard-toolbar-part="actions" style={{
          ...surfaceStyle, position: 'absolute', left: 60, top: 12,
          flexDirection: 'row', maxWidth: 'calc(100% - 72px)', overflowX: 'auto',
        }}>{actionControls}</div>
      ) : null}
      {eraserPicker && !readOnly ? (
        <div ref={eraserPickerRef} role="group" aria-label="Eraser modes"
          id={controller.domId('eraser-picker')} data-glideboard-role="eraser-picker"
          onKeyDown={event => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setEraserPicker(null);
            eraserTriggerRef.current?.focus();
          }}
          onBlur={event => {
            if (event.relatedTarget !== eraserTriggerRef.current && !event.currentTarget.contains(event.relatedTarget)) {
              setEraserPicker(null);
            }
          }}
          style={{
            ...surfaceStyle, ...eraserPicker, position: 'absolute',
            width: ERASER_PICKER_WIDTH, height: ERASER_PICKER_HEIGHT,
            maxWidth: 'calc(100% - 16px)', boxSizing: 'border-box',
            gap: 2,
            border: `1px solid ${wbTheme.border}`,
          }}>
          {ERASER_MODES.map(mode => (
            <button key={mode.id} type="button" className="glideboard-toolbar-button"
              aria-label={mode.label}
              title={`${mode.label} (${mode.shortcut})`}
              aria-keyshortcuts={mode.id === 'eraser' ? 'X' : undefined}
              data-isactive={eraserTool === mode.id} aria-pressed={eraserTool === mode.id}
              autoFocus={eraserTool === mode.id}
              onClick={() => {
                selectTool(mode.id);
                eraserTriggerRef.current?.focus();
              }}
              style={{
                ...buttonStyle,
                color: eraserTool === mode.id ? wbTheme.accentText : wbTheme.text,
              }}>
              {mode.id === 'eraser' ? <LuEraser size={16} aria-hidden="true" />
                : <EraserIcon partial={mode.id === 'partial-eraser'} area={mode.id === 'area-eraser'} />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
