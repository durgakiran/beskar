import React from 'react';
import { useEditor, useValue } from 'tldraw';
import { ZoomIn, ZoomOut, Maximize2, Grid3x3 } from 'lucide-react';

export function ZoomStrip() {
    const editor = useEditor();

    const zoom = useValue('zoom', () => Math.round(editor.getZoomLevel() * 100), [editor]);
    const isGridMode = useValue('isGridMode', () => editor.getInstanceState().isGridMode, [editor]);

    return (
        <div className="wb-zoom" role="group" aria-label="Zoom controls">
            <button
                className="wb-zoom__btn"
                title="Toggle Grid"
                onClick={() => editor.updateInstanceState({ isGridMode: !isGridMode })}
                type="button"
                aria-label="Toggle Grid"
                style={{ color: isGridMode ? '#2f80ed' : 'inherit' }}
            >
                <Grid3x3 size={14} />
            </button>
            <div className="wb-zoom__divider" />
            <button
                className="wb-zoom__btn"
                title="Zoom out (−)"
                onClick={() => editor.zoomOut()}
                type="button"
                aria-label="Zoom out"
            >
                <ZoomOut size={14} />
            </button>
            <button
                className="wb-zoom__level"
                title="Reset zoom"
                onClick={() => editor.resetZoom()}
                type="button"
                aria-label="Reset zoom"
            >
                {zoom}%
            </button>
            <button
                className="wb-zoom__btn"
                title="Zoom in (+)"
                onClick={() => editor.zoomIn()}
                type="button"
                aria-label="Zoom in"
            >
                <ZoomIn size={14} />
            </button>
            <div className="wb-zoom__divider" />
            <button
                className="wb-zoom__btn"
                title="Fit to screen"
                onClick={() => editor.zoomToFit()}
                type="button"
                aria-label="Fit to screen"
            >
                <Maximize2 size={14} />
            </button>
        </div>
    );
}
