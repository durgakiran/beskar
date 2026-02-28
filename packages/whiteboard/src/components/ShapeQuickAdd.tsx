import React, { useState } from 'react';
import {
    useEditor,
    useValue,
    track,
    createShapeId,
    Mat,
    Vec,
    ArrowShapeKindStyle,
    type TLShapeId,
} from 'tldraw';

const SHAPE_OPTIONS = [
    { type: 'rectangle', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="1" /></svg> },
    { type: 'ellipse', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="12" rx="9" ry="6" /></svg> },
    { type: 'diamond', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,3 21,12 12,21 3,12" /></svg> },
    { type: 'triangle', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,4 22,20 2,20" /></svg> },
];

export const ShapeQuickAdd = track(() => {
    const editor = useEditor();
    const [hoveredDir, setHoveredDir] = useState<string | null>(null);
    const [openPopoverDir, setOpenPopoverDir] = useState<string | null>(null);

    // Track active selection
    const selection = editor.getSelectedShapeIds();
    const isSingleSelection = selection.length === 1;
    const selectedId = isSingleSelection ? selection[0] : null;

    // Do not show arrows if we are dragging an arrow, resizing, etc.
    const isDraggingArrow = useValue('isDraggingArrow', () => {
        return editor.getCurrentToolId() === 'arrow' && editor.getPath().includes('dragging');
    }, [editor]);

    if (!selectedId || isDraggingArrow) {
        return null;
    }

    const shape = editor.getShape(selectedId);
    if (!shape || shape.type === 'arrow' || shape.type === 'line' || shape.type === 'draw') {
        return null; // Skip non-primitive shapes for this quick add logic
    }

    const geometry = editor.getShapeGeometry(shape);
    const pageTransform = editor.getShapePageTransform(shape);

    if (!geometry || !pageTransform) {
        return null;
    }

    const bounds = geometry.bounds;

    // We want the arrows slightly offset from the shape's bounds
    const OFFSET = 40;

    // Calculate page coordinates for the directional arrows
    const topPtPage = Mat.applyToPoint(pageTransform, new Vec(bounds.midX, bounds.minY - OFFSET));
    const rightPtPage = Mat.applyToPoint(pageTransform, new Vec(bounds.maxX + OFFSET, bounds.midY));
    const bottomPtPage = Mat.applyToPoint(pageTransform, new Vec(bounds.midX, bounds.maxY + OFFSET));
    const leftPtPage = Mat.applyToPoint(pageTransform, new Vec(bounds.minX - OFFSET, bounds.midY));

    // Convert to viewport coordinates
    const topPt = editor.pageToViewport(topPtPage);
    const rightPt = editor.pageToViewport(rightPtPage);
    const bottomPt = editor.pageToViewport(bottomPtPage);
    const leftPt = editor.pageToViewport(leftPtPage);

    const directions = [
        { id: 'top', pt: topPt, rotation: 0, dx: 0, dy: -1 },
        { id: 'right', pt: rightPt, rotation: 90, dx: 1, dy: 0 },
        { id: 'bottom', pt: bottomPt, rotation: 180, dx: 0, dy: 1 },
        { id: 'left', pt: leftPt, rotation: 270, dx: -1, dy: 0 },
    ];

    const SPACING = 100; // Spacing between original shape and newly spawned shape

    const handleShapeAdd = (dir: typeof directions[0], shapeType: string) => {
        if (!selectedId) return;

        // Calculate where the new shape goes in Page coordinates.
        // We calculate distance based on shape center to shape center ideally
        const centerPtPage = Mat.applyToPoint(pageTransform, new Vec(bounds.midX, bounds.midY));

        // Spawn distance
        const spawnDistance = (Math.max(bounds.width, bounds.height) / 2) + SPACING + OFFSET;

        const newCenterX = centerPtPage.x + (dir.dx * spawnDistance);
        const newCenterY = centerPtPage.y + (dir.dy * spawnDistance);

        // Approximate widths for primitives
        const standardW = 100;
        const standardH = 100;

        const newShapeId = createShapeId();
        const newArrowId = createShapeId();

        // Ensure elbow arrow
        editor.setStyleForNextShapes(ArrowShapeKindStyle, 'elbow');

        // Create the shape
        editor.createShapes([
            {
                id: newShapeId,
                type: 'geo',
                x: newCenterX - (standardW / 2),
                y: newCenterY - (standardH / 2),
                props: {
                    geo: shapeType as any,
                    w: standardW,
                    h: standardH,
                },
            },
            {
                id: newArrowId,
                type: 'arrow',
                x: centerPtPage.x,
                y: centerPtPage.y,
                props: {
                    start: { x: 0, y: 0 },
                    end: { x: (dir.pt.x * 2) - newCenterX, y: (dir.pt.y * 2) - newCenterY },
                    arrowheadEnd: 'arrow',
                }
            }
        ]);

        editor.createBindings([
            {
                type: 'arrow',
                fromId: newArrowId,
                toId: selectedId,
                props: {
                    terminal: 'start',
                    normalizedAnchor: { x: 0.5, y: 0.5 },
                    isExact: false,
                    isPrecise: true
                }
            },
            {
                type: 'arrow',
                fromId: newArrowId,
                toId: newShapeId,
                props: {
                    terminal: 'end',
                    normalizedAnchor: { x: 0.5, y: 0.5 },
                    isExact: false,
                    isPrecise: true
                }
            }
        ]);

        editor.setCurrentTool('select');
        editor.select(newShapeId);

        setOpenPopoverDir(null);
        setHoveredDir(null);
    };

    return (
        <div className="shape-quickadd-container" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 500, overflow: 'visible' }}>
            {directions.map((dir) => {
                const isHovered = hoveredDir === dir.id;
                const isOpen = openPopoverDir === dir.id;

                return (
                    <div
                        key={dir.id}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            transform: `translate(${dir.pt.x}px, ${dir.pt.y}px)`,
                            pointerEvents: 'auto',
                        }}
                    >
                        {/* Directional Arrow Trigger */}
                        <div
                            className="shape-quickadd-arrow"
                            onPointerEnter={() => setHoveredDir(dir.id)}
                            onPointerLeave={() => setHoveredDir(null)}
                            onPointerDownCapture={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOpenPopoverDir(isOpen ? null : dir.id);
                            }}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                transform: `translate(-50%, -50%) rotate(${dir.rotation}deg)`,
                                width: '36px',
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                opacity: isHovered || isOpen ? 1 : 0.6,
                                transition: 'all 0.15s ease',
                                background: isHovered || isOpen ? '#ebf8ff' : '#ffffff',
                                border: `2px solid ${isHovered || isOpen ? '#2f80ed' : '#e2e8f0'}`,
                                borderRadius: '50%',
                                boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                            }}
                        >
                            {/* SVG Arrow */}
                            <svg width="20" height="20" viewBox="0 0 24 24" fill={isHovered || isOpen ? "#2f80ed" : "#888"} stroke="none">
                                <path d="M12 2 L22 12 H15 V22 H9 V12 H2 Z" />
                            </svg>
                        </div>

                        {/* Shape Popover */}
                        {isOpen && (
                            <div
                                className="shape-quickadd-popover"
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    transform: dir.id === 'top' ? 'translate(-50%, calc(-100% - 34px))' :
                                        dir.id === 'bottom' ? 'translate(-50%, 34px)' :
                                            dir.id === 'left' ? 'translate(calc(-100% - 34px), -50%)' :
                                                'translate(34px, -50%)',
                                    flexDirection: dir.id === 'top' || dir.id === 'bottom' ? 'row' : 'column',
                                    background: 'var(--color-panel, #ffffff)',
                                    border: '1px solid var(--color-divider, #e2e8f0)',
                                    borderRadius: '12px',
                                    padding: '6px',
                                    display: 'flex',
                                    gap: '4px',
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                                    pointerEvents: 'auto',
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                            >
                                {SHAPE_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.type}
                                        onPointerDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleShapeAdd(dir, opt.type);
                                        }}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            padding: '8px',
                                            cursor: 'pointer',
                                            borderRadius: '8px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            transition: 'background-color 0.1s ease',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-divider)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                    >
                                        <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111' }}>
                                            {opt.icon}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
});
