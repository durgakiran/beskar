import React, { useEffect, useId, useState } from 'react';
import type { InternalResourceHandler, InternalResourceResult, InternalResourceType } from '../../types';
import { parseInternalResourceUrl } from '../../nodes/internalDocumentUrl';

interface Props {
  handler: InternalResourceHandler;
  initialType?: InternalResourceType;
  onPick: (resource: InternalResourceResult) => void;
  onCancel: () => void;
}

export function InternalResourcePicker({ handler, initialType, onPick, onCancel }: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InternalResourceType | 'all'>(initialType || 'all');
  const [results, setResults] = useState<InternalResourceResult[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'invalid'>('loading');
  const [active, setActive] = useState(0);
  const [revision, retry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState('loading'); setResults([]); setActive(0);
    const timer = window.setTimeout(async () => {
      try {
        const parsed = parseInternalResourceUrl(query, handler.appBaseUrl);
        let next: InternalResourceResult[];
        if (parsed) {
          const metadata = await handler.getResourceMetadata(parsed.resourceId, parsed.resourceType, parsed);
          next = metadata ? [{ ...metadata, spaceId: parsed.spaceId, href: parsed.href }] : [];
        } else if (/^(https?:|\/)/i.test(query.trim())) {
          if (!cancelled) setState('invalid');
          return;
        } else {
          const types: InternalResourceType[] = filter === 'all' ? ['document', 'whiteboard'] : [filter];
          next = (await Promise.all(types.map(type => handler.searchResources(query, type)))).flat();
        }
        if (!cancelled) { setResults(next); setState('ready'); }
      } catch { if (!cancelled) setState('error'); }
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, filter, handler, revision]);
  useEffect(() => { document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, id]);
  return <div className="internal-link-picker" role="dialog" aria-label="Choose internal link" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
  }}>
    <label htmlFor={id}>Search documents and whiteboards or paste an internal URL</label>
    <input id={id} autoFocus role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-results`}
      aria-activedescendant={results[active] ? `${id}-${active}` : undefined} value={query}
      placeholder="Search or paste a link…" onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setActive(n => results.length ? (n + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0);
        }
        if (event.key === 'Enter') { event.preventDefault(); if (results[active] && state === 'ready') onPick(results[active]); }
      }} />
    <select aria-label="Resource type" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
      <option value="all">All</option><option value="document">Documents</option><option value="whiteboard">Whiteboards</option>
    </select>
    <div role="status">{state === 'loading' ? 'Searching…' : state === 'error' ? 'Could not search. Try again.' : state === 'invalid' ? 'Paste a document or whiteboard URL from this app.' : results.length ? `${results.length} results` : 'No accessible results found'}</div>
    {state === 'error' && <button type="button" onClick={() => retry(n => n + 1)}>Retry search</button>}
    <div id={`${id}-results`} role="listbox" aria-label="Resources" className="internal-link-results">
      {results.map((resource, index) => <button id={`${id}-${index}`} role="option" aria-selected={active === index}
        key={`${resource.spaceId || ''}-${resource.resourceType}-${resource.resourceId}`} type="button" className="internal-link-result"
        onMouseDown={event => event.preventDefault()} onClick={() => onPick(resource)}>
        <span>{resource.icon || (resource.resourceType === 'whiteboard' ? '▧' : '📄')}</span>
        <span>{resource.title || 'Untitled'} <small>{resource.resourceType}{resource.spaceId ? ` · ${resource.spaceId}` : ''}</small></span>
      </button>)}
    </div>
    <button type="button" onClick={onCancel}>Cancel</button>
  </div>;
}
