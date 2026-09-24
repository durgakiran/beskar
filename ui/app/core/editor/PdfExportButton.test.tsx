import React from 'react';
import { Theme } from '@radix-ui/themes';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PdfExportButton from './PdfExportButton';

const mocks = vi.hoisted(() => ({ create: vi.fn(), save: vi.fn() }));
vi.mock('@durgakiran/editor/pdf', () => ({ createDocumentPdf: mocks.create }));
vi.mock('./pdfAssets', () => ({ downloadPdf: mocks.save, resolvePdfImage: vi.fn() }));
vi.mock('../desktop/isDesktop', () => ({ isDesktop: false }));

const snapshot = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Current draft' }] }] };
const editor = { isDestroyed: false, getJSON: vi.fn(() => snapshot) };
const show = (props = {}) => render(<Theme><PdfExportButton editor={editor as never} title="Draft title" spaceId="space-1" {...props} /></Theme>);

describe('PDF export dialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.create.mockResolvedValue({ blob: new Blob(['pdf']), fileName: 'Draft title.pdf', warnings: [] });
        mocks.save.mockResolvedValue(true);
    });
    afterEach(cleanup);
    it('disables export until a document editor exists', () => {
        show({ editor: null });
        expect((screen.getByRole('button', { name: 'Export PDF' }) as HTMLButtonElement).disabled).toBe(true);
    });
    it('exports a snapshot with chosen paper settings and reports fallbacks', async () => {
        mocks.create.mockResolvedValue({ blob: new Blob(['pdf']), fileName: 'Draft title.pdf', warnings: ['Some images could not be loaded.'] });
        show();
        fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
        expect(screen.getByText(/including unsaved changes/)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Paper size'), { target: { value: 'LETTER' } });
        fireEvent.change(screen.getByLabelText('Orientation'), { target: { value: 'landscape' } });
        fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
        await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
        expect(mocks.create).toHaveBeenCalledWith(snapshot, expect.objectContaining({ title: 'Draft title', pageSize: 'LETTER', orientation: 'landscape' }));
        expect(screen.getByText('Some images could not be loaded.')).toBeTruthy();
    });
    it('shows errors and allows retry without downloading a failed export', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.create.mockRejectedValueOnce(new Error('Failed'));
        show({ published: true });
        fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
        expect(screen.getByText(/published document/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
        await screen.findByRole('alert');
        expect(mocks.save).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
        await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
        vi.restoreAllMocks();
    });
    it('prevents duplicate exports while rendering', async () => {
        let finish: (value: unknown) => void;
        mocks.create.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        show();
        fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
        const button = screen.getByRole('button', { name: 'Download PDF' });
        fireEvent.click(button); fireEvent.click(button);
        await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
        finish!({ blob: new Blob(), fileName: 'test.pdf', warnings: [] });
        await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    });
});

describe('export from document actions', () => {
    afterEach(cleanup);
    it('keeps the dialog open after the ellipsis menu closes', async () => {
        const { default: ReadOnlyContentMain } = await import('../../components/ReadOnlyContentMain');
        const { MemoryRouter } = await import('react-router-dom');
        function DocumentActions() {
            const [open, setOpen] = React.useState(false);
            return <MemoryRouter><Theme>
                <ReadOnlyContentMain spaceId="space-1" pageId="1" title="Test" breadcrumbs={[]} archived={false}
                    capabilities={{ canEdit: true, canDelete: true, canComment: true, canShare: true }} meta={{}}
                    isCommentsOpen={false} commentPresentation="docked" onOpenComments={() => {}} onEdit={() => {}} onDelete={() => {}}
                    onExportPdf={() => setOpen(true)}>
                    <p>Document body</p>
                </ReadOnlyContentMain>
                <PdfExportButton editor={editor as never} title="Test" spaceId="space-1" published hideTrigger open={open} onOpenChange={setOpen} />
            </Theme></MemoryRouter>;
        }
        render(<DocumentActions />);
        expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
        expect(screen.getByRole('dialog')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        // The mobile action menu exposes the same export flow.
        fireEvent.click(screen.getByRole('button', { name: 'Open actions' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
        expect(screen.getByRole('dialog')).toBeTruthy();
    });
});
