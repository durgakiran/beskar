import React, { useEffect, useRef, useState } from 'react';
import { renderMermaid } from './mermaidRenderer';

function themeAt(element: Element | null): 'default' | 'dark' {
  const explicit = element?.closest('[data-theme="dark"], [data-theme="light"], .dark, .light');
  if (explicit) return explicit.matches('[data-theme="dark"], .dark') ? 'dark' : 'default';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

export function MermaidPreview({ source }: { source: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<'default' | 'dark'>('default');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sync = () => setTheme(themeAt(root.current));
    const observer = new MutationObserver(sync);
    for (let ancestor = root.current?.parentElement; ancestor; ancestor = ancestor.parentElement) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', sync);
    sync();
    return () => { observer.disconnect(); media?.removeEventListener('change', sync); };
  }, []);

  useEffect(() => {
    setSvg('');
    setError('');
    if (!source.trim()) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      renderMermaid(source, theme, controller.signal).then(
        result => { if (!controller.signal.aborted) { setSvg(result); setLoading(false); } },
        cause => {
          if (!controller.signal.aborted) {
            setError(cause instanceof Error ? cause.message : 'Unable to render this diagram.');
            setLoading(false);
          }
        },
      );
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [source, theme]);

  return <div ref={root} className="code-block-mermaid-preview" aria-label="Mermaid diagram preview">
    {loading && <span role="status">Rendering diagram…</span>}
    {!loading && error && <span role="alert">{error}</span>}
    {!loading && !error && !svg && <span>Add Mermaid code to preview.</span>}
    {!loading && svg && <img alt="Rendered Mermaid diagram" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />}
  </div>;
}
