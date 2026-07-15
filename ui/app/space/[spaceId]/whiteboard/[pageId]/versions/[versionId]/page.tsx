import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Flex, Text, Button, Spinner } from '@radix-ui/themes';
import { ArrowLeft } from 'lucide-react';
import { Glideboard } from '@durgakiran/glideboard';
import * as Y from 'yjs';
import { base64ToUint8Array } from 'app/core/utils/base64';

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
  errorKind: 'corrupt-version' | 'request-failed' | null;
};

class CorruptWhiteboardVersionError extends Error {}

export default function WhiteboardVersionViewPage() {
  const { spaceId, pageId, versionId } = useParams();
  const navigate = useNavigate();
  const versionSessionKey = `${spaceId ?? 'missing-space'}:${pageId ?? 'missing-page'}:version:${versionId ?? 'missing-version'}`;
  const [loadState, setLoadState] = useState<LoadState>({
    sessionKey: versionSessionKey,
    status: 'loading',
    doc: null,
    errorKind: null,
  });

  const status = loadState.sessionKey === versionSessionKey
    ? loadState.status
    : 'loading';
  const versionDoc = loadState.sessionKey === versionSessionKey
    ? loadState.doc
    : null;
  const errorKind = loadState.sessionKey === versionSessionKey
    ? loadState.errorKind
    : null;
  const collaboration = useMemo(
    () => versionDoc ? { doc: versionDoc } : null,
    [versionDoc],
  );

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;
    let loadedDoc: Y.Doc | null = null;

    setLoadState({ sessionKey: versionSessionKey, status: 'loading', doc: null, errorKind: null });

    const fetchVersion = async () => {
      try {
        if (!spaceId || !pageId || !versionId) {
          throw new Error('Missing whiteboard version route parameters');
        }

        const res = await fetch(`/api/v1/editor/space/${spaceId}/whiteboard/${pageId}/versions/${versionId}`, {
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
          String(version.spaceId).toLowerCase() !== spaceId.toLowerCase() ||
          String(version.pageId) !== pageId ||
          String(version.docId) !== versionId
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
        setLoadState({ sessionKey: versionSessionKey, status: 'ready', doc: nextDoc, errorKind: null });
      } catch (err) {
        if (!active || abortController.signal.aborted) return;
        console.error('Failed to fetch version', err);
        setLoadState({
          sessionKey: versionSessionKey,
          status: 'error',
          doc: null,
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
  }, [pageId, spaceId, versionId, versionSessionKey]);

  return (
    <Flex direction="column" style={{ height: '100vh', overflow: 'hidden' }}>
      <Flex align="center" gap="3" p="3" style={{ borderBottom: '1px solid var(--gray-4)', background: 'var(--color-panel)' }}>
        <Button variant="ghost" color="gray" onClick={() => navigate(`/space/${spaceId}/whiteboard/${pageId}/versions`)}>
          <ArrowLeft size={16} /> Back to History
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
