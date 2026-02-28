import React, { useState } from 'react';
import { useEditor, exportToBlob } from 'tldraw';
import { Download, Image as ImageIcon, Copy, Check } from 'lucide-react';

export function ExportPanel() {
    const editor = useEditor();
    const [copied, setCopied] = useState(false);

    const getExportIds = () => {
        const selected = editor.getSelectedShapeIds();
        if (selected.length > 0) return selected;
        // If nothing is selected, export all shapes on current page
        return Array.from(editor.getCurrentPageShapeIds());
    };

    const handleExportPNG = async () => {
        const ids = getExportIds();
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
    };

    const handleExportSVG = async () => {
        const ids = getExportIds();
        if (ids.length === 0) return;
        const blob = await exportToBlob({
            editor,
            ids: ids,
            format: 'svg',
            opts: { background: true, padding: 32 }
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `diagram-${new Date().toISOString().split('T')[0]}.svg`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleCopy = async () => {
        const ids = getExportIds();
        if (ids.length === 0) return;
        const blob = await exportToBlob({
            editor,
            ids: ids,
            format: 'png',
            opts: { background: true, padding: 32 }
        });

        try {
            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error('Failed to copy to clipboard', e);
            // Fallback for browsers that don't support ClipboardItem API directly 
            // without a user-triggered event happening immediately.
            alert("Clipboard permission denied or unsupported. Try downloading instead.");
        }
    };

    return (
        <div className="wb-export" role="group" aria-label="Export controls">
            <button
                className="wb-export__btn"
                title="Copy as Image"
                onClick={handleCopy}
                type="button"
            >
                {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
            </button>
            <div className="wb-export__divider" />
            <button
                className="wb-export__btn"
                title="Download PNG"
                onClick={handleExportPNG}
                type="button"
            >
                <ImageIcon size={14} />
            </button>
            <button
                className="wb-export__btn"
                title="Download SVG"
                onClick={handleExportSVG}
                type="button"
            >
                <Download size={14} />
            </button>
        </div>
    );
}
