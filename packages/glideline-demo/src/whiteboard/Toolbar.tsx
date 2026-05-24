/**
 * whiteboard/Toolbar.tsx
 *
 * Left-side floating toolbar with:
 *  - Tool buttons (select, hand, shapes, text, sticky, draw, eraser, arrow)
 *  - Shape picker popover for rectangle / ellipse / triangle / diamond / hexagon / star
 *  - Active tool highlight
 *  - Undo / Redo buttons
 */

import React from 'react';
import { arrowPresetSignal, setConnectorPreset, wbEditor, type ConnectorPreset } from './editor';
import { useSignalValue } from '../useSignalValue';

interface ToolDef {
  id: string;
  label: string;
  shortcut?: string;
  icon: string;
}

const SHAPE_TOOLS: ToolDef[] = [
  { id: 'box', label: 'Rectangle', shortcut: 'R', icon: '▭' },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'E', icon: '○' },
  { id: 'triangle', label: 'Triangle', icon: '△' },
  { id: 'diamond', label: 'Diamond', icon: '◇' },
  { id: 'hexagon', label: 'Hexagon', icon: '⬡' },
  { id: 'star', label: 'Star', icon: '☆' },
];

const SHAPE_TOOL_IDS = new Set(SHAPE_TOOLS.map(tool => tool.id));

const ARROW_TOOLS: Array<ToolDef & { preset: ConnectorPreset }> = [
  { id: 'connector-line', label: 'Line', shortcut: 'A', icon: '─', preset: 'line' },
  { id: 'connector-arrow', label: 'Arrow', icon: '→', preset: 'arrow' },
  { id: 'connector-double-arrow', label: 'Double Arrow', icon: '↔', preset: 'double-arrow' },
];

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: '↖' },
  { id: 'hand', label: 'Hand', shortcut: 'H', icon: '✋' },
  { id: 'shape-picker', label: 'Shapes', shortcut: 'R', icon: '▭' },
  { id: 'text', label: 'Text', shortcut: 'T', icon: 'A' },
  { id: 'sticky-note', label: 'Sticky', shortcut: 'S', icon: '🗒' },
  { id: 'draw', label: 'Draw', shortcut: 'D', icon: '✏' },
  { id: 'eraser', label: 'Eraser', shortcut: 'X', icon: '⌫' },
  { id: 'arrow-picker', label: 'Arrow', shortcut: 'A', icon: '→' },
];

const BUTTON_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  borderRadius: 10,
  border: '1.5px solid transparent',
  background: 'transparent',
  color: '#6c7086',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
  transition: 'all 0.12s',
  position: 'relative',
};

function ToolButton({ tool, active, onClick }: { tool: ToolDef; active: boolean; onClick: () => void }) {
  return (
    <button
      id={`wb-tool-${tool.id}`}
      title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
      onClick={onClick}
      style={{
        ...BUTTON_STYLE,
        border: active ? '1.5px solid #89b4fa' : '1.5px solid transparent',
        background: active ? '#89b4fa22' : 'transparent',
        color: active ? '#89b4fa' : '#6c7086',
      }}
    >
      <span style={{ fontSize: 18 }}>{tool.icon}</span>
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
  return (
    <div style={{ position: 'relative' }}>
      <button
        id="wb-tool-shape-picker"
        title={`Shapes (${currentShapeTool.label})`}
        onClick={onToggle}
        style={{
          ...BUTTON_STYLE,
          border: active ? '1.5px solid #89b4fa' : '1.5px solid transparent',
          background: active ? '#89b4fa22' : 'transparent',
          color: active ? '#89b4fa' : '#6c7086',
        }}
      >
        <span style={{ fontSize: 18 }}>{currentShapeTool.icon}</span>
        <span style={{ fontSize: 9, marginTop: 2, opacity: 0.7 }}>{isOpen ? '⌃' : '⌄'}</span>
      </button>

      {isOpen ? (
        <div
          id="wb-shape-picker"
          style={{
            position: 'absolute',
            left: 56,
            top: -6,
            zIndex: 120,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 48px)',
            gap: 8,
            padding: 10,
            background: '#1e1e2e',
            border: '1px solid #313244',
            borderRadius: 14,
            boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
          }}
        >
          {SHAPE_TOOLS.map(tool => {
            const selected = currentShapeTool.id === tool.id;
            return (
              <button
                key={tool.id}
                id={`wb-shape-option-${tool.id}`}
                title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                onClick={() => onSelectShape(tool.id)}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  border: selected ? '1.5px solid #89b4fa' : '1px solid #313244',
                  background: selected ? '#89b4fa22' : '#181825',
                  color: selected ? '#89b4fa' : '#cdd6f4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: 20,
                }}
              >
                {tool.icon}
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
  return (
    <div style={{ position: 'relative' }}>
      <button
        id="wb-tool-arrow-picker"
        title={`Connector (${currentArrowTool.label})`}
        onClick={onToggle}
        style={{
          ...BUTTON_STYLE,
          border: active ? '1.5px solid #89b4fa' : '1.5px solid transparent',
          background: active ? '#89b4fa22' : 'transparent',
          color: active ? '#89b4fa' : '#6c7086',
        }}
      >
        <span style={{ fontSize: 18 }}>{currentArrowTool.icon}</span>
        <span style={{ fontSize: 9, marginTop: 2, opacity: 0.7 }}>{isOpen ? '⌃' : '⌄'}</span>
      </button>

      {isOpen ? (
        <div
          id="wb-arrow-picker"
          style={{
            position: 'absolute',
            left: 56,
            top: -6,
            zIndex: 120,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 56px)',
            gap: 8,
            padding: 10,
            background: '#1e1e2e',
            border: '1px solid #313244',
            borderRadius: 14,
            boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
          }}
        >
          {ARROW_TOOLS.map(tool => {
            const selected = currentArrowTool.preset === tool.preset;
            return (
              <button
                key={tool.id}
                id={`wb-arrow-option-${tool.preset}`}
                title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
                onClick={() => onSelectArrow(tool.preset)}
                style={{
                  width: 56,
                  height: 48,
                  borderRadius: 12,
                  border: selected ? '1.5px solid #89b4fa' : '1px solid #313244',
                  background: selected ? '#89b4fa22' : '#181825',
                  color: selected ? '#89b4fa' : '#cdd6f4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: 20,
                }}
              >
                {tool.icon}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Toolbar() {
  const activeTool = useSignalValue(wbEditor.currentToolId) ?? 'select';
  const currentArrowPreset = useSignalValue(arrowPresetSignal) ?? 'arrow';
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
    if (!isShapePickerOpen && !isArrowPickerOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) {
        setIsShapePickerOpen(false);
        setIsArrowPickerOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isArrowPickerOpen, isShapePickerOpen]);

  const currentShapeTool = SHAPE_TOOLS.find(tool => tool.id === currentShapeToolId) ?? SHAPE_TOOLS[0]!;
  const currentArrowTool = ARROW_TOOLS.find(tool => tool.preset === currentArrowPreset) ?? ARROW_TOOLS[1]!;
  const shapeToolsActive = SHAPE_TOOL_IDS.has(activeTool);
  const arrowToolActive = activeTool === 'arrow';

  const handleToolClick = (toolId: string) => {
    setIsShapePickerOpen(false);
    setIsArrowPickerOpen(false);
    wbEditor.setCurrentTool(toolId);
  };

  const handleShapePickerToggle = () => {
    setIsArrowPickerOpen(false);
    wbEditor.setCurrentTool(currentShapeTool.id);
    setIsShapePickerOpen(open => !open);
  };

  const handleShapeSelect = (toolId: string) => {
    setCurrentShapeToolId(toolId);
    setIsShapePickerOpen(false);
    wbEditor.setCurrentTool(toolId);
  };

  const handleArrowPickerToggle = () => {
    setIsShapePickerOpen(false);
    wbEditor.setCurrentTool('arrow');
    setIsArrowPickerOpen(open => !open);
  };

  const handleArrowSelect = (preset: ConnectorPreset) => {
    setConnectorPreset(preset);
    setIsArrowPickerOpen(false);
    wbEditor.setCurrentTool('arrow');
  };

  return (
    <div
      ref={toolbarRef}
      id="wb-toolbar"
      style={{
        position: 'absolute',
        left: 12,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        background: '#1e1e2e',
        border: '1px solid #313244',
        borderRadius: 14,
        padding: '10px 6px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      {TOOLS.map(tool => {
        if (tool.id === 'shape-picker') {
          return (
            <ShapePickerButton
              key={tool.id}
              active={shapeToolsActive || isShapePickerOpen}
              currentShapeTool={currentShapeTool}
              isOpen={isShapePickerOpen}
              onToggle={handleShapePickerToggle}
              onSelectShape={handleShapeSelect}
            />
          );
        }

        if (tool.id === 'arrow-picker') {
          return (
            <ArrowPickerButton
              key={tool.id}
              active={arrowToolActive || isArrowPickerOpen}
              currentArrowTool={currentArrowTool}
              isOpen={isArrowPickerOpen}
              onToggle={handleArrowPickerToggle}
              onSelectArrow={handleArrowSelect}
            />
          );
        }

        return (
          <ToolButton
            key={tool.id}
            tool={tool}
            active={activeTool === tool.id}
            onClick={() => handleToolClick(tool.id)}
          />
        );
      })}

      <div style={{ width: 32, height: 1, background: '#313244', margin: '4px 0' }} />

      <button
        id="wb-undo"
        title="Undo (⌘Z)"
        onClick={() => {
          setIsShapePickerOpen(false);
          wbEditor.undo();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 36,
          borderRadius: 8,
          border: '1.5px solid transparent',
          background: 'transparent',
          color: '#6c7086',
          cursor: 'pointer',
          fontSize: 16,
          transition: 'all 0.12s',
        }}
      >
        ↩
      </button>

      <button
        id="wb-redo"
        title="Redo (⇧⌘Z)"
        onClick={() => {
          setIsShapePickerOpen(false);
          wbEditor.redo();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 36,
          borderRadius: 8,
          border: '1.5px solid transparent',
          background: 'transparent',
          color: '#6c7086',
          cursor: 'pointer',
          fontSize: 16,
          transition: 'all 0.12s',
        }}
      >
        ↪
      </button>
    </div>
  );
}
