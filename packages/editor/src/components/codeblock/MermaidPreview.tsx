import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FiMaximize2 } from 'react-icons/fi';
import { MermaidDiagramDialog, type DiagramSize } from './MermaidDiagramDialog';
import { renderMermaid } from './mermaidRenderer';

interface Diagram {
  src: string;
  size: DiagramSize | null;
}

const MIN_INLINE_SCALE = 0.8;

function diagramFromSvg(svg: string): Diagram {
  const element = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const viewBox = element.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const width = viewBox?.[2];
  const height = viewBox?.[3];
  return {
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    size: width && height && width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)
      ? { width, height }
      : null,
  };
}

function themeAt(element: Element | null): 'default' | 'dark' {
  const explicit = element?.closest('[data-theme="dark"], [data-theme="light"], .dark, .light');
  if (explicit) return explicit.matches('[data-theme="dark"], .dark') ? 'dark' : 'default';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

export function MermaidPreview({ source }: { source: string }) {
  const root = useRef<HTMLDivElement>(null);
  const inline = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState<'default' | 'dark'>('default');
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [scaledDown, setScaledDown] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
    setError('');
    if (!source.trim()) {
      setDiagram(null);
      setExpanded(false);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const svg = await renderMermaid(source, theme, controller.signal);
        if (!controller.signal.aborted) setDiagram(diagramFromSvg(svg));
      } catch (cause) {
        if (!controller.signal.aborted) {
          setDiagram(null);
          setExpanded(false);
          setError(cause instanceof Error ? cause.message : 'Unable to render this diagram.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [source, theme]);

  useLayoutEffect(() => {
    const frame = inline.current;
    const img = image.current;
    if (!frame || !img || !diagram) return;
    const measure = () => {
      const { width, height } = img.getBoundingClientRect();
      setClipped(height - frame.clientHeight > 1 || width - frame.clientWidth > 1);
      setScaledDown(!!diagram.size && diagram.size.width - width > 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(img);
    measure();
    return () => observer.disconnect();
  }, [diagram]);

  return <div ref={root} className="code-block-mermaid-preview" aria-label="Mermaid diagram preview">
    {!diagram && loading && <span role="status">Rendering diagram…</span>}
    {!diagram && !loading && error && <span role="alert">{error}</span>}
    {!diagram && !loading && !error && <span>Add Mermaid code to preview.</span>}
    {diagram && <>
      <div ref={inline} className={`mermaid-inline-frame${clipped ? ' is-clipped' : ''}`}>
        <img
          ref={image}
          alt={clipped ? 'Excerpt of the rendered Mermaid diagram' : 'Rendered Mermaid diagram'}
          src={diagram.src}
          style={{ width: diagram.size
            ? `min(${diagram.size.width}px, max(100%, ${diagram.size.width * MIN_INLINE_SCALE}px))`
            : undefined }}
          onLoad={event => {
            if (diagram.size) return;
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
            if (width && height) {
              setDiagram(current => current?.src === diagram.src ? { ...current, size: { width, height } } : current);
            }
          }}
        />
      </div>
      {diagram.size && (clipped || scaledDown || expanded) && <div className="mermaid-inline-actions">
        {clipped && <span>Showing part of the diagram</span>}
        <button ref={opener} className="code-block-control mermaid-open-diagram" type="button" aria-haspopup="dialog" onClick={() => setExpanded(true)}>
          <FiMaximize2 aria-hidden="true" /> Open diagram
        </button>
      </div>}
      {expanded && diagram.size && <MermaidDiagramDialog src={diagram.src} size={diagram.size} onClose={() => {
        setExpanded(false);
        opener.current?.focus({ preventScroll: true });
      }} />}
    </>}
  </div>;
}
