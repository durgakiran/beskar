import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Flex, Text, Button, Spinner } from '@radix-ui/themes';
import { ArrowLeft } from 'lucide-react';
import { Glideboard, type GlideboardAssetStorage } from '@durgakiran/glideboard';
import * as Y from 'yjs';
import { base64ToUint8Array } from 'app/core/utils/base64';
import { getApiV1Base } from 'app/core/http/apiBase';

interface WhiteboardVersionData {
  docId: number;
  data?: string | null;
  pageId: number;
  spaceId: string;
}

interface WhiteboardVersionResponse {
  data?: WhiteboardVersionData | null;
}

type LoadState = {
  sessionKey: string;
  status: 'loading' | 'ready' | 'error';
  doc: Y.Doc | null;
  documentId: string | null;
  errorKind: 'corrupt-version' | 'request-failed' | null;
};

class CorruptWhiteboardVersionError extends Error {}

function canonicalPositiveId(value: string | undefined): string | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? String(parsed) : null;
}

export default function WhiteboardVersionViewPage() {
  const { spaceId, pageId, versionId } = useParams();
  const navigate = useNavigate();
  const canonicalPageId = canonicalPositiveId(pageId);
  const canonicalVersionId = canonicalPositiveId(versionId);
  const versionSessionKey = `${spaceId ?? 'missing-space'}:${pageId ?? 'missing-page'}:version:${versionId ?? 'missing-version'}`;
  const [loadState, setLoadState] = useState<LoadState>({
    sessionKey: versionSessionKey,
    status: 'loading',
    doc: null,
    documentId: null,
    errorKind: null,
  });

  const status = loadState.sessionKey === versionSessionKey
    ? loadState.status
    : 'loading';
  const versionDoc = loadState.sessionKey === versionSessionKey
    ? loadState.doc
    : null;
  const historicalDocumentId = loadState.sessionKey === versionSessionKey
    ? loadState.documentId
    : null;
  const errorKind = loadState.sessionKey === versionSessionKey
    ? loadState.errorKind
    : null;
  const collaboration = useMemo(
    () => versionDoc ? { doc: versionDoc } : null,
    [versionDoc],
  );
  const assetResolutionContext = useMemo(() => ({
    documentId: historicalDocumentId ?? undefined,
    versionId: canonicalVersionId ?? undefined,
    snapshotId: canonicalVersionId ?? undefined,
  }), [canonicalVersionId, historicalDocumentId]);
  const assetStorage = useMemo<GlideboardAssetStorage>(() => ({
    async prepare() {
      throw new Error('Historical whiteboard versions are read-only.');
    },
    resolve(asset) {
      const hash = String(asset.props.hash ?? '');
      if (!canonicalPageId || !/^[a-f0-9]{64}$/.test(hash)) return null;
      const apiV1 = getApiV1Base({ fallbackBase: import.meta.env.VITE_IMAGE_SERVER_URL });
      return `${apiV1}/media/whiteboard-asset/${canonicalPageId}/${hash}`;
    },
    async download(asset, signal) {
      const url = this.resolve(asset, assetResolutionContext);
      if (!url) throw new Error('Invalid historical whiteboard asset identity.');
      const response = await fetch(url, { credentials: 'include', signal });
      if (!response.ok) throw new Error(`Historical whiteboard asset download failed (${response.status})`);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        mimeType: response.headers.get('content-type')?.split(';', 1)[0] ?? '',
      };
    },
  }), [assetResolutionContext, canonicalPageId]);

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;
    let loadedDoc: Y.Doc | null = null;

    setLoadState({ sessionKey: versionSessionKey, status: 'loading', doc: null, documentId: null, errorKind: null });

    const fetchVersion = async () => {
      try {
        if (!spaceId || !canonicalPageId || !canonicalVersionId) {
          throw new Error('Missing whiteboard version route parameters');
        }

        const res = await fetch(`/api/v1/editor/space/${encodeURIComponent(spaceId)}/whiteboard/${canonicalPageId}/versions/${canonicalVersionId}`, {
          credentials: 'include',
          signal: abortController.signal,
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch whiteboard version (${res.status})`);
        }

        const json = await res.json() as WhiteboardVersionResponse;
        const version = json.data;
        if (
          !version ||
          typeof version.data !== 'string' ||
          version.data.length === 0 ||
          !Number.isSafeInteger(version.pageId) ||
          !Number.isSafeInteger(version.docId) ||
          String(version.spaceId).toLowerCase() !== spaceId.toLowerCase() ||
          String(version.pageId) !== canonicalPageId ||
          String(version.docId) !== canonicalVersionId
        ) {
          throw new Error('Whiteboard version response does not match the requested version');
        }

        const nextDoc = new Y.Doc();
        try {
          Y.applyUpdate(nextDoc, base64ToUint8Array(version.data));
        } catch (err) {
          nextDoc.destroy();
          throw new CorruptWhiteboardVersionError(
            err instanceof Error ? err.message : 'Invalid historical whiteboard update',
          );
        }

        if (!active) {
          nextDoc.destroy();
          return;
        }

        loadedDoc = nextDoc;
        setLoadState({
          sessionKey: versionSessionKey,
          status: 'ready',
          doc: nextDoc,
          documentId: String(version.docId),
          errorKind: null,
        });
      } catch (err) {
        if (!active || abortController.signal.aborted) return;
        console.error('Failed to fetch version', err);
        setLoadState({
          sessionKey: versionSessionKey,
          status: 'error',
          doc: null,
          documentId: null,
          errorKind: err instanceof CorruptWhiteboardVersionError
            ? 'corrupt-version'
            : 'request-failed',
        });
      }
    };

    void fetchVersion();

    return () => {
      active = false;
      abortController.abort();
      loadedDoc?.destroy();
    };
  }, [canonicalPageId, canonicalVersionId, spaceId, versionSessionKey]);

  return (
    <Flex direction="column" style={{ height: '100vh', overflow: 'hidden' }}>
      <Flex align="center" gap="3" p="3" style={{ borderBottom: '1px solid var(--gray-4)', background: 'var(--color-panel)' }}>
        <Button variant="ghost" color="gray" onClick={() => navigate(`/space/${spaceId}/whiteboard/${pageId}`)}>
          <ArrowLeft size={16} /> Back to whiteboard
        </Button>
        <Text size="3" weight="bold">Historical Version (Read-Only)</Text>
      </Flex>

      <Flex flexGrow="1" style={{ position: 'relative' }}>
        {status === 'loading' ? (
          <Flex align="center" justify="center" style={{ width: '100%', height: '100%' }}>
            <Spinner size="3" />
          </Flex>
        ) : status === 'ready' && collaboration ? (
          <Glideboard
            sessionKey={versionSessionKey}
            collaboration={collaboration}
            readOnly
            assetStorage={assetStorage}
            assetResolutionContext={assetResolutionContext}
          />
        ) : (
          <Flex align="center" justify="center" style={{ width: '100%', height: '100%' }}>
            <Text color="red">
              {errorKind === 'corrupt-version'
                ? 'This historical whiteboard version is corrupt and cannot be opened.'
                : 'Failed to load whiteboard data.'}
            </Text>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
