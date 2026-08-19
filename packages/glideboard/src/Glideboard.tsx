import React from 'react';
import { WhiteboardApp } from './WhiteboardApp.js';
import { GlideboardController } from './GlideboardController.js';
import { GlideboardProvider } from './GlideboardContext.js';
import type { GlideboardHandle, GlideboardProps } from './types.js';

interface GlideboardSessionProps extends GlideboardProps {
  resolvedSessionKey: string;
  forwardedRef: React.ForwardedRef<GlideboardHandle>;
}

interface MountedGlideboardSessionProps extends GlideboardProps {
  controller: GlideboardController;
  forwardedRef: React.ForwardedRef<GlideboardHandle>;
}

function MountedGlideboardSession({
  controller,
  forwardedRef,
  collaboration,
  readOnly = false,
  assetLibraryProvider,
  toolbarLayout = 'split',
  onDocumentChange,
  documentChangeDebounceMs = 500,
  debugApiKey,
}: MountedGlideboardSessionProps) {
  React.useImperativeHandle(forwardedRef, () => ({
    get checkpoints() {
      return controller.getCollaborationCheckpoints();
    },
    serialize: () => controller.editor.serialize(),
    replaceDocument: (document) => controller.replaceDocument(document),
    getPages: () => controller.editor.getPageIds().map(id => controller.editor.getPage(id)!),
    getActivePageId: () => controller.editor.getActivePageId(),
    setActivePage: (pageId) => controller.editor.setActivePage(pageId),
    createPage: (name) => controller.editor.createPage(name),
    renamePage: (pageId, name) => controller.editor.renamePage(pageId, name),
    duplicatePage: (pageId) => controller.editor.duplicatePage(pageId),
    movePage: (pageId, direction) => controller.editor.movePage(pageId, direction),
    deletePage: (pageId) => controller.editor.deletePage(pageId),
    exportSvg: (options) => controller.exportSvgAtTarget(options),
    createPortableFragment: (options) => controller.createPortableFragment(options),
    pastePortableFragment: (fragment, options) => controller.pastePortableFragment(fragment, options),
    importSvg: (source) => controller.importSvg(source),
		importRaster: (bytes, declaredMimeType) => controller.importRaster(bytes, declaredMimeType),
		replaceAsset: (shapeId, request) => controller.replaceAsset(shapeId, request),
		downloadAsset: (recordId, signal, context) => controller.downloadAsset(recordId, signal, context),
		clearAssetImportHistory: () => controller.clearAssetImportHistory(),
    configureAssetPlacement: (config) => controller.configureAssetPlacement(config),
    getRecoverableTextDraft: () => controller.recoverableTextDraftSignal.peek(),
		setCurrentTool: (toolId) => controller.setCurrentTool(toolId),
		setReadOnly: (value) => controller.setReadOnly(value),
    settleActiveEdit: (policy) => controller.settleActiveEdit(policy),
    acquireMutationFence: (reason) => controller.acquireMutationFence(reason),
    captureProjectionTarget: () => controller.captureProjectionTarget(),
    flush: () => controller.flush(),
  }), [controller]);

  React.useEffect(() => {
    // Callback identity is live configuration, not session identity.
    controller.configureDocumentChanges(onDocumentChange, documentChangeDebounceMs);
  }, [controller, documentChangeDebounceMs, onDocumentChange]);

  React.useEffect(() => {
    controller.setReadOnly(readOnly);
  }, [controller, readOnly]);

  const collaborationDoc = collaboration?.doc;
  const collaborationProvider = collaboration?.provider;
  const collaborationUserId = collaboration?.user?.id;
  const collaborationUserName = collaboration?.user?.name;
  const collaborationUserColor = collaboration?.user?.color;
  const collaborationBoardIdentity = collaboration?.boardIdentity;
  const collaborationBootstrapRevision = collaboration?.bootstrapRevision;

  React.useEffect(() => {
    if (!collaborationDoc) return;
    return controller.attachCollaboration({
      doc: collaborationDoc,
      provider: collaborationProvider
        ? {
          synced: collaborationProvider.synced,
          awareness: collaborationProvider.awareness,
          on: collaborationProvider.on?.bind(collaborationProvider),
          off: collaborationProvider.off?.bind(collaborationProvider),
        }
        : null,
      user: collaborationUserId && collaborationUserName && collaborationUserColor
        ? {
          id: collaborationUserId,
          name: collaborationUserName,
          color: collaborationUserColor,
        }
        : null,
      boardIdentity: collaborationBoardIdentity,
      bootstrapRevision: collaborationBootstrapRevision,
    });
  }, [
    collaborationBoardIdentity,
    collaborationBootstrapRevision,
    collaborationDoc,
    collaborationProvider,
    collaborationUserColor,
    collaborationUserId,
    collaborationUserName,
    controller,
  ]);

  React.useEffect(() => controller.startDocumentChangeTracking(), [controller]);

  React.useEffect(() => {
    if (!debugApiKey) return;
    return controller.attachDebugApi(debugApiKey);
  }, [controller, debugApiKey]);

  return (
    <GlideboardProvider controller={controller}>
      <WhiteboardApp assetLibraryProvider={assetLibraryProvider} toolbarLayout={toolbarLayout} />
    </GlideboardProvider>
  );
}

function GlideboardSession({
  resolvedSessionKey,
  forwardedRef,
  initialDocument,
  initialDocumentDisposition,
  customShapes,
  assetStorage,
  assetResolutionContext,
  readOnly = false,
  pendingSaveOnUnmount = 'cancel',
  ...props
}: GlideboardSessionProps) {
  const startupOptionsRef = React.useRef({
    initialDocument,
    initialDocumentDisposition,
    customShapes,
    assetStorage,
    assetResolutionContext,
    readOnly,
  });
  const pendingSavePolicyRef = React.useRef(pendingSaveOnUnmount);
  pendingSavePolicyRef.current = pendingSaveOnUnmount;
  const [controller, setController] = React.useState<GlideboardController | null>(null);
  const [creationError, setCreationError] = React.useState<unknown>(null);

  React.useEffect(() => {
    let active = true;
    let ownedController: GlideboardController | null = null;

    // React 18 StrictMode discards the first render and replays mount effects.
    // Construct after that replay so plugins install exactly once and no
    // abandoned controller can leak plugin side effects.
    queueMicrotask(() => {
      if (!active) return;
      try {
        const startup = startupOptionsRef.current;
        ownedController = new GlideboardController({
          sessionKey: resolvedSessionKey,
          customShapes: startup.customShapes,
          initialDocument: startup.initialDocument,
          initialDocumentDisposition: startup.initialDocumentDisposition,
          readOnly: startup.readOnly,
          assetStorage: startup.assetStorage,
          assetResolutionContext: startup.assetResolutionContext,
        });
        setController(ownedController);
      } catch (error) {
        if (active) setCreationError(error);
      }
    });

    return () => {
      active = false;
      if (!ownedController) return;
      void ownedController.dispose({ pendingSave: pendingSavePolicyRef.current }).catch(error => {
        console.error('[Glideboard] failed to flush while disposing:', error);
      });
    };
  }, [resolvedSessionKey]);

  if (creationError) throw creationError;
  if (!controller) return null;

  return (
    <MountedGlideboardSession
      {...props}
      controller={controller}
      forwardedRef={forwardedRef}
      readOnly={readOnly}
    />
  );
}

const ForwardedGlideboard = React.forwardRef<GlideboardHandle, GlideboardProps>(
  function Glideboard({ sessionKey, ...props }, ref) {
    const generatedSessionKey = React.useId();
    const resolvedSessionKey = sessionKey ?? generatedSessionKey;
    return (
      <GlideboardSession
        key={resolvedSessionKey}
        {...props}
        sessionKey={sessionKey}
        resolvedSessionKey={resolvedSessionKey}
        forwardedRef={ref}
      />
    );
  },
);

/** A React 18-compatible callable surface around the forwardRef runtime component. */
export const Glideboard = ForwardedGlideboard as (
  props: GlideboardProps & React.RefAttributes<GlideboardHandle>
) => React.ReactElement<any, any> | null;
