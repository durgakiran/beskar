import React from 'react';
import { WhiteboardApp } from './WhiteboardApp';
import { GlideboardController } from './GlideboardController';
import { GlideboardProvider } from './GlideboardContext';
import type { GlideboardHandle, GlideboardProps } from './types';

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
  onDocumentChange,
  documentChangeDebounceMs = 500,
  debugApiKey,
}: MountedGlideboardSessionProps) {
  React.useImperativeHandle(forwardedRef, () => ({
    serialize: () => controller.editor.serialize(),
    replaceDocument: (document) => controller.replaceDocument(document),
    exportSvg: async (options) => {
      const shapeIds = options?.shapeIds
        ? [...options.shapeIds]
        : controller.editor.getShapes().map(shape => shape.id);
      return controller.editor.exportToSvg(shapeIds);
    },
    setCurrentTool: (toolId) => controller.setCurrentTool(toolId),
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

  React.useEffect(() => {
    if (!collaborationDoc) return;
    return controller.attachCollaboration({
      doc: collaborationDoc,
    });
  }, [collaborationDoc, controller]);

  React.useEffect(() => controller.attachPresence(
    collaborationProvider,
    collaborationUserId && collaborationUserName && collaborationUserColor
      ? {
          id: collaborationUserId,
          name: collaborationUserName,
          color: collaborationUserColor,
        }
      : null,
  ), [
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
      <WhiteboardApp />
    </GlideboardProvider>
  );
}

function GlideboardSession({
  resolvedSessionKey,
  forwardedRef,
  initialDocument,
  initialDocumentDisposition,
  customShapes,
  readOnly = false,
  pendingSaveOnUnmount = 'cancel',
  ...props
}: GlideboardSessionProps) {
  const startupOptionsRef = React.useRef({
    initialDocument,
    initialDocumentDisposition,
    customShapes,
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
