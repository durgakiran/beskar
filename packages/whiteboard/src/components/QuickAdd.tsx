import React from 'react';
import {
    useEditor,
    useValue,
    track,
    createShapeId,
    Mat,
    Vec,
    type TLShapeId,
    type TLArrowShape,
    ArrowShapeKindStyle,
} from 'tldraw';

export const QuickAdd = track(() => {
    const editor = useEditor();

    // Track hovered and selected shapes reactively
    const hoveredId = useValue('hovered shape', () => editor.getHoveredShapeId(), [editor]);
    const selection = editor.getSelectedShapeIds();
    const isSingleSelection = selection.length === 1;
    const selectedId = isSingleSelection ? selection[0] : null;

    // We check if the Arrow tool is actively dragging an arrow. 
    // If it is, the QuickAdd crosses should ignore pointer events so the arrow can naturally drop onto the shape itself.
    const isDraggingArrow = useValue('isDraggingArrow', () => {
        return editor.getCurrentToolId() === 'arrow' && editor.getPath().includes('dragging');
    }, [editor]);

    // Target shape is the hovered shape, or the selected shape if none hovered
    const targetId = hoveredId || selectedId;
    const shape = targetId ? editor.getShape(targetId) : null;

    React.useEffect(() => {
        // We intercept ANY time an Arrow tries to bind to ANY shape (both the start 'origin' and the end 'destination').
        // We check if that shape has a QuickAdd cross within 30 pixels of the drop/start zone.
        // If it does, we forcefully hijack the binding to snap EXACTLY to that QuickAdd cross ratio
        // and aggressively set `isPrecise: true` to prevent Tldraw from sliding the arrow around when the shape moves.
        return editor.sideEffects.registerBeforeCreateHandler('binding', (record) => {
            if (record.type !== 'arrow') return record;

            const toShape = editor.getShape(record.toId);
            if (!toShape || toShape.type === 'arrow') return record;

            const toGeom = editor.getShapeGeometry(toShape);
            const toPageTransform = editor.getShapePageTransform(toShape);
            if (!toGeom || !toPageTransform) return record;

            // Get the arrow that is being bound.
            const arrow = editor.getShape<TLArrowShape>(record.fromId);
            if (!arrow) return record;

            // Find exactly where the terminal is currently sitting in absolute page space.
            const arrowGeom = editor.getShapeGeometry(arrow);
            const arrowPageTransform = editor.getShapePageTransform(arrow);
            const bindingProps = record.props as any;
            const terminalPt = bindingProps.terminal === 'start' ? arrow.props.start : arrow.props.end;

            // If the terminal is already a binding, we do not need to intercept and align it.
            // This prevents crashes when arrows are created programmatically via ShapeQuickAdd.
            if ((terminalPt as any).type === 'binding') return record;

            // Tldraw natively uses plain {x, y} objects for unbounded dragging terminals
            const dropPtPage = Mat.applyToPoint(arrowPageTransform, { x: (terminalPt as any).x, y: (terminalPt as any).y });

            const { minX, midX, maxX, minY, midY, maxY, width, height } = toGeom.bounds;

            const gridPoints = [
                new Vec(midX, minY), new Vec(maxX, midY), new Vec(midX, maxY), new Vec(minX, midY),
                new Vec(minX, minY), new Vec(maxX, minY), new Vec(maxX, maxY), new Vec(minX, maxY)
            ];

            let bestSnap: { dist: number; anchor: { x: number, y: number } } | null = null;
            const thresholdPage = 30 / Math.max(0.1, editor.getZoomLevel()); // 30 pixels in screen space

            for (const localPt of gridPoints) {
                const borderPt = toGeom.nearestPoint(localPt);
                const pagePt = Mat.applyToPoint(toPageTransform, borderPt);
                const dist = Vec.Dist(pagePt, dropPtPage);

                if (dist < thresholdPage) {
                    if (!bestSnap || dist < bestSnap.dist) {
                        const anchorX = width > 0 ? (borderPt.x - minX) / width : 0.5;
                        const anchorY = height > 0 ? (borderPt.y - minY) / height : 0.5;
                        bestSnap = {
                            dist,
                            anchor: { x: Math.max(0, Math.min(1, anchorX)), y: Math.max(0, Math.min(1, anchorY)) }
                        };
                    }
                }
            }

            if (bestSnap) {
                // We successfully hijacked the binding and snapped it flawlessly to the destination/origin's QuickAdd cross!
                // `isPrecise: true` is the secret to locking the anchor visually so it never "slides" dynamically around the shape border.
                return {
                    ...record,
                    props: {
                        ...record.props,
                        normalizedAnchor: bestSnap.anchor,
                        isPrecise: true,
                        isExact: false, // keep false so it binds to the abstract shape proportion, not an absolute space coordinate
                        snap: 'none' // disable standard snapping behaviors that conflict
                    }
                };
            }

            return record;
        });
    }, [editor]);

    if (!targetId || !shape || shape.type === 'arrow') {
        return null;
    }

    // Geometry calculations
    const geometry = targetId ? editor.getShapeGeometry(targetId) : null;
    const pageTransform = targetId ? editor.getShapePageTransform(targetId) : null;
    let handles: { id: string, x: number; y: number; pageX: number; pageY: number; anchor: { x: number, y: number } }[] = [];

    if (geometry && pageTransform) {
        const localBounds = geometry.bounds;

        const { minX, midX, maxX, minY, midY, maxY, width, height } = localBounds;

        // Instead of 4 fixed bounding box midpoints, we take a 3x3 grid around the bounding box (excluding center)
        // and snap each point exactly to the border of the shape using `geometry.nearestPoint`.
        const gridPoints = [
            new Vec(midX, minY), // top
            new Vec(maxX, midY), // right
            new Vec(midX, maxY), // bottom
            new Vec(minX, midY), // left
            new Vec(minX, minY), // top-left
            new Vec(maxX, minY), // top-right
            new Vec(maxX, maxY), // bottom-right
            new Vec(minX, maxY)  // bottom-left
        ];

        handles = gridPoints.map((localPt, i) => {
            // Snap the bounding box grid point to the actual stroked geometry border
            const borderPt = geometry.nearestPoint(localPt);

            // Transform the border point into the page coordinate space
            const pagePt = Mat.applyToPoint(pageTransform, borderPt);

            // Convert to viewport coordinate space for rendering and dispatch
            const viewportPt = editor.pageToViewport(pagePt);

            // Calculate the anchor normally relative to the boundary box so Arrow tool knows where it is
            // Protect against zero width/height shapes
            const anchorX = width > 0 ? (borderPt.x - minX) / width : 0.5;
            const anchorY = height > 0 ? (borderPt.y - minY) / height : 0.5;

            return {
                id: `handle-${i}`,
                x: viewportPt.x,
                y: viewportPt.y,
                pageX: pagePt.x,
                pageY: pagePt.y,
                anchor: { x: Math.max(0, Math.min(1, anchorX)), y: Math.max(0, Math.min(1, anchorY)) }
            };
        });
    }

    const onPlusPointerDown = (e: React.PointerEvent, handle: typeof handles[0]) => {
        if (!targetId || !shape) return;

        e.stopPropagation();
        (e.target as Element).releasePointerCapture(e.pointerId);

        editor.setCurrentTool('arrow');
        // Force the resulting arrow to be an elegantly bending elbow arrow
        editor.setStyleForNextShapes(ArrowShapeKindStyle, 'elbow');

        // To create a perfect native binding WITHOUT visual drifting, we must provide 
        // the EXACT DOM coordinate that corresponds to the shape's geometric perimeter.
        // We calculate exactly where the handle is on the screen:
        const screenPt = editor.pageToScreen(new Vec(handle.pageX, handle.pageY));

        // Dispatch the native pointer_down at this EXACT calculated DOM coordinate.
        // Tldraw's native arrow tool hit-tests this exact point, discovers it perfectly intersects
        // the target shape's stroke, and natively builds a pure, robust binding record
        // before transitioning into its built-in 'dragging_handle' state.
        editor.dispatch({
            type: 'pointer',
            target: 'canvas',
            name: 'pointer_down',
            point: { x: screenPt.x, y: screenPt.y, z: e.pointerType === 'pen' ? e.pressure : 0.5 },
            pointerId: e.pointerId,
            button: e.button,
            isPen: e.pointerType === 'pen',
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            ctrlKey: e.ctrlKey,
            metaKey: e.metaKey,
            accelKey: e.metaKey || e.ctrlKey,
        });
    };

    return (
        <div style={{ display: 'contents' }}>
            {handles.length > 0 && (
                <svg
                    className="wb-quick-add-overlay"
                    aria-hidden="true"
                    style={{
                        pointerEvents: 'none',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        overflow: 'visible',
                        zIndex: 1000,
                    }}
                >
                    {handles.map((h) => (
                        <g
                            key={h.id}
                            transform={`translate(${h.x}, ${h.y})`}
                            pointerEvents={isDraggingArrow ? "none" : "all"}
                            cursor={isDraggingArrow ? "default" : "crosshair"}
                            onPointerDown={isDraggingArrow ? undefined : (e) => onPlusPointerDown(e, h)}
                            className="wb-quick-add__handle-dot"
                        >
                            {/* Hit area for easier grabbing */}
                            <circle cx={0} cy={0} r={12} fill="transparent" />
                            {/* Tiny 'x' mark like Lucidchart */}
                            <path
                                d="M -3 -3 L 3 3 M -3 3 L 3 -3"
                                stroke="#2f80ed"
                                strokeWidth={2}
                                strokeLinecap="round"
                            />
                        </g>
                    ))}
                </svg>
            )}
        </div>
    );
});
