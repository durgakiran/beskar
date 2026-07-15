import { signal } from '@preact/signals';
import {
  createCanvasToolServer,
  resolveArrowRoute,
  type Box2d,
  type CanvasToolName,
  type GlideDocument,
  type GlidePlugin,
  type LoadReport,
  type Vec2,
} from '@durgakiran/glideline';
import { bindGlideboardCollaboration } from './collaboration';
import { createGlideboardEditorInstance } from './editor';
import type {
  GlideboardCollaborationConfig,
  GlideboardCollaborationProvider,
  GlideboardDocumentChangeContext,
  GlideboardUser,
  InitialDocumentDisposition,
} from './types';

export type ConnectorPreset = 'line' | 'arrow' | 'double-arrow';
export type ArrowheadStyle = 'none' | 'arrow';
export type ArrowRouteStyle = 'curve' | 'ortho' | 'smart';

export interface GlideboardControllerOptions {
  sessionKey: string;
  customShapes?: readonly GlidePlugin[];
  initialDocument?: GlideDocument | null;
  initialDocumentDisposition?: InitialDocumentDisposition;
  readOnly?: boolean;
}

type DocumentChangeHandler = (
  document: GlideDocument,
  context: GlideboardDocumentChangeContext,
) => void | Promise<void>;

export interface GlideboardDisposeOptions {
  pendingSave?: 'cancel' | 'flush';
}

interface PresenceBinding {
  awareness: NonNullable<GlideboardCollaborationProvider['awareness']> | null;
  owner: object;
  active: boolean;
  cleanupScheduled: boolean;
}

let nextControllerId = 0;
const awarenessPresenceOwners = new WeakMap<object, object>();
const MAX_AUTOMATIC_SAVE_RETRIES = 3;
const MAX_AUTOMATIC_RETRY_DELAY_MS = 5_000;

function getConnectorPreset(
  arrowheadStart: ArrowheadStyle,
  arrowheadEnd: ArrowheadStyle,
): ConnectorPreset {
  if (arrowheadStart === 'arrow' && arrowheadEnd === 'arrow') return 'double-arrow';
  if (arrowheadStart === 'none' && arrowheadEnd === 'none') return 'line';
  return 'arrow';
}

function getPresetArrowheads(
  preset: ConnectorPreset,
): { arrowheadStart: ArrowheadStyle; arrowheadEnd: ArrowheadStyle } {
  switch (preset) {
    case 'line':
      return { arrowheadStart: 'none', arrowheadEnd: 'none' };
    case 'double-arrow':
      return { arrowheadStart: 'arrow', arrowheadEnd: 'arrow' };
    default:
      return { arrowheadStart: 'none', arrowheadEnd: 'arrow' };
  }
}

/**
 * Owns every mutable value that belongs to one mounted whiteboard session.
 * Nothing in this class is shared by another controller instance.
 */
export class GlideboardController {
  readonly sessionKey: string;
  readonly editor;
  readonly readOnlySignal = signal(false);
  readonly awarenessSignal = signal<any | null>(null);
  readonly isCanvasDraggingRef = { current: false };
  readonly deferredToolRestoreRef = { current: null as string | null };
  readonly arrowRouteStyleSignal;
  readonly arrowPresetSignal;
  readonly arrowheadStartSignal;
  readonly arrowheadEndSignal;

  private readonly toolServer;
  private readonly domIdPrefix: string;
  private readonly presenceOwner = {};
  private canvasElement: HTMLElement | null = null;
  private collaborationCleanup: (() => void) | null = null;
  private presenceBinding: PresenceBinding | null = null;
  private documentChangeDispose: (() => void) | null = null;
  private documentChangeHandler: DocumentChangeHandler | null = null;
  private documentChangeDebounceMs = 500;
  private documentChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private documentChangeGeneration = 0;
  private documentTrackingGeneration = 0;
  private documentDirty = false;
  private documentSaveInFlight: Promise<void> | null = null;
  private documentSaveAbortController: AbortController | null = null;
  private documentSaveRetryAttempt = 0;
  private disposalPromise: Promise<void> | null = null;
  private readonly debugCleanups = new Set<() => void>();

  constructor(options: GlideboardControllerOptions) {
    this.sessionKey = options.sessionKey;
    this.domIdPrefix = `glideboard-${++nextControllerId}`;
    this.editor = createGlideboardEditorInstance([...(options.customShapes ?? [])]);
    this.toolServer = createCanvasToolServer(this.editor);

    this.arrowRouteStyleSignal = signal<ArrowRouteStyle>(this.editor.arrowRouteStyle);
    this.arrowPresetSignal = signal<ConnectorPreset>(
      getConnectorPreset(this.editor.arrowheadStart, this.editor.arrowheadEnd),
    );
    this.arrowheadStartSignal = signal<ArrowheadStyle>(this.editor.arrowheadStart);
    this.arrowheadEndSignal = signal<ArrowheadStyle>(this.editor.arrowheadEnd);

    if (options.initialDocument) {
      if (!options.initialDocumentDisposition) {
        throw new Error('Glideboard: initialDocumentDisposition is required with initialDocument.');
      }
      this.editor.replaceDocument(options.initialDocument);
      this.documentDirty = options.initialDocumentDisposition.kind !== 'acknowledged-baseline';
    }
    this.setReadOnly(Boolean(options.readOnly));
  }

  replaceDocument(
    document: GlideDocument,
    options: { resetSessionState?: boolean } = {},
  ): LoadReport {
    const report = this.editor.replaceDocument(document);
    if (options.resetSessionState ?? true) {
      this.editor.resetSessionState();
      this.setArrowRouteStyle('curve');
      this.setConnectorPreset('arrow');
      this.editor.setCurrentTool(this.readOnlySignal.peek() ? 'hand' : 'select');
      this.isCanvasDraggingRef.current = false;
      this.deferredToolRestoreRef.current = null;
    }

    // Replacement is an acknowledged baseline, not a user edit. Retire any
    // save of the previous document and establish a clean tracking generation.
    this.documentTrackingGeneration += 1;
    this.documentChangeGeneration += 1;
    this.documentDirty = false;
    this.documentSaveRetryAttempt = 0;
    this.cancelPendingDocumentChange();
    this.documentSaveAbortController?.abort();
    return report;
  }

  domId(name: string): string {
    return `${this.domIdPrefix}-${name}`;
  }

  setCanvasElement(element: HTMLElement | null): void {
    this.canvasElement = element;
  }

  getCanvasElement(): HTMLElement | null {
    return this.canvasElement;
  }

  setReadOnly(readOnly: boolean): void {
    if (this.readOnlySignal.peek() === readOnly) return;
    this.readOnlySignal.value = readOnly;
    this.editor.setCurrentTool(readOnly ? 'hand' : 'select');
    if (readOnly) {
      this.editor.stopEditing();
      this.editor.clearBindingPreview();
      this.isCanvasDraggingRef.current = false;
      this.deferredToolRestoreRef.current = null;
    }
  }

  setCurrentTool(toolId: string): void {
    if (this.readOnlySignal.peek() && toolId !== 'hand') {
      throw new Error(`Glideboard: cannot select tool "${toolId}" while the board is read-only.`);
    }
    this.editor.setCurrentTool(toolId);
  }

  setArrowRouteStyle(routeStyle: ArrowRouteStyle): void {
    this.editor.arrowRouteStyle = routeStyle;
    this.arrowRouteStyleSignal.value = routeStyle;
  }

  private setArrowheads(
    arrowheadStart: ArrowheadStyle,
    arrowheadEnd: ArrowheadStyle,
  ): void {
    this.editor.arrowheadStart = arrowheadStart;
    this.editor.arrowheadEnd = arrowheadEnd;
    this.arrowheadStartSignal.value = arrowheadStart;
    this.arrowheadEndSignal.value = arrowheadEnd;
    this.arrowPresetSignal.value = getConnectorPreset(arrowheadStart, arrowheadEnd);
  }

  setArrowheadStart(arrowheadStart: ArrowheadStyle): void {
    this.setArrowheads(arrowheadStart, this.editor.arrowheadEnd);
  }

  setArrowheadEnd(arrowheadEnd: ArrowheadStyle): void {
    this.setArrowheads(this.editor.arrowheadStart, arrowheadEnd);
  }

  setConnectorPreset(preset: ConnectorPreset): void {
    const { arrowheadStart, arrowheadEnd } = getPresetArrowheads(preset);
    this.setArrowheads(arrowheadStart, arrowheadEnd);
  }

  clearDocument(): void {
    const ids = this.editor.serialize().records
      .map(record => String(record.id ?? ''))
      .filter(Boolean);
    if (ids.length > 0) {
      this.editor.batch('Clear Document', () => {
        this.editor.store.remove(ids);
      });
    }
    this.editor.setSelectedShapeIds([]);
    this.editor.stopEditing();
    this.editor.clearBindingPreview();
    this.editor.camera.setCamera({ x: 0, y: 0, z: 1 });
  }

  attachCollaboration(config: GlideboardCollaborationConfig): () => void {
    this.detachCollaboration();

    const cleanupBinding = bindGlideboardCollaboration(this.editor, config);
    const cleanupPresence = config.provider || config.user
      ? this.attachPresence(config.provider, config.user)
      : null;
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      cleanupBinding();
      cleanupPresence?.();
      if (this.collaborationCleanup === cleanup) {
        this.collaborationCleanup = null;
      }
    };

    this.collaborationCleanup = cleanup;
    return cleanup;
  }

  detachCollaboration(): void {
    const cleanup = this.collaborationCleanup;
    this.collaborationCleanup = null;
    cleanup?.();
  }

  attachPresence(
    provider?: GlideboardCollaborationProvider | null,
    user?: GlideboardUser | null,
  ): () => void {
    const awareness = provider?.awareness ?? null;
    const previousBinding = this.presenceBinding;
    const existingOwner = awareness
      ? awarenessPresenceOwners.get(awareness)
      : undefined;

    // One awareness instance represents one local Yjs client state. If two
    // boards shared it, their user and cursor fields would overwrite each
    // other, and unmounting either board could clear the other's presence.
    if (existingOwner && existingOwner !== this.presenceOwner) {
      throw new Error(
        'Glideboard: a collaboration awareness provider cannot be shared by multiple boards.',
      );
    }

    if (previousBinding) {
      if (previousBinding.awareness === awareness) {
        // React StrictMode replays effects. Hand ownership to the replacement
        // binding without broadcasting a transient departure in between.
        previousBinding.active = false;
        previousBinding.cleanupScheduled = false;
        this.presenceBinding = null;
      } else {
        this.releasePresenceBinding(previousBinding);
      }
    }

    const binding: PresenceBinding = {
      awareness,
      owner: this.presenceOwner,
      active: true,
      cleanupScheduled: false,
    };
    this.presenceBinding = binding;
    this.awarenessSignal.value = awareness;

    if (awareness) {
      awarenessPresenceOwners.set(awareness, binding.owner);
      awareness.setLocalStateField('user', user
        ? {
            id: user.id,
            name: user.name,
            color: user.color,
          }
        : null);
    }

    const cleanup = () => {
      if (!binding.active || binding.cleanupScheduled) return;
      binding.cleanupScheduled = true;
      queueMicrotask(() => {
        if (!binding.active || !binding.cleanupScheduled) return;
        this.releasePresenceBinding(binding);
      });
    };
    return cleanup;
  }

  detachPresence(): void {
    const binding = this.presenceBinding;
    if (binding) this.releasePresenceBinding(binding);
    this.awarenessSignal.value = null;
  }

  configureDocumentChanges(
    handler: DocumentChangeHandler | null | undefined,
    debounceMs = 500,
  ): void {
    const nextHandler = handler ?? null;
    const hadHandler = this.documentChangeHandler !== null;
    const debounceChanged = this.documentChangeDebounceMs !== debounceMs;
    this.documentChangeHandler = nextHandler;
    this.documentChangeDebounceMs = debounceMs;

    if (!this.documentChangeHandler) {
      this.cancelPendingDocumentChange();
      return;
    }

    // Callback identity is live configuration only. Replacing an inline
    // callback must not restart a pending debounce or manufacture another
    // save while an earlier callback is in flight. The timer reads the latest
    // handler when it starts; actual store changes are what mark us dirty.
    if (this.documentDirty && (!hadHandler || debounceChanged)) {
      this.scheduleDocumentChange();
    }
  }

  startDocumentChangeTracking(): () => void {
    this.stopDocumentChangeTracking();
    const disposeSubscription = this.editor.store.listen(changes => {
      if (changes.scope === 'ephemeral') return;
      this.documentDirty = true;
      this.documentSaveRetryAttempt = 0;
      this.scheduleDocumentChange();
    });

    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      disposeSubscription();
      if (this.documentChangeDispose === cleanup) {
        this.documentChangeDispose = null;
        this.documentTrackingGeneration += 1;
        this.cancelPendingDocumentChange();
      }
    };
    this.documentChangeDispose = cleanup;
    if (this.documentDirty) this.scheduleDocumentChange();
    return cleanup;
  }

  stopDocumentChangeTracking(): void {
    const cleanup = this.documentChangeDispose;
    if (cleanup) {
      cleanup();
    } else {
      this.documentTrackingGeneration += 1;
      this.cancelPendingDocumentChange();
    }
  }

  async flush(): Promise<void> {
    this.cancelPendingDocumentChange();

    // Serialize callbacks and keep draining if the document changes while a
    // prior callback is awaiting I/O.
    while (true) {
      const inFlight = this.documentSaveInFlight;
      if (inFlight) {
        await inFlight;
        continue;
      }
      if (!this.documentDirty || !this.documentChangeHandler) return;
      this.cancelPendingDocumentChange();
      await this.startDocumentSave();
    }
  }

  attachDebugApi(debugApiKey: string): () => void {
    if (typeof window === 'undefined' || !debugApiKey) return () => {};

    const api = {
      reset: () => this.clearDocument(),
      setCurrentTool: (id: string) => this.setCurrentTool(id),
      getCurrentToolId: () => this.editor.currentToolId.peek(),
      callTool: async (name: CanvasToolName, input: unknown) => this.toolServer.callTool(name, input),
      getToolManifest: () => this.toolServer.generateToolManifest(),
      getAIContext: (opts?: { viewport?: boolean }) => this.editor.getAIContext(opts),
      takeScreenshot: (box?: Box2d) => this.editor.takeScreenshot(box),
      select: (ids: string[]) => this.editor.setSelectedShapeIds(ids as any),
      getSmartRoutingSnapshot: () => this.editor.getSmartRoutingSnapshot(),
      getArrowRoutePoints: (id: string): Vec2[] | null => {
        const shape = this.editor.getShape(id as any);
        if (!shape || shape.type !== 'arrow') return null;
        return resolveArrowRoute(this.editor as any, shape as any).worldPoints;
      },
    };

    (window as any)[debugApiKey] = api;
    let active = true;
    const cleanup = () => {
      if (!active) return;
      active = false;
      if ((window as any)[debugApiKey] === api) {
        delete (window as any)[debugApiKey];
      }
      this.debugCleanups.delete(cleanup);
    };
    this.debugCleanups.add(cleanup);
    return cleanup;
  }

  dispose(options: GlideboardDisposeOptions = {}): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;

    this.stopDocumentChangeTracking();
    this.cancelPendingDocumentChange();

    const finishDisposal = () => {
      this.documentChangeHandler = null;
      this.documentDirty = false;
      this.documentSaveRetryAttempt = 0;
      this.detachCollaboration();
      this.detachPresence();
      for (const cleanup of [...this.debugCleanups]) cleanup();
      this.isCanvasDraggingRef.current = false;
      this.deferredToolRestoreRef.current = null;
      this.canvasElement = null;
    };

    if (options.pendingSave === 'flush') {
      this.disposalPromise = this.flush().finally(finishDisposal);
    } else {
      this.documentSaveAbortController?.abort();
      finishDisposal();
      this.disposalPromise = Promise.resolve();
    }

    return this.disposalPromise;
  }

  private scheduleDocumentChange(delayMs = this.documentChangeDebounceMs): void {
    this.cancelPendingDocumentChange();
    if (
      !this.documentChangeDispose ||
      !this.documentDirty ||
      !this.documentChangeHandler ||
      this.documentSaveInFlight
    ) {
      return;
    }

    const generation = this.documentChangeGeneration;
    this.documentChangeTimer = setTimeout(() => {
      if (generation !== this.documentChangeGeneration) return;
      this.documentChangeTimer = null;
      void this.startDocumentSave().catch(error => {
        console.error('[Glideboard] onDocumentChange failed:', error);
      });
    }, Math.max(0, delayMs));
  }

  private startDocumentSave(): Promise<void> {
    if (this.documentSaveInFlight) return this.documentSaveInFlight;
    if (!this.documentDirty || !this.documentChangeHandler) return Promise.resolve();

    const handler = this.documentChangeHandler;
    const document = this.editor.serialize();
    const trackingGeneration = this.documentTrackingGeneration;
    const abortController = new AbortController();
    this.documentSaveAbortController = abortController;
    this.documentDirty = false;
    let failed = false;

    let savePromise!: Promise<void>;
    savePromise = (async () => {
      try {
        await Promise.resolve().then(() => handler(document, { signal: abortController.signal }));
        if (trackingGeneration === this.documentTrackingGeneration) {
          this.documentSaveRetryAttempt = 0;
        }
      } catch (error) {
        failed = true;
        if (trackingGeneration === this.documentTrackingGeneration) {
          this.documentDirty = true;
          this.documentSaveRetryAttempt += 1;
        }
        throw error;
      } finally {
        if (this.documentSaveInFlight === savePromise) {
          this.documentSaveInFlight = null;
        }
        if (this.documentSaveAbortController === abortController) {
          this.documentSaveAbortController = null;
        }
        const shouldSchedule = Boolean(
          this.documentChangeDispose &&
          this.documentDirty &&
          this.documentChangeHandler
        );

        if (shouldSchedule && failed && this.documentSaveRetryAttempt <= MAX_AUTOMATIC_SAVE_RETRIES) {
          const baseDelay = Math.max(100, this.documentChangeDebounceMs);
          const retryDelay = Math.min(
            MAX_AUTOMATIC_RETRY_DELAY_MS,
            baseDelay * (2 ** (this.documentSaveRetryAttempt - 1)),
          );
          this.scheduleDocumentChange(retryDelay);
        } else if (shouldSchedule && !failed) {
          this.scheduleDocumentChange();
        }
      }
    })();

    this.documentSaveInFlight = savePromise;
    return savePromise;
  }

  private cancelPendingDocumentChange(): void {
    this.documentChangeGeneration += 1;
    if (this.documentChangeTimer) {
      clearTimeout(this.documentChangeTimer);
      this.documentChangeTimer = null;
    }
  }

  private releasePresenceBinding(binding: PresenceBinding): void {
    if (!binding.active) return;
    binding.active = false;
    binding.cleanupScheduled = false;

    const { awareness } = binding;
    if (awareness && awarenessPresenceOwners.get(awareness) === binding.owner) {
      awareness.setLocalStateField('cursor', null);
      awareness.setLocalStateField('user', null);
      awarenessPresenceOwners.delete(awareness);
    }

    if (this.presenceBinding === binding) {
      this.presenceBinding = null;
      this.awarenessSignal.value = null;
    }
  }
}
