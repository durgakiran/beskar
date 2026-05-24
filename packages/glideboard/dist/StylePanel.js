import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from 'react';
import { TLDRAW_COLORS, } from '@durgakiran/glideline';
import { useSelectedShapes } from './hooks/useSelectedShapes';
import { setArrowRouteStyle, setArrowheadEnd, setArrowheadStart, wbEditor, } from './editor';
const panelStyle = {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 240,
    background: '#1e1e2e',
    borderRadius: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    color: '#cdd6f4',
    fontFamily: 'sans-serif',
    zIndex: 100,
    userSelect: 'none',
    pointerEvents: 'auto',
};
const sectionTitleStyle = {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#6c7086',
    marginBottom: 8,
    fontWeight: 600,
};
const rowStyle = {
    display: 'flex',
    gap: 4,
};
function IconButton({ active, onClick, children }) {
    return (_jsx("button", { onClick: onClick, style: {
            flex: 1,
            height: 28,
            borderRadius: 4,
            border: `1px solid ${active ? '#89b4fa' : '#313244'}`,
            background: active ? '#89b4fa22' : 'transparent',
            color: active ? '#89b4fa' : '#bac2de',
            cursor: 'pointer',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
        }, children: children }));
}
export function StylePanel() {
    const shapes = useSelectedShapes();
    const supportedKeys = useMemo(() => {
        const keys = new Set();
        shapes.forEach(shape => {
            Object.keys(shape.props).forEach(key => keys.add(key));
        });
        return keys;
    }, [shapes]);
    if (shapes.length === 0)
        return null;
    const getCommonValue = (key) => {
        let value = undefined;
        let first = true;
        for (const shape of shapes) {
            if (key in shape.props) {
                if (first) {
                    value = shape.props[key];
                    first = false;
                }
                else if (value !== shape.props[key]) {
                    return undefined;
                }
            }
        }
        return value;
    };
    const updateProp = (key, value) => {
        wbEditor.history.batch('Style change', () => {
            for (const shape of shapes) {
                if (key in shape.props) {
                    wbEditor.updateShape(shape.id, {
                        props: { ...shape.props, [key]: value },
                    });
                }
            }
        });
    };
    const color = getCommonValue('color');
    const fillStyle = getCommonValue('fillStyle');
    const strokeStyle = getCommonValue('strokeStyle');
    const strokeWidth = getCommonValue('strokeWidth');
    const font = getCommonValue('font');
    const fontSize = getCommonValue('fontSize');
    const textAlign = getCommonValue('textAlign');
    const labelColor = getCommonValue('labelColor');
    const routeStyle = getCommonValue('routeStyle');
    const arrowheadStart = getCommonValue('arrowheadStart');
    const arrowheadEnd = getCommonValue('arrowheadEnd');
    const updateArrowRoute = (value) => {
        setArrowRouteStyle(value);
        updateProp('routeStyle', value);
    };
    const updateArrowhead = (terminal, value) => {
        if (terminal === 'start')
            setArrowheadStart(value);
        else
            setArrowheadEnd(value);
        updateProp(terminal === 'start' ? 'arrowheadStart' : 'arrowheadEnd', value);
    };
    return (_jsxs("div", { style: panelStyle, onPointerDown: event => event.stopPropagation(), children: [supportedKeys.has('color') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "Stroke / Fill Color" }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }, children: Object.entries(TLDRAW_COLORS).map(([name, hex]) => {
                            const active = color === name || color === hex;
                            return (_jsx("button", { onClick: () => updateProp('color', name), title: name, style: {
                                    width: 24,
                                    height: 24,
                                    borderRadius: 4,
                                    border: `2px solid ${active ? '#cba6f7' : 'transparent'}`,
                                    background: hex,
                                    cursor: 'pointer',
                                    boxShadow: active ? '0 0 0 1px #1e1e2e inset' : 'none',
                                } }, name));
                        }) })] })) : null, supportedKeys.has('labelColor') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "Text Color" }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }, children: Object.entries(TLDRAW_COLORS).map(([name, hex]) => {
                            const active = labelColor === name || labelColor === hex;
                            return (_jsx("button", { onClick: () => updateProp('labelColor', name), title: name, style: {
                                    width: 24,
                                    height: 24,
                                    borderRadius: 4,
                                    border: `2px solid ${active ? '#cba6f7' : 'transparent'}`,
                                    background: hex,
                                    cursor: 'pointer',
                                    boxShadow: active ? '0 0 0 1px #1e1e2e inset' : 'none',
                                } }, name));
                        }) })] })) : null, supportedKeys.has('fillStyle') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "Fill" }), _jsxs("div", { style: rowStyle, children: [_jsx(IconButton, { active: fillStyle === 'none', onClick: () => updateProp('fillStyle', 'none'), children: "None" }), _jsx(IconButton, { active: fillStyle === 'semi', onClick: () => updateProp('fillStyle', 'semi'), children: "Semi" }), _jsx(IconButton, { active: fillStyle === 'solid', onClick: () => updateProp('fillStyle', 'solid'), children: "Solid" })] })] })) : null, supportedKeys.has('strokeWidth') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "Stroke Width" }), _jsxs("div", { style: rowStyle, children: [_jsx(IconButton, { active: strokeWidth === 'thin', onClick: () => updateProp('strokeWidth', 'thin'), children: "S" }), _jsx(IconButton, { active: strokeWidth === 'medium', onClick: () => updateProp('strokeWidth', 'medium'), children: "M" }), _jsx(IconButton, { active: strokeWidth === 'thick', onClick: () => updateProp('strokeWidth', 'thick'), children: "L" }), _jsx(IconButton, { active: strokeWidth === 'xl', onClick: () => updateProp('strokeWidth', 'xl'), children: "XL" })] })] })) : null, supportedKeys.has('strokeStyle') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "Stroke Style" }), _jsxs("div", { style: rowStyle, children: [_jsx(IconButton, { active: strokeStyle === 'solid', onClick: () => updateProp('strokeStyle', 'solid'), children: "Solid" }), _jsx(IconButton, { active: strokeStyle === 'dashed', onClick: () => updateProp('strokeStyle', 'dashed'), children: "Dash" }), _jsx(IconButton, { active: strokeStyle === 'dotted', onClick: () => updateProp('strokeStyle', 'dotted'), children: "Dot" })] })] })) : null, supportedKeys.has('routeStyle') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "Arrow Route" }), _jsxs("div", { style: rowStyle, children: [_jsx(IconButton, { active: routeStyle === 'curve', onClick: () => updateArrowRoute('curve'), children: "Curve" }), _jsx(IconButton, { active: routeStyle === 'ortho', onClick: () => updateArrowRoute('ortho'), children: "Ortho" }), _jsx(IconButton, { active: routeStyle === 'smart', onClick: () => updateArrowRoute('smart'), children: "Smart" })] })] })) : null, supportedKeys.has('arrowheadStart') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "Start Arrowhead" }), _jsxs("div", { style: rowStyle, children: [_jsx(IconButton, { active: arrowheadStart === 'none', onClick: () => updateArrowhead('start', 'none'), children: "None" }), _jsx(IconButton, { active: arrowheadStart === 'arrow', onClick: () => updateArrowhead('start', 'arrow'), children: "Arrow" })] })] })) : null, supportedKeys.has('arrowheadEnd') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "End Arrowhead" }), _jsxs("div", { style: rowStyle, children: [_jsx(IconButton, { active: arrowheadEnd === 'none', onClick: () => updateArrowhead('end', 'none'), children: "None" }), _jsx(IconButton, { active: arrowheadEnd === 'arrow', onClick: () => updateArrowhead('end', 'arrow'), children: "Arrow" })] })] })) : null, supportedKeys.has('font') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "Font Family" }), _jsxs("div", { style: rowStyle, children: [_jsx(IconButton, { active: font === 'draw', onClick: () => updateProp('font', 'draw'), children: "Draw" }), _jsx(IconButton, { active: font === 'sans', onClick: () => updateProp('font', 'sans'), children: "Sans" }), _jsx(IconButton, { active: font === 'serif', onClick: () => updateProp('font', 'serif'), children: "Serif" }), _jsx(IconButton, { active: font === 'mono', onClick: () => updateProp('font', 'mono'), children: "Mono" })] })] })) : null, supportedKeys.has('fontSize') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "Font Size" }), _jsxs("div", { style: rowStyle, children: [_jsx(IconButton, { active: fontSize === 'sm', onClick: () => updateProp('fontSize', 'sm'), children: "S" }), _jsx(IconButton, { active: fontSize === 'md', onClick: () => updateProp('fontSize', 'md'), children: "M" }), _jsx(IconButton, { active: fontSize === 'lg', onClick: () => updateProp('fontSize', 'lg'), children: "L" }), _jsx(IconButton, { active: fontSize === 'xl', onClick: () => updateProp('fontSize', 'xl'), children: "XL" })] })] })) : null, supportedKeys.has('textAlign') ? (_jsxs("div", { children: [_jsx("div", { style: sectionTitleStyle, children: "Text Align" }), _jsxs("div", { style: rowStyle, children: [_jsx(IconButton, { active: textAlign === 'left', onClick: () => updateProp('textAlign', 'left'), children: "Left" }), _jsx(IconButton, { active: textAlign === 'center', onClick: () => updateProp('textAlign', 'center'), children: "Center" }), _jsx(IconButton, { active: textAlign === 'right', onClick: () => updateProp('textAlign', 'right'), children: "Right" })] })] })) : null] }));
}
//# sourceMappingURL=StylePanel.js.map