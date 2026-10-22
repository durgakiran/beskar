import { Popover } from '@radix-ui/themes';
import { Highlighter, Baseline } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type {} from '@tiptap/extension-color';
import type {} from '@tiptap/extension-highlight';

const colors = [
    ['Gray', '#64748b', '#f1f5f9'], ['Red', '#dc2626', '#fee2e2'],
    ['Orange', '#ea580c', '#ffedd5'], ['Yellow', '#a16207', '#fef9c3'],
    ['Green', '#15803d', '#dcfce7'], ['Teal', '#0f766e', '#ccfbf1'],
    ['Blue', '#2563eb', '#dbeafe'], ['Purple', '#9333ea', '#f3e8ff'],
    ['Pink', '#db2777', '#fce7f3'],
];

export function ColorMenu({ editor, highlight = false, disabled }: { editor: Editor; highlight?: boolean; disabled: boolean }) {
    const label = highlight ? 'Highlight color' : 'Text color';
    const current = editor.getAttributes(highlight ? 'highlight' : 'textStyle').color;
    const apply = (color: string) => {
        const chain = editor.chain().focus();
        if (highlight) color ? chain.setHighlight({ color }).run() : chain.unsetHighlight().run();
        else color ? chain.setColor(color).run() : chain.unsetColor().run();
    };
    return <Popover.Root>
        <Popover.Trigger><button type="button" className="document-tool" aria-label={label} title={label} disabled={disabled}>
            {highlight ? <Highlighter size={17} /> : <Baseline size={17} />}
            <span className="document-color-indicator" style={{ background: current || (highlight ? '#fef08a' : 'currentColor') }} />
        </button></Popover.Trigger>
        <Popover.Content align="start" sideOffset={8} onCloseAutoFocus={event => event.preventDefault()}>
            <div className="document-color-menu" aria-label={label}>
                <strong>{label}</strong>
                <div className="document-color-grid">{colors.map(([name, text, background]) => {
                    const color = highlight ? background : text;
                    return <Popover.Close key={name}><button type="button" aria-label={`${name} ${label.toLowerCase()}`}
                        aria-pressed={current === color} title={name} style={{ background: color }} onClick={() => apply(color)} /></Popover.Close>;
                })}</div>
                <Popover.Close><button type="button" className="document-color-reset" onClick={() => apply('')}>Reset to default</button></Popover.Close>
            </div>
        </Popover.Content>
    </Popover.Root>;
}
