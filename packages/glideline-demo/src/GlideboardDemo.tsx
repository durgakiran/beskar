import React from 'react';
import {
  createAssetLibraryProvider,
  createSvgPathShape,
  Glideboard,
  type AssetLibraryGroup,
  type AssetLibraryItem,
  type AssetLibraryProvider,
  type GlideboardHandle,
} from '@durgakiran/glideboard';
import { aid, type GlideAsset, type GlideDocument } from '@durgakiran/glideline';
import { createDemoAssetStorage, DEMO_RASTER_QUOTA_BYTES } from './demo-asset-storage';

const STORAGE_KEY = 'glideline-whiteboard-v1';
const SESSION_KEY = 'glideline-whiteboard-demo';
const FAVORITES_KEY = 'glideline-whiteboard-demo-asset-favorites';
const RECENTS_KEY = 'glideline-whiteboard-demo-asset-recents';
const P3_C6_SOURCE_SESSION_KEY = 'glideline-p3-c6-source';
const P3_C6_DESTINATION_SESSION_KEY = 'glideline-p3-c6-destination';
const P3_C6_SOURCE_STORAGE_KEY = 'glideline-p3-c6-source-raster-bytes-v1';
const P3_C6_DESTINATION_STORAGE_KEY = 'glideline-p3-c6-destination-raster-bytes-v1';
const P3_C6_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

type AcceptanceBoardState = {
  recordCount: number;
  shapeCount: number;
  assetCount: number;
  rasterShapeCount: number;
  assets: Array<{ id: string; type: string; resolvedUrls: string[] }>;
};

type PortableRequestEvidence = {
  sequence: number;
  board?: 'source' | 'destination';
  operation: 'createPortableFragment' | 'pastePortableFragment' | 'exportSvg';
  shapeIds?: string[];
  point?: { x: number; y: number };
  context?: import('@durgakiran/glideline').AssetResolutionContext;
};

type CrossBoardAcceptanceResult = {
  source: AcceptanceBoardState;
  destination: AcceptanceBoardState;
  renderedAssetUrlState: {
    source: Array<{ assetId: string; urls: string[]; allBlobUrls: boolean }>;
    destination: Array<{ assetId: string; urls: string[]; allBlobUrls: boolean }>;
  };
  svg: { containsEmbeddedPng: boolean; containsBlobUrl: boolean; length: number };
  requests: PortableRequestEvidence[];
};

declare global {
  interface Window {
    __GLIDELINE_PORTABLE_EXPORT__?: unknown;
    __GLIDELINE_P3_C6__?: {
      getAcceptanceState(): AcceptanceBoardState;
      createPortableFragment(shapeIds: string[], context?: import('@durgakiran/glideline').AssetResolutionContext): Promise<unknown>;
      pastePortableFragment(fragment: import('@durgakiran/glideline').PortableBoardFragment, point?: { x: number; y: number }): Promise<string[]>;
      exportSvg(shapeIds?: string[], context?: import('@durgakiran/glideline').AssetResolutionContext): Promise<string>;
      flush(): Promise<void>;
      resetDestination(): Promise<void>;
      getRequestEvidence(): PortableRequestEvidence[];
      runCrossBoardAcceptance(): Promise<CrossBoardAcceptanceResult>;
      getLastCrossBoardAcceptance(): CrossBoardAcceptanceResult | null;
    };
  }
}

function inspectAcceptanceBoard(
  board: GlideboardHandle | null,
  root: HTMLElement | null,
): AcceptanceBoardState {
  const records = board?.serialize().records ?? [];
  const rasterShapes = records.filter(record => record.kind === 'shape' && record.type === 'raster-image');
  const assets = records.filter(record => record.kind === 'asset').map(record => ({
    id: String(record.id),
    type: String(record.type),
    resolvedUrls: rasterShapes
      .filter(shape => ((shape as unknown as Record<string, unknown>)['props'] as Record<string, unknown>)['assetId'] === record.id)
      .map(shape => root?.querySelector(`[data-shape-id="${CSS.escape(String(shape.id))}"] image`)?.getAttribute('href'))
      .filter((url): url is string => Boolean(url)),
  }));
  return {
    recordCount: records.length,
    shapeCount: records.filter(record => record.kind === 'shape').length,
    assetCount: assets.length,
    rasterShapeCount: rasterShapes.length,
    assets,
  };
}

async function waitForRenderedRaster(
  readState: () => AcceptanceBoardState,
  expectedCount: number,
): Promise<AcceptanceBoardState> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = readState();
    if (state.assets.reduce((count, asset) => count + asset.resolvedUrls.length, 0) === expectedCount) return state;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  throw new Error('Timed out waiting for acceptance raster URLs to render.');
}

function renderedUrlState(state: AcceptanceBoardState) {
  return state.assets.map(asset => ({
    assetId: asset.id,
    urls: [...asset.resolvedUrls],
    allBlobUrls: asset.resolvedUrls.length > 0 && asset.resolvedUrls.every(url => url.startsWith('blob:')),
  }));
}

const DEMO_GROUPS: readonly AssetLibraryGroup[] = [
  { id: 'my-shapes', providerId: 'demo-catalog', name: 'My Shapes', kind: 'personal', installed: true },
  { id: 'team-library', providerId: 'demo-catalog', name: 'Team Library', kind: 'team', installed: true },
  { id: 'aws', providerId: 'demo-catalog', name: 'AWS', kind: 'vendor', installed: true, sourceVersion: '2026.04' },
  { id: 'azure', providerId: 'demo-catalog', name: 'Azure', kind: 'vendor', installed: true, sourceVersion: '2026.06' },
  { id: 'google-cloud', providerId: 'demo-catalog', name: 'Google Cloud', kind: 'vendor', installed: true, sourceVersion: '2026.05' },
  { id: 'kubernetes', providerId: 'demo-catalog', name: 'Kubernetes', kind: 'vendor', installed: true, sourceVersion: '1.35' },
];

function thumbnail(label: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="96" viewBox="0 0 160 96"><rect width="160" height="96" rx="8" fill="#f8fafc"/><rect x="47" y="15" width="66" height="66" rx="14" fill="${color}"/><text x="80" y="57" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="white">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function catalogItem(
  id: string,
  name: string,
  groupId: string,
  sourceVersion: string,
  license: string,
  label: string,
  color: string,
  availability: AssetLibraryItem['availability'] = 'available',
): AssetLibraryItem {
  return {
    id, providerId: 'demo-catalog', sourceLibraryId: groupId, sourceVersion, name,
    mediaType: 'svg', width: 160, height: 96, license, thumbnailUrl: thumbnail(label, color),
    groupIds: [groupId], availability, isFavorite: false,
    metadata: { category: 'Architecture', vendor: groupId },
  };
}

const DEMO_ASSETS: readonly AssetLibraryItem[] = [
  catalogItem('mine:decision', 'Decision gateway', 'my-shapes', '3', 'Private workspace', 'D', '#0f766e'),
  catalogItem('team:service', 'Platform service', 'team-library', '12', 'Internal use', 'PS', '#7c3aed'),
  catalogItem('team:legacy', 'Legacy team mark', 'team-library', '4', 'Internal use', '!', '#64748b', 'missing'),
  catalogItem('aws:lambda', 'AWS Lambda', 'aws', '2026.04', 'AWS Architecture Icons License', 'L', '#ed7100'),
  catalogItem('azure:functions', 'Azure Functions', 'azure', '2026.06', 'Microsoft Trademark Guidelines', 'Fn', '#0078d4'),
  catalogItem('gcp:cloud-run', 'Google Cloud Run', 'google-cloud', '2026.05', 'Google Cloud Brand Guidelines', 'CR', '#4285f4'),
  catalogItem('k8s:service', 'Kubernetes Service', 'kubernetes', '1.35', 'Apache-2.0', 'K8s', '#326ce5'),
];

function readStoredIds(key: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function demoAssetRecord(item: AssetLibraryItem): { asset: GlideAsset; contentHash: string } {
  const itemIndex = DEMO_ASSETS.findIndex(candidate => candidate.id === item.id);
  const contentHash = 'abcdef'[(itemIndex + 2) % 6]!.repeat(64);
  return {
    contentHash,
    asset: {
      id: aid(`asset:sha256:${contentHash}`), kind: 'asset', type: 'sanitized-svg', schemaVersion: 1,
      props: {
        hash: contentHash, mimeType: 'image/svg+xml', sanitizerVersion: 1, byteLength: 64,
        width: item.width, height: item.height, viewBox: [0, 0, item.width, item.height],
        paths: [{ d: `M8 8 L${item.width - 8} 8 L${item.width - 8} ${item.height - 8} L8 ${item.height - 8} Z` }],
      },
      meta: {},
    },
  };
}

function holdCatalogRequest(signal: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException('Catalog request cancelled', 'AbortError'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export function createDemoAssetLibraryProvider(options: {
  loading?: boolean;
  failFirstSearch?: boolean;
  consumePlacementFailure?: () => boolean;
  beforeMaterialize?: (signal: AbortSignal) => Promise<void>;
} = {}): AssetLibraryProvider {
  let failNextSearch = Boolean(options.failFirstSearch);
  const beforeRead = async (signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException('Catalog request cancelled', 'AbortError');
    if (options.loading) await holdCatalogRequest(signal);
  };
  return createAssetLibraryProvider({
    id: 'demo-catalog',
    async search({ query, groupIds, signal }) {
      await beforeRead(signal);
      if (failNextSearch) {
        failNextSearch = false;
        throw new Error('Demo catalog is unavailable.');
      }
      const needle = query.trim().toLowerCase();
      const groups = groupIds ? new Set(groupIds) : null;
      return {
        items: DEMO_ASSETS.filter(item => (!groups || item.groupIds.some(id => groups.has(id)))
          && (!needle || `${item.name} ${item.sourceLibraryId} ${item.license}`.toLowerCase().includes(needle))),
      };
    },
    async getGroups(signal) {
      await beforeRead(signal);
      return DEMO_GROUPS;
    },
    async getFavorites(signal) {
      await beforeRead(signal);
      const ids = new Set(readStoredIds(FAVORITES_KEY));
      return DEMO_ASSETS.filter(item => ids.has(item.id)).map(item => ({ ...item, isFavorite: true }));
    },
    async setFavorite(itemId, favorite, signal) {
      if (signal.aborted) throw new DOMException('Favorite update cancelled', 'AbortError');
      const ids = new Set(readStoredIds(FAVORITES_KEY));
      if (favorite) ids.add(itemId); else ids.delete(itemId);
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
    },
    async getRecents(signal) {
      await beforeRead(signal);
      const byId = new Map(DEMO_ASSETS.map(item => [item.id, item]));
      return readStoredIds(RECENTS_KEY).map(id => byId.get(id)).filter((item): item is AssetLibraryItem => Boolean(item));
    },
    async recordRecent(itemId, signal) {
      if (signal.aborted) throw new DOMException('Recent update cancelled', 'AbortError');
      const ids = [itemId, ...readStoredIds(RECENTS_KEY).filter(id => id !== itemId)].slice(0, 12);
      window.localStorage.setItem(RECENTS_KEY, JSON.stringify(ids));
    },
    async getInstallations(signal) {
      await beforeRead(signal);
      return DEMO_GROUPS.map(group => ({
        libraryId: group.id, providerId: 'demo-catalog', sourceVersion: group.sourceVersion ?? 'current', status: 'installed' as const,
      }));
    },
    async install(libraryId) {
      return { libraryId, providerId: 'demo-catalog', sourceVersion: 'current', status: 'installed' };
    },
    async getRetainedDependencies() { return []; },
    async resolveRetainedDependency() { throw new Error('The demo has no retained catalog dependencies.'); },
    async removeInstallation() { throw new Error('Demo catalog groups cannot be removed.'); },
    async materialize(request) {
      if (request.signal.aborted) throw new DOMException('Asset placement cancelled', 'AbortError');
      await options.beforeMaterialize?.(request.signal);
      if (request.signal.aborted) throw new DOMException('Asset placement cancelled', 'AbortError');
      if (options.consumePlacementFailure?.()) {
        throw new Error('Demo asset placement failed.');
      }
      const item = DEMO_ASSETS.find(candidate => candidate.id === request.itemId);
      if (!item || item.availability !== 'available') throw new Error('This demo asset is unavailable.');
      const materialized = demoAssetRecord(item);
      return { ...materialized, rollback: async () => undefined };
    },
  });
}

function createPlacementGate() {
  type Waiter = {
    signal: AbortSignal;
    resolve: () => void;
    reject: (error: DOMException) => void;
    onAbort: () => void;
  };
  let held = false;
  const waiters = new Set<Waiter>();

  const settle = (waiter: Waiter, error?: DOMException) => {
    if (!waiters.delete(waiter)) return;
    waiter.signal.removeEventListener('abort', waiter.onAbort);
    if (error) waiter.reject(error);
    else waiter.resolve();
  };

  return {
    setHeld(next: boolean) {
      held = next;
      if (!held) for (const waiter of [...waiters]) settle(waiter);
    },
    wait(signal: AbortSignal): Promise<void> {
      if (signal.aborted) return Promise.reject(new DOMException('Asset placement cancelled', 'AbortError'));
      if (!held) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const waiter = {} as Waiter;
        waiter.signal = signal;
        waiter.resolve = resolve;
        waiter.reject = reject;
        waiter.onAbort = () => settle(waiter, new DOMException('Asset placement cancelled', 'AbortError'));
        waiters.add(waiter);
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      });
    },
  };
}

// Official AWS Lambda architecture icon path from AWS's April 2026 icon package.
// Source: https://aws.amazon.com/architecture/icons/
const AWS_LAMBDA_PATH = 'M28.0075352 66 L15.5907274 66 L29.3235885 37.296 L35.5460249 50.106 L28.0075352 66 Z M30.2196674 34.553 C30.0512768 34.208 29.7004629 33.989 29.3175745 33.989 L29.3145676 33.989 C28.9286723 33.99 28.5778583 34.211 28.4124746 34.558 L13.097944 66.569 C12.9495999 66.879 12.9706487 67.243 13.1550766 67.534 C13.3374998 67.824 13.6582439 68 14.0020416 68 L28.6420072 68 C29.0299071 68 29.3817234 67.777 29.5481094 67.428 L37.563706 50.528 C37.693006 50.254 37.6920037 49.937 37.5586944 49.665 L30.2196674 34.553 Z M64.9953491 66 L52.6587274 66 L32.866809 24.57 C32.7014253 24.222 32.3486067 24 31.9617091 24 L23.8899822 24 L23.8990031 14 L39.7197081 14 L59.4204149 55.429 C59.5857986 55.777 59.9386172 56 60.3255148 56 L64.9953491 56 L64.9953491 66 Z M65.9976745 54 L60.9599868 54 L41.25928 12.571 C41.0938963 12.223 40.7410777 12 40.3531778 12 L22.89768 12 C22.3453987 12 21.8963569 12.447 21.8953545 12.999 L21.884329 24.999 C21.884329 25.265 21.9885708 25.519 22.1780103 25.707 C22.3654452 25.895 22.6200358 26 22.8866544 26 L31.3292417 26 L51.1221625 67.43 C51.2885485 67.778 51.6393624 68 52.02626 68 L65.9976745 68 C66.5519605 68 67 67.552 67 67 L67 55 C67 54.448 66.5519605 54 65.9976745 54 Z';

function scaleAbsolutePath(path: string, scaleX: number, scaleY: number): string {
  const tokens = path.match(/[MLCZ]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const parameterCounts: Record<string, number> = { M: 2, L: 2, C: 6, Z: 0 };
  const output: string[] = [];
  let index = 0;

  while (index < tokens.length) {
    const command = tokens[index++]!;
    output.push(command);
    const count = parameterCounts[command];
    if (count === undefined) throw new Error(`Unsupported SVG command: ${command}`);
    for (let parameter = 0; parameter < count; parameter++) {
      const value = Number(tokens[index++]);
      output.push(String(value * (parameter % 2 === 0 ? scaleX : scaleY)));
    }
  }

  return output.join(' ');
}

const { plugin: awsLambdaPlugin } = createSvgPathShape({
  type: 'aws-lambda',
  defaultSize: { w: 120, h: 120 },
  defaultColor: 'orange',
  defaultFillStyle: 'solid',
  getPathD: (w, h) => scaleAbsolutePath(AWS_LAMBDA_PATH, w / 80, h / 80),
});

function loadInitialDocument(): GlideDocument | null {
  if (typeof window === 'undefined') return null;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as GlideDocument;
  } catch (error) {
    console.warn('[GlideboardDemo] Failed to restore session:', error);
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export default function GlideboardDemo() {
  const boardRef = React.useRef<GlideboardHandle | null>(null);
  const boardRootRef = React.useRef<HTMLDivElement | null>(null);
  const acceptanceSourceRef = React.useRef<GlideboardHandle | null>(null);
  const acceptanceSourceRootRef = React.useRef<HTMLDivElement | null>(null);
  const acceptanceDestinationRef = React.useRef<GlideboardHandle | null>(null);
  const acceptanceDestinationRootRef = React.useRef<HTMLDivElement | null>(null);
  const acceptanceSourceBaseline = React.useRef<GlideDocument | null>(null);
  const acceptanceDestinationBaseline = React.useRef<GlideDocument | null>(null);
  const lastCrossBoardAcceptance = React.useRef<CrossBoardAcceptanceResult | null>(null);
  const initialDocument = React.useMemo(() => loadInitialDocument(), []);
  const [slowUpload, setSlowUpload] = React.useState(false);
  const [failNextUpload, setFailNextUpload] = React.useState(false);
  const [failNextDownload, setFailNextDownload] = React.useState(false);
  const [catalogLoading, setCatalogLoading] = React.useState(false);
  const [catalogFailureGeneration, setCatalogFailureGeneration] = React.useState(0);
  const [catalogResetGeneration, setCatalogResetGeneration] = React.useState(0);
  const [holdPlacement, setHoldPlacement] = React.useState(false);
  const [failNextPlacement, setFailNextPlacement] = React.useState(false);
  const [readOnly, setReadOnly] = React.useState(false);
  const [exportStatus, setExportStatus] = React.useState<'idle' | 'ready' | 'error'>('idle');
  const [crossBoardStatus, setCrossBoardStatus] = React.useState<'idle' | 'running' | 'ready' | 'error'>('idle');
  const [crossBoardSummary, setCrossBoardSummary] = React.useState('');
  const [rasterUsage, setRasterUsage] = React.useState(0);
  const slowUploadRef = React.useRef(slowUpload);
  const failNextUploadRef = React.useRef(failNextUpload);
  const failNextDownloadRef = React.useRef(failNextDownload);
  const portableRequestEvidence = React.useRef<PortableRequestEvidence[]>([]);
  const failNextPlacementRef = React.useRef(failNextPlacement);
  const placementGate = React.useMemo(() => createPlacementGate(), []);
  slowUploadRef.current = slowUpload;
  failNextUploadRef.current = failNextUpload;
  failNextDownloadRef.current = failNextDownload;
  failNextPlacementRef.current = failNextPlacement;
  const assetStorage = React.useMemo(() => createDemoAssetStorage({
    isSlowUpload: () => slowUploadRef.current,
    consumeUploadFailure: () => {
      if (!failNextUploadRef.current) return false;
      failNextUploadRef.current = false;
      setFailNextUpload(false);
      return true;
    },
    consumeDownloadFailure: () => {
      if (!failNextDownloadRef.current) return false;
      failNextDownloadRef.current = false;
      setFailNextDownload(false);
      return true;
    },
    onUsageChange: setRasterUsage,
  }), []);
  const acceptanceSourceStorage = React.useMemo(() => createDemoAssetStorage({
    isSlowUpload: () => false,
    consumeUploadFailure: () => false,
    persistenceKey: P3_C6_SOURCE_STORAGE_KEY,
  }), []);
  const acceptanceDestinationStorage = React.useMemo(() => createDemoAssetStorage({
    isSlowUpload: () => false,
    consumeUploadFailure: () => false,
    persistenceKey: P3_C6_DESTINATION_STORAGE_KEY,
  }), []);
  const assetLibraryProvider = React.useMemo(() => createDemoAssetLibraryProvider({
    loading: catalogLoading,
    failFirstSearch: catalogFailureGeneration > 0,
    beforeMaterialize: signal => placementGate.wait(signal),
    consumePlacementFailure: () => {
      if (!failNextPlacementRef.current) return false;
      failNextPlacementRef.current = false;
      setFailNextPlacement(false);
      return true;
    },
  }), [catalogFailureGeneration, catalogLoading, catalogResetGeneration, placementGate]);
  React.useEffect(() => {
    assetStorage.activate();
    acceptanceSourceStorage.activate();
    acceptanceDestinationStorage.activate();
    setRasterUsage(assetStorage.usageBytes());
    return () => {
      assetStorage.dispose();
      acceptanceSourceStorage.dispose();
      acceptanceDestinationStorage.dispose();
    };
  }, [acceptanceDestinationStorage, acceptanceSourceStorage, assetStorage]);
  React.useEffect(() => {
    const runCrossBoardAcceptance = async (): Promise<CrossBoardAcceptanceResult> => {
      const source = acceptanceSourceRef.current;
      const destination = acceptanceDestinationRef.current;
      if (!source || !destination) throw new Error('P3-C6 acceptance boards are not ready.');
      acceptanceSourceBaseline.current ??= structuredClone(source.serialize());
      acceptanceDestinationBaseline.current ??= structuredClone(destination.serialize());
      source.replaceDocument(structuredClone(acceptanceSourceBaseline.current));
      destination.replaceDocument(structuredClone(acceptanceDestinationBaseline.current));
      acceptanceSourceStorage.reset();
      acceptanceDestinationStorage.reset();
      portableRequestEvidence.current = [];

      const bytes = Uint8Array.from(atob(P3_C6_PNG_BASE64), character => character.charCodeAt(0));
      const sourceShapeId = String(await source.importRaster(bytes, 'image/png'));
      const sourceState = await waitForRenderedRaster(
        () => inspectAcceptanceBoard(source, acceptanceSourceRootRef.current),
        1,
      );
      const sourceContext = { documentId: P3_C6_SOURCE_SESSION_KEY };
      portableRequestEvidence.current.push({
        sequence: 1,
        board: 'source',
        operation: 'createPortableFragment',
        shapeIds: [sourceShapeId],
        context: sourceContext,
      });
      const fragment = await source.createPortableFragment({
        shapeIds: [sourceShapeId as import('@durgakiran/glideline').ShapeId],
        resolutionContext: sourceContext,
      });
      if (!fragment) throw new Error('P3-C6 source did not produce a portable fragment.');

      const point = { x: 240, y: 180 };
      portableRequestEvidence.current.push({ sequence: 2, board: 'destination', operation: 'pastePortableFragment', point });
      const destinationIds = await destination.pastePortableFragment(fragment, { point });
      const destinationState = await waitForRenderedRaster(
        () => inspectAcceptanceBoard(destination, acceptanceDestinationRootRef.current),
        destinationIds.length,
      );
      const destinationContext = { documentId: P3_C6_DESTINATION_SESSION_KEY };
      portableRequestEvidence.current.push({
        sequence: 3,
        board: 'destination',
        operation: 'exportSvg',
        shapeIds: destinationIds.map(String),
        context: destinationContext,
      });
      const svg = await destination.exportSvg({ shapeIds: destinationIds, resolutionContext: destinationContext });
      const result: CrossBoardAcceptanceResult = {
        source: sourceState,
        destination: destinationState,
        renderedAssetUrlState: {
          source: renderedUrlState(sourceState),
          destination: renderedUrlState(destinationState),
        },
        svg: {
          containsEmbeddedPng: svg.includes('data:image/png;base64,'),
          containsBlobUrl: svg.includes('blob:'),
          length: svg.length,
        },
        requests: structuredClone(portableRequestEvidence.current),
      };
      lastCrossBoardAcceptance.current = result;
      return structuredClone(result);
    };
    const api = {
      getAcceptanceState: () => inspectAcceptanceBoard(boardRef.current, boardRootRef.current),
      createPortableFragment: (shapeIds: string[], context?: import('@durgakiran/glideline').AssetResolutionContext) => {
        portableRequestEvidence.current.push({
          sequence: portableRequestEvidence.current.length + 1,
          operation: 'createPortableFragment',
          shapeIds: [...shapeIds],
          ...(context ? { context: structuredClone(context) } : {}),
        });
        return boardRef.current!.createPortableFragment({
          shapeIds: shapeIds as import('@durgakiran/glideline').ShapeId[],
          resolutionContext: context,
        });
      },
      pastePortableFragment: (fragment: import('@durgakiran/glideline').PortableBoardFragment, point?: { x: number; y: number }) => {
        portableRequestEvidence.current.push({
          sequence: portableRequestEvidence.current.length + 1,
          operation: 'pastePortableFragment',
          ...(point ? { point: { ...point } } : {}),
        });
        return boardRef.current!.pastePortableFragment(fragment, { point }).then(ids => ids.map(String));
      },
      exportSvg: (shapeIds?: string[], context?: import('@durgakiran/glideline').AssetResolutionContext) => {
        portableRequestEvidence.current.push({
          sequence: portableRequestEvidence.current.length + 1,
          operation: 'exportSvg',
          ...(shapeIds ? { shapeIds: [...shapeIds] } : {}),
          ...(context ? { context: structuredClone(context) } : {}),
        });
        return boardRef.current!.exportSvg({
          shapeIds: shapeIds as import('@durgakiran/glideline').ShapeId[] | undefined,
          resolutionContext: context,
        });
      },
      getRequestEvidence: () => structuredClone(portableRequestEvidence.current),
      runCrossBoardAcceptance,
      getLastCrossBoardAcceptance: () => structuredClone(lastCrossBoardAcceptance.current),
      flush: () => boardRef.current!.flush(),
      resetDestination: async () => {
        boardRef.current?.clearAssetImportHistory?.();
        (window as typeof window & { __GLIDELINE_WHITEBOARD__?: { reset(): void } }).__GLIDELINE_WHITEBOARD__?.reset();
        assetStorage.reset();
        await boardRef.current!.flush();
      },
    };
    window.__GLIDELINE_P3_C6__ = api;
    return () => {
      if (window.__GLIDELINE_P3_C6__ === api) delete window.__GLIDELINE_P3_C6__;
    };
  }, [acceptanceDestinationStorage, acceptanceSourceStorage, assetStorage]);

  const runCrossBoardAcceptanceControl = async () => {
    setCrossBoardStatus('running');
    setCrossBoardSummary('');
    try {
      const result = await window.__GLIDELINE_P3_C6__!.runCrossBoardAcceptance();
      setCrossBoardSummary(
        `source ${result.source.shapeCount}/${result.source.assetCount}; destination ${result.destination.shapeCount}/${result.destination.assetCount}; ${result.requests.length} requests; SVG embedded`,
      );
      setCrossBoardStatus('ready');
    } catch (error) {
      setCrossBoardSummary(error instanceof Error ? error.message : String(error));
      setCrossBoardStatus('error');
    }
  };

	const resetDemoData = () => {
		// Restore mutation permission synchronously before the privileged clear;
		// the React prop update alone would not reach the controller until after this handler returns.
		boardRef.current?.setReadOnly(false);
		setReadOnly(false);
		boardRef.current?.clearAssetImportHistory();
    const debug = (window as typeof window & {
      __GLIDELINE_WHITEBOARD__?: { reset(): void };
    }).__GLIDELINE_WHITEBOARD__;
    debug?.reset();
    assetStorage.reset();
    for (const key of [
      STORAGE_KEY,
      FAVORITES_KEY,
      RECENTS_KEY,
      P3_C6_SOURCE_STORAGE_KEY,
      P3_C6_DESTINATION_STORAGE_KEY,
    ]) {
      window.localStorage.removeItem(key);
    }
    delete window.__GLIDELINE_PORTABLE_EXPORT__;
    portableRequestEvidence.current = [];
    setSlowUpload(false);
    setFailNextUpload(false);
    setFailNextDownload(false);
    setCatalogLoading(false);
    setCatalogFailureGeneration(0);
    placementGate.setHeld(false);
    setHoldPlacement(false);
    setFailNextPlacement(false);
    setCatalogResetGeneration(value => value + 1);
    setExportStatus('idle');
    setCrossBoardStatus('idle');
    setCrossBoardSummary('');
    lastCrossBoardAcceptance.current = null;
  };

  const exportPortableBoard = async () => {
    try {
      const board = boardRef.current;
      if (!board) throw new Error('Board is not ready.');
      const shapeIds = board.serialize().records
        .filter(record => record.kind === 'shape')
        .map(record => record.id as import('@durgakiran/glideline').ShapeId);
      window.__GLIDELINE_PORTABLE_EXPORT__ = await board.createPortableFragment({ shapeIds });
      setExportStatus('ready');
    } catch (error) {
      console.error('[GlideboardDemo] Portable export failed:', error);
      setExportStatus('error');
    }
  };

  return (
    <div style={{ height: 'calc(100vh - 42px)', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        data-demo-role="acceptance-controls"
        aria-label="Glideboard demo controls"
        style={{ minHeight: 42, padding: '5px 8px', boxSizing: 'border-box', display: 'flex', gap: 6,
          alignItems: 'center', overflowX: 'auto', background: '#fff', borderBottom: '1px solid #d8dee8' }}
      >
        <DemoToggle pressed={slowUpload} onClick={() => setSlowUpload(value => !value)}>Slow upload</DemoToggle>
        <DemoToggle pressed={failNextUpload} onClick={() => setFailNextUpload(value => !value)}>Fail next upload</DemoToggle>
        <DemoToggle pressed={failNextDownload} onClick={() => setFailNextDownload(value => !value)}>Fail next download</DemoToggle>
        <DemoToggle pressed={catalogLoading} onClick={() => setCatalogLoading(value => !value)}>Catalog loading</DemoToggle>
        <DemoToggle pressed={holdPlacement} onClick={() => {
          const next = !holdPlacement;
          placementGate.setHeld(next);
          setHoldPlacement(next);
        }}>Hold placement</DemoToggle>
        <DemoToggle pressed={failNextPlacement} onClick={() => setFailNextPlacement(value => !value)}>Fail next placement</DemoToggle>
        <button
          type="button"
          id="demo-run-p3-c6"
          data-acceptance-status={crossBoardStatus}
          disabled={crossBoardStatus === 'running'}
          onClick={() => void runCrossBoardAcceptanceControl()}
          style={{ flex: '0 0 auto', height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid #166534',
            background: '#f0fdf4', color: '#166534', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >Run P3-C6</button>
        <output data-demo-role="p3-c6-result" data-status={crossBoardStatus} style={{ flex: '0 0 auto', fontSize: 11, color: crossBoardStatus === 'error' ? '#b91c1c' : '#334155', whiteSpace: 'nowrap' }}>
          {crossBoardSummary}
        </output>
        <button
          type="button"
          onClick={() => setCatalogFailureGeneration(value => value + 1)}
          style={{ flex: '0 0 auto', height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid #c7ced8',
            background: '#fff', color: '#334155', fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >Fail catalog load</button>
        <DemoToggle pressed={readOnly} onClick={() => setReadOnly(value => !value)}>Read-only</DemoToggle>
        <button
          type="button"
          aria-label="Reset demo data"
          onClick={resetDemoData}
          style={{ flex: '0 0 auto', height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid #c7ced8',
            background: '#fff', color: '#334155', fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >Reset demo</button>
        <span data-demo-role="raster-quota" style={{ flex: '0 0 auto', fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
          Raster {Math.ceil(rasterUsage / 1024)} KB / {DEMO_RASTER_QUOTA_BYTES / (1024 * 1024)} MB
        </span>
        <button
          type="button"
          id="demo-export-portable"
          data-export-status={exportStatus}
          onClick={() => void exportPortableBoard()}
          style={{ flex: '0 0 auto', height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid #0f766e',
            background: '#f0fdfa', color: '#115e59', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >Export portable</button>
        <button
          id="demo-tool-aws-lambda"
          onClick={() => boardRef.current?.setCurrentTool('aws-lambda')}
          style={{ flex: '0 0 auto', height: 30, padding: '0 10px', borderRadius: 6, border: '1px solid #ed7100',
            background: '#fff7ed', color: '#9a3412', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >AWS Lambda</button>
      </div>
      <div ref={boardRootRef} data-demo-role="board" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <Glideboard
          ref={boardRef}
          sessionKey={SESSION_KEY}
          initialDocument={initialDocument}
          initialDocumentDisposition={initialDocument
            ? { kind: 'local-recovery', recoveryCheckpoint: STORAGE_KEY }
            : undefined}
          debugApiKey="__GLIDELINE_WHITEBOARD__"
          customShapes={[awsLambdaPlugin]}
          assetStorage={assetStorage}
          assetLibraryProvider={assetLibraryProvider}
          readOnly={readOnly}
          onDocumentChange={(document) => {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
          }}
          pendingSaveOnUnmount="flush"
        />
      </div>
      <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0, width: 640, height: 480, overflow: 'hidden', pointerEvents: 'none' }}>
        <div ref={acceptanceSourceRootRef} style={{ position: 'absolute', inset: 0 }}>
          <Glideboard ref={acceptanceSourceRef} sessionKey={P3_C6_SOURCE_SESSION_KEY} assetStorage={acceptanceSourceStorage} />
        </div>
        <div ref={acceptanceDestinationRootRef} style={{ position: 'absolute', inset: 0 }}>
          <Glideboard ref={acceptanceDestinationRef} sessionKey={P3_C6_DESTINATION_SESSION_KEY} assetStorage={acceptanceDestinationStorage} />
        </div>
      </div>
    </div>
  );
}

function DemoToggle({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      style={{ flex: '0 0 auto', height: 30, padding: '0 10px', borderRadius: 6,
        border: `1px solid ${pressed ? '#2563eb' : '#c7ced8'}`,
        background: pressed ? '#eff6ff' : '#fff', color: pressed ? '#1d4ed8' : '#334155',
        fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap' }}
    >{children}</button>
  );
}
