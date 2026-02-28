import React, { useState, useRef, useEffect } from 'react';
import {
    useEditor,
    useTools,
    useIsToolSelected,
    GeoShapeGeoStyle,
    ArrowShapeArrowheadEndStyle,
    ArrowShapeKindStyle,
} from 'tldraw';
import {
    MousePointer2,
    Hand,
    Pencil,
    Eraser,
    ArrowRight,
    Type,
    StickyNote,
    Undo2,
    Redo2,
    ChevronRight,
    Minus,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolButtonProps {
    tool: string;
    label: string;
    shortcut?: string;
    children: React.ReactNode;
    onClick?: () => void;
}

// ─── Sub-type popover for shapes ─────────────────────────────────────────────

const GEO_SUB_TYPES = [
    { geo: 'rectangle', label: 'Rect', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="1" /></svg> },
    { geo: 'ellipse', label: 'Ellipse', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="12" rx="9" ry="6" /></svg> },
    { geo: 'diamond', label: 'Diamond', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,3 21,12 12,21 3,12" /></svg> },
    { geo: 'triangle', label: 'Triangle', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,4 22,20 2,20" /></svg> },
    { geo: 'oval', label: 'Oval', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="8" width="18" height="8" rx="4" /></svg> },
    { geo: 'trapezoid', label: 'Trapezoid', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5,18 19,18 22,6 2,6" /></svg> },
    { geo: 'rhombus', label: 'Rhombus', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,3 22,12 12,21 2,12" /></svg> },
    { geo: 'star', label: 'Star', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" /></svg> },
    { geo: 'cloud', label: 'Cloud', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg> },
    { geo: 'hexagon', label: 'Hexagon', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12,2 22,7 22,17 12,22 2,17 2,7" /></svg> },
    { type: 'cylinder', label: 'Cylinder', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" /></svg> },
    { type: 'parallelogram', label: 'Parallelogram', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5,18 19,18 22,6 8,6" /></svg> },
] as const;

const ARROW_STYLES = [
    { id: 'straight', label: 'Straight', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="14,7 19,12 14,17" /></svg> },
    { id: 'curved', label: 'Curved', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 19 C 5 5, 19 5, 19 19" /><polyline points="14,14 19,19 14,24" /></svg> },
] as const;

// ─── Tool button ─────────────────────────────────────────────────────────────

function ToolButton({ tool, label, shortcut, children, onClick }: ToolButtonProps) {
    const editor = useEditor();
    const tools = useTools();
    const isActive = useIsToolSelected(tools[tool]);

    const handleClick = () => {
        onClick?.();
        editor.setCurrentTool(tool);
    };

    return (
        <button
            className={['wb-toolbar__btn', isActive ? 'wb-toolbar__btn--active' : ''].filter(Boolean).join(' ')}
            title={shortcut ? `${label} (${shortcut})` : label}
            aria-label={label}
            onClick={handleClick}
            type="button"
        >
            {children}
        </button>
    );
}

// ─── Shape sub-type popover ───────────────────────────────────────────────────

function ShapePopover({ onClose }: { onClose: () => void }) {
    const editor = useEditor();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    const pick = (geo?: string, customType?: string) => {
        if (customType) {
            editor.setCurrentTool('select');
            const vp = editor.getViewportPageBounds();
            editor.createShape({ type: customType as never, x: vp.x + vp.w / 2 - 60, y: vp.y + vp.h / 2 - 40 });
        } else if (geo) {
            editor.setStyleForNextShapes(GeoShapeGeoStyle, geo);
            editor.setCurrentTool('geo');
        }
        onClose();
    };

    return (
        <div ref={ref} className="wb-shape-popover">
            <div className="wb-shape-popover__title">Shapes</div>
            <div className="wb-shape-popover__grid">
                {GEO_SUB_TYPES.map((s) => (
                    <button
                        key={`${'geo' in s ? s.geo : s.type}-${s.label}`}
                        className="wb-shape-popover__item"
                        title={s.label}
                        type="button"
                        onClick={() => pick('geo' in s ? s.geo : undefined, 'type' in s ? s.type : undefined)}
                    >
                        <div className="wb-shape-popover__icon">{s.icon}</div>
                        <span className="wb-shape-popover__label">{s.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── Arrow style picker ───────────────────────────────────────────────────────

function ArrowStylePicker({ onClose }: { onClose: () => void }) {
    const editor = useEditor();
    const tools = useTools();
    const isArrowActive = useIsToolSelected(tools['arrow']);

    if (!isArrowActive) return null;

    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    const setStyle = (id: string) => {
        // In tldraw v3, 'arc' is used for both curved and straight (bend 0)
        // Since we can't easily set 'bend' as a style prop for NEXT shapes via a constant, 
        // we use the kind style which is definitely exported.
        editor.setStyleForNextShapes(ArrowShapeKindStyle, 'arc');
        onClose();
    };

    return (
        <div ref={ref} className="wb-arrow-picker">
            {ARROW_STYLES.map((s) => (
                <button
                    key={s.id}
                    className="wb-arrow-picker__btn"
                    title={s.label}
                    type="button"
                    onClick={() => setStyle(s.id)}
                >
                    {s.icon}
                    <span>{s.label}</span>
                </button>
            ))}
        </div>
    );
}

// ─── Main Toolbar ─────────────────────────────────────────────────────────────

export function WhiteboardToolbar() {
    const editor = useEditor();
    const [shapePopoverOpen, setShapePopoverOpen] = useState(false);
    const [arrowPickerOpen, setArrowPickerOpen] = useState(false);
    const tools = useTools();
    const isGeoActive = useIsToolSelected(tools['geo']);
    const isCylinderActive = useIsToolSelected(tools['cylinder']);
    const isParallelogramActive = useIsToolSelected(tools['parallelogram']);
    const isShapeActive = isGeoActive || isCylinderActive || isParallelogramActive;
    const isArrowActive = useIsToolSelected(tools['arrow']);

    return (
        <div className="wb-toolbar" role="toolbar" aria-label="Whiteboard tools">
            {/* Navigate */}
            <div className="wb-toolbar__group">
                <ToolButton tool="select" label="Select" shortcut="V">
                    <MousePointer2 size={16} />
                </ToolButton>
                <ToolButton tool="hand" label="Pan" shortcut="H">
                    <Hand size={16} />
                </ToolButton>
            </div>

            <div className="wb-toolbar__divider" />

            {/* Draw */}
            <div className="wb-toolbar__group">
                <ToolButton tool="draw" label="Pen" shortcut="D">
                    <Pencil size={16} />
                </ToolButton>

                {/* Shape button + popover */}
                <div className="wb-toolbar__shape-wrap">
                    <button
                        className={['wb-toolbar__btn', isShapeActive ? 'wb-toolbar__btn--active' : ''].filter(Boolean).join(' ')}
                        title="Shapes"
                        type="button"
                        onClick={() => {
                            setShapePopoverOpen((v) => !v);
                            setArrowPickerOpen(false);
                            editor.setCurrentTool('geo');
                        }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="12" rx="1" /></svg>
                    </button>
                    <span className="wb-toolbar__btn-arrow"><ChevronRight size={8} /></span>
                    {shapePopoverOpen && <ShapePopover onClose={() => setShapePopoverOpen(false)} />}
                </div>

                <ToolButton tool="line" label="Line" shortcut="L">
                    <Minus size={16} />
                </ToolButton>

                {/* Arrow button + style picker */}
                <div className="wb-toolbar__shape-wrap">
                    <ToolButton
                        tool="arrow"
                        label="Arrow / Connector"
                        shortcut="A"
                        onClick={() => { setArrowPickerOpen(false); setShapePopoverOpen(false); }}
                    >
                        <ArrowRight size={16} />
                    </ToolButton>
                    {isArrowActive && (
                        <span
                            className="wb-toolbar__btn-arrow"
                            onClick={() => setArrowPickerOpen((v) => !v)}
                            style={{ cursor: 'pointer' }}
                        >
                            <ChevronRight size={8} />
                        </span>
                    )}
                    {arrowPickerOpen && <ArrowStylePicker onClose={() => setArrowPickerOpen(false)} />}
                </div>
            </div>

            <div className="wb-toolbar__divider" />

            {/* Content */}
            <div className="wb-toolbar__group">
                <ToolButton tool="text" label="Text" shortcut="T">
                    <Type size={16} />
                </ToolButton>
                <ToolButton tool="note" label="Sticky Note" shortcut="N">
                    <StickyNote size={16} />
                </ToolButton>
                <ToolButton tool="frame" label="Frame" shortcut="F">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18" />
                    </svg>
                </ToolButton>
                <ToolButton tool="eraser" label="Eraser" shortcut="E">
                    <Eraser size={16} />
                </ToolButton>
            </div>

            <div className="wb-toolbar__divider" />

            {/* History */}
            <div className="wb-toolbar__group">
                <button className="wb-toolbar__btn" title="Undo (Ctrl+Z)" onClick={() => editor.undo()} type="button">
                    <Undo2 size={16} />
                </button>
                <button className="wb-toolbar__btn" title="Redo (Ctrl+Shift+Z)" onClick={() => editor.redo()} type="button">
                    <Redo2 size={16} />
                </button>
            </div>
        </div>
    );
}
