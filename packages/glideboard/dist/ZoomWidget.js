import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { wbEditor } from './editor';
import { useSignalValue } from './useSignalValue';
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;
export function fitToScreen() {
    const shapes = wbEditor.getShapes();
    if (shapes.length === 0) {
        wbEditor.camera.setCamera({ x: 0, y: 0, z: 1 });
        return;
    }
    const container = document.getElementById('wb-canvas');
    if (!container)
        return;
    const { width, height } = container.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const shape of shapes) {
        const bounds = wbEditor.getShapeWorldBounds(shape);
        if (bounds.minX < minX)
            minX = bounds.minX;
        if (bounds.minY < minY)
            minY = bounds.minY;
        if (bounds.maxX > maxX)
            maxX = bounds.maxX;
        if (bounds.maxY > maxY)
            maxY = bounds.maxY;
    }
    const pad = 60;
    const contentWidth = maxX - minX + pad * 2;
    const contentHeight = maxY - minY + pad * 2;
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(width / contentWidth, height / contentHeight)));
    wbEditor.camera.setCamera({
        x: minX - pad,
        y: minY - pad,
        z,
    });
}
const buttonStyle = {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: '#a6adc8',
    cursor: 'pointer',
    fontSize: 18,
    borderRadius: 8,
    transition: 'background 0.12s, color 0.12s',
};
function zoomToward(newZ) {
    const camera = wbEditor.camera.getCamera();
    const container = document.getElementById('wb-canvas');
    if (!container) {
        wbEditor.camera.setCamera({ z: newZ });
        return;
    }
    const { width, height } = container.getBoundingClientRect();
    const screenX = width / 2;
    const screenY = height / 2;
    const pagePointX = screenX / camera.z + camera.x;
    const pagePointY = screenY / camera.z + camera.y;
    wbEditor.camera.setCamera({
        x: pagePointX - screenX / newZ,
        y: pagePointY - screenY / newZ,
        z: newZ,
    });
}
export function ZoomWidget() {
    const camera = useSignalValue(wbEditor.camera.signal);
    const zoom = camera?.z ?? 1;
    const pct = Math.round(zoom * 100);
    const zoomIn = () => zoomToward(Math.min(MAX_ZOOM, zoom + ZOOM_STEP));
    const zoomOut = () => zoomToward(Math.max(MIN_ZOOM, zoom - ZOOM_STEP));
    const reset = () => zoomToward(1);
    return (_jsxs("div", { id: "wb-zoom-widget", style: {
            position: 'absolute',
            bottom: 16,
            right: 16,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            background: '#1e1e2e',
            border: '1px solid #313244',
            borderRadius: 10,
            padding: '3px 6px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        }, children: [_jsx("button", { id: "wb-fit", title: "Fit to screen (\u21E71)", onClick: fitToScreen, style: buttonStyle, children: "\u229E" }), _jsx("div", { style: { width: 1, height: 24, background: '#313244', margin: '0 2px' } }), _jsx("button", { id: "wb-zoom-out", title: "Zoom out (\u2212)", onClick: zoomOut, style: buttonStyle, children: "\u2212" }), _jsxs("button", { id: "wb-zoom-pct", title: "Reset zoom (1)", onClick: reset, style: { ...buttonStyle, width: 56, fontSize: 13, fontFamily: 'Inter, monospace', fontWeight: 600, color: '#cdd6f4' }, children: [pct, "%"] }), _jsx("button", { id: "wb-zoom-in", title: "Zoom in (+)", onClick: zoomIn, style: buttonStyle, children: "+" })] }));
}
//# sourceMappingURL=ZoomWidget.js.map