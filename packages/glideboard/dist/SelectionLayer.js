import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getArrowBendHandlePoint, } from '@durgakiran/glideline';
import { useSignalValue } from './useSignalValue';
import { wbEditor } from './editor';
const HANDLE_SIZE = 8;
const ROTATION_HANDLE_OFFSET = 20;
export function SelectionLayer() {
    const selectedIds = useSignalValue(wbEditor.getSelectionSignal());
    const camera = useSignalValue(wbEditor.camera.signal);
    const [boxes, setBoxes] = useState([]);
    const [shapes, setShapes] = useState([]);
    useEffect(() => {
        if (!selectedIds || selectedIds.length === 0) {
            setBoxes([]);
            setShapes([]);
            return;
        }
        const nextBoxes = [];
        const nextShapes = [];
        for (const id of selectedIds) {
            const shape = wbEditor.store.getSignal(id)?.value;
            if (!shape)
                continue;
            const localBounds = wbEditor.getShapeUtil(shape.type).getGeometry(shape).getBounds();
            nextBoxes.push({
                minX: localBounds.minX + shape.x,
                minY: localBounds.minY + shape.y,
                maxX: localBounds.maxX + shape.x,
                maxY: localBounds.maxY + shape.y,
                w: localBounds.w,
                h: localBounds.h,
                rotation: shape.rotation ?? 0,
            });
            nextShapes.push(shape);
        }
        setBoxes(nextBoxes);
        setShapes(nextShapes);
    }, [selectedIds]);
    if (!selectedIds || selectedIds.length === 0 || boxes.length === 0)
        return null;
    const allText = shapes.every(shape => shape.type === 'text');
    if (shapes.length === 1 && shapes[0]?.type === 'arrow') {
        const arrow = shapes[0];
        const { start, end } = arrow.props;
        const hs = HANDLE_SIZE / camera.z;
        const bendPoint = getArrowBendHandlePoint(wbEditor, arrow);
        const startWorldX = arrow.x + start.point.x;
        const startWorldY = arrow.y + start.point.y;
        const endWorldX = arrow.x + end.point.x;
        const endWorldY = arrow.y + end.point.y;
        return (_jsxs("g", { id: "wb-selection-overlay", children: [_jsx("rect", { "data-handle": "start", x: startWorldX - hs / 2, y: startWorldY - hs / 2, width: hs, height: hs, fill: "#1e1e2e", stroke: "#89b4fa", strokeWidth: 1 / camera.z, transform: `rotate(45, ${startWorldX}, ${startWorldY})`, style: { cursor: 'crosshair' } }), _jsx("rect", { "data-handle": "end", x: endWorldX - hs / 2, y: endWorldY - hs / 2, width: hs, height: hs, fill: "#1e1e2e", stroke: "#89b4fa", strokeWidth: 1 / camera.z, transform: `rotate(45, ${endWorldX}, ${endWorldY})`, style: { cursor: 'crosshair' } }), bendPoint ? (_jsx("circle", { "data-handle": "bend", cx: bendPoint.x, cy: bendPoint.y, r: 5 / camera.z, fill: "#89b4fa", stroke: "#1e1e2e", strokeWidth: 1 / camera.z, style: { cursor: 'grab' } })) : null] }));
    }
    const minX = Math.min(...boxes.map(box => box.minX));
    const minY = Math.min(...boxes.map(box => box.minY));
    const maxX = Math.max(...boxes.map(box => box.maxX));
    const maxY = Math.max(...boxes.map(box => box.maxY));
    const width = maxX - minX;
    const height = maxY - minY;
    const cx = minX + width / 2;
    const cy = minY + height / 2;
    const transform = boxes.length === 1 ? `rotate(${(boxes[0].rotation * 180) / Math.PI}, ${cx}, ${cy})` : undefined;
    const handles = [
        { id: 'nw', px: minX, py: minY },
        { id: 'n', px: minX + width / 2, py: minY },
        { id: 'ne', px: maxX, py: minY },
        { id: 'e', px: maxX, py: minY + height / 2 },
        { id: 'se', px: maxX, py: maxY },
        { id: 's', px: minX + width / 2, py: maxY },
        { id: 'sw', px: minX, py: maxY },
        { id: 'w', px: minX, py: minY + height / 2 },
    ];
    const hs = HANDLE_SIZE / camera.z;
    return (_jsxs("g", { id: "wb-selection-overlay", transform: transform, children: [_jsx("rect", { x: minX, y: minY, width: width, height: height, fill: "none", stroke: "#89b4fa", strokeWidth: 1 / camera.z, strokeDasharray: `${4 / camera.z} ${2 / camera.z}`, pointerEvents: "none" }), !allText ? (_jsxs(_Fragment, { children: [handles.map(handle => (_jsx("rect", { "data-handle": handle.id, x: handle.px - hs / 2, y: handle.py - hs / 2, width: hs, height: hs, fill: "#1e1e2e", stroke: "#89b4fa", strokeWidth: 1 / camera.z, rx: 1 / camera.z, style: { cursor: handleCursor(handle.id) } }, handle.id))), _jsx("circle", { "data-handle": "rotate", cx: minX + width / 2, cy: minY - ROTATION_HANDLE_OFFSET / camera.z, r: 5 / camera.z, fill: "#1e1e2e", stroke: "#89b4fa", strokeWidth: 1 / camera.z, style: { cursor: 'grab' } }), _jsx("line", { x1: minX + width / 2, y1: minY, x2: minX + width / 2, y2: minY - ROTATION_HANDLE_OFFSET / camera.z, stroke: "#89b4fa", strokeWidth: 1 / camera.z, pointerEvents: "none" })] })) : null] }));
}
function handleCursor(handle) {
    const map = {
        nw: 'nw-resize',
        n: 'n-resize',
        ne: 'ne-resize',
        e: 'e-resize',
        se: 'se-resize',
        s: 's-resize',
        sw: 'sw-resize',
        w: 'w-resize',
    };
    return map[handle];
}
export function MarqueeOverlay() {
    const camera = useSignalValue(wbEditor.camera.signal);
    const selectTool = wbEditor.getCurrentTool();
    const marqueeState = selectTool._childMap?.get('marqueeSelecting');
    const rect = useSignalValue(marqueeState?.marqueeBoxSignal);
    if (!rect || rect.w === 0 || rect.h === 0)
        return null;
    return (_jsx("rect", { x: rect.minX, y: rect.minY, width: rect.w, height: rect.h, fill: "#89b4fa11", stroke: "#89b4fa", strokeWidth: 1 / camera.z, strokeDasharray: `${3 / camera.z} ${2 / camera.z}`, pointerEvents: "none" }));
}
//# sourceMappingURL=SelectionLayer.js.map