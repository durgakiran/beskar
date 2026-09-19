import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Button, Dialog, Flex, Text } from '@radix-ui/themes';
import { FiDownload } from 'react-icons/fi';
import { isDesktop } from '../desktop/isDesktop';
import { downloadPdf, resolvePdfImage } from './pdfAssets';

export default function PdfExportButton({ editor, title, spaceId, disabled, published = false, open: controlledOpen, onOpenChange, hideTrigger = false }: {
    editor?: Editor | null; title: string; spaceId: string; disabled?: boolean; published?: boolean;
    open?: boolean; onOpenChange?: (open: boolean) => void; hideTrigger?: boolean;
}) {
    const [internalOpen, setInternalOpen] = useState(false);
    const open = controlledOpen ?? internalOpen;
    const setOpen = onOpenChange ?? setInternalOpen;
    const [busy, setBusy] = useState(false);
    const exporting = useRef(false);
    const [pageSize, setPageSize] = useState<'A4' | 'LETTER'>('A4');
    const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
    const [error, setError] = useState('');
    const [warnings, setWarnings] = useState<string[]>([]);
    const [complete, setComplete] = useState(false);
    useEffect(() => {
        if (open) { setError(''); setWarnings([]); setComplete(false); }
    }, [open]);
    const exportPdf = async () => {
        if (!editor || editor.isDestroyed || exporting.current) return;
        exporting.current = true;
        setBusy(true); setError(''); setWarnings([]); setComplete(false);
        // Capture before loading the export module, so collaborative edits cannot change it.
        const snapshot = editor.getJSON();
        const exportTitle = title;
        try {
            const { createDocumentPdf } = await import('@durgakiran/editor/pdf');
            const result = await createDocumentPdf(snapshot, {
                title: exportTitle, pageSize, orientation, baseUrl: window.location.href,
                resolveImage: resolvePdfImage,
                resolveDocumentLink: attrs => attrs.resourceId
                    ? `${window.location.origin}/space/${encodeURIComponent(spaceId)}/view/${encodeURIComponent(String(attrs.resourceId))}` : undefined,
            });
            const saved = await downloadPdf(result.blob, result.fileName);
            setWarnings(result.warnings); setComplete(saved);
        } catch (error) {
            console.error('PDF export failed', error);
            setError('The PDF could not be created. Please try again.');
        } finally { exporting.current = false; setBusy(false); }
    };
    return <Dialog.Root open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (value) { setError(''); setWarnings([]); setComplete(false); } } }}>
        {!hideTrigger && <Dialog.Trigger><Button variant="soft" color="gray" size="2" disabled={disabled || !editor || editor.isDestroyed}><FiDownload /> Export PDF</Button></Dialog.Trigger>}
        <Dialog.Content maxWidth="440px" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
            <Dialog.Title>Export PDF</Dialog.Title>
            <Dialog.Description size="2">{published ? 'Export this published document.' : 'Export the current draft, including unsaved changes.'} Comments are excluded.</Dialog.Description>
            <Flex direction="column" gap="3" mt="4">
                <label><Text as="div" size="2" mb="1">Paper size</Text><select aria-label="Paper size" disabled={busy} value={pageSize} onChange={e => setPageSize(e.target.value as typeof pageSize)} className="w-full rounded border p-2"><option value="A4">A4</option><option value="LETTER">Letter</option></select></label>
                <label><Text as="div" size="2" mb="1">Orientation</Text><select aria-label="Orientation" disabled={busy} value={orientation} onChange={e => setOrientation(e.target.value as typeof orientation)} className="w-full rounded border p-2"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
                <Text size="1" color="gray">Embeds become links. Columns flow in reading order, and inline equations use LaTeX text.</Text>
                {error && <Text role="alert" color="red" size="2">{error}</Text>}
                {complete && <Text role="status" size="2">{isDesktop ? 'PDF saved.' : 'PDF download started.'}</Text>}
                {!!warnings.length && <div role="status"><Text size="2" weight="medium">Export notes</Text><ul className="list-disc pl-5 text-sm">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
            </Flex>
            <Flex justify="end" gap="3" mt="5"><Dialog.Close><Button variant="soft" color="gray" disabled={busy}>{complete ? 'Done' : 'Cancel'}</Button></Dialog.Close><Button onClick={exportPdf} loading={busy} disabled={busy || !editor || editor.isDestroyed}>{busy ? 'Creating PDF…' : isDesktop ? 'Save PDF' : 'Download PDF'}</Button></Flex>
        </Dialog.Content>
    </Dialog.Root>;
}
