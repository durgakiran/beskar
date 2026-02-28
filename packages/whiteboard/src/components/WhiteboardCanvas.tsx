import React from 'react';
import { ShapeLibraryPanel } from './ShapeLibraryPanel';
import { WhiteboardToolbar } from './WhiteboardToolbar';
import { ZoomStrip } from './ZoomStrip';
import { QuickAdd } from './QuickAdd';
import { ShapeQuickAdd } from './ShapeQuickAdd';

/**
 * Composition root for custom UI elements that live purely OVER the canvas.
 * This is passed to tldraw's components.InFrontOfTheCanvas slot.
 */
export function WhiteboardCanvas() {
    return (
        <div className="wb-overlay">
            <ShapeLibraryPanel />
            <QuickAdd />
            <ShapeQuickAdd />

            <div className="wb-overlay__right">
                <WhiteboardToolbar />
                <ZoomStrip />
            </div>
        </div>
    );
}
