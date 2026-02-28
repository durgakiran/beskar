import React, { useState, useEffect } from 'react';
import { ShapeLibraryPanel } from './ShapeLibraryPanel';
import { WhiteboardToolbar } from './WhiteboardToolbar';
import { ZoomStrip } from './ZoomStrip';
import { QuickAdd } from './QuickAdd';
import { ShapeQuickAdd } from './ShapeQuickAdd';
import { ExportPanel } from './ExportPanel';
import { ShortcutsModal } from './ShortcutsModal';
import { useEditor, exportToBlob, useValue } from 'tldraw';

/**
 * Composition root for custom UI elements that live purely OVER the canvas.
 * This is passed to tldraw's components.InFrontOfTheCanvas slot.
 */
export function WhiteboardCanvas() {
    const editor = useEditor();
    const [showShortcuts, setShowShortcuts] = useState(false);

    // Track if the canvas is completely blank to show the empty state hint
    const isEmpty = useValue('is-empty', () => {
        try {
            return editor.getCurrentPageShapeIds().size === 0;
        } catch {
            return false;
        }
    }, [editor]);

    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;

            // Tldraw marks the entire canvas as contentEditable for mobile IME.
            // We only want to abort if the user is genuinely editing text inside a shape or form field.
            const isEditingText =
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.closest('.tl-text') ||
                (target.isContentEditable && !target.closest('.tl-canvas'));

            if (isEditingText) {
                return;
            }

            // ? toggles shortcuts modal (Shift + /)
            if (e.key === '?') {
                e.preventDefault();
                e.stopImmediatePropagation();
                e.stopPropagation();
                setShowShortcuts((prev) => !prev);
                return;
            }

            // Cmd+E / Ctrl+E triggers export to PNG
            if (e.key === 'e' || e.key === 'E') {
                if (e.metaKey || e.ctrlKey) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.stopPropagation();

                    const selectedIds = editor.getSelectedShapeIds();
                    const ids = selectedIds.length > 0 ? selectedIds : Array.from(editor.getCurrentPageShapeIds());

                    if (ids.length === 0) return;

                    const blob = await exportToBlob({
                        editor,
                        ids: ids,
                        format: 'png',
                        opts: { background: true, padding: 32 }
                    });

                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `diagram-${new Date().toISOString().split('T')[0]}.png`;
                    a.click();
                    URL.revokeObjectURL(url);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, [editor]);

    return (
        <div className="wb-overlay">
            <ShapeLibraryPanel />
            <QuickAdd />
            <ShapeQuickAdd />

            <div className="wb-overlay__right">
                <ExportPanel />
                <WhiteboardToolbar />
                <ZoomStrip />
            </div>

            {isEmpty && (
                <div className="wb-empty-state">
                    Drag a shape from the left to start drawing
                </div>
            )}

            {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
        </div>
    );
}
