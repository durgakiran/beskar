import React from 'react';
import { X } from 'lucide-react';

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
    return (
        <div className="wb-shortcuts-modal" onClick={onClose}>
            <div className="wb-shortcuts-modal__content" onClick={(e) => e.stopPropagation()}>
                <header className="wb-shortcuts-modal__header">
                    <h2>Keyboard Shortcuts</h2>
                    <button onClick={onClose} title="Close" aria-label="Close" type="button">
                        <X size={18} />
                    </button>
                </header>

                <div className="wb-shortcuts-modal__body">
                    <div className="wb-shortcuts-section">
                        <h3>Tools</h3>
                        <ul>
                            <li><kbd>V</kbd> <span>Select Tool</span></li>
                            <li><kbd>H</kbd> <span>Hand Tool (Pan)</span></li>
                            <li><kbd>R</kbd> <span>Rectangle</span></li>
                            <li><kbd>E</kbd> <span>Ellipse</span></li>
                            <li><kbd>D</kbd> <span>Draw / Pen</span></li>
                            <li><kbd>T</kbd> <span>Text</span></li>
                            <li><kbd>A</kbd> <span>Arrow</span></li>
                            <li><kbd>L</kbd> <span>Line</span></li>
                        </ul>
                    </div>

                    <div className="wb-shortcuts-section">
                        <h3>Actions</h3>
                        <ul>
                            <li><kbd>Cmd</kbd> + <kbd>Z</kbd> <span>Undo</span></li>
                            <li><kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> <span>Redo</span></li>
                            <li><kbd>Cmd</kbd> + <kbd>A</kbd> <span>Select All</span></li>
                            <li><kbd>Backspace</kbd> <span>Delete Selected</span></li>
                            <li><kbd>Cmd</kbd> + <kbd>C</kbd> <span>Copy</span></li>
                            <li><kbd>Cmd</kbd> + <kbd>V</kbd> <span>Paste</span></li>
                            <li><kbd>Cmd</kbd> + <kbd>D</kbd> <span>Duplicate</span></li>
                        </ul>
                    </div>

                    <div className="wb-shortcuts-section">
                        <h3>Custom Plugins</h3>
                        <ul>
                            <li><kbd>?</kbd> <span>Show Shortcuts</span></li>
                            <li><kbd>Cmd</kbd> + <kbd>E</kbd> <span>Export as PNG</span></li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
