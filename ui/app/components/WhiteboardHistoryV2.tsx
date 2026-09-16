import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Flex, Text } from '@radix-ui/themes';
import { boardUrl, contentUrl, jsonRequest, post, WhiteboardApiError, type DraftManifest, type PublishedBoard } from 'app/core/whiteboard/v2/api';

type Version = PublishedBoard & { versionId: string; versionNumber: string; publishedAt: string };
type History = { versions: Version[]; nextBefore?: string };
type HistorySession = { base: string; parentSignal?: AbortSignal; abort: AbortController };
function requestScope(parent: AbortSignal) {
    const abort = new AbortController();
    const cancel = () => abort.abort();
    parent.addEventListener('abort', cancel, { once: true });
    if (parent.aborted) cancel();
    return { signal: abort.signal, dispose: () => { parent.removeEventListener('abort', cancel); cancel(); } };
}
export default function WhiteboardHistoryV2({ spaceId, pageId, canRestore, onRestored, signal }: { spaceId: string; pageId: string; canRestore: boolean; onRestored: () => void; signal?: AbortSignal }) {
    const base = boardUrl(spaceId, pageId);
    const [open, setOpen] = useState(false);
    const [versions, setVersions] = useState<Version[]>([]);
    const [cursor, setCursor] = useState<string>();
    const [selected, setSelected] = useState('');
    const [version, setVersion] = useState<Version>();
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [detailError, setDetailError] = useState('');
    const [confirmation, setConfirmation] = useState(false);
    const [retry, setRetry] = useState(0);
    const pending = useRef<{ versionId: string; key: string; sent?: boolean; body: { expectedHeadSequence: string } } | null>(null);
    const inFlight = useRef(false);
    const activeSession = useRef<HistorySession | null>(null);
    const currentContext = useRef({ base, signal });
    currentContext.current = { base, signal };
    const isCurrent = (session: HistorySession | null): session is HistorySession => Boolean(session
        && activeSession.current === session && !session.abort.signal.aborted
        && currentContext.current.base === session.base && currentContext.current.signal === session.parentSignal);
    const renderedSession = activeSession.current;
    useEffect(() => {
        const session: HistorySession = { base, parentSignal: signal, abort: new AbortController() };
        const cancel = () => session.abort.abort();
        activeSession.current = session;
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        // Retry receipts belong to one board session. Closing the dialog keeps them;
        // replacing the board/session or unmounting abandons its local UI state.
        pending.current = null; inFlight.current = false;
        setOpen(false); setVersions([]); setCursor(undefined); setSelected(''); setVersion(undefined);
        setLoading(false); setBusy(false); setError(''); setDetailError(''); setConfirmation(false);
        return () => {
            signal?.removeEventListener('abort', cancel);
            cancel();
            if (activeSession.current === session) activeSession.current = null;
        };
    }, [base, signal]);
    useEffect(() => {
        const session = renderedSession;
        if (!open || !isCurrent(session)) return;
        const request = requestScope(session.abort.signal);
        setLoading(true); setError('');
        void jsonRequest<History>(`${base}/versions`, { signal: request.signal }).then(data => {
            if (request.signal.aborted || !isCurrent(session)) return;
            setVersions(data.versions); setCursor(data.nextBefore);
            setSelected(pending.current?.versionId ?? data.versions[0]?.versionId ?? '');
        }).catch(e => { if (!request.signal.aborted && isCurrent(session)) setError(e.message); }).finally(() => { if (!request.signal.aborted && isCurrent(session)) setLoading(false); });
        return request.dispose;
    }, [open, base, retry, signal]);
    useEffect(() => {
        const session = renderedSession;
        if (!open || !selected || !isCurrent(session)) return;
        const request = requestScope(session.abort.signal); setVersion(undefined); setDetailError('');
        void jsonRequest<Version>(`${base}/versions/${selected}`, { signal: request.signal }).then(data => { if (!request.signal.aborted && isCurrent(session)) setVersion(data); })
            .catch(e => { if (!request.signal.aborted && isCurrent(session)) setDetailError(e.message); });
        return request.dispose;
    }, [open, base, selected, retry, signal]);
    const more = async () => {
        const session = activeSession.current;
        if (!cursor || inFlight.current || !isCurrent(session)) return;
        inFlight.current = true; setLoading(true); setError('');
        try {
            const data = await jsonRequest<History>(`${base}/versions?before=${encodeURIComponent(cursor)}`, { signal: session.abort.signal });
            if (!isCurrent(session)) return;
            setVersions(current => [...current, ...data.versions.filter(v => !current.some(c => c.versionId === v.versionId))]); setCursor(data.nextBefore);
        } catch (e) { if (isCurrent(session)) setError((e as Error).message); }
        finally { if (isCurrent(session)) { inFlight.current = false; setLoading(false); } }
    };
    const prepare = async () => {
        const session = activeSession.current;
        if (inFlight.current || !isCurrent(session)) return;
        inFlight.current = true; setBusy(true); setError('');
        try {
            if (!pending.current) {
                const draft = await jsonRequest<DraftManifest>(`${base}/draft`, { signal: session.abort.signal });
                if (!isCurrent(session)) return;
                pending.current = { versionId: selected, key: crypto.randomUUID(), body: { expectedHeadSequence: draft.headSequence } };
            }
            setConfirmation(true);
        } catch (e) { if (isCurrent(session)) setError((e as Error).message); }
        finally { if (isCurrent(session)) { inFlight.current = false; setBusy(false); } }
    };
    const restore = async () => {
        const session = activeSession.current;
        if (!pending.current || inFlight.current || !isCurrent(session)) return;
        inFlight.current = true; setBusy(true); setError('');
        try {
            const attempt = pending.current; attempt.sent = true;
            await post(`${base}/versions/${attempt.versionId}/restore`, attempt.body, attempt.key, session.abort.signal);
            if (!isCurrent(session)) return;
            pending.current = null; setConfirmation(false); setOpen(false); onRestored();
        } catch (e) {
            if (!isCurrent(session)) return;
            if (e instanceof WhiteboardApiError && !e.retryable) { pending.current = null; setConfirmation(false); }
            setError(e instanceof WhiteboardApiError && e.code === 'DRAFT_HEAD_CHANGED' ? 'The draft changed. Review the version and choose Restore to draft again.' : (e as Error).message);
        } finally { if (isCurrent(session)) { inFlight.current = false; setBusy(false); } }
    };
    return <Dialog.Root open={open} onOpenChange={next => { if (!busy && !loading) setOpen(next); }}>
        <Dialog.Trigger><Button variant="soft">Version history</Button></Dialog.Trigger>
        <Dialog.Content maxWidth="900px">
            <Dialog.Title>Version history</Dialog.Title>
            <Dialog.Description>Browse published versions. Restoring changes the draft; the published version stays unchanged.</Dialog.Description>
            {error && <Text as="p" role="alert" color="red">{error}</Text>}
            {error && !confirmation && !pending.current && <Button variant="soft" onClick={() => setRetry(n => n + 1)}>Reload history</Button>}
            <Flex gap="4" my="4" wrap="wrap">
                <Flex direction="column" gap="2" style={{ flex: '1 1 180px', maxHeight: 400, overflowY: 'auto' }}>
                    {versions.map(v => <Button key={v.versionId} variant={selected === v.versionId ? 'solid' : 'soft'} disabled={busy || confirmation || Boolean(pending.current)} onClick={() => setSelected(v.versionId)}>Version {v.versionNumber} — {v.snapshot.title}</Button>)}
                    {loading ? <Text role="status">Loading history…</Text> : !versions.length && !error ? <Text>No published versions yet.</Text> : null}
                    {cursor && <Button disabled={loading || busy} onClick={() => void more()}>Load older versions</Button>}
                </Flex>
                <Flex direction="column" gap="2" style={{ flex: '3 1 280px', minWidth: 0 }}>
                    {detailError && <><Text role="alert" color="red">{detailError}</Text><Button onClick={() => setRetry(n => n + 1)}>Retry version</Button></>}
                    {selected && !version && !detailError && <Text role="status">Loading version…</Text>}
                    {version && <><Text weight="bold">Version {version.versionNumber}: {version.snapshot.title}</Text><Text size="2">Published {new Date(version.publishedAt).toLocaleString()}</Text>
                        {version.preview ? <img src={contentUrl(version.preview.url)} alt={`Version ${version.versionNumber} preview`} onError={() => setDetailError('Unable to load this preview.')} style={{ width: '100%', height: 300, objectFit: 'contain', border: '1px solid #ddd' }} /> : <Text>This version has no preview.</Text>}
                    </>}
                </Flex>
            </Flex>
            {confirmation && <Text as="p">Replace the current draft with this version? Collaborators will reload the restored draft. Unpublished changes will no longer be part of the draft.</Text>}
            <Flex gap="3" justify="end" mt="4">
                {confirmation && !pending.current?.sent && <Button variant="soft" disabled={busy} onClick={() => { pending.current = null; setConfirmation(false); }}>Cancel restore</Button>}
                <Button variant="soft" disabled={busy || loading} onClick={() => setOpen(false)}>Close history</Button>
                {canRestore && version && <Button disabled={busy || Boolean(detailError)} onClick={() => void (confirmation ? restore() : prepare())}>{busy ? 'Please wait…' : confirmation ? (pending.current?.sent ? 'Retry restore' : 'Confirm restore') : pending.current ? 'Retry restore' : 'Restore to draft'}</Button>}
            </Flex>
        </Dialog.Content>
    </Dialog.Root>;
}
