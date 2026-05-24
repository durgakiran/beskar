import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { arrowPresetSignal, setConnectorPreset, wbEditor } from './editor';
import { useSignalValue } from './useSignalValue';
const SHAPE_TOOLS = [
    { id: 'box', label: 'Rectangle', shortcut: 'R', icon: '▭' },
    { id: 'ellipse', label: 'Ellipse', shortcut: 'E', icon: '○' },
    { id: 'triangle', label: 'Triangle', icon: '△' },
    { id: 'diamond', label: 'Diamond', icon: '◇' },
    { id: 'hexagon', label: 'Hexagon', icon: '⬡' },
    { id: 'star', label: 'Star', icon: '☆' },
];
const SHAPE_TOOL_IDS = new Set(SHAPE_TOOLS.map(tool => tool.id));
const ARROW_TOOLS = [
    { id: 'connector-line', label: 'Line', shortcut: 'A', icon: '─', preset: 'line' },
    { id: 'connector-arrow', label: 'Arrow', icon: '→', preset: 'arrow' },
    { id: 'connector-double-arrow', label: 'Double Arrow', icon: '↔', preset: 'double-arrow' },
];
const TOOLS = [
    { id: 'select', label: 'Select', shortcut: 'V', icon: '↖' },
    { id: 'hand', label: 'Hand', shortcut: 'H', icon: '✋' },
    { id: 'shape-picker', label: 'Shapes', shortcut: 'R', icon: '▭' },
    { id: 'text', label: 'Text', shortcut: 'T', icon: 'A' },
    { id: 'sticky-note', label: 'Sticky', shortcut: 'S', icon: '🗒' },
    { id: 'draw', label: 'Draw', shortcut: 'D', icon: '✏' },
    { id: 'eraser', label: 'Eraser', shortcut: 'X', icon: '⌫' },
    { id: 'arrow-picker', label: 'Arrow', shortcut: 'A', icon: '→' },
];
const buttonStyle = {
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
function ToolButton({ tool, active, onClick }) {
    return (_jsxs("button", { id: `wb-tool-${tool.id}`, title: tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label, onClick: onClick, style: {
            ...buttonStyle,
            border: active ? '1.5px solid #89b4fa' : '1.5px solid transparent',
            background: active ? '#89b4fa22' : 'transparent',
            color: active ? '#89b4fa' : '#6c7086',
        }, children: [_jsx("span", { style: { fontSize: 18 }, children: tool.icon }), tool.shortcut ? (_jsx("span", { style: { fontSize: 8, marginTop: 2, opacity: 0.7, fontFamily: 'monospace' }, children: tool.shortcut })) : null] }));
}
function ShapePickerButton({ active, currentShapeTool, isOpen, onToggle, onSelectShape, }) {
    return (_jsxs("div", { style: { position: 'relative' }, children: [_jsxs("button", { id: "wb-tool-shape-picker", title: `Shapes (${currentShapeTool.label})`, onClick: onToggle, style: {
                    ...buttonStyle,
                    border: active ? '1.5px solid #89b4fa' : '1.5px solid transparent',
                    background: active ? '#89b4fa22' : 'transparent',
                    color: active ? '#89b4fa' : '#6c7086',
                }, children: [_jsx("span", { style: { fontSize: 18 }, children: currentShapeTool.icon }), _jsx("span", { style: { fontSize: 9, marginTop: 2, opacity: 0.7 }, children: isOpen ? '⌃' : '⌄' })] }), isOpen ? (_jsx("div", { id: "wb-shape-picker", style: {
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
                }, children: SHAPE_TOOLS.map(tool => {
                    const selected = currentShapeTool.id === tool.id;
                    return (_jsx("button", { id: `wb-shape-option-${tool.id}`, title: tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label, onClick: () => onSelectShape(tool.id), style: {
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
                        }, children: tool.icon }, tool.id));
                }) })) : null] }));
}
function ArrowPickerButton({ active, currentArrowTool, isOpen, onToggle, onSelectArrow, }) {
    return (_jsxs("div", { style: { position: 'relative' }, children: [_jsxs("button", { id: "wb-tool-arrow-picker", title: `Connector (${currentArrowTool.label})`, onClick: onToggle, style: {
                    ...buttonStyle,
                    border: active ? '1.5px solid #89b4fa' : '1.5px solid transparent',
                    background: active ? '#89b4fa22' : 'transparent',
                    color: active ? '#89b4fa' : '#6c7086',
                }, children: [_jsx("span", { style: { fontSize: 18 }, children: currentArrowTool.icon }), _jsx("span", { style: { fontSize: 9, marginTop: 2, opacity: 0.7 }, children: isOpen ? '⌃' : '⌄' })] }), isOpen ? (_jsx("div", { id: "wb-arrow-picker", style: {
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
                }, children: ARROW_TOOLS.map(tool => {
                    const selected = currentArrowTool.preset === tool.preset;
                    return (_jsx("button", { id: `wb-arrow-option-${tool.preset}`, title: tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label, onClick: () => onSelectArrow(tool.preset), style: {
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
                        }, children: tool.icon }, tool.id));
                }) })) : null] }));
}
export function Toolbar() {
    const activeTool = useSignalValue(wbEditor.currentToolId) ?? 'select';
    const currentArrowPreset = useSignalValue(arrowPresetSignal) ?? 'arrow';
    const toolbarRef = React.useRef(null);
    const [isShapePickerOpen, setIsShapePickerOpen] = React.useState(false);
    const [isArrowPickerOpen, setIsArrowPickerOpen] = React.useState(false);
    const [currentShapeToolId, setCurrentShapeToolId] = React.useState('box');
    React.useEffect(() => {
        if (SHAPE_TOOL_IDS.has(activeTool)) {
            setCurrentShapeToolId(activeTool);
        }
        else if (isShapePickerOpen) {
            setIsShapePickerOpen(false);
        }
        if (activeTool !== 'arrow' && isArrowPickerOpen) {
            setIsArrowPickerOpen(false);
        }
    }, [activeTool, isArrowPickerOpen, isShapePickerOpen]);
    React.useEffect(() => {
        const handlePointerDown = (event) => {
            if (!toolbarRef.current?.contains(event.target)) {
                setIsShapePickerOpen(false);
                setIsArrowPickerOpen(false);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, []);
    const currentShapeTool = SHAPE_TOOLS.find(tool => tool.id === currentShapeToolId) ?? SHAPE_TOOLS[0];
    const currentArrowTool = ARROW_TOOLS.find(tool => tool.preset === currentArrowPreset) ?? ARROW_TOOLS[1];
    const selectTool = (toolId) => {
        wbEditor.setCurrentTool(toolId);
        setIsShapePickerOpen(false);
        setIsArrowPickerOpen(false);
    };
    return (_jsxs("div", { ref: toolbarRef, id: "wb-toolbar", style: {
            position: 'absolute',
            left: 12,
            top: 12,
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 8,
            background: '#1e1e2e',
            border: '1px solid #313244',
            borderRadius: 14,
            boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
        }, children: [TOOLS.map(tool => {
                if (tool.id === 'shape-picker') {
                    return (_jsx(ShapePickerButton, { active: SHAPE_TOOL_IDS.has(activeTool), currentShapeTool: currentShapeTool, isOpen: isShapePickerOpen, onToggle: () => {
                            setIsArrowPickerOpen(false);
                            setIsShapePickerOpen(open => !open);
                            if (!SHAPE_TOOL_IDS.has(activeTool)) {
                                wbEditor.setCurrentTool(currentShapeTool.id);
                            }
                        }, onSelectShape: (toolId) => {
                            setCurrentShapeToolId(toolId);
                            selectTool(toolId);
                        } }, tool.id));
                }
                if (tool.id === 'arrow-picker') {
                    return (_jsx(ArrowPickerButton, { active: activeTool === 'arrow', currentArrowTool: currentArrowTool, isOpen: isArrowPickerOpen, onToggle: () => {
                            setIsShapePickerOpen(false);
                            setIsArrowPickerOpen(open => !open);
                            wbEditor.setCurrentTool('arrow');
                        }, onSelectArrow: (preset) => {
                            setConnectorPreset(preset);
                            wbEditor.setCurrentTool('arrow');
                            setIsArrowPickerOpen(false);
                        } }, tool.id));
                }
                return (_jsx(ToolButton, { tool: tool, active: activeTool === tool.id, onClick: () => selectTool(tool.id) }, tool.id));
            }), _jsx("div", { style: { width: '100%', height: 1, background: '#313244', margin: '2px 0' } }), _jsx(ToolButton, { tool: { id: 'undo', label: 'Undo', shortcut: '⌘Z', icon: '↶' }, active: false, onClick: () => wbEditor.undo() }), _jsx(ToolButton, { tool: { id: 'redo', label: 'Redo', shortcut: '⌘⇧Z', icon: '↷' }, active: false, onClick: () => wbEditor.redo() })] }));
}
//# sourceMappingURL=Toolbar.js.map