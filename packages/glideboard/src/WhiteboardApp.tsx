import React from 'react';
import { Canvas } from './Canvas.js';
import { ContextMenu } from './ContextMenu.js';
import { useGlideboardController } from './GlideboardContext.js';
import { PositionSizeBar, StylePanel } from './StylePanel.js';
import { wbTheme } from './theme.js';
import { Toolbar } from './Toolbar.js';
import { ZoomWidget, fitToScreen } from './ZoomWidget.js';
import { useSignalValue } from './useSignalValue.js';
import { BackToContentButton } from './BackToContentButton.js';
import { CollaborationCursors } from './CollaborationCursors.js';
import { LayersPanel } from './LayersPanel.js';
import { ContentIngressError, normalizeClipboardText, type ShapeId } from '@durgakiran/glideline';
import {
  AssetFileValidationError,
  AssetImportPanel,
  createAssetImportCorrelationToken,
  GLIDEBOARD_ASSET_ACCEPT,
  readAssetImportRequest,
  type AssetImportNotice,
} from './AssetImportPanel.js';
import { AssetsPanel, hasAssetDragType, readAssetDragData } from './AssetsPanel.js';
import type { AssetLibraryProvider } from './asset-library.js';
import type { GlideboardToolbarLayout } from './types.js';
import { AssetPlacementStatus } from './AssetPlacementStatus.js';
import { getShortcutEventPath, shouldIgnoreGlideboardShortcuts } from './shortcut-guards.js';
import { PageTabs } from './PageTabs.js';

const TOOL_KEYS: Record<string, string> = {
  v: 'select',
  h: 'hand',
  r: 'box',
  e: 'ellipse',
  t: 'text',
  s: 'sticky-note',
  d: 'draw',
  x: 'eraser',
  a: 'arrow',
  f: 'frame',
};

// Keep page support in the document model while the page navigation UI is deferred.
const PAGE_TABS_ENABLED = false;

export function WhiteboardApp({
  assetLibraryProvider,
  toolbarLayout = 'split',
}: {
  assetLibraryProvider?: AssetLibraryProvider;
  toolbarLayout?: GlideboardToolbarLayout;
}) {
  const controller = useGlideboardController();
  const editor = controller.editor;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const focusReturnRef = React.useRef<HTMLElement | null>(null);
  const pickerOpenRef = React.useRef(false);
  const dragDepthRef = React.useRef(0);
  const shapeCount = useSignalValue(editor.getCurrentPageShapeIdsSignal())?.length ?? 0;
  const camera = useSignalValue(editor.camera.signal);
  const readOnly = useSignalValue(controller.readOnlySignal) ?? false;
  const assetImportJobs = useSignalValue(controller.assetImportJobsSignal) ?? [];
  const assetPlacement = useSignalValue(controller.assetPlacementSignal) ?? null;
  const [contextMenuPosition, setContextMenuPosition] = React.useState<{ x: number; y: number } | null>(null);
  const [layersOpen, setLayersOpen] = React.useState(false);
  const [assetsOpen, setAssetsOpen] = React.useState(false);
  const [isFileDragActive, setIsFileDragActive] = React.useState(false);
  const [importNotices, setImportNotices] = React.useState<readonly AssetImportNotice[]>([]);
  const [latestImportCorrelationToken, setLatestImportCorrelationToken] = React.useState<string | null>(null);
  const nextNoticeIdRef = React.useRef(0);
  const recordRecentQueueRef = React.useRef<Promise<void>>(Promise.resolve());

  const isSpacebarHeldRef = React.useRef(false);
  const previousToolRef = React.useRef<string | null>(null);

  const addImportNotice = React.useCallback((name: string, error: unknown, recoveryMessage?: string, correlationToken = createAssetImportCorrelationToken()) => {
    const category = error instanceof AssetFileValidationError ? error.category : 'unknown';
    const message = error instanceof Error ? error.message : 'Unable to prepare this image.';
    setImportNotices(current => [...current, {
      id: `asset-import-notice:${++nextNoticeIdRef.current}`,
      name,
      category,
      message,
      recoveryMessage,
      correlationToken,
    }]);
  }, []);

  const dismissImportNotice = React.useCallback((id: string) => {
    setImportNotices(current => current.filter(notice => notice.id !== id));
  }, []);

  const closeAssets = React.useCallback(() => {
    setAssetsOpen(false);
    controller.getCanvasElement()?.focus();
  }, [controller]);

  const recordCatalogRecent = React.useCallback((itemId: string, displayName: string) => {
    if (!assetLibraryProvider) return;
    const operation = new AbortController();
    const update = recordRecentQueueRef.current
      .catch(() => undefined)
      .then(() => assetLibraryProvider.recordRecent(itemId, operation.signal));
    recordRecentQueueRef.current = update;
    void update
      .catch(error => addImportNotice(
        `Unable to update recent assets for ${displayName}`,
        error,
        'The asset was placed. Dismiss this message and reopen Assets to continue.',
      ));
  }, [addImportNotice, assetLibraryProvider]);

  const importFiles = React.useCallback(async (files: readonly File[], origin?: { x: number; y: number }) => {
    if (readOnly || files.length === 0) return;
    setLayersOpen(false);
    setAssetsOpen(false);
    const viewport = editor.camera.getViewportBounds();
    const anchor = origin ?? { x: viewport.x + viewport.w / 2 - 160, y: viewport.y + viewport.h / 2 - 120 };
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      const correlationToken = createAssetImportCorrelationToken();
      setLatestImportCorrelationToken(correlationToken);
      try {
        const point = { x: anchor.x + index * 24, y: anchor.y + index * 24 };
        const request = await readAssetImportRequest(file, point, controller.assetLimits, correlationToken);
        void controller.queueAssetImport(request).result.catch(() => undefined);
      } catch (error) {
        addImportNotice(file.name || 'Image', error, undefined, correlationToken);
      }
    }
  }, [addImportNotice, controller, editor, readOnly]);

  const requestAssetImport = React.useCallback((trigger: HTMLElement) => {
    if (readOnly) return;
    focusReturnRef.current = trigger;
    pickerOpenRef.current = true;
    fileInputRef.current?.click();
  }, [readOnly]);

  const restoreImportFocus = React.useCallback(() => {
    if (!pickerOpenRef.current) return;
    pickerOpenRef.current = false;
    const target = focusReturnRef.current;
    focusReturnRef.current = null;
    requestAnimationFrame(() => target?.focus());
  }, []);

  React.useEffect(() => {
    const handleWindowFocus = () => {
      if (pickerOpenRef.current) window.setTimeout(restoreImportFocus, 0);
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, [restoreImportFocus]);

  React.useEffect(() => {
    if (!readOnly) return;
    dragDepthRef.current = 0;
    setIsFileDragActive(false);
    for (const job of controller.assetImportJobsSignal.peek()) {
      if (job.status === 'queued' || job.status === 'uploading') controller.cancelAssetImport(job.id);
    }
  }, [controller, readOnly]);

  React.useEffect(() => {
    if (readOnly) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      const path = getShortcutEventPath(event);
      if (!root || (!path.includes(root) && !(event.target instanceof Node && root.contains(event.target)))) return;
      if (shouldIgnoreGlideboardShortcuts(event) || editor.editingShapeId.peek()) return;

      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();

        if (isSpacebarHeldRef.current) return;
        isSpacebarHeldRef.current = true;

        const currentTool = editor.currentToolId.peek();
        if (currentTool !== 'hand') {
          previousToolRef.current = currentTool === 'asset' ? 'select' : currentTool;
          editor.setCurrentTool('hand', { preserveSelection: true });
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        if (!isSpacebarHeldRef.current && shouldIgnoreGlideboardShortcuts(event)) return;
        if (isSpacebarHeldRef.current) {
          event.preventDefault();
          isSpacebarHeldRef.current = false;
          if (previousToolRef.current) {
            if (controller.isCanvasDraggingRef.current) {
              // Pointer is still captured — defer restoration until pointerUp fires
              controller.deferredToolRestoreRef.current = previousToolRef.current;
            } else {
              editor.setCurrentTool(previousToolRef.current);
            }
            previousToolRef.current = null;
          }
        }
      }
    };

    const handleBlur = () => {
      if (isSpacebarHeldRef.current) {
        isSpacebarHeldRef.current = false;
        if (previousToolRef.current) {
          if (controller.isCanvasDraggingRef.current) {
            controller.deferredToolRestoreRef.current = previousToolRef.current;
          } else {
            editor.setCurrentTool(previousToolRef.current);
          }
          previousToolRef.current = null;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
      window.removeEventListener('blur', handleBlur);
    };
  }, [controller, editor, readOnly]);

  const onContextMenu = (event: React.MouseEvent) => {
    if (readOnly) return;
    event.preventDefault();
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const writePortableSelection = async (ids: readonly ShapeId[]) => {
    const fragment = await controller.createPortableFragment({ shapeIds: [...ids] });
    if (!fragment) return;
    const serialized = JSON.stringify(fragment);
    const text = (fragment.records ?? [])
      .filter(record => record.kind === 'shape' && typeof (record.props as Record<string, unknown> | undefined)?.['text'] === 'string')
      .map(record => String((record.props as Record<string, unknown>)['text']))
      .join('\n');
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          [PORTABLE_CLIPBOARD_MIME]: new Blob([serialized], { type: PORTABLE_CLIPBOARD_MIME }),
          'text/html': new Blob([`<p>${escaped.replace(/\n/g, '<br>')}</p>`], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
        return;
      } catch {
        // Some browsers reject custom MIME types; retain the portable text fallback.
      }
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${PORTABLE_CLIPBOARD_PREFIX}${serialized}`);
    }
  };

  const copyPortableSelection = (ids: readonly ShapeId[]) => {
    editor.copy([...ids]);
    return writePortableSelection(ids);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (shouldIgnoreGlideboardShortcuts(event)) return;
    if (editor.editingShapeId.peek()) return;

    if (!readOnly) {
      const toolId = TOOL_KEYS[event.key.toLowerCase()];
      if (toolId && !event.metaKey && !event.ctrlKey && !event.altKey) {
        editor.setCurrentTool(toolId);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !event.metaKey) {
        const ids = editor.getSelectedShapeIds();
        if (ids.length > 0) {
          event.preventDefault();
          editor.batch('Delete Shapes', () => editor.deleteShapes(ids));
        }
      }

      if (event.key.startsWith('Arrow')) {
        const ids = editor.getSelectedShapeIds();
        if (ids.length > 0) {
          event.preventDefault();
          const amount = event.shiftKey ? 10 : 1;
          const delta = event.key === 'ArrowLeft' ? { x: -amount, y: 0 }
            : event.key === 'ArrowRight' ? { x: amount, y: 0 }
            : event.key === 'ArrowUp' ? { x: 0, y: -amount }
            : { x: 0, y: amount };
          editor.nudgeShapes(ids, delta);
        }
      }

      if (event.metaKey || event.ctrlKey) {
        const ids = editor.getSelectedShapeIds();
        if (event.key.toLowerCase() === 'a') {
          event.preventDefault();
          editor.selectAll();
        } else if (event.key === 'c' && ids.length > 0) {
          event.preventDefault();
          void copyPortableSelection(ids).catch(error => {
            console.warn('[Glideboard] Unable to write portable clipboard data', error);
          });
        } else if (event.key === 'x' && ids.length > 0) {
          event.preventDefault();
          let portableWrite = Promise.resolve();
          editor.batch('Cut Shapes', () => {
            editor.copy([...ids]);
            portableWrite = writePortableSelection(ids);
            editor.deleteShapes(ids);
          });
          void portableWrite.catch(error => {
            console.warn('[Glideboard] Unable to write portable clipboard data', error);
          });
        } else if (event.key === 'd' && ids.length > 0) {
          event.preventDefault();
          editor.duplicateShapes(ids, { x: 20, y: 20 });
        } else if (event.key.toLowerCase() === 'g' && ids.length > 0) {
          event.preventDefault();
          if (event.shiftKey) editor.ungroupShapes(ids);
          else if (ids.length >= 2) editor.groupShapes(ids);
        } else if (event.key.toLowerCase() === 'l' && ids.length > 0) {
          event.preventDefault();
          const lock = !ids.every(id => editor.getShape(id)?.isLocked);
          editor.setLocked(ids, lock);
        } else if (event.key.toLowerCase() === 'h' && event.shiftKey && ids.length > 0) {
          event.preventDefault();
          const hide = !ids.every(id => editor.getShape(id)?.isHidden);
          editor.setHidden(ids, hide);
        } else if (event.key === ']' && ids.length > 0) {
          event.preventDefault();
          editor.reorderShapes(ids, event.shiftKey ? 'front' : 'forward');
        } else if (event.key === '[' && ids.length > 0) {
          event.preventDefault();
          editor.reorderShapes(ids, event.shiftKey ? 'back' : 'backward');
        }
      }

      if (event.key === 'Escape') {
        editor.setCurrentTool('select');
        editor.setSelectedShapeIds([]);
      }

      if (!readOnly && event.key === 'z' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
      }
    }

    if (event.key === '1' && event.shiftKey) {
      fitToScreen(controller);
    }
  };

  const onPaste = (event: React.ClipboardEvent) => {
    if (shouldIgnoreGlideboardShortcuts(event)) return;
    if (editor.editingShapeId.peek()) return;
    const clipboard = event.clipboardData;
    const svg = clipboard.getData('image/svg+xml');
    const html = clipboard.getData('text/html');
    const text = clipboard.getData('text/plain');
    const privateFragment = clipboard.getData(PORTABLE_CLIPBOARD_MIME);
    if (privateFragment || text.startsWith(PORTABLE_CLIPBOARD_PREFIX)) {
      event.preventDefault();
      if (readOnly) return;
      try {
        const fragment = JSON.parse(privateFragment || text.slice(PORTABLE_CLIPBOARD_PREFIX.length));
        void controller.pastePortableFragment(fragment).catch(error => {
          console.warn('[Glideboard] Unable to paste portable clipboard data', error);
        });
      } catch (error) {
        console.warn('[Glideboard] Invalid portable clipboard data', error);
      }
      return;
    }
    const svgSource = svg || (/^\s*<svg[\s>]/i.test(html) ? html : '');
    const imageFiles = Array.from(clipboard.files);

    if (readOnly && (svgSource || imageFiles.length > 0)) {
      event.preventDefault();
      addImportNotice('Image import blocked', new AssetFileValidationError('permission', 'This board is read-only.'));
      return;
    }

    if (svgSource) {
      event.preventDefault();
      const blob = new File([svgSource], 'Pasted SVG.svg', { type: 'image/svg+xml' });
      void importFiles([blob]);
      return;
    }
    if (imageFiles.length > 0) {
      event.preventDefault();
      void importFiles(imageFiles);
      return;
    }
    if (html || text) {
      event.preventDefault();
      try {
        controller.importPlainText(normalizeClipboardText({ html, text }));
      } catch (error) {
        const message = error instanceof ContentIngressError
          ? error.message
          : 'Unable to import clipboard content';
        console.warn(`[Glideboard] ${message}`);
      }
      return;
    }

    // No external clipboard representation: preserve Glideboard's in-memory copy/paste.
    event.preventDefault();
    editor.paste();
  };

  return (
    <div
      ref={rootRef}
      id={controller.domId('app')}
      data-glideboard-role="app"
      data-toolbar-layout={toolbarLayout}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        outline: 'none',
        overflow: 'hidden',
        background: wbTheme.appBg,
        '--glideboard-floating-panel-top': toolbarLayout === 'split' ? '80px' : '12px',
      } as React.CSSProperties}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onContextMenu={onContextMenu}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        if (readOnly) return;
        dragDepthRef.current += 1;
        setIsFileDragActive(true);
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes('Files') && !hasAssetDragType(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = readOnly ? 'none' : 'copy';
      }}
      onDragLeave={event => {
        if (!event.dataTransfer.types.includes('Files') || readOnly) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsFileDragActive(false);
      }}
      onDrop={event => {
        const fileDrag = event.dataTransfer.types.includes('Files');
        const payload = fileDrag ? null : readAssetDragData(event.dataTransfer);
        const libraryDrag = payload !== null;
        if (!fileDrag && !libraryDrag) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsFileDragActive(false);
        if (readOnly) {
          if (libraryDrag) return;
          addImportNotice('Image import blocked', new AssetFileValidationError('permission', 'This board is read-only.'));
          return;
        }
        const canvas = controller.getCanvasElement();
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const point = editor.screenToPage({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        if (payload) {
          if (!assetLibraryProvider || payload.providerId !== assetLibraryProvider.id) return;
          controller.configureAssetPlacement({
            displayName: payload.displayName,
            selection: payload.selection,
            materializer: request => assetLibraryProvider.materialize(request),
            callbacks: {
              onPlaced: () => {
                recordCatalogRecent(payload.selection.itemId, payload.displayName);
              },
            },
          });
          editor.dispatchEvent({ type: 'pointerDown', point, shiftKey: false, target: 'canvas' });
          editor.dispatchEvent({ type: 'pointerUp', point });
          closeAssets();
          return;
        }
        void importFiles(Array.from(event.dataTransfer.files), point);
      }}
    >
      <style>{`
        @keyframes glideboard-placement-spin { to { transform: rotate(360deg); } }
        [data-glideboard-role="asset-placement-status"][data-placement-status="pending"] > span:first-child svg {
          animation: glideboard-placement-spin 900ms linear infinite;
        }
        @media (max-width: 600px) {
          [data-glideboard-toolbar-part="actions"] {
            top: 8px !important;
            left: 8px !important;
            right: 8px !important;
            max-width: none !important;
            padding: 4px !important;
            border-radius: 8px !important;
            gap: 2px !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
          }
          [data-glideboard-role="toolbar-tools"] {
            top: 66px !important;
            left: 8px !important;
            right: 8px !important;
            max-height: 54px !important;
            padding: 4px !important;
            border-radius: 8px !important;
            flex-direction: row !important;
            gap: 2px !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            scrollbar-width: thin;
          }
          [data-glideboard-role="toolbar-tools"] > * { flex: 0 0 auto; }
          [data-glideboard-role="toolbar-separator"] {
            width: 1px !important;
            height: 32px !important;
            margin: 6px 2px !important;
          }
          [data-glideboard-role="shape-picker"],
          [data-glideboard-role="arrow-picker"] {
            position: fixed !important;
            top: 126px !important;
            left: 8px !important;
            max-width: calc(100vw - 16px);
          }
          [data-glideboard-role="style-panel-host"] > * {
            top: 126px !important;
            right: 8px !important;
            max-width: calc(100% - 16px) !important;
            max-height: calc(100% - 182px) !important;
          }
          [data-glideboard-role="position-size-bar"] {
            left: 8px !important;
            right: 8px !important;
            width: auto !important;
            max-width: none !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
          }
          [data-glideboard-role="style-panel-host"]:has([data-glideboard-role="position-size-bar"])
            > [data-glideboard-role="selected-style-panel"] {
            top: 174px !important;
            max-height: calc(100% - 230px) !important;
          }
          [data-glideboard-role="layers-panel"] {
            top: 126px !important;
            left: 8px !important;
            right: 8px !important;
            bottom: 104px !important;
            width: auto !important;
          }
          [data-glideboard-role="assets-panel"] {
            top: 126px !important;
            left: 8px !important;
            right: 8px !important;
            bottom: 104px !important;
            width: auto !important;
            max-width: none !important;
          }
          [data-glideboard-role="asset-placement-status"] {
            top: 126px !important;
          }
          [data-glideboard-role="toolbar"][data-toolbar-layout="vertical"] [data-glideboard-role="toolbar-tools"] {
            top: 8px !important;
          }
          [data-glideboard-role="app"][data-toolbar-layout="vertical"] [data-glideboard-role="style-panel-host"] > *,
          [data-glideboard-role="app"][data-toolbar-layout="vertical"] [data-glideboard-role="layers-panel"],
          [data-glideboard-role="app"][data-toolbar-layout="vertical"] [data-glideboard-role="assets-panel"],
          [data-glideboard-role="app"][data-toolbar-layout="vertical"] [data-glideboard-role="asset-placement-status"] {
            top: 66px !important;
          }
          [data-glideboard-role="asset-import-panel"] {
            right: 8px !important;
            bottom: 104px !important;
            width: calc(100% - 16px) !important;
            max-width: none !important;
            max-height: min(300px, calc(100% - 130px)) !important;
          }
          [data-glideboard-role="zoom-widget"] {
            right: 8px !important;
            bottom: 8px !important;
          }
          [data-glideboard-role="page-tabs"] {
            left: 8px !important;
            right: 8px !important;
            bottom: 56px !important;
          }
          [data-glideboard-role="statusbar"] {
            left: 8px !important;
            bottom: 8px !important;
            transform: none !important;
            padding: 4px 8px !important;
          }
          [data-glideboard-role="status-zoom"],
          [data-glideboard-role="status-help"] { display: none; }
        }
      `}</style>
      <input
        ref={fileInputRef}
        data-glideboard-role="asset-file-input"
        data-asset-import-correlation={latestImportCorrelationToken ?? undefined}
        type="file"
        accept={GLIDEBOARD_ASSET_ACCEPT}
        multiple
        aria-label="Choose images to import"
        style={{ display: 'none' }}
        onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void importFiles(files).finally(restoreImportFocus);
        }}
      />
      <Canvas />
      {isFileDragActive ? (
        <div data-glideboard-role="asset-drop-highlight" aria-hidden style={{
          position: 'absolute', inset: 8, zIndex: 90, pointerEvents: 'none',
          display: 'grid', placeItems: 'center', border: `2px dashed ${wbTheme.accent}`,
          borderRadius: 8, background: wbTheme.accentSurface, color: wbTheme.accentText,
          fontSize: 14, fontWeight: 650,
        }}>Drop images to import</div>
      ) : null}
      <CollaborationCursors />
      {assetPlacement ? (
        <AssetPlacementStatus
          placement={assetPlacement}
          onCancel={() => controller.cancelAssetPlacement()}
          onRetry={() => controller.retryAssetPlacement()}
        />
      ) : null}
      {(!readOnly || assetLibraryProvider) ? <Toolbar
        layout={toolbarLayout}
        readOnly={readOnly}
        layersOpen={layersOpen}
        assetsOpen={assetsOpen}
        assetsAvailable={Boolean(assetLibraryProvider)}
        onToggleLayers={() => {
          setAssetsOpen(false);
          setLayersOpen(open => !open);
        }}
        onToggleAssets={() => {
          setLayersOpen(false);
          setAssetsOpen(open => !open);
        }}
        onRequestAssetImport={requestAssetImport}
      /> : null}
      {layersOpen ? <LayersPanel /> : null}
      {assetsOpen && assetLibraryProvider ? (
        <AssetsPanel
          key={getAssetProviderIdentity(assetLibraryProvider)}
          provider={assetLibraryProvider}
          readOnly={readOnly}
          onRequestClose={closeAssets}
          onPlaced={item => recordCatalogRecent(item.id, item.name)}
        />
      ) : null}
      <ZoomWidget />
      {PAGE_TABS_ENABLED ? <PageTabs /> : null}
      {!readOnly && !layersOpen && !assetsOpen ? (
        <div data-glideboard-role="style-panel-host" style={{ display: 'contents' }}>
          <PositionSizeBar />
          <StylePanel />
        </div>
      ) : null}
      <AssetImportPanel
        notices={importNotices}
        onDismissNotice={dismissImportNotice}
      />
      {!readOnly ? (
        <ContextMenu position={contextMenuPosition} onClose={() => setContextMenuPosition(null)} />
      ) : null}
      <BackToContentButton />
      <div
        id={controller.domId('statusbar')}
        data-glideboard-role="statusbar"
        style={{
          position: 'absolute',
          bottom: PAGE_TABS_ENABLED ? 62 : 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          background: wbTheme.surface,
          border: `1px solid ${wbTheme.border}`,
          borderRadius: 10,
          padding: '4px 12px',
          fontSize: 11,
          color: wbTheme.textSoft,
          fontFamily: 'inherit',
          pointerEvents: 'none',
          userSelect: 'none',
          boxShadow: wbTheme.statusShadow,
        }}
      >
        {shapeCount} shape{shapeCount !== 1 ? 's' : ''}
        <span data-glideboard-role="status-zoom">{camera && ` · ${Math.round(camera.z * 100)}%`}</span>
        {readOnly ? (
          <span style={{ color: wbTheme.accentText }}> · Read-only</span>
        ) : (
          <span data-glideboard-role="status-help" style={{ color: wbTheme.accentText }}> · Double-click to edit labels</span>
        )}
      </div>
    </div>
  );
}

const assetProviderIdentities = new WeakMap<AssetLibraryProvider, number>();
let nextAssetProviderIdentity = 1;

function getAssetProviderIdentity(provider: AssetLibraryProvider): number {
  const existing = assetProviderIdentities.get(provider);
  if (existing !== undefined) return existing;
  const identity = nextAssetProviderIdentity++;
  assetProviderIdentities.set(provider, identity);
  return identity;
}
const PORTABLE_CLIPBOARD_PREFIX = 'application/x-glideboard-fragment+json\n';
const PORTABLE_CLIPBOARD_MIME = 'application/x-glideboard-fragment+json';
