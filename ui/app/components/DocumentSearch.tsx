import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
import { railActiveClass, railButtonClass } from './workspaceRailStyles';
import { Icon } from '@components/ui/Icon';
import { DocumentSearchResult, searchDocuments } from '../core/http/searchApiHandler';

const documentURL = (result: DocumentSearchResult) => `/space/${result.spaceId}/view/${result.pageId}`;

export default function DocumentSearch() {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const [state, setState] = useState<{ query: string; results: DocumentSearchResult[]; status: 'idle' | 'loading' | 'ready' | 'error' }>({ query: '', results: [], status: 'idle' });
    const input = useRef<HTMLInputElement>(null);
    const listID = useId();
    const navigate = useNavigate();
    const location = useLocation();
    const normalized = query.trim();
    const results = state.query === normalized ? state.results : [];

    useEffect(() => { setOpen(false); setQuery(''); }, [location.pathname]);

    useEffect(() => {
        const shortcut = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            const editing = target?.closest?.('input, textarea, [contenteditable="true"]');
            if (event.defaultPrevented || (!input.current && target?.closest?.('[role="dialog"]'))) return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && (!editing || target === input.current)) {
                event.preventDefault(); setOpen(true); input.current?.focus();
            }
        };
        document.addEventListener('keydown', shortcut);
        return () => {
            document.removeEventListener('keydown', shortcut);
        };
    }, []);

    useEffect(() => {
        setActive(-1);
        if (!open || Array.from(normalized).length < 2) {
            setState({ query: normalized, results: [], status: 'idle' });
            return;
        }
        const controller = new AbortController();
        setState({ query: normalized, results: [], status: 'loading' });
        const timer = window.setTimeout(async () => {
            try {
                const data = await searchDocuments(normalized, controller.signal);
                if (!controller.signal.aborted) setState({ query: normalized, results: data, status: 'ready' });
            } catch {
                if (!controller.signal.aborted) setState({ query: normalized, results: [], status: 'error' });
            }
        }, 250);
        return () => { window.clearTimeout(timer); controller.abort(); };
    }, [normalized, open]);

    useEffect(() => {
        if (active >= 0) document.getElementById(`${listID}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
    }, [active, listID]);

    const status = Array.from(normalized).length < 2 ? 'Type at least 2 characters to search published documents.'
        : state.query !== normalized || state.status === 'loading' ? 'Searching documents…'
        : state.status === 'error' ? 'Search is temporarily unavailable. Try again shortly.'
        : results.length === 0 ? 'No matching documents found.' : `${results.length} document${results.length === 1 ? '' : 's'} found`;

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button type="button" aria-label="Search documents" title="Search documents (⌘ / Ctrl K)"
                    className={cn(railButtonClass, open && railActiveClass)}>
                    <Icon name="Search" className="h-5 w-5" strokeWidth={1.75} />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content side="right" align="start" sideOffset={12} collisionPadding={8} aria-label="Document search"
                    className="z-[60] flex max-h-[var(--radix-popover-content-available-height)] w-[min(440px,calc(100vw-72px))] max-w-[var(--radix-popover-content-available-width)] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
                    onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}>
                    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-neutral-200 px-3">
                        <Icon name="Search" className="h-4 w-4 shrink-0 text-neutral-500" />
                        <input ref={input} type="search" role="combobox" aria-label="Search documents" aria-autocomplete="list"
                            aria-controls={listID} aria-expanded={true}
                            aria-activedescendant={active >= 0 && results[active] ? `${listID}-${active}` : undefined}
                            value={query} maxLength={200} placeholder="Search documents…" autoComplete="off" spellCheck={false}
                            className="w-full min-w-0 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-500 [&::-webkit-search-cancel-button]:hidden"
                            onChange={(event) => { setQuery(event.target.value); setActive(-1); }}
                            onKeyDown={(event) => {
                                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                    event.preventDefault();
                                    if (results.length) setActive((index) => event.key === 'ArrowDown' ? (index + 1) % results.length : index <= 0 ? results.length - 1 : index - 1);
                                }
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    if (active >= 0 && results[active]) { setOpen(false); navigate(documentURL(results[active])); }
                                }
                            }} />
                        {query ? <button type="button" aria-label="Clear search" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                            onClick={() => { setQuery(''); input.current?.focus(); }}><Icon name="X" className="h-3.5 w-3.5" /></button>
                            : <kbd className="hidden shrink-0 rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-400 lg:inline">⌘ / Ctrl K</kbd>}
                    </div>
                    <div role="status" aria-live="polite" className={results.length ? 'sr-only' : 'px-4 py-6 text-sm text-neutral-500'}>{status}</div>
                    <ul id={listID} role="listbox" aria-label="Document search results" className="min-h-0 max-h-[min(420px,60dvh)] overflow-y-auto empty:hidden">
                        {results.map((result, index) => (
                            <li key={result.pageId} id={`${listID}-${index}`} role="option" aria-selected={active === index}>
                                <Link to={documentURL(result)} tabIndex={-1} onMouseEnter={() => setActive(index)}
                                    onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(false)}
                                    className={`flex gap-3 px-4 py-3 text-left transition-colors ${active === index ? 'bg-primary-50' : 'hover:bg-neutral-50'}`}>
                                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-500"><Icon name="FileText" className="h-4 w-4" /></span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-semibold text-neutral-900">{result.title || 'Untitled document'}</span>
                                        <span className="mt-0.5 block truncate text-xs text-neutral-500">{result.spaceName}</span>
                                        {result.snippet && <span className="mt-1 block line-clamp-2 text-xs leading-5 text-neutral-600">{result.snippet}</span>}
                                    </span>
                                    <Icon name="ArrowUpRight" className="mt-1 h-3.5 w-3.5 shrink-0 text-neutral-400" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                    {results.length > 0 && <div className="hidden border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-400 sm:block">↑ ↓ Navigate <span className="mx-2">↵ Open</span> Esc Close</div>}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
