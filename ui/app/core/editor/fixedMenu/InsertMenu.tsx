import { useState } from 'react';
import { Popover } from '@radix-ui/themes';
import { Plus, Search } from 'lucide-react';
import { SlashCommandGroups } from '@durgakiran/editor';
import type { Editor } from '@tiptap/react';

export function InsertMenu({ editor, disabled }: { editor: Editor; disabled: boolean }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const search = query.trim().toLowerCase();
    const groups = SlashCommandGroups.map(group => ({
        ...group,
        commands: group.commands.filter(command =>
            (!command.requiredNodes || command.requiredNodes.every(name => editor.schema.nodes[name])) &&
            !command.shouldBeHidden?.(editor) &&
            [command.label, command.description, ...(command.aliases ?? [])].some(text => text.toLowerCase().includes(search))
        ),
    })).filter(group => group.commands.length);

    return <Popover.Root open={open} onOpenChange={value => { setOpen(value); setQuery(''); }}>
        <Popover.Trigger>
            <button type="button" className="document-tool document-tool--insert" disabled={disabled}>
                <Plus size={16} /> Insert
            </button>
        </Popover.Trigger>
        <Popover.Content className="document-insert-menu" align="start" sideOffset={8}
            onCloseAutoFocus={event => event.preventDefault()}>
            <div className="document-insert-search"><Search size={16} aria-hidden="true" />
                <input autoFocus aria-label="Search insert options" placeholder="Search blocks, media, and more…"
                    value={query} onChange={event => setQuery(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'ArrowDown' || event.key === 'Enter') {
                            event.preventDefault();
                            const first = event.currentTarget.closest('.document-insert-menu')?.querySelector<HTMLButtonElement>('.document-insert-item');
                            if (event.key === 'Enter') first?.click(); else first?.focus();
                        }
                    }} />
            </div>
            <div className="document-insert-results" onKeyDown={event => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.document-insert-item'));
                const index = items.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                event.preventDefault();
                items[next]?.focus();
            }}>
                {groups.map(group => <section key={group.name} aria-label={group.title}>
                    <h3>{group.title}</h3>
                    {group.commands.map(command => <button key={command.name} type="button" className="document-insert-item"
                        onClick={() => { setOpen(false); command.action(editor); }}>
                        <span className="document-insert-icon" aria-hidden="true">{command.icon}</span>
                        <span><strong>{command.label}</strong><small>{command.description}</small></span>
                    </button>)}
                </section>)}
                {!groups.length && <p className="document-insert-empty">No matching options. Try “table”, “image”, or “math”.</p>}
            </div>
        </Popover.Content>
    </Popover.Root>;
}
