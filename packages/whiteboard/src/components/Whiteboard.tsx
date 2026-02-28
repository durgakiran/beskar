'use client';

import React, { useCallback } from 'react';
import {
    Tldraw,
    type Editor as TldrawEditor,
    type TLComponents,
    ArrowShapeArrowheadEndStyle,
} from 'tldraw';
import type { WhiteboardProps } from '../types';
import { WhiteboardCanvas } from './WhiteboardCanvas';
import { customShapeUtils } from '../shapes';

/**
 * InFrontOfTheCanvas slot — renders as a 100%×100% absolute overlay inside the
 * tldraw canvas container. All our custom UI (panel, toolbar, zoom) live here.
 */
function CanvasOverlay() {
    return <WhiteboardCanvas />;
}

export function Whiteboard({
    readOnly = false,
    persistenceKey,
    onMount,
    className,
    style,
    collaboration: _collaboration,
}: WhiteboardProps) {
    const components: TLComponents = {
        Toolbar: null,
        NavigationPanel: null,
        InFrontOfTheCanvas: readOnly ? undefined : CanvasOverlay,
    };

    const handleMount = useCallback(
        (editor: TldrawEditor) => {
            if (readOnly) {
                editor.updateInstanceState({ isReadonly: true });
            }

            // Epic 3: Default styles for connectors
            editor.setStyleForNextShapes(ArrowShapeArrowheadEndStyle, 'arrow');

            onMount?.(editor);
        },
        [readOnly, onMount],
    );

    return (
        <div
            className={['wb-canvas-root', className].filter(Boolean).join(' ')}
            style={{ position: 'relative', width: '100%', height: '100%', ...style }}
        >
            <Tldraw
                persistenceKey={persistenceKey}
                onMount={handleMount}
                components={components}
                shapeUtils={customShapeUtils}
                inferDarkMode
            />
        </div>
    );
}
