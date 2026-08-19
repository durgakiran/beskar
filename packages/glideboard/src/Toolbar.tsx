import React from 'react';
import {
  FiMousePointer,
  FiMove,
  FiSquare,
  FiCircle,
  FiTriangle,
  FiHexagon,
  FiStar,
  FiType,
  FiFileText,
  FiPenTool,
  FiMinus,
  FiArrowRight,
  FiRepeat,
  FiRotateCcw,
  FiRotateCw,
  FiLayout,
  FiLayers,
  FiImage,
  FiGrid,
} from 'react-icons/fi';
import {
  LuEraser,
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
import type { GlideboardToolbarLayout } from './types.js';

interface ToolDef {
  id: string;
  label: string;
  shortcut?: string;
  icon: React.ComponentType<any>;
}

const SHAPE_TOOLS: ToolDef[] = [
  { id: 'box', label: 'Rectangle', shortcut: 'R', icon: FiSquare },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'E', icon: FiCircle },
  { id: 'triangle', label: 'Triangle', icon: FiTriangle },
  { id: 'diamond', label: 'Diamond', icon: LuDiamond },
  { id: 'hexagon', label: 'Hexagon', icon: FiHexagon },
  { id: 'star', label: 'Star', icon: FiStar },
  { id: 'rounded-rect', label: 'Rounded Rect', icon: LuRectangleHorizontal },
  { id: 'parallelogram', label: 'Parallelogram', icon: FiSquare },
  { id: 'chevron', label: 'Chevron', icon: LuChevronsRight },
  { id: 'document', label: 'Document', icon: LuFileOutput },
  { id: 'cylinder', label: 'Cylinder', icon: LuDatabase },
  { id: 'note', label: 'Note', icon: LuStickyNote },
  { id: 'callout', label: 'Callout', icon: LuMessageSquare },
];

const SHAPE_TOOL_IDS = new Set(SHAPE_TOOLS.map(tool => tool.id));

const ARROW_TOOLS: Array<ToolDef & { preset: ConnectorPreset }> = [
  { id: 'connector-line', label: 'Line', shortcut: 'A', icon: FiMinus, preset: 'line' },
  { id: 'connector-arrow', label: 'Arrow', icon: FiArrowRight, preset: 'arrow' },
  { id: 'connector-double-arrow', label: 'Double Arrow', icon: FiRepeat, preset: 'double-arrow' },
];

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: FiMousePointer },
  { id: 'hand', label: 'Hand', shortcut: 'H', icon: FiMove },
  { id: 'shape-picker', label: 'Shapes', shortcut: 'R', icon: FiSquare },
  { id: 'text', label: 'Text', shortcut: 'T', icon: FiType },
  { id: 'sticky-note', label: 'Sticky', shortcut: 'S', icon: FiFileText },
  { id: 'frame', label: 'Frame', shortcut: 'F', icon: FiLayout },
  { id: 'draw', label: 'Draw', shortcut: 'D', icon: FiPenTool },
  { id: 'eraser', label: 'Eraser', shortcut: 'X', icon: LuEraser },
  { id: 'arrow-picker', label: 'Arrow', shortcut: 'A', icon: FiArrowRight },
];

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

function ToolButton({ tool, active, onClick }: { tool: ToolDef; active: boolean; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
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
      onClick={onClick}
      style={{
        ...buttonStyle,
        color: active ? wbTheme.accentText : wbTheme.textSoft,
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
}: {
  layout?: GlideboardToolbarLayout;
  layersOpen?: boolean;
  assetsOpen?: boolean;
  assetsAvailable?: boolean;
  readOnly?: boolean;
  onToggleLayers?: () => void;
  onToggleAssets?: () => void;
  onRequestAssetImport?: (trigger: HTMLElement) => void;
}) {
  const controller = useGlideboardController();
  const { editor } = controller;
  const activeTool = useSignalValue(editor.currentToolId) ?? 'select';
  const currentArrowPreset = useSignalValue(controller.arrowPresetSignal) ?? 'arrow';
  const snapSettings = useSignalValue(editor.snapping.settings)!;
  const toolbarRef = React.useRef<HTMLDivElement>(null);
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
  }, [activeTool, isArrowPickerOpen, isShapePickerOpen]);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setIsShapePickerOpen(false);
        setIsArrowPickerOpen(false);
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
          flexDirection: 'row', maxWidth: 'calc(100% - 72px)',
        }}>{actionControls}</div>
      ) : null}
    </div>
  );
}
