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
} from 'react-icons/lu';
import { useGlideboardController } from './GlideboardContext';
import type { ConnectorPreset } from './GlideboardController';
import { wbTheme } from './theme';
import { useSignalValue } from './useSignalValue';

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
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  borderRadius: 10,
  border: '1.5px solid transparent',
  background: 'transparent',
  color: wbTheme.textSoft,
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
  transition: 'all 0.12s',
  position: 'relative',
};

function ToolButton({ tool, active, onClick }: { tool: ToolDef; active: boolean; onClick: () => void }) {
  const controller = useGlideboardController();
  const Icon = tool.icon;
  return (
    <button
      id={controller.domId(`tool-${tool.id}`)}
      data-glideboard-tool={tool.id}
      title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
      onClick={onClick}
      style={{
        ...buttonStyle,
        border: active ? `1.5px solid ${wbTheme.accent}` : '1.5px solid transparent',
        background: active ? wbTheme.accentSurface : 'transparent',
        color: active ? wbTheme.accentText : wbTheme.textSoft,
      }}
    >
      <span style={{ fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={18} /></span>
      {tool.shortcut ? (
        <span style={{ fontSize: 8, marginTop: 2, opacity: 0.7, fontFamily: 'monospace' }}>{tool.shortcut}</span>
      ) : null}
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
        id={controller.domId('tool-shape-picker')}
        data-glideboard-control="shape-picker"
        title={`Shapes (${currentShapeTool.label})`}
        onClick={onToggle}
        style={{
          ...buttonStyle,
          border: active ? `1.5px solid ${wbTheme.accent}` : '1.5px solid transparent',
          background: active ? wbTheme.accentSurface : 'transparent',
          color: active ? wbTheme.accentText : wbTheme.textSoft,
        }}
      >
        <span style={{ fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={18} /></span>
        <span style={{ fontSize: 9, marginTop: 2, opacity: 0.7 }}>{isOpen ? '⌃' : '⌄'}</span>
      </button>

      {isOpen ? (
        <div
          id={controller.domId('shape-picker')}
          data-glideboard-role="shape-picker"
          style={{
            position: 'absolute',
            left: 56,
            top: -6,
            zIndex: 120,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 48px)',
            gap: 8,
            padding: 10,
            background: wbTheme.surface,
            border: `1px solid ${wbTheme.border}`,
            borderRadius: 14,
            boxShadow: wbTheme.shadow,
          }}
        >
          {SHAPE_TOOLS.map(tool => {
            const selected = currentShapeTool.id === tool.id;
            const ToolIcon = tool.icon;
            return (
              <button
                key={tool.id}
                id={controller.domId(`shape-option-${tool.id}`)}
                data-glideboard-shape-option={tool.id}
                title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                onClick={() => onSelectShape(tool.id)}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  border: selected ? `1.5px solid ${wbTheme.accent}` : `1px solid ${wbTheme.border}`,
                  background: selected ? wbTheme.accentSurface : wbTheme.surfaceMuted,
                  color: selected ? wbTheme.accentText : wbTheme.text,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: 20,
                }}
              >
                <ToolIcon size={20} />
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
        id={controller.domId('tool-arrow-picker')}
        data-glideboard-control="arrow-picker"
        title={`Connector (${currentArrowTool.label})`}
        onClick={onToggle}
        style={{
          ...buttonStyle,
          border: active ? `1.5px solid ${wbTheme.accent}` : '1.5px solid transparent',
          background: active ? wbTheme.accentSurface : 'transparent',
          color: active ? wbTheme.accentText : wbTheme.textSoft,
        }}
      >
        <span style={{ fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={18} /></span>
        <span style={{ fontSize: 9, marginTop: 2, opacity: 0.7 }}>{isOpen ? '⌃' : '⌄'}</span>
      </button>

      {isOpen ? (
        <div
          id={controller.domId('arrow-picker')}
          data-glideboard-role="arrow-picker"
          style={{
            position: 'absolute',
            left: 56,
            top: -6,
            zIndex: 120,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 56px)',
            gap: 8,
            padding: 10,
            background: wbTheme.surface,
            border: `1px solid ${wbTheme.border}`,
            borderRadius: 14,
            boxShadow: wbTheme.shadow,
          }}
        >
          {ARROW_TOOLS.map(tool => {
            const selected = currentArrowTool.preset === tool.preset;
            const ToolIcon = tool.icon;
            return (
              <button
                key={tool.id}
                id={controller.domId(`arrow-option-${tool.preset}`)}
                data-glideboard-arrow-option={tool.preset}
                title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                onClick={() => onSelectArrow(tool.preset)}
                style={{
                  width: 56,
                  height: 48,
                  borderRadius: 12,
                  border: selected ? `1.5px solid ${wbTheme.accent}` : `1px solid ${wbTheme.border}`,
                  background: selected ? wbTheme.accentSurface : wbTheme.surfaceMuted,
                  color: selected ? wbTheme.accentText : wbTheme.text,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: 20,
                }}
              >
                <ToolIcon size={20} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Toolbar({ layersOpen = false, onToggleLayers }: { layersOpen?: boolean; onToggleLayers?: () => void }) {
  const controller = useGlideboardController();
  const { editor } = controller;
  const activeTool = useSignalValue(editor.currentToolId) ?? 'select';
  const currentArrowPreset = useSignalValue(controller.arrowPresetSignal) ?? 'arrow';
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

  return (
    <div
      ref={toolbarRef}
      id={controller.domId('toolbar')}
      data-glideboard-role="toolbar"
      style={{
        position: 'absolute',
        left: 12,
        top: 12,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        background: wbTheme.surface,
        border: `1px solid ${wbTheme.border}`,
        borderRadius: 14,
        boxShadow: wbTheme.shadow,
      }}
    >
      {TOOLS.map(tool => {
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
                if (!SHAPE_TOOL_IDS.has(activeTool)) {
                  controller.setCurrentTool(currentShapeTool.id);
                }
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

        return (
          <ToolButton
            key={tool.id}
            tool={tool}
            active={activeTool === tool.id}
            onClick={() => selectTool(tool.id)}
          />
        );
      })}

      <div style={{ width: '100%', height: 1, background: wbTheme.border, margin: '2px 0' }} />

      <ToolButton tool={{ id: 'undo', label: 'Undo', shortcut: '⌘Z', icon: FiRotateCcw }} active={false} onClick={() => editor.undo()} />
      <ToolButton tool={{ id: 'redo', label: 'Redo', shortcut: '⌘⇧Z', icon: FiRotateCw }} active={false} onClick={() => editor.redo()} />
      <ToolButton tool={{ id: 'layers', label: 'Layers', icon: FiLayers }} active={layersOpen} onClick={() => onToggleLayers?.()} />
    </div>
  );
}
