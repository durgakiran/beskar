import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { CanvasTextView } from '@durgakiran/canvas-text-editor/view';
import type { CanvasRichTextDocument } from '@durgakiran/canvas-text-editor/model';
import { projectCanvasRichTextToPlainText } from '@durgakiran/canvas-text-editor/model';
import type {
  GlideEditor,
  GlideShape,
  ShapeId,
  Vec2,
  LabelProps,
  RichTextDescriptor,
  TextEditSession,
} from '@durgakiran/glideline';
import { FONT_FAMILIES } from '@durgakiran/glideline';
import { CanvasOverlays, getHandleAtPagePoint, getCursorForHandle } from './CanvasOverlays.js';
import { useGlideboardController } from './GlideboardContext.js';
import { wbTheme } from './theme.js';
import { useSignalValue } from './useSignalValue.js';
import {
  getViewportShapeEntries,
  sameViewportEntries,
  type ViewportShapeEntry,
} from './viewport-rendering.js';
import { shouldIgnoreGlideboardShortcuts } from './shortcut-guards.js';

const LazyCanvasTextEditor = React.lazy(async () => {
  const module = await import('@durgakiran/canvas-text-editor/editor');
  return { default: module.CanvasTextEditor };
});

export function getCanvasToolCursor(tool: string | undefined, handleId: string | null, buttons = 0): string {
  if (tool === 'hand') return buttons === 1 ? 'grabbing' : 'grab';
  if (tool === 'asset') return 'crosshair';
  return handleId ? getCursorForHandle(handleId) : 'default';
}

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────

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

function readEditingText(element: HTMLElement): string {
  return (element.textContent ?? '').split(EMPTY_EDIT_MARKER).join('');
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
    const disposers = [
      editor.store.listen(schedule),
      editor.camera.signal.subscribe(schedule),
      editor.getSelectionSignal().subscribe(schedule),
      editor.editingShapeId.subscribe(schedule),
      editor.erasingShapeIds.subscribe(schedule),
      editor.bindingPreview.subscribe(schedule),
      editor.activePageId.subscribe(schedule),
      editor.interactions.getChangedIdsSignal().subscribe(schedule),
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
}: {
  id: ShapeId;
  zIndex: number;
  isEditing: boolean;
}) => {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const sig = editor.getShapeSignal(id);
  const shape = useSignalValue(sig as any) as GlideShape | null;
  const remoteTextEditingShapeIds = useSignalValue(controller.remoteTextEditingShapeIdsSignal);
  const isRemoteTextEditing = remoteTextEditingShapeIds?.has(id) ?? false;
  useSignalValue(editor.getDocumentVersionSignal());
  useSignalValue(controller.collaborationTextVersionSignal);
  const svgRef = useRef<SVGSVGElement>(null);

  // Inject toSvg() geometry output into the per-shape <svg>
  useEffect(() => {
    if (!svgRef.current || !shape) return;
    const util = editor.getShapeUtil(shape.type);
    if ((util as any).toSvg) {
      const el = (util as any).toSvg(shape);
      svgRef.current.innerHTML = '';
      if (el) {
        const defs = el.querySelector('defs');
        if (defs) {
          svgRef.current.appendChild(defs);
        }
        svgRef.current.appendChild(el);
      }
    }
  }, [editor, shape]);

  const util = shape ? editor.getShapeUtil(shape.type) : null;
  const labelProps: LabelProps | null = (shape && util) ? ((util as any).getLabelProps?.(shape) ?? null) : null;
  const richText = (shape && util) ? util.getRichTextDescriptor(shape as any) : null;
  const textCollaboration = richText
    ? controller.getCanvasTextCollaboration(id as ShapeId, { create: false })
    : undefined;

  if (!shape || !util || editor.isShapeEffectivelyHidden(shape.id as ShapeId)) return null;

  const isTextType = shape.type === 'text';
  const hasFixedWidth = isTextType && typeof (shape.props as any).w === 'number';

  const localBounds = util.getGeometry(shape as any).getBounds();
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
      }}
    >
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
            fontFamily: richText.fontFamily,
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
            fontFamily: labelProps.fontFamily,
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
            overflow: 'hidden',
            whiteSpace: (isTextType && !hasFixedWidth) ? 'pre' : 'pre-wrap',
            wordBreak: 'break-word',
            outline: 'none',
            boxSizing: 'border-box',
            lineHeight: labelProps.lineHeight ?? 1.35,
            visibility: isEditing ? 'hidden' : 'visible',
          }}
        >
          {labelProps.text}
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
// EraserPreviewOverlay — transient feedback outside shape layers
// ─────────────────────────────────────────────────────────────

const EraserPreviewShape = memo(({ id, zoom }: { id: ShapeId; zoom: number }) => {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const shape = useSignalValue(editor.getShapeSignal(id) as any) as GlideShape | null;
  if (!shape) return null;

  const points = editor.transforms.getWorldOutline(id);
  if (points.length === 0) return null;
  const serialized = points.map(point => `${point.x},${point.y}`).join(' ');
  const open = shape.type === 'arrow' || shape.type === 'freehand';
  return open ? (
    <polyline
      points={serialized}
      fill="none"
      stroke="#f38ba8"
      strokeWidth={8 / zoom}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.65}
    />
  ) : (
    <polygon
      points={serialized}
      fill="#f38ba8"
      stroke="#f38ba8"
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
          fontFamily: descriptor.fontFamily,
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
    if (readEditingText(editable) !== session.draft) {
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
  const layoutShape = session.pendingProps
    ? { ...shape, props: { ...shape.props, ...session.pendingProps } }
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
          outline: conflicted ? '2px solid #ef4444' : '2px solid #4f8cff',
          outlineOffset: 2,
          fontFamily: labelProps.fontFamily,
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
          lineHeight: 1.35,
        }}
      >
        <div
          ref={editableRef}
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
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
            const draft = readEditingText(editable);
            editor.updateEditingDraft(draft);
            if (!draft && editable.textContent === '') {
              editable.textContent = EMPTY_EDIT_MARKER;
              moveCaretToEnd(editable);
            }
          }}
          onCompositionStart={() => editor.setEditingComposition(true)}
          onCompositionEnd={event => {
            const draft = readEditingText(event.currentTarget);
            event.currentTarget.textContent = draft || EMPTY_EDIT_MARKER;
            moveCaretToEnd(event.currentTarget);
            editor.updateEditingDraft(draft);
            editor.setEditingComposition(false);
          }}
          onBlur={commit}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || session.composing) return;
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
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
            lineHeight: 1.35,
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Canvas
// ─────────────────────────────────────────────────────────────

export function Canvas() {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const camera = useSignalValue(editor.camera.signal)!;
  const editingId = useSignalValue(editor.editingShapeId);
  const readOnly = useSignalValue(controller.readOnlySignal) ?? false;
  const [viewportRevision, setViewportRevision] = useState(0);
  const viewportShapes = useViewportShapeEntries(editor, viewportRevision);
  const containerRef = useRef<HTMLDivElement>(null);
  const preventFocusStealRef = useRef(false);
  const isMiddleDraggingRef = useRef(false);
  const originalToolBeforeMiddleDragRef = useRef<string | null>(null);
  const isPointerDownRef = useRef(false);
  const awarenessCursorFrameRef = useRef<number | null>(null);
  const latestAwarenessCursorRef = useRef<Vec2 | null>(null);
  const activeTool = useSignalValue(editor.currentToolId);

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
  }, [controller, editor]);

  const getPagePoint = useCallback((event: React.PointerEvent | React.WheelEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, page: editor.screenToPage(screen) };
  }, [editor]);

  const getShapeAtEvent = useCallback((event: React.PointerEvent) => {
    const { page } = getPagePoint(event);
    return editor.getTopShapeAtPoint(page) ?? null;
  }, [editor, getPagePoint]);

  const getHandleAtEvent = useCallback((event: React.PointerEvent) => {
    const { page } = getPagePoint(event);
    return getHandleAtPagePoint(editor, page.x, page.y);
  }, [editor, getPagePoint]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;

    if (event.button === 1) {
      if (readOnly) return;
      event.preventDefault();
      isMiddleDraggingRef.current = true;
      originalToolBeforeMiddleDragRef.current = editor.currentToolId.peek();
      editor.setCurrentTool('hand', { preserveSelection: true });
    }

    isPointerDownRef.current = true;
    controller.isCanvasDraggingRef.current = true;
    controller.activePointerIdRef.current = event.pointerId;
    containerRef.current!.setPointerCapture(event.pointerId);

    const { screen, page } = getPagePoint(event);
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
    editor.dispatchEvent({
      type: 'pointerDown',
      point: page,
      screenPoint: screen,
      shiftKey: event.shiftKey,
      pressure: event.pressure,
      pointerType: event.pointerType,
      target: (hit && event.button === 0) ? 'shape' : 'canvas',
      shapeId: (hit && event.button === 0) ? (hit.id as ShapeId) : undefined,
    } as any);
    if (!readOnly && editor.editingShapeId.peek() !== editingBefore) {
      preventFocusStealRef.current = true;
    }
  }, [controller, editor, getHandleAtEvent, getPagePoint, getShapeAtEvent, readOnly]);

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const { screen, page } = getPagePoint(event);
    const handleId = controller.readOnlySignal.peek()
      ? null
      : getHandleAtPagePoint(editor, page.x, page.y);
    if (containerRef.current) {
      const currentTool = editor.currentToolId.peek();
      containerRef.current.style.cursor = getCanvasToolCursor(currentTool, handleId, event.buttons);
    }
    editor.dispatchEvent({
      type: 'pointerMove', point: page, screenPoint: screen,
      shiftKey: event.shiftKey, altKey: event.altKey,
      pressure: event.pressure, pointerType: event.pointerType,
    } as any);
    
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
  }, [controller, editor, getPagePoint]);

  useEffect(() => {
    const awareness = controller.awarenessSignal.peek();
    if (!awareness || !editingId) return;
    latestAwarenessCursorRef.current = null;
    awareness.setLocalStateField('canvasCursor', null);
  }, [controller, editingId]);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    isPointerDownRef.current = false;
    controller.activePointerIdRef.current = null;
    if (containerRef.current?.hasPointerCapture?.(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
    const { screen, page } = getPagePoint(event);
    editor.dispatchEvent({
      type: 'pointerUp', point: page, screenPoint: screen,
      shiftKey: event.shiftKey, altKey: event.altKey,
      pressure: event.pressure, pointerType: event.pointerType,
    } as any);

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
  }, [controller, editor, getPagePoint]);

  const cancelPointerInteraction = useCallback((pointerId?: number) => {
    if (!isPointerDownRef.current && !editor.interactions.active) return;
    isPointerDownRef.current = false;
    controller.isCanvasDraggingRef.current = false;
    controller.activePointerIdRef.current = null;
    if (pointerId !== undefined && containerRef.current?.hasPointerCapture?.(pointerId)) {
      containerRef.current.releasePointerCapture(pointerId);
    }
    editor.dispatchEvent({ type: 'keyDown', key: 'Escape' } as any);
    if (editor.interactions.active) editor.interactions.cancel();
    isMiddleDraggingRef.current = false;
    originalToolBeforeMiddleDragRef.current = null;
    controller.deferredToolRestoreRef.current = null;
  }, [controller, editor]);

  useEffect(() => {
    const handleWindowBlur = () => cancelPointerInteraction();
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      cancelPointerInteraction();
    };
  }, [cancelPointerInteraction]);

  const onDoubleClick = useCallback((event: React.MouseEvent) => {
    if (readOnly) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const page = editor.screenToPage(screen);
    const hit = editor.getTopShapeAtPoint(page);
    editor.dispatchEvent({ type: 'doubleClick', point: page, shapeId: hit?.id as ShapeId | undefined } as any);
  }, [editor, readOnly]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (shouldIgnoreGlideboardShortcuts(event) || readOnly || editor.editingShapeId.peek()) return;
    editor.dispatchEvent({ type: 'keyDown', key: event.key } as any);
  }, [editor, readOnly]);

  const onPointerLeave = useCallback(() => {
    const awareness = controller.awarenessSignal.peek();
    if (awareness) {
      if (awarenessCursorFrameRef.current !== null) {
        cancelAnimationFrame(awarenessCursorFrameRef.current);
        awarenessCursorFrameRef.current = null;
      }
      latestAwarenessCursorRef.current = null;
      awareness.setLocalStateField('canvasCursor', null);
    }
  }, [controller]);

  const cameraTransform = `matrix(${camera.z}, 0, 0, ${camera.z}, ${-camera.x * camera.z}, ${-camera.y * camera.z})`;
  const assetPlacementArmed = activeTool === 'asset' || undefined;
  const canvasCursor = getCanvasToolCursor(activeTool, null);

  return (
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={event => cancelPointerInteraction(event.pointerId)}
      onLostPointerCapture={event => cancelPointerInteraction(event.pointerId)}
      onPointerLeave={onPointerLeave}
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
    </div>
  );
}
