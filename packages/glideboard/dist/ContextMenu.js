import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { wbEditor } from './editor';
export function ContextMenu({ position, onClose }) {
    const menuRef = useRef(null);
    useEffect(() => {
        if (!position)
            return;
        const handlePointerDown = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                onClose();
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [onClose, position]);
    if (!position)
        return null;
    const selectedIds = wbEditor.getSelectedShapeIds();
    const hasSelection = selectedIds.length > 0;
    const handlePaste = () => {
        const canvas = document.getElementById('wb-canvas');
        if (!canvas)
            return;
        const rect = canvas.getBoundingClientRect();
        const pagePoint = wbEditor.screenToPage({
            x: position.x - rect.left,
            y: position.y - rect.top,
        });
        wbEditor.paste(pagePoint);
        onClose();
    };
    return (_jsxs("div", { ref: menuRef, style: {
            position: 'fixed',
            left: position.x,
            top: position.y,
            background: '#1e1e2e',
            border: '1px solid #313244',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: '8px 0',
            zIndex: 9999,
            minWidth: 180,
            color: '#cdd6f4',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 13,
            userSelect: 'none',
        }, onContextMenu: event => event.preventDefault(), children: [_jsx(MenuItem, { label: "Copy", shortcut: "Cmd+C", disabled: !hasSelection, onClick: () => { wbEditor.copy(selectedIds); onClose(); } }), _jsx(MenuItem, { label: "Paste", shortcut: "Cmd+V", disabled: false, onClick: handlePaste }), _jsx(MenuItem, { label: "Duplicate", shortcut: "Cmd+D", disabled: !hasSelection, onClick: () => { wbEditor.duplicateShapes(selectedIds, { x: 20, y: 20 }); onClose(); } }), _jsx("div", { style: { height: 1, background: '#313244', margin: '6px 0' } }), _jsx(MenuItem, { label: "Bring to front", shortcut: "Cmd+Shift+]", disabled: !hasSelection, onClick: () => { wbEditor.reorderShapes(selectedIds, 'front'); onClose(); } }), _jsx(MenuItem, { label: "Bring forward", shortcut: "Cmd+]", disabled: !hasSelection, onClick: () => { wbEditor.reorderShapes(selectedIds, 'forward'); onClose(); } }), _jsx(MenuItem, { label: "Send backward", shortcut: "Cmd+[", disabled: !hasSelection, onClick: () => { wbEditor.reorderShapes(selectedIds, 'backward'); onClose(); } }), _jsx(MenuItem, { label: "Send to back", shortcut: "Cmd+Shift+[", disabled: !hasSelection, onClick: () => { wbEditor.reorderShapes(selectedIds, 'back'); onClose(); } }), _jsx("div", { style: { height: 1, background: '#313244', margin: '6px 0' } }), _jsx(MenuItem, { label: "Delete", shortcut: "Backspace", disabled: !hasSelection, color: "#f38ba8", onClick: () => { wbEditor.deleteShapes(selectedIds); onClose(); } })] }));
}
function MenuItem({ label, shortcut, disabled, onClick, color, }) {
    return (_jsxs("div", { onClick: disabled ? undefined : onClick, style: {
            padding: '6px 16px',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.4 : 1,
            color: color || 'inherit',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'transparent',
        }, onPointerEnter: event => {
            if (!disabled)
                event.currentTarget.style.background = '#313244';
        }, onPointerLeave: event => {
            if (!disabled)
                event.currentTarget.style.background = 'transparent';
        }, children: [_jsx("span", { children: label }), _jsx("span", { style: { opacity: 0.5, fontSize: 11 }, children: shortcut })] }));
}
//# sourceMappingURL=ContextMenu.js.map