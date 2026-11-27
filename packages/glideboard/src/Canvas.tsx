import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { computed } from '@preact/signals';
import { LuPen, LuPencil } from 'react-icons/lu';
import { CanvasTextView } from '@durgakiran/canvas-text-editor/view';
import type { CanvasRichTextDocument } from '@durgakiran/canvas-text-editor/model';
import { projectCanvasRichTextToPlainText } from '@durgakiran/canvas-text-editor/model';
import type {
  ArrowShape,
  ArrowUtil,
  GlideEditor,
  GlideShape,
  PointerMoveEvent,
  ShapeId,
  Vec2,
  LabelProps,
  RichTextDescriptor,
  StateNode,
  TextEditSession,
} from '@durgakiran/glideline';
import {
  boardFontStyle, ERASER_RADIUS_PX, getAreaEraseCuts, getAreaEraseMaskBounds, getAreaEraseMaskPaths,
  TextTool, type FreehandUtil,
} from '@durgakiran/glideline';
import { CanvasOverlays, getHandleAtPagePoint, getCursorForHandle } from './CanvasOverlays.js';
import { BoardNavigation } from './BoardNavigation.js';
import { useGlideboardController } from './GlideboardContext.js';
import { wbTheme } from './theme.js';
import { useSignalValue } from './useSignalValue.js';
import {
  getViewportShapeEntries,
  sameViewportEntries,
  type ViewportShapeEntry,
} from './viewport-rendering.js';
import { shouldIgnoreGlideboardShortcuts } from './shortcut-guards.js';
import { useStrokeDiagnostics } from './hooks/useStrokeDiagnostics.js';
import type { GlideboardStrokeDiagnosticsHandler } from './types.js';

const LazyCanvasTextEditor = React.lazy(async () => {
  const module = await import('@durgakiran/canvas-text-editor/editor');
  return { default: module.CanvasTextEditor };
});

export function getCanvasToolCursor(tool: string | undefined, handleId: string | null, buttons = 0, editor?: GlideEditor): string {
  if (tool === 'hand') return buttons === 1 ? 'grabbing' : 'grab';
  if (tool === 'draw' || tool === 'pencil') return 'none';
  if (tool === 'highlighter' || tool === 'asset' || tool === 'line' || tool === 'eraser'
    || tool === 'whole-stroke-eraser' || tool === 'partial-eraser' || tool === 'area-eraser') return 'crosshair';
  return handleId ? getCursorForHandle(handleId, editor) : 'default';
}

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────

function stylusTilt(event: Pick<PointerEvent, 'pointerType' | 'tiltX' | 'tiltY'>) {
  if (event.pointerType !== 'pen') return {};
  const x = event.tiltX || 0;
  const y = event.tiltY || 0;
  const magnitude = Math.hypot(x, y);
  const cap = Math.max(90, magnitude);
  return { tilt: Math.min(1, magnitude / 90), tiltDirection: { x: x / cap, y: y / cap } };
}

function isFreehandTool(tool: string): boolean {
  return tool === 'draw' || tool === 'pencil' || tool === 'highlighter';
}

function pointsToSvgPath(points: Vec2[], closed = false): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let path = `M ${first.x} ${first.y}`;
  for (const point of rest) {
    path += ` L ${point.x} ${point.y}`;
  }
  if (closed) path += ' Z';
  return path;
}

// A non-breaking space creates a real line box for Chromium's empty-editable
// caret. It is stripped at the draft boundary and is never persisted.
const EMPTY_EDIT_MARKER = '\u00A0';

function readEditingText(element: HTMLElement, multiline = false): string {
  return ((multiline ? element.innerText : element.textContent) ?? '').split(EMPTY_EDIT_MARKER).join('');
}

function moveCaretToEnd(element: HTMLElement): void {
  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(element);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function useViewportShapeEntries(
  editor: GlideEditor,
  viewportRevision: number,
): readonly ViewportShapeEntry[] {
  const [entries, setEntries] = useState<readonly ViewportShapeEntry[]>(
    () => getViewportShapeEntries(editor),
  );

  useEffect(() => {
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const next = getViewportShapeEntries(editor);
      setEntries(current => sameViewportEntries(current, next) ? current : next);
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(update);
    };
    let previousPreviewIds: readonly string[] = [];
    const disposers = [
      editor.store.listen(schedule),
      editor.camera.signal.subscribe(schedule),
      editor.getSelectionSignal().subscribe(schedule),
      editor.editingShapeId.subscribe(schedule),
      editor.erasingShapeIds.subscribe(schedule),
      editor.bindingPreview.subscribe(schedule),
      editor.activePageId.subscribe(schedule),
      editor.interactions.getChangedIdsSignal().subscribe(ids => {
        // A new freehand stroke is already pinned in the shape layer. Its
        // growing bounds do not change which records need to be mounted.
        const sameNewStroke = ids.length === 1 && ids[0] === previousPreviewIds[0]
          && isFreehandTool(editor.currentToolId.peek()) && !editor.store.has(ids[0]!)
          && editor.getShape(ids[0] as ShapeId)?.type === 'freehand';
        previousPreviewIds = ids;
        if (!sameNewStroke) schedule();
      }),
    ];
    schedule();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      for (const dispose of disposers) dispose();
    };
  }, [editor, viewportRevision]);

  return entries;
}

// ─────────────────────────────────────────────────────────────
// Grid (background SVG only)
// ─────────────────────────────────────────────────────────────

function Grid() {
  const controller = useGlideboardController();
  const camera = useSignalValue(controller.editor.camera.signal)!;
  const settings = useSignalValue(controller.editor.snapping.settings)!;
  const spacing = settings.gridSize * camera.z;
  const dotR = 1;
  const ox = ((-camera.x * camera.z) % spacing + spacing) % spacing;
  const oy = ((-camera.y * camera.z) % spacing + spacing) % spacing;

  return <>
    <defs>
      <pattern id={controller.domId('grid-pattern')} x={ox} y={oy} width={spacing} height={spacing} patternUnits="userSpaceOnUse">
        <circle cx={dotR} cy={dotR} r={dotR} fill={wbTheme.grid} />
      </pattern>
    </defs>
    {settings.showGrid ? <rect x="0" y="0" width="100%" height="100%" fill={`url(#${controller.domId('grid-pattern')})`} /> : null}
  </>;
}

// ─────────────────────────────────────────────────────────────
// ShapeLayer — one HTML div per shape
// ─────────────────────────────────────────────────────────────

const ShapeLayer = memo(({
  id,
  zIndex,
  isEditing,
  connectorEdit,
  beginStrokeSvgRender,
}: {
  id: ShapeId;
  zIndex: number;
  isEditing: boolean;
  connectorEdit?: TextEditSession;
  beginStrokeSvgRender?: (shape: GlideShape) => (() => void) | undefined;
}) => {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const sig = editor.getShapeSignal(id);
  const shape = useSignalValue(sig as any) as GlideShape | null;
  const isFreehand = shape?.type === 'freehand';
  const erasePreviewSignal = useMemo(() => isFreehand
    ? computed(() => editor.partialErasePreviews.value.get(id))
    : undefined, [editor, id, isFreehand]);
  const erasePreview = useSignalValue(erasePreviewSignal);
  const currentErasePreview = erasePreview && erasePreview.stroke === shape && !editor.isShapeEffectivelyLocked(id)
    ? erasePreview : undefined;
  const areaErasePreviewSignal = useMemo(() => computed(() => editor.areaErasePreviews.value.get(id)), [editor, id]);
  const areaErasePreview = useSignalValue(areaErasePreviewSignal);
  const areaEraseCuts = useMemo(() => {
    if (!shape) return [];
    const cuts = getAreaEraseCuts(shape);
    return areaErasePreview?.shape === shape ? [...cuts, areaErasePreview.cut] : cuts;
  }, [shape, areaErasePreview]);
  const remoteTextEditingShapeIds = useSignalValue(controller.remoteTextEditingShapeIdsSignal);
  const isRemoteTextEditing = remoteTextEditingShapeIds?.has(id) ?? false;
  const inkParent = useSignalValue(isFreehand ? editor.interactions.getSignal(shape.parentId) : undefined);
  // Top-level ink renders from its own record and erase-preview signals.
  // Nested shapes still need ancestor edits, and connectors need rerouting.
  const documentVersion = useSignalValue(isFreehand && inkParent?.['kind'] === 'page'
    ? undefined : editor.getDocumentVersionSignal());
  useSignalValue(controller.collaborationTextVersionSignal);
  const svgRef = useRef<SVGSVGElement>(null);

  const routeVersion = shape?.type === 'arrow' ? documentVersion : undefined;
  // Inject toSvg() geometry output into the per-shape <svg>
  useLayoutEffect(() => {
    if (!svgRef.current || !shape) return;
    const util = editor.getShapeUtil(shape.type);
    if (currentErasePreview) {
      const { stroke, fragments } = currentErasePreview;
      // The existing shape layer applies the stroke's world transform and clipping.
      const paths = fragments.map(points => (util as FreehandUtil).toSvg({
        ...stroke, x: 0, y: 0, props: { ...stroke.props, points, isClosed: false },
      }));
      svgRef.current.replaceChildren(...paths);
      return;
    }
    if ((util as any).toSvg) {
      const finishStrokeSvgRender = beginStrokeSvgRender?.(shape);
      const el = shape.type === 'arrow' && connectorEdit
        ? (util as ArrowUtil).toSvg({
            ...shape,
            props: { ...shape.props, ...connectorEdit.pendingProps, label: connectorEdit.draft },
          } as ArrowShape, true)
        : (util as any).toSvg(shape);
      svgRef.current.innerHTML = '';
      if (el) {
        const defs = el.querySelector('defs');
        if (defs) {
          svgRef.current.appendChild(defs);
        }
        svgRef.current.appendChild(el);
      }
      finishStrokeSvgRender?.();
    }
  }, [editor, shape, routeVersion, connectorEdit, currentErasePreview, beginStrokeSvgRender]);

  const util = shape ? editor.getShapeUtil(shape.type) : null;
  const labelProps: LabelProps | null = (shape && util) ? ((util as any).getLabelProps?.(shape) ?? null) : null;
  const richText = (shape && util) ? util.getRichTextDescriptor(shape as any) : null;
  const textCollaboration = richText
    ? controller.getCanvasTextCollaboration(id as ShapeId, { create: false })
    : undefined;

  if (!shape || !util || editor.isShapeEffectivelyHidden(shape.id as ShapeId)) return null;

  const isTextType = shape.type === 'text';
  const hasFixedWidth = isTextType && typeof (shape.props as any).w === 'number';

  // Live freehand geometry overflows its SVG and has no label to size.
  const localBounds = isFreehand && !editor.store.has(id) && !labelProps && !richText
    ? { w: 1, h: 1 }
    : util.getGeometry(shape as any).getBounds();
  const visualBounds = areaEraseCuts.length ? util.getVisualBounds(shape as any) : null;
  const maskBounds = visualBounds ? getAreaEraseMaskBounds(visualBounds) : null;
  const maskId = controller.domId(`area-mask-${id}`);
  const world = editor.getWorldTransform(shape.id as ShapeId);
  const worldTransform = `matrix(${world.a}, ${world.b}, ${world.c}, ${world.d}, ${world.e}, ${world.f})`;
  const clippingFrame = editor.getClippingFrameAncestors(shape.id as ShapeId)[0];
  const clipPath = clippingFrame ? (() => {
    const bounds = editor.transforms.getLocalGeometry(clippingFrame.id as ShapeId).getBounds();
    return `polygon(${[
      { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
    ].map(point => editor.pageToLocal(shape.id as ShapeId,
      editor.localToPage(clippingFrame.id as ShapeId, point)))
      .map(point => `${point.x}px ${point.y}px`).join(', ')})`;
  })() : undefined;

  return (
    <div
      id={controller.domId(`shape-${id}`)}
      data-shape-id={id}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: localBounds.w,
        height: localBounds.h,
        transform: worldTransform,
        transformOrigin: '0 0',
        zIndex,
        pointerEvents: 'none',
        clipPath,
        maskImage: maskBounds ? `url("#${maskId}")` : undefined,
      }}
    >
      {maskBounds && visualBounds && (
        <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" {...maskBounds}>
              <rect {...maskBounds} fill="white" />
              {getAreaEraseMaskPaths(areaEraseCuts, visualBounds).map(({ d, transform }, index) => (
                <path key={index} d={d} transform={transform} fill="black" />
              ))}
            </mask>
          </defs>
        </svg>
      )}
      {/* Geometry: 1×1px SVG with overflow:visible — contains toSvg() output */}
      <svg
        ref={svgRef}
        style={{
          overflow: 'visible',
          width: 1,
          height: 1,
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      />

      {/* Label: native HTML div */}
      {richText && (richText.fallbackText.length > 0 || isEditing || textCollaboration) ? (
        <div
          className="glideboard-rich-text-view"
          style={{
            position: 'absolute',
            inset: 0,
            width: richText.sizeMode === 'auto' ? 'max-content' : richText.w,
            height: richText.h,
            minWidth: richText.sizeMode === 'auto' ? 1 : undefined,
            overflow: richText.sizeMode === 'fixed' ? 'hidden' : 'visible',
            ...boardFontStyle(richText.fontFamily),
            fontSize: richText.fontSize,
            color: richText.color,
            opacity: typeof shape.props['opacity'] === 'number' ? shape.props['opacity'] : 1,
            textAlign: richText.textAlign,
            lineHeight: richText.lineHeight,
            pointerEvents: 'none',
            userSelect: 'none',
            visibility: isEditing ? 'hidden' : 'visible',
          }}
        >
          {isRemoteTextEditing && textCollaboration ? (
            <React.Suspense fallback={(
              <CanvasTextView
                value={richText.value}
                fallbackText={richText.fallbackText}
                fragment={textCollaboration.fragment}
              />
            )}>
              <LazyCanvasTextEditor
                value={richText.value}
                collaboration={textCollaboration}
                editable={false}
                autoFocus={false}
                showToolbar={false}
                className={`glideboard-rich-text-remote-editor glideboard-rich-text-editor--${richText.sizeMode}`}
              />
            </React.Suspense>
          ) : (
            <CanvasTextView
              value={richText.value}
              fallbackText={richText.fallbackText}
              fragment={textCollaboration?.fragment}
              linkActivation="modified-click"
              style={richText.sizeMode === 'auto' ? {
                width: 'max-content',
                maxWidth: 'none',
                overflowWrap: 'normal',
              } : undefined}
            />
          )}
        </div>
      ) : labelProps && (labelProps.text.length > 0 || isEditing) && (
        <div
          data-glideboard-role="shape-label"
          style={{
            position: 'absolute',
            left: labelProps.x ?? labelProps.padding,
            top: labelProps.y ?? labelProps.padding,
            width: labelProps.w ?? (isTextType && !hasFixedWidth ? 'max-content' : Math.max(0, localBounds.w - labelProps.padding * 2)),
            height: labelProps.h ?? (isTextType ? 'auto' : Math.max(0, localBounds.h - labelProps.padding * 2)),
            ...boardFontStyle(labelProps.fontFamily),
            fontSize: labelProps.fontSize,
            color: labelProps.color,
            opacity: typeof shape.props['opacity'] === 'number' ? shape.props['opacity'] : 1,
            background: labelProps.background ?? 'transparent',
            textAlign: labelProps.textAlign,
            display: 'flex',
            flexDirection: 'column',
            alignItems: labelProps.textAlign === 'left' ? 'flex-start' : labelProps.textAlign === 'right' ? 'flex-end' : 'center',
            justifyContent: labelProps.verticalAlign === 'center' ? 'center' : 'flex-start',
            pointerEvents: 'none',
            userSelect: 'none',
            overflow: shape.type === 'arrow' ? 'visible' : 'hidden',
            whiteSpace: (isTextType && !hasFixedWidth) ? 'pre' : 'pre-wrap',
            wordBreak: 'break-word',
            outline: 'none',
            boxSizing: 'border-box',
            lineHeight: labelProps.lineHeight ?? 1.35,
            visibility: isEditing ? 'hidden' : 'visible',
          }}
        >
          {shape.type === 'frame' ? (
            <span
              style={{ pointerEvents: 'auto' }}
              onDoubleClick={event => {
                if (editor.currentToolId.peek() !== 'select') return;
                event.stopPropagation();
                if (controller.readOnlySignal.peek() || editor.editingShapeId.peek() || editor.isShapeEffectivelyLocked(id)) return;
                editor.startEditing(id);
              }}
            >
              {labelProps.text}
            </span>
          ) : labelProps.text}
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
// EraserPreviewOverlay — transient feedback outside shape layers
// ─────────────────────────────────────────────────────────────

const ERASER_PREVIEW_COLOR = '#f38ba8';

const EraserPreviewShape = memo(({ id, zoom }: { id: ShapeId; zoom: number }) => {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const shape = useSignalValue(editor.getShapeSignal(id) as any) as GlideShape | null;
  if (!shape) return null;

  const points = editor.transforms.getWorldOutline(id);
  if (points.length === 0) return null;
  const serialized = points.map(point => `${point.x},${point.y}`).join(' ');
  const open = shape.type === 'arrow' || shape.type === 'line' || shape.type === 'freehand';
  return open ? (
    <polyline
      points={serialized}
      fill="none"
      stroke={ERASER_PREVIEW_COLOR}
      strokeWidth={8 / zoom}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.65}
    />
  ) : (
    <polygon
      points={serialized}
      fill={ERASER_PREVIEW_COLOR}
      stroke={ERASER_PREVIEW_COLOR}
      strokeWidth={2 / zoom}
      opacity={0.35}
    />
  );
});

function EraserPreviewOverlay() {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const ids = useSignalValue(editor.erasingShapeIds) ?? new Set<ShapeId>();
  const zoom = useSignalValue(editor.camera.signal)?.z ?? 1;

  if (ids.size === 0) return null;

  return (
    <svg
      data-glideboard-role="eraser-preview-overlay"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 999_999,
      }}
    >
      {[...ids].map(id => <EraserPreviewShape key={id} id={id} zoom={zoom} />)}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// TextEditingOverlay — the only live text editor on the canvas
// ─────────────────────────────────────────────────────────────

function RichTextEditingOverlay({
  shape,
  session,
  descriptor,
}: {
  shape: GlideShape;
  session: TextEditSession;
  descriptor: RichTextDescriptor;
}) {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const rootRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef(descriptor.value as CanvasRichTextDocument);
  const measuredRef = useRef({ w: descriptor.w, h: descriptor.h });
  const hasUserChangedRef = useRef(false);
  const livePublishFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const awareness = controller.awarenessSignal.peek();
    if (!awareness) return;
    awareness.setLocalStateField('canvasTextEditing', {
      shapeId: shape.id,
      pageId: editor.getActivePageId(),
    });
    return () => awareness.setLocalStateField('canvasTextEditing', null);
  }, [controller, editor, shape.id]);

  const syncDraft = useCallback((
    document: CanvasRichTextDocument,
    measured = measuredRef.current,
    forceDirty = false,
  ) => {
    documentRef.current = document;
    measuredRef.current = measured;
    const w = descriptor.sizeMode === 'auto'
      ? Math.max(descriptor.fontSize * 0.6, Math.ceil(measured.w))
      : descriptor.w;
    const h = descriptor.sizeMode === 'fixed'
      ? descriptor.h
      : Math.max(descriptor.fontSize * descriptor.lineHeight, Math.ceil(measured.h));
    editor.updateEditingDraft(projectCanvasRichTextToPlainText(document), {
      richText: document,
      w,
      h,
      sizeMode: descriptor.sizeMode,
    }, forceDirty);
    if (forceDirty || hasUserChangedRef.current) editor.publishEditingDraft();
  }, [descriptor.fontSize, descriptor.h, descriptor.lineHeight, descriptor.sizeMode, descriptor.w, editor]);

  const commit = useCallback((document = documentRef.current) => {
    if (livePublishFrameRef.current !== null) {
      cancelAnimationFrame(livePublishFrameRef.current);
      livePublishFrameRef.current = null;
    }
    const content = rootRef.current?.querySelector<HTMLElement>('.canvas-text-editor__content');
    syncDraft(document, content ? {
      w: Math.max(1, content.scrollWidth),
      h: Math.max(1, content.scrollHeight),
    } : measuredRef.current, hasUserChangedRef.current);
    editor.commitEditing(true);
  }, [editor, syncDraft]);

  const scheduleLivePublish = useCallback((document: CanvasRichTextDocument) => {
    documentRef.current = document;
    hasUserChangedRef.current = true;
    if (livePublishFrameRef.current !== null) cancelAnimationFrame(livePublishFrameRef.current);
    livePublishFrameRef.current = requestAnimationFrame(() => {
      livePublishFrameRef.current = null;
      const content = rootRef.current?.querySelector<HTMLElement>('.canvas-text-editor__content');
      syncDraft(documentRef.current, content ? {
        w: Math.max(1, content.scrollWidth),
        h: Math.max(1, content.scrollHeight),
      } : measuredRef.current, true);
    });
  }, [syncDraft]);

  useEffect(() => () => {
    if (livePublishFrameRef.current !== null) cancelAnimationFrame(livePublishFrameRef.current);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (
        rootRef.current?.contains(target)
        || target?.closest('.canvas-text-link-bubble')
        || target?.closest('[data-glideboard-role="selected-style-panel"]')
      ) return;
      const ownBoard = rootRef.current?.closest('[data-glideboard-role="app"]');
      const targetBoard = target?.closest('[data-glideboard-role="app"]');
      if (targetBoard && targetBoard !== ownBoard) return;
      commit();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [commit]);

  const world = editor.getWorldTransform(shape.id as ShapeId);
  const worldTransform = `matrix(${world.a}, ${world.b}, ${world.c}, ${world.d}, ${world.e}, ${world.f})`;
  const width = descriptor.sizeMode === 'auto' ? 'max-content' : descriptor.w;
  const height = descriptor.sizeMode === 'fixed' ? descriptor.h : 'auto';

  return (
    <div
      ref={rootRef}
      data-glideboard-role="rich-text-editing-overlay"
      data-shape-id={shape.id}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: descriptor.w,
        height: descriptor.h,
        transform: worldTransform,
        transformOrigin: '0 0',
        zIndex: 1_000_000,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width,
          height,
          minWidth: descriptor.sizeMode === 'auto' ? 10 : undefined,
          minHeight: descriptor.fontSize * descriptor.lineHeight,
          outline: session.status === 'conflicted' ? '2px solid #ef4444' : '2px solid #4f8cff',
          outlineOffset: 2,
          ...boardFontStyle(descriptor.fontFamily),
          fontSize: descriptor.fontSize,
          color: descriptor.color,
          opacity: typeof shape.props['opacity'] === 'number' ? shape.props['opacity'] : 1,
          textAlign: descriptor.textAlign,
          lineHeight: descriptor.lineHeight,
          overflow: descriptor.sizeMode === 'fixed' ? 'hidden' : 'visible',
          pointerEvents: 'auto',
          cursor: 'text',
        }}
      >
        <React.Suspense fallback={<CanvasTextView value={descriptor.value} fallbackText={descriptor.fallbackText} />}>
          <LazyCanvasTextEditor
            value={descriptor.value}
            collaboration={controller.getCanvasTextCollaboration(shape.id as ShapeId)}
            restoreValueOnCancel={descriptor.value}
            syncExternalValue={false}
            className={`glideboard-rich-text-editor glideboard-rich-text-editor--${descriptor.sizeMode}`}
            onChange={scheduleLivePublish}
            onSizeChange={size => syncDraft(documentRef.current, size)}
            onCommit={commit}
            onCancel={() => editor.cancelEditing(true, session.status === 'conflicted')}
          />
        </React.Suspense>
      </div>
    </div>
  );
}

function TextEditingOverlay() {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const session = useSignalValue(editor.textEditing.session) as TextEditSession | null;
  const shape = useSignalValue(
    session ? editor.getShapeSignal(session.shapeId) as any : null,
  ) as GlideShape | null;
  const editableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editable = editableRef.current;
    if (!editable || !session) return;
    if (readEditingText(editable, shape?.type === 'arrow') !== session.draft) {
      editable.textContent = session.draft || EMPTY_EDIT_MARKER;
    } else if (!session.draft && editable.textContent === '') {
      editable.textContent = EMPTY_EDIT_MARKER;
    }
  }, [session?.draft, session?.shapeId, shape?.id]);

  useEffect(() => {
    const editable = editableRef.current;
    if (!editable || !session) return;
    editable.focus();
    moveCaretToEnd(editable);
  }, [session?.shapeId, shape?.id]);

  if (!session || !shape) return null;

  const util = editor.getShapeUtil(shape.type);
  const isConnector = shape.type === 'arrow';
  const layoutShape = session.pendingProps || isConnector
    ? { ...shape, props: { ...shape.props, ...session.pendingProps, ...(isConnector ? { label: session.draft } : {}) } }
    : shape;
  const labelProps = util.getLabelProps(layoutShape as any);
  if (!labelProps) return null;
  const richText = util.getRichTextDescriptor(layoutShape as any);
  if (shape.type === 'text' && richText) {
    return <RichTextEditingOverlay shape={shape} session={session} descriptor={richText} />;
  }

  const localBounds = util.getGeometry(layoutShape as any).getBounds();
  const world = editor.getWorldTransform(shape.id as ShapeId);
  const worldTransform = `matrix(${world.a}, ${world.b}, ${world.c}, ${world.d}, ${world.e}, ${world.f})`;
  const isTextType = shape.type === 'text';
  const hasFixedWidth = isTextType && typeof (shape.props as any).w === 'number';
  const conflicted = session.status === 'conflicted';

  const commit = () => {
    if (editor.commitEditing(true)) return;
    requestAnimationFrame(() => editableRef.current?.focus());
  };

  return (
    <div
      data-glideboard-role="text-editing-overlay"
      data-shape-id={shape.id}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: localBounds.w,
        height: localBounds.h,
        transform: worldTransform,
        transformOrigin: '0 0',
        zIndex: 1_000_000,
        pointerEvents: 'none',
      }}
    >
      <div
        data-glideboard-role="text-editing-box"
        onPointerDown={event => {
          event.stopPropagation();
          editableRef.current?.focus();
        }}
        style={{
          position: 'absolute',
          left: labelProps.x ?? labelProps.padding,
          top: labelProps.y ?? labelProps.padding,
          width: labelProps.w ?? (isTextType && !hasFixedWidth ? 'max-content' : Math.max(0, localBounds.w - labelProps.padding * 2)),
          height: labelProps.h ?? (isTextType ? 'auto' : Math.max(0, localBounds.h - labelProps.padding * 2)),
          minWidth: isTextType && !hasFixedWidth ? 150 : '2ch',
          minHeight: '1.35em',
          padding: 0,
          border: 0,
          outline: conflicted ? '2px solid #ef4444' : isConnector ? 'none' : '2px solid #4f8cff',
          boxShadow: isConnector ? `0 1px 0 ${wbTheme.accent}` : undefined,
          outlineOffset: 2,
          ...boardFontStyle(labelProps.fontFamily),
          fontSize: labelProps.fontSize,
          color: labelProps.color,
          opacity: typeof shape.props['opacity'] === 'number' ? shape.props['opacity'] : 1,
          background: labelProps.background ?? 'transparent',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: labelProps.verticalAlign === 'center' ? 'center' : 'flex-start',
          pointerEvents: 'auto',
          overflow: 'visible',
          cursor: 'text',
          boxSizing: 'border-box',
          lineHeight: labelProps.lineHeight ?? 1.35,
        }}
      >
        <div
          ref={editableRef}
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          role="textbox"
          aria-label={shape.type === 'frame' ? 'Frame name' : undefined}
          aria-multiline={shape.type !== 'frame'}
          aria-invalid={conflicted || undefined}
          title={conflicted ? 'This label changed elsewhere. Press Escape to keep the newer document value.' : undefined}
          onPointerDown={event => event.stopPropagation()}
          onBeforeInput={event => {
            if (
              event.currentTarget.textContent === EMPTY_EDIT_MARKER
              && !event.nativeEvent.isComposing
            ) {
              event.currentTarget.textContent = '';
              moveCaretToEnd(event.currentTarget);
            }
          }}
          onInput={event => {
            const editable = event.currentTarget;
            const draft = readEditingText(editable, isConnector);
            editor.updateEditingDraft(draft);
            if (!draft && editable.textContent === '') {
              editable.textContent = EMPTY_EDIT_MARKER;
              moveCaretToEnd(editable);
            }
          }}
          onCompositionStart={() => editor.setEditingComposition(true)}
          onCompositionEnd={event => {
            const draft = readEditingText(event.currentTarget, isConnector);
            event.currentTarget.textContent = draft || EMPTY_EDIT_MARKER;
            moveCaretToEnd(event.currentTarget);
            editor.updateEditingDraft(draft);
            editor.setEditingComposition(false);
          }}
          onBlur={commit}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || session.composing) return;
            if (event.key === 'Enter' && (shape.type === 'frame' || event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              editor.cancelEditing(true, conflicted);
            }
          }}
          style={{
            width: '100%',
            minWidth: isTextType && !hasFixedWidth ? 150 : '2ch',
            minHeight: '1.35em',
            padding: 0,
            border: 0,
            outline: 'none',
            font: 'inherit',
            color: 'inherit',
            textAlign: labelProps.textAlign,
            userSelect: 'text',
            whiteSpace: isTextType && !hasFixedWidth ? 'pre' : 'pre-wrap',
            wordBreak: 'break-word',
            cursor: 'text',
            boxSizing: 'border-box',
            lineHeight: labelProps.lineHeight ?? 1.35,
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Canvas
// ─────────────────────────────────────────────────────────────

export function Canvas({ onStrokeDiagnostics }: { onStrokeDiagnostics?: GlideboardStrokeDiagnosticsHandler }) {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const strokeDiagnostics = useStrokeDiagnostics(controller, onStrokeDiagnostics);
  const camera = useSignalValue(editor.camera.signal)!;
  const editingId = useSignalValue(editor.editingShapeId);
  const editingSession = useSignalValue(editor.textEditing.session);
  const readOnly = useSignalValue(controller.readOnlySignal) ?? false;
  const [viewportRevision, setViewportRevision] = useState(0);
  const [pointerEditTool, setPointerEditTool] = useState<string | null>(null);
  const viewportShapes = useViewportShapeEntries(editor, viewportRevision);
  const containerRef = useRef<HTMLDivElement>(null);
  const partialEraserCursorRef = useRef<HTMLDivElement>(null);
  const pencilCursorRef = useRef<HTMLSpanElement>(null);
  const drawFrameRef = useRef<number | null>(null);
  const pendingDrawMoveRef = useRef<(PointerMoveEvent & { samples: (Vec2 & { pressure: number; tilt?: number; tiltDirection?: Vec2 })[] }) | null>(null);
  const pointerScreenRef = useRef<Vec2 | null>(null);
  const preventFocusStealRef = useRef(false);
  const isMiddleDraggingRef = useRef(false);
  const originalToolBeforeMiddleDragRef = useRef<string | null>(null);
  const isPointerDownRef = useRef(false);
  const activePointerTypeRef = useRef<string | null>(null);
  const lastPressWasIgnoredTouchRef = useRef(false);
  const segmentDragCursorRef = useRef<string | null>(null);
  const awarenessCursorFrameRef = useRef<number | null>(null);
  const latestAwarenessCursorRef = useRef<Vec2 | null>(null);
  const activeTool = useSignalValue(editor.currentToolId);
  const showPencilCursor = (activeTool === 'draw' || activeTool === 'pencil') && !readOnly;
  const showPartialEraserCursor = (activeTool === 'partial-eraser' || activeTool === 'area-eraser') && !readOnly;

  const updatePointerPosition = useCallback((screen: Vec2 | null) => {
    pointerScreenRef.current = screen;
    const pencil = pencilCursorRef.current;
    if (pencil) {
      pencil.style.visibility = screen ? 'visible' : 'hidden';
      // The icon's tip is at roughly (2, 22) in its 24px view box.
      if (screen) pencil.style.transform = `translate3d(${screen.x - 2}px, ${screen.y - 22}px, 0)`;
      return;
    }
    const cursor = partialEraserCursorRef.current;
    if (!cursor) return;
    cursor.style.visibility = screen ? 'visible' : 'hidden';
    if (screen) {
      cursor.style.left = `${screen.x}px`;
      cursor.style.top = `${screen.y}px`;
    }
  }, []);

  useLayoutEffect(() => {
    if (showPencilCursor || showPartialEraserCursor) updatePointerPosition(pointerScreenRef.current);
  }, [showPencilCursor, showPartialEraserCursor, updatePointerPosition]);

  const clearPendingDrawMove = useCallback(() => {
    if (drawFrameRef.current !== null) cancelAnimationFrame(drawFrameRef.current);
    drawFrameRef.current = null;
    const move = pendingDrawMoveRef.current;
    pendingDrawMoveRef.current = null;
    return move;
  }, []);

  const flushDrawMove = useCallback((frameAt?: number) => {
    const move = clearPendingDrawMove();
    if (move && isFreehandTool(editor.currentToolId.peek()) && !controller.readOnlySignal.peek()) {
      const finishDrawUpdate = strokeDiagnostics.beginDrawUpdate(frameAt);
      try {
        editor.dispatchEvent(move);
      } finally {
        finishDrawUpdate?.();
      }
    }
  }, [clearPendingDrawMove, controller, editor, strokeDiagnostics]);

  const queueDrawMove = useCallback((move: PointerMoveEvent) => {
    const pending = pendingDrawMoveRef.current;
    const samples = pending?.samples ?? [];
    if (pending) samples.push({
      ...pending.point, pressure: pending.pressure ?? 0.5, tilt: pending.tilt, tiltDirection: pending.tiltDirection,
    });
    for (const sample of move.samples ?? []) samples.push(sample);
    pendingDrawMoveRef.current = { ...move, samples };
    if (drawFrameRef.current === null) {
      drawFrameRef.current = requestAnimationFrame(frameAt => {
        drawFrameRef.current = null;
        flushDrawMove(frameAt);
      });
    }
  }, [flushDrawMove]);

  useEffect(() => {
    // A tool switch or an external preview cancellation invalidates input
    // queued for that interaction, even if draw is selected again immediately.
    return editor.interactions.getKindSignal().subscribe(kind => {
      if (kind === null) clearPendingDrawMove();
    });
  }, [clearPendingDrawMove, editor]);

  useEffect(() => {
    setPointerEditTool(tool => tool === activeTool && !readOnly ? tool : null);
  }, [activeTool, readOnly]);

  useEffect(() => {
    if (!readOnly) return;
    isMiddleDraggingRef.current = false;
    originalToolBeforeMiddleDragRef.current = null;
  }, [readOnly]);

  useEffect(() => () => {
    if (awarenessCursorFrameRef.current !== null) cancelAnimationFrame(awarenessCursorFrameRef.current);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    controller.setCanvasElement(el);

    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0]!.contentRect;
      editor.camera.setViewportSize(width, height);
      setViewportRevision(revision => revision + 1);
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    editor.camera.setViewportSize(rect.width, rect.height);
    setViewportRevision(revision => revision + 1);

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = el.getBoundingClientRect();
      const screenPt = { x: event.clientX - box.left, y: event.clientY - box.top };
      const cam = editor.camera.getCamera();

      // Branch 1: Pinch-to-zoom — browsers set ctrlKey=true for trackpad pinch gestures
      if (event.ctrlKey || event.metaKey) {
        flushDrawMove();
        const factor = Math.exp(-event.deltaY * 0.01);
        const newZ = Math.max(0.1, Math.min(8, cam.z * factor));
        const pagePtX = screenPt.x / cam.z + cam.x;
        const pagePtY = screenPt.y / cam.z + cam.y;
        editor.camera.setCamera({
          x: pagePtX - screenPt.x / newZ,
          y: pagePtY - screenPt.y / newZ,
          z: newZ,
        });
        return;
      }

      // Branch 2: Shift+scroll → horizontal pan only
      if (event.shiftKey) {
        editor.camera.setCamera({
          x: cam.x + (event.deltaY + event.deltaX) / cam.z,
        });
        return;
      }

      // Branch 3: Plain scroll / trackpad two-finger swipe → translate camera
      editor.camera.setCamera({
        x: cam.x + event.deltaX / cam.z,
        y: cam.y + event.deltaY / cam.z,
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', handleWheel);
      if (controller.getCanvasElement() === el) {
        controller.setCanvasElement(null);
      }
    };
  }, [controller, editor, flushDrawMove]);

  const getPagePoint = useCallback((event: React.PointerEvent | React.WheelEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, page: editor.screenToPage(screen), rect };
  }, [editor]);

  const getShapeAtEvent = useCallback((event: React.PointerEvent) => {
    const { page } = getPagePoint(event);
    return editor.getTopShapeAtPoint(page) ?? null;
  }, [editor, getPagePoint]);

  const getHandleAtEvent = useCallback((event: React.PointerEvent) => {
    const { page } = getPagePoint(event);
    return getHandleAtPagePoint(editor, page.x, page.y);
  }, [editor, getPagePoint]);

  const cancelPointerInteraction = useCallback((
    reason: 'pointercancel' | 'lostpointercapture' | 'window-blur' | 'unmount' | 'pen-takeover',
    pointerId?: number,
    event?: PointerEvent,
  ) => {
    if (pointerId !== undefined && pointerId !== controller.activePointerIdRef.current) return;
    if (!isPointerDownRef.current && !editor.interactions.active) return;
    flushDrawMove();
    const reportStroke = strokeDiagnostics.pointerEnded();
    updatePointerPosition(null);
    isPointerDownRef.current = false;
    activePointerTypeRef.current = null;
    setPointerEditTool(null);
    controller.isCanvasDraggingRef.current = false;
    controller.activePointerIdRef.current = null;
    if (pointerId !== undefined && containerRef.current?.hasPointerCapture?.(pointerId)) {
      containerRef.current.releasePointerCapture(pointerId);
    }
    // Give the active tool a chance to salvage in-progress work on a
    // browser/OS-initiated cancel (distinct from the user pressing Escape).
    // Only fall back to the hard-abort Escape path if nothing handled it —
    // this keeps every tool that hasn't opted into pointerCancel behaving
    // exactly as before.
    try {
      const handled = editor.dispatchEvent({ type: 'pointerCancel', reason: reason === 'unmount' ? 'unmount' : 'interrupted' });
      if (!handled) {
        editor.dispatchEvent({ type: 'keyDown', key: 'Escape' } as any);
      }
      if (editor.interactions.active) editor.interactions.cancel();
    } finally {
      reportStroke?.(reason, event);
    }
    if (segmentDragCursorRef.current && containerRef.current) {
      segmentDragCursorRef.current = null;
      containerRef.current.style.cursor = getCanvasToolCursor(editor.currentToolId.peek(), null);
    }
    isMiddleDraggingRef.current = false;
    originalToolBeforeMiddleDragRef.current = null;
    controller.deferredToolRestoreRef.current = null;
  }, [controller, editor, flushDrawMove, strokeDiagnostics, updatePointerPosition]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    const isPenPress = event.pointerType === 'pen' && event.button === 0 && !controller.readOnlySignal.peek();
    const view = isPenPress && !controller.penModeSignal.peek()
      ? event.currentTarget.ownerDocument.defaultView : null;
    const activatesPenMode = (view?.navigator.maxTouchPoints ?? 0) > 0
      || view?.matchMedia?.('(any-pointer: coarse)').matches === true;
    const activePointerId = controller.activePointerIdRef.current;
    if (isPointerDownRef.current && event.pointerId !== activePointerId) {
      const isPenDrawing = isPenPress && isFreehandTool(editor.currentToolId.peek());
      if ((activatesPenMode || isPenDrawing) && activePointerId !== null && activePointerTypeRef.current === 'touch') {
        // A touch can reach the canvas before the digitizer classifies it as a palm.
        // Finish that interaction before assigning capture to the incoming pen.
        cancelPointerInteraction('pen-takeover', activePointerId);
      } else {
        if (isPenDrawing) strokeDiagnostics.blockedPenPress(activePointerId);
        return;
      }
    }
    // macOS reports Control-click as a primary pointer press before contextmenu.
    // Let that menu open without starting a canvas selection or transform.
    if (event.button === 0 && event.ctrlKey && event.pointerType === 'mouse'
      && navigator.platform.startsWith('Mac')) return;

    if (event.button === 1) {
      if (readOnly) return;
      event.preventDefault();
      isMiddleDraggingRef.current = true;
      originalToolBeforeMiddleDragRef.current = editor.currentToolId.peek();
      editor.setCurrentTool('hand', { preserveSelection: true });
    }

    isPointerDownRef.current = true;
    activePointerTypeRef.current = event.pointerType;
    segmentDragCursorRef.current = null;
    controller.isCanvasDraggingRef.current = true;
    controller.activePointerIdRef.current = event.pointerId;
    containerRef.current!.setPointerCapture(event.pointerId);
    if (activatesPenMode) controller.penModeSignal.value = true;
    strokeDiagnostics.pointerDown(event.nativeEvent);

    const { screen, page } = getPagePoint(event);
    updatePointerPosition(screen);
    const handleId = readOnly ? null : getHandleAtEvent(event);

    if (handleId && event.button === 0) {
      if (readOnly) return;
      controller.textStyleTargetIdSignal.value = null;
      editor.setCurrentTool('select');
      editor.dispatchEvent({
        type: 'pointerDown',
        point: page,
        screenPoint: screen,
        shiftKey: event.shiftKey,
        pressure: event.pressure,
        pointerType: event.pointerType,
        target: 'handle',
        handleId,
      } as any);
      if (handleId.startsWith('ortho-segment-')) {
        segmentDragCursorRef.current = getCursorForHandle(handleId, editor);
        containerRef.current!.style.cursor = segmentDragCursorRef.current;
      }
      return;
    }

    const hit = getShapeAtEvent(event);
    if (event.button === 0) {
      if (hit) {
        const util = editor.getShapeUtil(hit.type);
        const localPoint = editor.pageToLocal(hit.id as ShapeId, page);
        controller.textStyleTargetIdSignal.value = (
          hit.type === 'text' || util.hitTestLabel(hit as any, localPoint)
        ) ? hit.id as ShapeId : null;
      } else {
        controller.textStyleTargetIdSignal.value = null;
      }
    }
    const editingBefore = editor.editingShapeId.peek();
    const tool = editor.currentToolId.peek();
    if (!readOnly && (tool === 'eraser' || tool === 'whole-stroke-eraser' || tool === 'partial-eraser'
      || tool === 'area-eraser' || tool === 'asset')) {
      setPointerEditTool(tool);
    }
    editor.dispatchEvent({
      type: 'pointerDown',
      point: page,
      screenPoint: screen,
      shiftKey: event.shiftKey,
      pressure: event.pressure,
      ...stylusTilt(event),
      pointerType: event.pointerType,
      target: (hit && event.button === 0) ? 'shape' : 'canvas',
      shapeId: (hit && event.button === 0) ? (hit.id as ShapeId) : undefined,
    } as any);
    if (isFreehandTool(tool)) strokeDiagnostics.strokeStarted();
    if (!readOnly && editor.editingShapeId.peek() !== editingBefore) {
      preventFocusStealRef.current = true;
    }
  }, [cancelPointerInteraction, controller, editor, getHandleAtEvent, getPagePoint, getShapeAtEvent, readOnly, strokeDiagnostics, updatePointerPosition]);

  const ignoresTouch = useCallback((event: { pointerType: string }) => (
    event.pointerType === 'touch' && controller.penModeSignal.peek()
  ), [controller]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (ignoresTouch(event)) return;
    if (isPointerDownRef.current && event.pointerId !== controller.activePointerIdRef.current) return;
    const { screen, page, rect } = getPagePoint(event);
    updatePointerPosition(screen);
    const currentTool = editor.currentToolId.peek();
    const drawing = isPointerDownRef.current && isFreehandTool(currentTool);
    const coalesced = drawing ? event.nativeEvent.getCoalescedEvents?.() : undefined;
    if (drawing) strokeDiagnostics.pointerMove(event.nativeEvent, coalesced);
    const samples = coalesced?.map(sample => ({
      ...editor.screenToPage({ x: sample.clientX - rect.left, y: sample.clientY - rect.top }),
      pressure: sample.pressure,
      ...stylusTilt(sample),
    }));
    const handleId = drawing || controller.readOnlySignal.peek()
      ? null
      : getHandleAtPagePoint(editor, page.x, page.y);
    if (containerRef.current && !drawing) {
      const state = editor.getCurrentTool().current.constructor as typeof StateNode;
      const segmentCursor = state.id === 'editingOrthoRoute' ? segmentDragCursorRef.current : null;
      containerRef.current.style.cursor = state.id === 'draggingConnectorLabel' ? 'grabbing'
        : segmentCursor ?? getCanvasToolCursor(controller.readOnlySignal.peek() && currentTool === 'draw'
          ? undefined : currentTool, handleId, event.buttons, editor);
    }
    const move: PointerMoveEvent = {
      type: 'pointerMove', point: page, screenPoint: screen, samples,
      shiftKey: event.shiftKey, altKey: event.altKey,
      pressure: event.pressure, ...stylusTilt(event), pointerType: event.pointerType,
    };
    if (drawing) queueDrawMove(move);
    else editor.dispatchEvent(move);
    
    const awareness = controller.awarenessSignal.peek();
    if (awareness) {
      if (editor.editingShapeId.peek()) {
        latestAwarenessCursorRef.current = null;
        awareness.setLocalStateField('canvasCursor', null);
        return;
      }
      latestAwarenessCursorRef.current = page;
      if (awarenessCursorFrameRef.current === null) {
        awarenessCursorFrameRef.current = requestAnimationFrame(() => {
          awarenessCursorFrameRef.current = null;
          awareness.setLocalStateField('canvasCursor', latestAwarenessCursorRef.current);
        });
      }
    }
  }, [controller, editor, getPagePoint, ignoresTouch, queueDrawMove, strokeDiagnostics, updatePointerPosition]);

  useEffect(() => {
    const awareness = controller.awarenessSignal.peek();
    if (!awareness || !editingId) return;
    latestAwarenessCursorRef.current = null;
    awareness.setLocalStateField('canvasCursor', null);
  }, [controller, editingId]);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    if (!isPointerDownRef.current || event.pointerId !== controller.activePointerIdRef.current) return;
    flushDrawMove();
    isPointerDownRef.current = false;
    activePointerTypeRef.current = null;
    setPointerEditTool(null);
    controller.activePointerIdRef.current = null;

    // Commit the gesture before releasing pointer capture. Releasing capture
    // fires 'lostpointercapture' synchronously (in Chromium), which is wired
    // to cancelPointerInteraction — if that ran first, it would see the
    // interaction as still active (this pointerUp hasn't committed it yet)
    // and cancel the just-finished stroke via a synthetic Escape.
    const { screen, page } = getPagePoint(event);
    updatePointerPosition(event.pointerType === 'touch' ? null : screen);
    const reportStroke = strokeDiagnostics.pointerEnded(event.nativeEvent);
    try {
      editor.dispatchEvent({
        type: 'pointerUp', point: page, screenPoint: screen,
        shiftKey: event.shiftKey, altKey: event.altKey,
        pressure: event.pressure, ...stylusTilt(event), pointerType: event.pointerType,
      } as any);
    } finally {
      reportStroke?.('pointerup', event.nativeEvent);
    }
    if (containerRef.current?.hasPointerCapture?.(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }

    controller.isCanvasDraggingRef.current = false;

    if (isMiddleDraggingRef.current) {
      isMiddleDraggingRef.current = false;
      const restoreTool = originalToolBeforeMiddleDragRef.current;
      originalToolBeforeMiddleDragRef.current = null;
      if (restoreTool && !controller.readOnlySignal.peek()) {
        controller.setCurrentTool(restoreTool);
      }
    }

    // Restore tool deferred from a spacebar release mid-drag
    const deferredTool = controller.deferredToolRestoreRef.current;
    controller.deferredToolRestoreRef.current = null;
    if (deferredTool && !controller.readOnlySignal.peek()) {
      controller.setCurrentTool(deferredTool);
    }
    if (segmentDragCursorRef.current && containerRef.current) {
      segmentDragCursorRef.current = null;
      const handleId = controller.readOnlySignal.peek() ? null : getHandleAtPagePoint(editor, page.x, page.y);
      containerRef.current.style.cursor = getCanvasToolCursor(editor.currentToolId.peek(), handleId, event.buttons, editor);
    }
  }, [controller, editor, flushDrawMove, getPagePoint, strokeDiagnostics, updatePointerPosition]);

  useEffect(() => {
    const handleWindowBlur = () => {
      updatePointerPosition(null);
      cancelPointerInteraction('window-blur');
    };
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      cancelPointerInteraction('unmount');
    };
  }, [cancelPointerInteraction, updatePointerPosition]);

  const onDoubleClick = useCallback((event: React.MouseEvent) => {
    if (readOnly || editor.editingShapeId.peek() || shouldIgnoreGlideboardShortcuts(event)) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const page = editor.screenToPage(screen);
    const hit = editor.getTopShapeAtPoint(page);
    if (!hit && editor.currentToolId.peek() === 'select') {
      event.preventDefault();
      TextTool.createAndEdit(editor, page);
      return;
    }
    editor.dispatchEvent({ type: 'doubleClick', point: page, shapeId: hit?.id as ShapeId | undefined });
  }, [editor, readOnly]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (shouldIgnoreGlideboardShortcuts(event) || readOnly || editor.editingShapeId.peek()) return;
    if (event.key === 'Escape') clearPendingDrawMove();
    const reportStroke = event.key === 'Escape' ? strokeDiagnostics.takeStroke() : undefined;
    try {
      editor.dispatchEvent({ type: 'keyDown', key: event.key } as any);
    } finally {
      reportStroke?.('escape');
    }
  }, [clearPendingDrawMove, editor, readOnly, strokeDiagnostics]);

  const onPointerLeave = useCallback((event: React.PointerEvent) => {
    if (ignoresTouch(event) || (isPointerDownRef.current && event.pointerId !== controller.activePointerIdRef.current)) return;
    updatePointerPosition(null);
    if (!isPointerDownRef.current) editor.clearBindingPreview();
    const awareness = controller.awarenessSignal.peek();
    if (awareness) {
      if (awarenessCursorFrameRef.current !== null) {
        cancelAnimationFrame(awarenessCursorFrameRef.current);
        awarenessCursorFrameRef.current = null;
      }
      latestAwarenessCursorRef.current = null;
      awareness.setLocalStateField('canvasCursor', null);
    }
  }, [controller, editor, ignoresTouch, updatePointerPosition]);

  const suppressTouchMouseEvent = useCallback((event: React.MouseEvent) => {
    if (!controller.penModeSignal.peek()) return;
    const native = event.nativeEvent;
    // Some browsers dispatch a MouseEvent without a pointerType for a touch double-click or menu.
    const isTouch = 'pointerType' in native && native.pointerType
      ? native.pointerType === 'touch' : lastPressWasIgnoredTouchRef.current;
    if (isTouch) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, [controller]);

  const cameraTransform = `matrix(${camera.z}, 0, 0, ${camera.z}, ${-camera.x * camera.z}, ${-camera.y * camera.z})`;
  const assetPlacementArmed = activeTool === 'asset' || undefined;
  const canvasCursor = getCanvasToolCursor(readOnly && activeTool === 'draw' ? undefined : activeTool, null);

  const canvas = (
    <div
      ref={containerRef}
      id={controller.domId('canvas')}
      data-glideboard-role="canvas"
      data-asset-placement-armed={assetPlacementArmed}
      tabIndex={0}
      style={{
        flex: 1,
        position: 'relative',
        background: wbTheme.canvasBg,
        overflow: 'hidden',
        touchAction: 'none',
        outline: 'none',
        cursor: canvasCursor,
      }}
      onPointerDownCapture={event => {
        const ignore = ignoresTouch(event);
        lastPressWasIgnoredTouchRef.current = ignore;
        if (ignore) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDown={onPointerDown}
      onPointerEnter={event => {
        if (ignoresTouch(event) || (isPointerDownRef.current && event.pointerId !== controller.activePointerIdRef.current)) return;
        updatePointerPosition(getPagePoint(event).screen);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={event => cancelPointerInteraction('pointercancel', event.pointerId, event.nativeEvent)}
      onLostPointerCapture={event => cancelPointerInteraction('lostpointercapture', event.pointerId, event.nativeEvent)}
      onPointerLeave={onPointerLeave}
      onDoubleClickCapture={suppressTouchMouseEvent}
      onContextMenuCapture={suppressTouchMouseEvent}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onMouseDown={event => {
        if (event.button === 1) {
          event.preventDefault();
        }
        if (preventFocusStealRef.current) {
          preventFocusStealRef.current = false;
          event.preventDefault();
        }
      }}
    >
      {/* 1. Background grid SVG — no shapes */}
      <svg
        id={controller.domId('background')}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        <Grid />
      </svg>

      {/* 2. World layer — one camera transform for visible and pinned content */}
      <div
        id={controller.domId('world')}
        data-glideboard-role="world-layer"
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'visible',
          transform: cameraTransform,
          transformOrigin: '0 0',
          willChange: 'transform',
          pointerEvents: 'none',
        }}
      >
        <div
          id={controller.domId('shapes')}
          data-glideboard-role="shape-layer"
          style={{
            position: 'absolute',
            inset: 0,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          {viewportShapes.map(({ id, zIndex }) => (
            <ShapeLayer
              key={id}
              id={id}
              zIndex={zIndex}
              isEditing={editingId === id}
              beginStrokeSvgRender={onStrokeDiagnostics ? strokeDiagnostics.beginSvgRender : undefined}
              connectorEdit={editingSession?.shapeId === id && editor.getShape(id)?.type === 'arrow' ? editingSession : undefined}
            />
          ))}
        </div>

        {/* Transient previews stay mounted even when their records are offscreen. */}
        <EraserPreviewOverlay />

        {/* One text editor for the active edit session. */}
        {!readOnly && <TextEditingOverlay />}
      </div>

      {/* 3. Screen overlay — selection handles, marquee, binding preview */}
      <CanvasOverlays />
      {showPencilCursor ? (
        <span ref={pencilCursorRef} data-glideboard-role="pencil-cursor" aria-hidden="true"
          style={{
            position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
            left: 0, top: 0, zIndex: 1_000_000,
          }}>
          <LuPencil size={24} color="#222" fill="#fff" style={{ display: 'block' }} />
        </span>
      ) : null}
      {showPartialEraserCursor ? (
        <div ref={partialEraserCursorRef} data-glideboard-role="partial-eraser-cursor" aria-hidden="true"
          style={{
            position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
            width: ERASER_RADIUS_PX * 2, height: ERASER_RADIUS_PX * 2,
            boxSizing: 'border-box', borderRadius: '50%',
            border: `1px solid ${ERASER_PREVIEW_COLOR}`, boxShadow: `0 0 0 1px ${wbTheme.surface}`,
            transform: 'translate(-50%, -50%)', zIndex: 1_000_000,
          }} />
      ) : null}
    </div>
  );
  return (
    <>
      {canvas}
      <BoardNavigation viewportRevision={viewportRevision}
        pointerEditing={!readOnly && pointerEditTool !== null && pointerEditTool === activeTool} />
    </>
  );
}
