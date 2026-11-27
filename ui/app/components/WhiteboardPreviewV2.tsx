import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button, Flex, IconButton, Text } from '@radix-ui/themes';
import { Maximize, Minimize, Minus, Plus } from 'lucide-react';
import { boardUrl, contentUrl, jsonRequest, WhiteboardApiError, type PublishedBoard } from 'app/core/whiteboard/v2/api';

const fitView = { scale: 1, x: 0, y: 0, doubleTapZoomed: false };
const minScale = 0.5;
const maxScale = 8;
const zoomStep = 1.25;
const panStep = 40;
const tapDuration = 250;
const tapMovement = 8;
const doubleTapDelay = 300;
const doubleTapDistance = 28;
const viewAnimationDuration = 240;
const wheelZoomTimeConstant = 45;

type View = typeof fitView;
type ViewAnimation = { frame: number; target: View; source: 'control' | 'wheel' | 'other'; updatedAt: number };
type Tap = { x: number; y: number; time: number };
type ActivePointer = { x: number; y: number; type: string; tapStart?: Tap };

function zoomView(view: View, factor: number, anchorX = 0, anchorY = 0) {
    const scale = Math.min(maxScale, Math.max(minScale, view.scale * factor));
    if (scale === view.scale) return view;
    const ratio = scale / view.scale;
    return { ...view, scale, x: anchorX + (view.x - anchorX) * ratio, y: anchorY + (view.y - anchorY) * ratio };
}

function PreviewViewer({ src, title, onError }: { src: string; title: string; onError: () => void }) {
    const frame = useRef<HTMLDivElement>(null);
    const expandedDialog = useRef<HTMLDialogElement>(null);
    const fullscreenButton = useRef<HTMLButtonElement>(null);
    const restoreFocus = useRef(false);
    const requestingFullscreen = useRef(false);
    const pointers = useRef(new Map<number, ActivePointer>());
    const lastTap = useRef<Tap | null>(null);
    const currentView = useRef(fitView);
    const viewAnimation = useRef<ViewAnimation | null>(null);
    const [view, setView] = useState(fitView);
    const [dragging, setDragging] = useState(false);
    const [nativeFullscreen, setNativeFullscreen] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const stopAnimation = useCallback(() => {
        if (!viewAnimation.current) return;
        cancelAnimationFrame(viewAnimation.current.frame);
        viewAnimation.current = null;
    }, []);
    const applyView = useCallback((next: View) => {
        currentView.current = next;
        setView(next);
    }, []);
    const updateView = useCallback((update: (current: View) => View) => {
        stopAnimation();
        applyView(update(currentView.current));
    }, [applyView, stopAnimation]);

    useEffect(() => {
        const syncFullscreen = () => {
            lastTap.current = null;
            stopAnimation();
            setNativeFullscreen(document.fullscreenElement === frame.current);
        };
        document.addEventListener('fullscreenchange', syncFullscreen);
        return () => {
            document.removeEventListener('fullscreenchange', syncFullscreen);
            stopAnimation();
        };
    }, [stopAnimation]);

    useEffect(() => {
        if (expanded || restoreFocus.current) fullscreenButton.current?.focus({ preventScroll: true });
        restoreFocus.current = expanded;
    }, [expanded]);

    const animateView = useCallback((target: View, source: ViewAnimation['source'] = 'other') => {
        const pending = viewAnimation.current;
        if (pending?.target === target) return;
        const from = currentView.current;
        const samePosition = from.scale === target.scale && from.x === target.x && from.y === target.y;
        if (samePosition || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            stopAnimation();
            applyView(target);
            return;
        }

        const start = performance.now();
        const wheel = source === 'wheel';
        if (wheel && pending?.source === 'wheel') {
            pending.target = target;
            pending.updatedAt = start;
            return;
        }

        stopAnimation();
        let lastFrame = start;
        const tick = (now: number) => {
            const { target, updatedAt } = animation;
            const progress = Math.min(1, Math.max(0, (now - updatedAt) / viewAnimationDuration));
            if (progress === 1) {
                viewAnimation.current = null;
                applyView(target);
                return;
            }
            const origin = wheel ? currentView.current : from;
            const eased = wheel ? 1 - Math.exp(-Math.max(0, now - lastFrame) / wheelZoomTimeConstant) : 1 - (1 - progress) ** 3;
            lastFrame = now;
            applyView({
                ...target,
                scale: origin.scale + (target.scale - origin.scale) * eased,
                x: origin.x + (target.x - origin.x) * eased,
                y: origin.y + (target.y - origin.y) * eased,
            });
            animation.frame = requestAnimationFrame(tick);
        };
        const animation: ViewAnimation = { frame: requestAnimationFrame(tick), target, source, updatedAt: start };
        viewAnimation.current = animation;
    }, [applyView, stopAnimation]);

    const attachViewport = useCallback((element: HTMLDivElement | null) => {
        if (!element) return;
        const handleWheel = (event: WheelEvent) => {
            if (!event.deltaY) return;
            event.preventDefault();
            if (pointers.current.size) return;
            lastTap.current = null;
            const rect = element.getBoundingClientRect();
            const x = event.clientX - rect.left - rect.width / 2;
            const y = event.clientY - rect.top - rect.height / 2;
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
            const factor = Math.exp(-delta * 0.002);
            if (event.ctrlKey) {
                // Trackpad pinch arrives as a modified wheel event.
                updateView(current => zoomView(current, factor, x, y));
                return;
            }
            const current = currentView.current;
            const pending = viewAnimation.current;
            const baseScale = pending?.source === 'wheel' ? pending.target.scale : current.scale;
            // Accumulate wheel input while anchoring each new target to the view under the cursor.
            animateView(zoomView(current, factor * (baseScale / current.scale), x, y), 'wheel');
        };
        element.addEventListener('wheel', handleWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleWheel);
    }, [animateView, updateView]);

    const pan = (x: number, y: number) => updateView(current => ({ ...current, x: current.x + x, y: current.y + y }));
    const zoom = (factor: number) => {
        lastTap.current = null;
        // Each press counts even when the preceding zoom is still in flight.
        const pending = viewAnimation.current;
        const base = pending?.source === 'control' ? pending.target : currentView.current;
        animateView(zoomView(base, factor), 'control');
    };
    const fit = () => {
        lastTap.current = null;
        animateView(fitView);
    };
    const endGesture = (id: number) => {
        const active = pointers.current;
        const pointer = active.get(id);
        if (active.delete(id) && active.size === 0) setDragging(false);
        return pointer;
    };
    const cancelGesture = (id: number) => {
        if (endGesture(id)) lastTap.current = null;
    };
    const finishGesture = (event: PointerEvent<HTMLDivElement>) => {
        const pointer = endGesture(event.pointerId);
        if (!pointer) return;
        const start = pointer.tapStart;
        const tap = { x: event.clientX, y: event.clientY, time: event.timeStamp };
        const previous = lastTap.current;
        lastTap.current = null;
        if (!start || tap.time - start.time > tapDuration || Math.hypot(tap.x - start.x, tap.y - start.y) > tapMovement) return;
        if (!previous || tap.time - previous.time > doubleTapDelay || Math.hypot(tap.x - previous.x, tap.y - previous.y) > doubleTapDistance) {
            lastTap.current = tap;
            return;
        }

        const rect = event.currentTarget.getBoundingClientRect();
        const x = tap.x - rect.left - rect.width / 2;
        const y = tap.y - rect.top - rect.height / 2;
        const current = currentView.current;
        animateView(current.doubleTapZoomed || current.scale >= maxScale
            ? fitView
            : { ...zoomView(current, 2, x, y), doubleTapZoomed: true });
    };
    const changeExpanded = (next: boolean) => {
        stopAnimation();
        pointers.current.clear();
        lastTap.current = null;
        setDragging(false);
        setExpanded(next);
    };

    const toggleFullscreen = async () => {
        const element = frame.current;
        if (!element || requestingFullscreen.current) return;
        if (expanded) {
            expandedDialog.current?.close();
            return;
        }
        if (document.fullscreenElement === element) {
            await document.exitFullscreen().catch(() => {});
            return;
        }
        if (element.requestFullscreen && document.fullscreenEnabled !== false) {
            requestingFullscreen.current = true;
            try {
                await element.requestFullscreen();
                return;
            } catch {
                // The fullscreen request can be denied even when the API is available.
            } finally {
                requestingFullscreen.current = false;
            }
        }
        if (element.isConnected && expandedDialog.current) {
            expandedDialog.current.showModal();
            changeExpanded(true);
        }
    };
    const isFullscreen = nativeFullscreen || expanded;
    const fullscreenLabel = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';

    const viewer = (
        <>
            <div
                ref={attachViewport}
                role="region"
                aria-label="Whiteboard image. Use arrow keys to pan, plus and minus to zoom, and zero to fit."
                tabIndex={0}
                className={`absolute inset-0 touch-none select-none overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-9)] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onPointerDown={event => {
                    const active = pointers.current;
                    const [first] = active.values();
                    if (event.button !== 0 || active.size >= 2) return;
                    if (first && (first.type !== 'touch' || event.pointerType !== 'touch')) return;
                    stopAnimation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const { clientX: x, clientY: y, pointerType: type } = event;
                    if (first) {
                        first.tapStart = undefined;
                        lastTap.current = null;
                    }
                    const tapStart = !first && type === 'touch' ? { x, y, time: event.timeStamp } : undefined;
                    active.set(event.pointerId, { x, y, type, tapStart });
                    setDragging(true);
                }}
                onPointerMove={event => {
                    const active = pointers.current;
                    const previous = active.get(event.pointerId);
                    if (!previous) return;
                    const [first, second] = active.values();
                    const other = previous === first ? second : first;
                    const { clientX: x, clientY: y } = event;
                    const dx = x - previous.x;
                    const dy = y - previous.y;
                    if (previous.tapStart) {
                        if (Math.hypot(dx, dy) <= tapMovement) return;
                        lastTap.current = null;
                    }
                    active.set(event.pointerId, { x, y, type: previous.type });
                    if (!other) {
                        pan(dx, dy);
                        return;
                    }

                    const rect = event.currentTarget.getBoundingClientRect();
                    const anchorX = (previous.x + other.x) / 2 - rect.left - rect.width / 2;
                    const anchorY = (previous.y + other.y) / 2 - rect.top - rect.height / 2;
                    const before = Math.max(1, Math.hypot(previous.x - other.x, previous.y - other.y));
                    const after = Math.max(1, Math.hypot(x - other.x, y - other.y));
                    updateView(current => {
                        const next = zoomView(current, after / before, anchorX, anchorY);
                        // The midpoint follows the fingers as the image scales around it.
                        return { ...next, x: next.x + dx / 2, y: next.y + dy / 2 };
                    });
                }}
                onPointerUp={finishGesture}
                onPointerCancel={event => cancelGesture(event.pointerId)}
                onLostPointerCapture={event => cancelGesture(event.pointerId)}
                onKeyDown={event => {
                    if (event.altKey || event.ctrlKey || event.metaKey) return;
                    switch (event.key) {
                        case '+':
                        case '=': zoom(zoomStep); break;
                        case '-': zoom(1 / zoomStep); break;
                        case '0': fit(); break;
                        case 'ArrowLeft': pan(panStep, 0); break;
                        case 'ArrowRight': pan(-panStep, 0); break;
                        case 'ArrowUp': pan(0, panStep); break;
                        case 'ArrowDown': pan(0, -panStep); break;
                        default: return;
                    }
                    event.preventDefault();
                }}
            >
                <img
                    className="pointer-events-none absolute inset-0 block h-full w-full object-contain"
                    style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
                    src={src}
                    alt={title}
                    draggable={false}
                    onError={onError}
                />
            </div>
            <Flex role="group" aria-label="Whiteboard preview controls" align="center" gap="2"
                className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] left-[max(0.75rem,env(safe-area-inset-left,0px))] rounded-xl border border-[var(--gray-6)] bg-[var(--color-panel-solid)] p-1.5 shadow-sm">
                <IconButton type="button" variant="soft" color="gray" aria-label="Zoom out" title="Zoom out" disabled={view.scale <= minScale} onClick={() => zoom(1 / zoomStep)}>
                    <Minus size={16} aria-hidden="true" />
                </IconButton>
                <Text role="status" size="2" className="min-w-11 text-center tabular-nums">{Math.round(view.scale * 100)}%</Text>
                <IconButton type="button" variant="soft" color="gray" aria-label="Zoom in" title="Zoom in" disabled={view.scale >= maxScale} onClick={() => zoom(zoomStep)}>
                    <Plus size={16} aria-hidden="true" />
                </IconButton>
                <Button type="button" variant="soft" color="gray" aria-label="Fit to view" title="Fit to view (0)" onClick={fit}>Fit</Button>
                <IconButton ref={fullscreenButton} type="button" variant="soft" color="gray"
                    aria-label={fullscreenLabel} title={fullscreenLabel} onClick={() => void toggleFullscreen()}>
                    {isFullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
                </IconButton>
            </Flex>
        </>
    );

    return (
        <>
            <div ref={frame} className="relative h-full bg-white">
                {!expanded && viewer}
            </div>
            <dialog ref={expandedDialog} onClose={() => changeExpanded(false)} aria-label="Whiteboard fullscreen view"
                className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden overscroll-contain border-0 bg-white p-0"
                style={{ height: '100dvh' }}>
                {expanded && viewer}
            </dialog>
        </>
    );
}

export default function WhiteboardPreviewV2({ spaceId, pageId, onPublished }: { spaceId: string; pageId: string; onPublished?: (board: PublishedBoard) => void }) {
    const [published, setPublished] = useState<PublishedBoard | null>(null);
    const [message, setMessage] = useState('Loading preview…');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const abort = new AbortController();
        setPublished(null); setMessage('Loading preview…');
        void jsonRequest<PublishedBoard>(`${boardUrl(spaceId, pageId)}/published`, { signal: abort.signal }).then(data => {
            if (abort.signal.aborted) return;
            setPublished(data); onPublished?.(data);
            if (!data.preview) setMessage('This version has no preview. Publish it again from the editor to add one.');
        }).catch(e => {
            if (!abort.signal.aborted) setMessage(e instanceof WhiteboardApiError && e.code === 'WHITEBOARD_NOT_PUBLISHED' ? 'This whiteboard has not been published yet.' : 'Unable to load the published preview.');
        });
        return () => abort.abort();
    }, [spaceId, pageId, attempt, onPublished]);
    return published?.preview ? <PreviewViewer
        key={published.preview.url}
        src={contentUrl(published.preview.url)}
        title={published.snapshot.title}
        onError={() => { setPublished(null); setMessage('Unable to load the published preview.'); }}
    />
        : <Flex align="center" justify="center" direction="column" gap="3" height="100%"><Text>{message}</Text>{message.startsWith('Unable') ? <Button onClick={() => setAttempt(n => n + 1)}>Retry</Button> : null}</Flex>;
}
