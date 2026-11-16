import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { FiMinus, FiMove, FiPlus, FiX } from 'react-icons/fi';

export interface DiagramSize {
  width: number;
  height: number;
}

const PADDING = 16;
const ZOOM_STEP = 1.4;
const MAX_ZOOM = 2.5;
const PAN_STEP = 48;

export function MermaidDiagramDialog({
  src, size, onClose,
}: {
  src: string;
  size: DiagramSize;
  onClose: () => void;
}) {
  const titleId = useId();
  const instructionsId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const zoomCenter = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const [bounds, setBounds] = useState<DiagramSize | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const modal = dialog.current;
    const container = viewport.current;
    if (!modal || !container) return;
    if (!modal.open) modal.showModal();
    container.focus({ preventScroll: true });

    const measure = () => {
      const { width, height } = container.getBoundingClientRect();
      setBounds(previous => previous?.width === width && previous.height === height
        ? previous
        : { width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, []);

  const fit = bounds ? Math.min(
    1,
    Math.max(1, bounds.width - PADDING * 2) / size.width,
    Math.max(1, bounds.height - PADDING * 2) / size.height,
  ) : 1;
  const scale = zoom === null ? fit : Math.max(fit, zoom);

  useLayoutEffect(() => {
    const container = viewport.current;
    const diagram = image.current;
    if (!container || !diagram) return;
    if (zoom === null) {
      container.scrollTo(0, 0);
    } else if (zoomCenter.current) {
      const { x, y } = zoomCenter.current;
      const frame = container.getBoundingClientRect();
      const graphic = diagram.getBoundingClientRect();
      container.scrollLeft += graphic.left + graphic.width * x - frame.left - container.clientWidth / 2;
      container.scrollTop += graphic.top + graphic.height * y - frame.top - container.clientHeight / 2;
    }
    zoomCenter.current = null;
  }, [zoom, scale]);

  function changeZoom(factor: number) {
    const container = viewport.current;
    const diagram = image.current;
    if (!container || !diagram) return;
    const next = Math.max(fit, Math.min(MAX_ZOOM, scale * factor));
    if (next === scale) return;
    const frame = container.getBoundingClientRect();
    const graphic = diagram.getBoundingClientRect();
    zoomCenter.current = {
      x: (frame.left + container.clientWidth / 2 - graphic.left) / graphic.width,
      y: (frame.top + container.clientHeight / 2 - graphic.top) / graphic.height,
    };
    setZoom(next === fit ? null : next);
  }

  function panWithKeyboard(event: React.KeyboardEvent) {
    const container = viewport.current;
    if (!container || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-PAN_STEP, 0],
      ArrowRight: [PAN_STEP, 0],
      ArrowUp: [0, -PAN_STEP],
      ArrowDown: [0, PAN_STEP],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    container.scrollBy(...direction);
  }

  return <dialog ref={dialog} className="mermaid-diagram-dialog" aria-labelledby={titleId} onClose={onClose} onKeyDown={panWithKeyboard}>
    <header className="mermaid-diagram-header">
      <h2 id={titleId}>Mermaid diagram</h2>
      <button className="code-block-control" type="button" onClick={() => dialog.current?.close()}><FiX aria-hidden="true" /> Close</button>
    </header>
    <div className="mermaid-diagram-tools" role="group" aria-label="Diagram zoom controls">
      <button className="code-block-control" type="button" onClick={() => {
        viewport.current?.scrollTo(0, 0);
        setZoom(null);
      }}>Fit to screen</button>
      <button className="code-block-control" type="button" disabled={scale <= fit} aria-label="Zoom out" onClick={() => changeZoom(1 / ZOOM_STEP)}><FiMinus aria-hidden="true" /></button>
      <output aria-label="Diagram zoom">{scale < 0.01 ? '<1' : Math.round(scale * 100)}%</output>
      <button className="code-block-control" type="button" disabled={scale >= MAX_ZOOM} aria-label="Zoom in" onClick={() => changeZoom(ZOOM_STEP)}><FiPlus aria-hidden="true" /></button>
    </div>
    <div
      ref={viewport}
      className={`mermaid-diagram-viewport${dragging ? ' is-dragging' : ''}`}
      role="region"
      tabIndex={0}
      aria-label="Diagram canvas"
      aria-describedby={instructionsId}
      onPointerDown={event => {
        if (!event.isPrimary || event.pointerType === 'touch' || event.button !== 0) return;
        const container = event.currentTarget;
        if (event.target === container) return;
        event.preventDefault();
        container.setPointerCapture(event.pointerId);
        drag.current = {
          id: event.pointerId, x: event.clientX, y: event.clientY,
          left: container.scrollLeft, top: container.scrollTop,
        };
        setDragging(true);
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (start?.id !== event.pointerId) return;
        event.currentTarget.scrollTo(start.left + start.x - event.clientX, start.top + start.y - event.clientY);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <div className="mermaid-diagram-stage" style={{ padding: PADDING }}>
        <img ref={image} src={src} alt="Rendered Mermaid diagram" draggable={false} style={{ width: size.width * scale, height: size.height * scale }} />
      </div>
    </div>
    <p className="mermaid-diagram-hint" id={instructionsId}><FiMove aria-hidden="true" /> Drag, swipe, or use arrow keys to pan</p>
  </dialog>;
}
