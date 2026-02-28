import React, { useState, useCallback } from 'react';
import { useEditor, GeoShapeGeoStyle } from 'tldraw';

// ─── Shape definitions ───────────────────────────────────────────────────────

interface ShapeEntry {
    label: string;
    /** tldraw tool id */
    tool: string;
    /** for geo tool: the geo sub-type to pre-set */
    geo?: string;
    /** for custom shapes: the shape type string */
    customType?: string;
    icon: React.ReactNode;
    /** additional keywords for search */
    tags?: string[];
}

interface ShapeCategory {
    id: string;
    label: string;
    shapes: ShapeEntry[];
}

function GeoIcon({ points }: { points: string }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points={points} />
        </svg>
    );
}

function SvgIcon({ children }: { children: React.ReactNode }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {children}
        </svg>
    );
}

const SHAPE_CATEGORIES: ShapeCategory[] = [
    {
        id: 'general',
        label: 'General',
        shapes: [
            { label: 'Rectangle', tool: 'geo', geo: 'rectangle', tags: ['rect', 'box', 'step', 'process'], icon: <SvgIcon><rect x="3" y="6" width="18" height="12" rx="1" /></SvgIcon> },
            { label: 'Ellipse', tool: 'geo', geo: 'ellipse', tags: ['oval', 'circle'], icon: <SvgIcon><ellipse cx="12" cy="12" rx="9" ry="6" /></SvgIcon> },
            { label: 'Diamond', tool: 'geo', geo: 'diamond', tags: ['decision', 'rhombus'], icon: <SvgIcon><polygon points="12,3 21,12 12,21 3,12" /></SvgIcon> },
            { label: 'Triangle', tool: 'geo', geo: 'triangle', icon: <SvgIcon><polygon points="12,3 22,21 2,21" /></SvgIcon> },
            { label: 'Oval', tool: 'geo', geo: 'oval', tags: ['term', 'terminal', 'pill'], icon: <SvgIcon><ellipse cx="12" cy="12" rx="9" ry="5" /></SvgIcon> },
            { label: 'Star', tool: 'geo', geo: 'star', icon: <SvgIcon><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" /></SvgIcon> },
        ],
    },
    {
        id: 'flowchart',
        label: 'Flowchart',
        shapes: [
            { label: 'Process', tool: 'geo', geo: 'rectangle', tags: ['step', 'box'], icon: <SvgIcon><rect x="3" y="6" width="18" height="12" rx="1" /></SvgIcon> },
            { label: 'Decision', tool: 'geo', geo: 'diamond', tags: ['diamond', 'if'], icon: <SvgIcon><polygon points="12,3 21,12 12,21 3,12" /></SvgIcon> },
            { label: 'Terminal', tool: 'geo', geo: 'oval', tags: ['start', 'end', 'pill'], icon: <SvgIcon><rect x="3" y="8" width="18" height="8" rx="4" /></SvgIcon> },
            { label: 'Data (I/O)', tool: 'geo', geo: 'trapezoid', tags: ['parallelogram', 'input', 'output'], icon: <GeoIcon points="5,18 19,18 22,6 2,6" /> },
            { label: 'Document', tool: 'geo', geo: 'cloud', icon: <SvgIcon><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></SvgIcon> },
            { label: 'Database', tool: 'cylinder', tags: ['cylinder', 'storage', 'DB'], icon: <SvgIcon><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6" /></SvgIcon> },
            { label: 'Parallelogram', tool: 'parallelogram', tags: ['data', 'io'], icon: <GeoIcon points="5,18 19,18 22,6 8,6" /> },
            { label: 'Delay', tool: 'geo', geo: 'trapezoid', tags: ['trapezoid', 'wait'], icon: <GeoIcon points="4,6 18,6 22,12 18,18 4,18" /> },
        ],
    },
    {
        id: 'arrows',
        label: 'Arrows',
        shapes: [
            { label: 'Arrow Right', tool: 'geo', geo: 'arrow-right', icon: <SvgIcon><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12,5 19,12 12,19" /></SvgIcon> },
            { label: 'Arrow Left', tool: 'geo', geo: 'arrow-left', icon: <SvgIcon><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12,5 5,12 12,19" /></SvgIcon> },
            { label: 'Arrow Up', tool: 'geo', geo: 'arrow-up', icon: <SvgIcon><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5,12 12,5 19,12" /></SvgIcon> },
            { label: 'Arrow Down', tool: 'geo', geo: 'arrow-down', icon: <SvgIcon><line x1="12" y1="5" x2="12" y2="19" /><polyline points="5,12 12,19 19,12" /></SvgIcon> },
        ],
    },
    {
        id: 'extras',
        label: 'Extras',
        shapes: [
            { label: 'Cloud', tool: 'geo', geo: 'cloud', icon: <SvgIcon><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></SvgIcon> },
            { label: 'Hexagon', tool: 'geo', geo: 'hexagon', icon: <GeoIcon points="12,2 22,7 22,17 12,22 2,17 2,7" /> },
            { label: 'Octagon', tool: 'geo', geo: 'octagon', icon: <GeoIcon points="8,2 16,2 22,8 22,16 16,22 8,22 2,16 2,8" /> },
            { label: 'Rhombus', tool: 'geo', geo: 'rhombus', icon: <GeoIcon points="4,12 12,4 20,12 12,20" /> },
            { label: 'Pentagon', tool: 'geo', geo: 'pentagon', icon: <GeoIcon points="12,2 22,9.5 18,21 6,21 2,9.5" /> },
            { label: 'Heart', tool: 'geo', geo: 'heart', icon: <SvgIcon><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></SvgIcon> },
            { label: 'X Box', tool: 'geo', geo: 'x-box', icon: <SvgIcon><rect x="3" y="3" width="18" height="18" rx="1" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></SvgIcon> },
            { label: 'Check Box', tool: 'geo', geo: 'check-box', icon: <SvgIcon><rect x="3" y="3" width="18" height="18" rx="1" /><polyline points="9,12 11,14 15,10" /></SvgIcon> },
        ],
    },
];

// ─── Individual shape tile ───────────────────────────────────────────────────

interface ShapeTileProps {
    entry: ShapeEntry;
}

function ShapeTile({ entry }: ShapeTileProps) {
    const editor = useEditor();

    const handleClick = useCallback(() => {
        const vp = editor.getViewportPageBounds();
        const cx = vp.x + vp.w / 2;
        const cy = vp.y + vp.h / 2;
        const W = 120;
        const H = 80;

        if (entry.tool === 'cylinder') {
            editor.createShape({
                type: 'cylinder',
                x: cx - W / 2,
                y: cy - H / 2,
                props: { w: W, h: H + 40 },
            });
        } else if (entry.tool === 'parallelogram') {
            editor.createShape({
                type: 'parallelogram',
                x: cx - W / 2,
                y: cy - H / 2,
                props: { w: W, h: H },
            });
        } else if (entry.geo) {
            editor.setCurrentTool('geo');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            editor.setStyleForNextShapes(GeoShapeGeoStyle, entry.geo as any);
            editor.createShape({
                type: 'geo',
                x: cx - W / 2,
                y: cy - H / 2,
                props: { w: W, h: H, geo: entry.geo as never },
            });
        }
        editor.setCurrentTool('select');
    }, [editor, entry]);

    return (
        <button
            className="wb-lib__tile"
            title={entry.label}
            aria-label={entry.label}
            onClick={handleClick}
            type="button"
        >
            {entry.icon}
            <span className="wb-lib__tile-label">{entry.label}</span>
        </button>
    );
}

// ─── Category accordion ──────────────────────────────────────────────────────

function CategorySection({ category }: { category: ShapeCategory }) {
    const [open, setOpen] = useState(true);
    return (
        <div className="wb-lib__category">
            <button
                className="wb-lib__category-header"
                onClick={() => setOpen((v) => !v)}
                type="button"
            >
                <span>{category.label}</span>
                <svg
                    className={`wb-lib__chevron ${open ? 'wb-lib__chevron--open' : ''}`}
                    width="12" height="12" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2"
                >
                    <polyline points="6,9 12,15 18,9" />
                </svg>
            </button>
            {open && (
                <div className="wb-lib__grid">
                    {category.shapes.map((s) => (
                        <ShapeTile key={`${category.id}-${s.tool}-${s.geo ?? ''}-${s.customType ?? ''}-${s.label}`} entry={s} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

export function ShapeLibraryPanel() {
    const [collapsed, setCollapsed] = useState(false);
    const [search, setSearch] = useState('');

    const filtered = search.trim()
        ? SHAPE_CATEGORIES.map((cat) => ({
            ...cat,
            shapes: cat.shapes.filter((s) => {
                const query = search.toLowerCase();
                return (
                    s.label.toLowerCase().includes(query) ||
                    s.tool.toLowerCase().includes(query) ||
                    (s.geo && s.geo.toLowerCase().includes(query)) ||
                    (s.tags && s.tags.some(t => t.toLowerCase().includes(query)))
                );
            }),
        })).filter((cat) => cat.shapes.length > 0)
        : SHAPE_CATEGORIES;

    return (
        <div className={`wb-lib ${collapsed ? 'wb-lib--collapsed' : ''}`}>
            {/* Collapse toggle */}
            <button
                className="wb-lib__toggle"
                onClick={() => setCollapsed((v) => !v)}
                title={collapsed ? 'Open shape library' : 'Close shape library'}
                type="button"
                aria-label="Toggle shape library"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {collapsed
                        ? <polyline points="9,18 15,12 9,6" />
                        : <polyline points="15,18 9,12 15,6" />}
                </svg>
            </button>

            {!collapsed && (
                <>
                    <div className="wb-lib__header">
                        <span className="wb-lib__title">Shapes</span>
                        <input
                            className="wb-lib__search"
                            type="search"
                            placeholder="Search…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            aria-label="Search shapes"
                        />
                    </div>
                    <div className="wb-lib__scroll">
                        {filtered.length === 0
                            ? <p className="wb-lib__empty">No shapes found</p>
                            : filtered.map((cat) => (
                                <CategorySection key={cat.id} category={cat} />
                            ))
                        }
                    </div>
                </>
            )}
        </div>
    );
}
