import { effect, signal } from '@preact/signals';
import { ArrowPlugin, BoxTool, DrawTool, EllipseTool, EllipseUtil, EraserTool, FreehandUtil, GeoShapePlugin, HandTool, SelectTool, StickyNoteTool, StickyNoteUtil, TextTool, TriangleTool, DiamondTool, HexagonTool, StarTool, ArrowTool, createCanvasToolServer, createEditor, resolveArrowRoute, } from '@durgakiran/glideline';
import { BoxUtil } from './shapes/BoxUtil';
import { FrameUtil } from './shapes/FrameUtil';
import { TextUtil } from './shapes/TextUtil';
import { bindGlideboardCollaboration } from './collaboration';
const CoreShapesPlugin = {
    id: 'glideboard-core-shapes',
    shapes: [
        BoxUtil,
        TextUtil,
        FrameUtil,
        EllipseUtil,
        StickyNoteUtil,
        FreehandUtil,
    ],
};
export function createGlideboardEditorInstance() {
    return createEditor({
        plugins: [CoreShapesPlugin, GeoShapePlugin, ArrowPlugin],
        tools: [
            SelectTool,
            BoxTool,
            TriangleTool,
            DiamondTool,
            HexagonTool,
            StarTool,
            ArrowTool,
            HandTool,
            EllipseTool,
            TextTool,
            StickyNoteTool,
            DrawTool,
            EraserTool,
        ],
    });
}
export const wbEditor = createGlideboardEditorInstance();
const wbToolServer = createCanvasToolServer(wbEditor);
export const readOnlySignal = signal(false);
function getConnectorPreset(arrowheadStart, arrowheadEnd) {
    if (arrowheadStart === 'arrow' && arrowheadEnd === 'arrow')
        return 'double-arrow';
    if (arrowheadStart === 'none' && arrowheadEnd === 'none')
        return 'line';
    return 'arrow';
}
function getPresetArrowheads(preset) {
    switch (preset) {
        case 'line':
            return { arrowheadStart: 'none', arrowheadEnd: 'none' };
        case 'double-arrow':
            return { arrowheadStart: 'arrow', arrowheadEnd: 'arrow' };
        default:
            return { arrowheadStart: 'none', arrowheadEnd: 'arrow' };
    }
}
export const arrowRouteStyleSignal = signal(wbEditor.arrowRouteStyle);
export const arrowPresetSignal = signal(getConnectorPreset(wbEditor.arrowheadStart, wbEditor.arrowheadEnd));
export const arrowheadStartSignal = signal(wbEditor.arrowheadStart);
export const arrowheadEndSignal = signal(wbEditor.arrowheadEnd);
export function setArrowRouteStyle(routeStyle) {
    wbEditor.arrowRouteStyle = routeStyle;
    arrowRouteStyleSignal.value = routeStyle;
}
function setArrowheads(arrowheadStart, arrowheadEnd) {
    wbEditor.arrowheadStart = arrowheadStart;
    wbEditor.arrowheadEnd = arrowheadEnd;
    arrowheadStartSignal.value = arrowheadStart;
    arrowheadEndSignal.value = arrowheadEnd;
    arrowPresetSignal.value = getConnectorPreset(arrowheadStart, arrowheadEnd);
}
export function setArrowheadStart(arrowheadStart) {
    setArrowheads(arrowheadStart, wbEditor.arrowheadEnd);
}
export function setArrowheadEnd(arrowheadEnd) {
    setArrowheads(wbEditor.arrowheadStart, arrowheadEnd);
}
export function setConnectorPreset(preset) {
    const { arrowheadStart, arrowheadEnd } = getPresetArrowheads(preset);
    setArrowheads(arrowheadStart, arrowheadEnd);
}
function getAllRecordIds() {
    return wbEditor.serialize().records
        .map(record => String(record.id ?? ''))
        .filter(Boolean);
}
export function clearWhiteboardState() {
    const ids = getAllRecordIds();
    if (ids.length > 0) {
        wbEditor.run(() => {
            wbEditor.store.remove(ids);
        }, { history: 'ignore' });
    }
    wbEditor.setSelectedShapeIds([]);
    wbEditor.stopEditing();
    wbEditor.clearBindingPreview();
    wbEditor.camera.setCamera({ x: 0, y: 0, z: 1 });
}
let collaborationCleanup = null;
function detachCollaboration() {
    collaborationCleanup?.();
    collaborationCleanup = null;
}
export function initializeGlideboardSession(opts) {
    detachCollaboration();
    clearWhiteboardState();
    readOnlySignal.value = Boolean(opts.readOnly);
    if (opts.initialDocument) {
        wbEditor.deserialize(opts.initialDocument);
    }
    if (opts.collaboration) {
        collaborationCleanup = bindGlideboardCollaboration(wbEditor, opts.collaboration);
    }
    wbEditor.setCurrentTool(readOnlySignal.value ? 'hand' : 'select');
}
export function teardownGlideboardSession() {
    detachCollaboration();
    clearWhiteboardState();
    readOnlySignal.value = false;
    wbEditor.setCurrentTool('select');
}
export function attachDebugApi(debugApiKey) {
    if (typeof window === 'undefined' || !debugApiKey)
        return () => { };
    window[debugApiKey] = {
        reset: clearWhiteboardState,
        setCurrentTool: (id) => wbEditor.setCurrentTool(id),
        getCurrentToolId: () => wbEditor.currentToolId.peek(),
        callTool: (name, input) => wbToolServer.callTool(name, input),
        getToolManifest: () => wbToolServer.generateToolManifest(),
        getAIContext: (opts) => wbEditor.getAIContext(opts),
        takeScreenshot: (box) => wbEditor.takeScreenshot(box),
        select: (ids) => wbEditor.setSelectedShapeIds(ids),
        getSmartRoutingSnapshot: () => wbEditor.getSmartRoutingSnapshot(),
        getArrowRoutePoints: (id) => {
            const shape = wbEditor.getShape(id);
            if (!shape || shape.type !== 'arrow')
                return null;
            return resolveArrowRoute(wbEditor, shape).worldPoints;
        },
    };
    return () => {
        delete window[debugApiKey];
    };
}
let persistTimer = null;
export function subscribeToDocumentChanges(onDocumentChange, debounceMs = 500) {
    const dispose = effect(() => {
        wbEditor.store.getVersionSignal().value;
        if (persistTimer)
            clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            onDocumentChange(wbEditor.serialize());
        }, debounceMs);
    });
    return () => dispose();
}
//# sourceMappingURL=editor.js.map