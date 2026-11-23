import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { FreehandShape, GlideShape, ShapeId } from '@durgakiran/glideline';
import type { GlideboardController } from '../GlideboardController.js';
import type {
  GlideboardDiagnosticPointerType,
  GlideboardStrokeDiagnostic,
  GlideboardStrokeDiagnosticsHandler,
  GlideboardStrokeEndReason,
  GlideboardStrokeFrameTiming,
} from '../types.js';

const MAX_PENDING_DIAGNOSTICS = 100;
const DELIVERY_DELAY_MS = 500;

interface InputSample {
  clientX: number;
  clientY: number;
  timeStamp: number;
}

interface ActivePointer {
  id: number;
  type: GlideboardDiagnosticPointerType;
  startedAt: number;
  blockedPenPressCount: number;
  strokeId?: ShapeId;
  lastSample: InputSample;
  moveEventCount: number;
  coalescedEventsAvailable: boolean | null;
  coalescedSampleCount: number;
  distinctMoveSampleCount: number;
  zeroPressureMoveEventCount: number;
  maxInputSampleGapMs: number;
  maxInputSampleDistancePx: number;
  zoomAtStart: number;
  queuedAt?: number;
  previousAnimationFrameAt?: number;
  drawUpdates: WeakMap<GlideShape, { queuedAt: number; finishedAt: number }>;
  frameTiming: { -readonly [K in keyof GlideboardStrokeFrameTiming]: GlideboardStrokeFrameTiming[K] };
}

function maxTime(previous: number | null, elapsed: number): number {
  return Math.max(previous ?? 0, Math.round(elapsed * 100) / 100);
}

function recordSample(pointer: ActivePointer, sample: InputSample): boolean {
  const { lastSample } = pointer;
  const distance = Math.hypot(sample.clientX - lastSample.clientX, sample.clientY - lastSample.clientY);
  pointer.maxInputSampleDistancePx = Math.max(pointer.maxInputSampleDistancePx, distance);
  pointer.maxInputSampleGapMs = Math.max(pointer.maxInputSampleGapMs, sample.timeStamp - lastSample.timeStamp);
  lastSample.clientX = sample.clientX;
  lastSample.clientY = sample.clientY;
  lastSample.timeStamp = sample.timeStamp;
  return distance > 0;
}

function diagnosticPointerType(type: string): GlideboardDiagnosticPointerType {
  return type === 'pen' || type === 'touch' || type === 'mouse' ? type : 'unknown';
}

export function useStrokeDiagnostics(
  controller: GlideboardController,
  onDiagnostics?: GlideboardStrokeDiagnosticsHandler,
) {
  const handlerRef = useRef(onDiagnostics);
  useLayoutEffect(() => { handlerRef.current = onDiagnostics; }, [onDiagnostics]);

  const diagnostics = useMemo(() => {
    const { editor } = controller;
    let active: ActivePointer | undefined;
    let pending: GlideboardStrokeDiagnostic[] = [];
    let deliveryScheduled = false;

    function enqueue(diagnostic: GlideboardStrokeDiagnostic): void {
      if (!handlerRef.current) return;
      if (pending.length === MAX_PENDING_DIAGNOSTICS) pending.shift();
      pending.push(diagnostic);
      if (deliveryScheduled) return;
      deliveryScheduled = true;
      setTimeout(async () => {
        deliveryScheduled = false;
        const batch = pending;
        pending = [];
        try {
          await handlerRef.current?.(batch);
        } catch {
          // A host's telemetry failure must not affect drawing or board disposal.
        }
      }, DELIVERY_DELAY_MS);
    }

    function takeStroke() {
      const strokeId = active?.strokeId;
      if (!active || !strokeId) return;
      const {
        type: pointerType, startedAt, blockedPenPressCount, moveEventCount, coalescedEventsAvailable,
        coalescedSampleCount, distinctMoveSampleCount, zeroPressureMoveEventCount,
        maxInputSampleGapMs, maxInputSampleDistancePx, zoomAtStart, frameTiming,
      } = active;
      const stroke = editor.getShape<FreehandShape>(strokeId);
      const acceptedPointCount = stroke?.type === 'freehand' ? stroke.props.points.length : null;
      const elapsedMs = Math.round(performance.now() - startedAt);
      active.strokeId = undefined;
      return (reason: GlideboardStrokeEndReason, event?: Pick<PointerEvent, 'buttons' | 'isTrusted'>) => {
        const committed = editor.store.has(strokeId) ? editor.getShape<FreehandShape>(strokeId) : undefined;
        const outcome = committed ? 'committed'
          : editor.getShape(strokeId) ? 'uncommitted' : 'discarded';
        const props = (committed ?? stroke)?.props;
        enqueue({
          type: 'stroke-ended', reason, pointerType, outcome, acceptedPointCount, elapsedMs,
          blockedPenPressCount, moveEventCount, coalescedEventsAvailable, coalescedSampleCount,
          distinctMoveSampleCount, zeroPressureMoveEventCount, zoomAtStart, frameTiming: { ...frameTiming },
          maxInputSampleGapMs: Math.round(maxInputSampleGapMs),
          maxInputSampleDistancePx: Math.round(maxInputSampleDistancePx * 10) / 10,
          committedPointCount: committed?.props.points.length ?? null,
          strokeStyle: props?.strokeStyle ?? null,
          strokeWidth: props?.strokeWidth ?? null,
          pressureSensitive: props?.pressureSensitive ?? null,
          ...(event && { buttons: event.buttons, isTrusted: event.isTrusted }),
        });
      };
    }

    return {
      pointerDown(event: PointerEvent) {
        if (!handlerRef.current) return;
        active = {
          id: event.pointerId, type: diagnosticPointerType(event.pointerType),
          startedAt: performance.now(), blockedPenPressCount: 0,
          lastSample: { clientX: event.clientX, clientY: event.clientY, timeStamp: event.timeStamp },
          moveEventCount: 0, coalescedEventsAvailable: null, coalescedSampleCount: 0,
          distinctMoveSampleCount: 0, zeroPressureMoveEventCount: 0,
          maxInputSampleGapMs: 0, maxInputSampleDistancePx: 0, zoomAtStart: editor.camera.getCamera().z,
          drawUpdates: new WeakMap(),
          frameTiming: {
            animationFrameCount: 0, synchronousFlushCount: 0, maxAnimationFrameGapMs: null,
            maxInputQueueMs: null, maxDrawUpdateMs: null, maxUpdateToSvgStartMs: null,
            svgRenderCount: 0, maxSvgRenderMs: null, slowestSvgPointCount: null, maxInputToSvgReadyMs: null,
          },
        };
      },
      pointerMove(event: PointerEvent, coalesced: readonly PointerEvent[] | undefined) {
        if (!active?.strokeId || !handlerRef.current) return;
        active.queuedAt ??= performance.now();
        active.moveEventCount += 1;
        active.coalescedEventsAvailable = active.coalescedEventsAvailable === true || coalesced !== undefined;
        active.coalescedSampleCount += coalesced?.length ?? 0;
        if (event.pressure === 0) active.zeroPressureMoveEventCount += 1;
        for (const sample of coalesced ?? []) {
          if (recordSample(active, sample)) active.distinctMoveSampleCount += 1;
        }
        if (recordSample(active, event)) active.distinctMoveSampleCount += 1;
      },
      beginDrawUpdate(frameAt?: number) {
        const pointer = active;
        const strokeId = pointer?.strokeId;
        const queuedAt = pointer?.queuedAt;
        if (!pointer || !strokeId || queuedAt === undefined || !handlerRef.current) return;
        const startedAt = performance.now();
        const before = editor.getShape(strokeId);
        const timing = pointer.frameTiming;
        pointer.queuedAt = undefined;
        timing.maxInputQueueMs = maxTime(timing.maxInputQueueMs, startedAt - queuedAt);
        if (frameAt === undefined) {
          timing.synchronousFlushCount += 1;
        } else {
          timing.animationFrameCount += 1;
          if (pointer.previousAnimationFrameAt !== undefined) {
            timing.maxAnimationFrameGapMs = maxTime(timing.maxAnimationFrameGapMs, frameAt - pointer.previousAnimationFrameAt);
          }
          pointer.previousAnimationFrameAt = frameAt;
        }
        return () => {
          const finishedAt = performance.now();
          timing.maxDrawUpdateMs = maxTime(timing.maxDrawUpdateMs, finishedAt - startedAt);
          const shape = editor.getShape(strokeId);
          if (shape && shape !== before) pointer.drawUpdates.set(shape, { queuedAt, finishedAt });
        };
      },
      beginSvgRender(shape: GlideShape) {
        if (!handlerRef.current || active?.strokeId !== shape.id || shape.type !== 'freehand'
          || shape.props['isComplete'] !== false) return;
        const { frameTiming: timing, drawUpdates } = active;
        const startedAt = performance.now();
        const update = drawUpdates.get(shape);
        if (update) {
          drawUpdates.delete(shape);
          timing.maxUpdateToSvgStartMs = maxTime(timing.maxUpdateToSvgStartMs, startedAt - update.finishedAt);
        }
        return () => {
          const finishedAt = performance.now();
          const elapsed = finishedAt - startedAt;
          timing.svgRenderCount += 1;
          const maxRender = maxTime(timing.maxSvgRenderMs, elapsed);
          if (timing.maxSvgRenderMs !== maxRender) {
            timing.maxSvgRenderMs = maxRender;
            timing.slowestSvgPointCount = (shape as FreehandShape).props.points.length;
          }
          if (update) timing.maxInputToSvgReadyMs = maxTime(timing.maxInputToSvgReadyMs, finishedAt - update.queuedAt);
        };
      },
      blockedPenPress(activePointerId: number | null) {
        if (!handlerRef.current) return;
        const owner = active?.id === activePointerId ? active : undefined;
        if (owner) owner.blockedPenPressCount += 1;
        enqueue({
          type: 'pen-press-blocked', reason: 'another-pointer-active',
          activePointerType: owner?.type ?? 'unknown',
          activePointerElapsedMs: owner ? Math.round(performance.now() - owner.startedAt) : null,
        });
      },
      strokeStarted() {
        if (!active) return;
        for (const id of editor.interactions.changedIds) {
          const shape = editor.getShape<FreehandShape>(id as ShapeId);
          if (shape?.type === 'freehand' && !shape.props.isComplete && !editor.store.has(id)) {
            active.strokeId = shape.id as ShapeId;
            return;
          }
        }
      },
      takeStroke,
      pointerEnded(event?: PointerEvent) {
        if (event && active?.strokeId) recordSample(active, event);
        const report = takeStroke();
        active = undefined;
        return report;
      },
      previewEnded() {
        const report = takeStroke();
        if (!report) return;
        const wentReadOnly = controller.readOnlySignal.peek();
        // The preview is cleared before the editor finishes a tool switch.
        queueMicrotask(() => report(wentReadOnly ? 'read-only'
          : editor.currentToolId.peek() !== 'draw' ? 'tool-change' : 'preview-ended'));
      },
    };
  }, [controller]);

  const enabled = Boolean(onDiagnostics);
  useEffect(() => {
    if (!enabled) return;
    return controller.editor.interactions.getKindSignal().subscribe(kind => {
      if (kind === null) diagnostics.previewEnded();
    });
  }, [controller, diagnostics, enabled]);

  return diagnostics;
}
