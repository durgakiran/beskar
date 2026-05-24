import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Canvas, InlineEditor } from './Canvas';
import { ContextMenu } from './ContextMenu';
import { readOnlySignal, wbEditor, } from './editor';
import { StylePanel } from './StylePanel';
import { Toolbar } from './Toolbar';
import { ZoomWidget, fitToScreen } from './ZoomWidget';
import { useSignalValue } from './useSignalValue';
const TOOL_KEYS = {
    v: 'select',
    h: 'hand',
    r: 'box',
    e: 'ellipse',
    t: 'text',
    s: 'sticky-note',
    d: 'draw',
    x: 'eraser',
    a: 'arrow',
};
export function WhiteboardApp() {
    const shapeCount = useSignalValue(wbEditor.store.getShapeIdsSignal())?.length ?? 0;
    const camera = useSignalValue(wbEditor.camera.signal);
    const readOnly = useSignalValue(readOnlySignal) ?? false;
    const [contextMenuPosition, setContextMenuPosition] = React.useState(null);
    const onContextMenu = (event) => {
        if (readOnly)
            return;
        event.preventDefault();
        setContextMenuPosition({ x: event.clientX, y: event.clientY });
    };
    const onKeyDown = (event) => {
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)
            return;
        if (wbEditor.editingShapeId.peek())
            return;
        if (!readOnly) {
            const toolId = TOOL_KEYS[event.key.toLowerCase()];
            if (toolId && !event.metaKey && !event.ctrlKey && !event.altKey) {
                wbEditor.setCurrentTool(toolId);
                return;
            }
            if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey) {
                const ids = wbEditor.getSelectedShapeIds();
                if (ids.length > 0)
                    wbEditor.deleteShapes(ids);
            }
            if (event.metaKey || event.ctrlKey) {
                const ids = wbEditor.getSelectedShapeIds();
                if (event.key === 'c' && ids.length > 0) {
                    wbEditor.copy(ids);
                }
                else if (event.key === 'x' && ids.length > 0) {
                    wbEditor.copy(ids);
                    wbEditor.deleteShapes(ids);
                }
                else if (event.key === 'v') {
                    wbEditor.paste();
                }
                else if (event.key === 'd' && ids.length > 0) {
                    event.preventDefault();
                    wbEditor.duplicateShapes(ids, { x: 20, y: 20 });
                }
                else if (event.key === ']' && ids.length > 0) {
                    event.preventDefault();
                    wbEditor.reorderShapes(ids, event.shiftKey ? 'front' : 'forward');
                }
                else if (event.key === '[' && ids.length > 0) {
                    event.preventDefault();
                    wbEditor.reorderShapes(ids, event.shiftKey ? 'back' : 'backward');
                }
            }
            if (event.key === 'Escape') {
                wbEditor.setCurrentTool('select');
                wbEditor.setSelectedShapeIds([]);
            }
        }
        if (event.key === 'z' && (event.metaKey || event.ctrlKey)) {
            if (event.shiftKey)
                wbEditor.redo();
            else
                wbEditor.undo();
        }
        if (event.key === '1' && event.shiftKey) {
            fitToScreen();
        }
    };
    return (_jsxs("div", { id: "whiteboard-app", style: {
            width: '100%',
            height: '100%',
            display: 'flex',
            position: 'relative',
            outline: 'none',
            overflow: 'hidden',
            background: '#181825',
        }, tabIndex: 0, onKeyDown: onKeyDown, onContextMenu: onContextMenu, children: [_jsx(Canvas, {}), _jsx(InlineEditor, {}), !readOnly ? _jsx(Toolbar, {}) : null, _jsx(ZoomWidget, {}), !readOnly ? _jsx(StylePanel, {}) : null, !readOnly ? (_jsx(ContextMenu, { position: contextMenuPosition, onClose: () => setContextMenuPosition(null) })) : null, _jsxs("div", { id: "wb-statusbar", style: {
                    position: 'absolute',
                    bottom: 16,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 50,
                    background: '#1e1e2e',
                    border: '1px solid #313244',
                    borderRadius: 8,
                    padding: '4px 12px',
                    fontSize: 11,
                    color: '#6c7086',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    pointerEvents: 'none',
                    userSelect: 'none',
                }, children: [shapeCount, " shape", shapeCount !== 1 ? 's' : '', camera && ` · ${Math.round(camera.z * 100)}%`, ' · ', _jsx("span", { style: { color: '#89b4fa' }, children: readOnly ? 'Read-only whiteboard' : 'Double-click to edit labels' })] })] }));
}
//# sourceMappingURL=WhiteboardApp.js.map