import WhiteboardHistoryV2 from './WhiteboardHistoryV2';
import "@durgakiran/glideboard/styles.css";
import { loadDraft } from 'app/core/whiteboard/v2/replay';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Flex, Spinner, Text } from '@radix-ui/themes';
import { useNavigate } from 'react-router-dom';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Glideboard, createPublishPreview, safeAwarenessEntries, type GlideboardHandle, type GlideboardCollaborationConfig } from '@durgakiran/glideboard';
import { getSignalingUrl } from 'app/core/signaling';
import { getApiV1Base } from 'app/core/http/apiBase';
import { YjsDurabilityCoordinator } from 'app/core/whiteboard/durability/YjsDurabilityCoordinator';
import { IndexedDbYjsRecoveryAdapter } from 'app/core/whiteboard/durability/IndexedDbYjsRecoveryAdapter';
import type { DurabilityStatus } from 'app/core/whiteboard/durability/types';
import { CheckpointAdapter } from 'app/core/whiteboard/v2/CheckpointAdapter';
import { boardUrl, digest, jsonRequest, post, sequence, WhiteboardApiError, type PublishedBoard } from 'app/core/whiteboard/v2/api';

type Rename = { title: string; key: string };
interface Session {
    doc: Y.Doc;
    provider: WebrtcProvider;
    durability: YjsDurabilityCoordinator;
    user: { id: string; name: string; color: string };
    collaboration: GlideboardCollaborationConfig;
    sync: () => ReturnType<typeof loadDraft>;
    saveTitle: () => Promise<void>;
}

export default function WhiteboardEditorV2({ slug }: { slug: string[] }) {
    const [space, page] = slug;
    const base = boardUrl(space, page);
    const navigate = useNavigate();
    const [session, setSession] = useState<Session | null>(null);
    const [board, setBoard] = useState<GlideboardHandle | null>(null);
    const [status, setStatus] = useState<DurabilityStatus | null>(null);
    const [title, setTitle] = useState('');
    const titleRef = useRef('');
    const pendingTitle = useRef<Rename | null>(null);
    const [titlePending, setTitlePending] = useState(false);
    const [error, setError] = useState('');
    const [syncError, setSyncError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const busyRef = useRef(false);
    const [peers, setPeers] = useState<string[]>([]);
    const pendingPublish = useRef<{ key: string; body: unknown } | null>(null);
    const titleStorage = useRef('');
    const titleInputFocused = useRef(false);
    const boardRef = useCallback((handle: GlideboardHandle | null) => setBoard(handle), []);

    useEffect(() => {
        const abort = new AbortController();
        let active = true;
        let owned: Session | null = null;
        let recovery: IndexedDbYjsRecoveryAdapter | null = null;
        let doc: Y.Doc | null = null;
        let timer: ReturnType<typeof setInterval> | undefined;
        let unsubscribe: (() => void) | undefined;
        setSession(null); setBoard(null); setError(''); setSyncError(''); setAccessDenied(false);
        const start = async () => {
            const user = await jsonRequest<{ id: string; name: string }>(`${getApiV1Base()}/profile/details`, { signal: abort.signal });
            const spaceUrl = `${getApiV1Base()}/space/${encodeURIComponent(space)}/details`;
            const [loaded, spaceDetails] = await Promise.all([
                loadDraft(base, abort.signal),
                jsonRequest<{ archivedAt?: string | null }>(spaceUrl, { signal: abort.signal }),
            ]);
            if (!active) return;
            doc = new Y.Doc();
            Y.applyUpdate(doc, loaded.state);
            // Separate actors and browser tabs so acknowledging one tab cannot clear another's offline recovery.
            let tabId = sessionStorage.getItem('beskar:whiteboard-tab');
            if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem('beskar:whiteboard-tab', tabId); }
            const generation = loaded.manifest.restoreGeneration ?? '0';
            sequence(generation);
            const generationSuffix = generation === '0' ? '' : `:restore:${generation}`;
            const room = `v2:${space}:${page}${generationSuffix}`;
            const sessionKey = `${base}:${user.id}:${tabId}${generationSuffix}`;
            titleStorage.current = `${sessionKey}:title`;
            const storedTitle = localStorage.getItem(titleStorage.current);
            pendingTitle.current = storedTitle ? JSON.parse(storedTitle) : null;
            titleRef.current = pendingTitle.current?.title ?? loaded.manifest.title;
            setTitle(titleRef.current); setTitlePending(Boolean(pendingTitle.current));
            recovery = new IndexedDbYjsRecoveryAdapter(sessionKey, page);
            await recovery.hydrate(doc);
            if (!active) return;
            const durability = new YjsDurabilityCoordinator({ sessionKey, draftId: page, clientId: tabId,
                durableRevision: loaded.manifest.headSequence, acknowledgedStateDigest: await digest(loaded.state),
                persistence: new CheckpointAdapter(base, loaded.state, generation), recovery });
            const provider = new WebrtcProvider(room, doc, { signaling: [getSignalingUrl()], filterBcConns: false });
            let archived = Boolean(spaceDetails.archivedAt);
            let paused = archived;
            if (archived) { provider.disconnect(); setAccessDenied(true); setSyncError('This space is archived and read-only.'); }
            let titleSequence = sequence(loaded.manifest.headSequence);
            let cache = loaded.cache;
            let syncing: ReturnType<typeof loadDraft> | null = null;
            let renaming: Promise<void> | null = null;
            const saveTitle = (): Promise<void> => {
                if (renaming) return renaming.then(() => saveTitle());
                const change = pendingTitle.current;
                if (!change) return Promise.resolve();
                const normalized = change.title.trim();
                if (!normalized || [...normalized].length > 255 || normalized.includes('\0')) return Promise.reject(new Error('Title must contain 1–255 characters.'));
                renaming = post<{ sequence: string }>(`${base}/checkpoint`, { updateEncoding: 'yjs-update-v1', update: 'AAA=', title: normalized, restoreGeneration: generation }, change.key, abort.signal).then(receipt => {
                    titleSequence = sequence(receipt.sequence) > titleSequence ? sequence(receipt.sequence) : titleSequence;
                    if (pendingTitle.current === change) {
                        pendingTitle.current = null;
                        localStorage.removeItem(titleStorage.current);
                        titleRef.current = normalized;
                        if (active) { setTitle(normalized); setTitlePending(false); }
                    }
                    provider.awareness.setLocalStateField('titleSequence', receipt.sequence);
                }).finally(() => { renaming = null; });
                return renaming;
            };
            const sync = () => {
                if (syncing) return syncing;
                syncing = Promise.all([
                    loadDraft(base, abort.signal, cache),
                    jsonRequest<{ archivedAt?: string | null }>(spaceUrl, { signal: abort.signal }),
                ]).then(([next, details]) => {
                    if (!active) throw new Error('Editor closed');
                    if ((next.manifest.restoreGeneration ?? '0') !== generation) {
                        provider.disconnect(); setAccessDenied(true);
                        pendingPublish.current = null;
                        setNotice('The draft was restored. Loaded the restored version; previous local recovery is retained separately.');
                        setLoadAttempt(n => n + 1);
                        throw new WhiteboardApiError(409, 'WHITEBOARD_RESTORED', 'The draft was restored. Reloading…');
                    }
                    const nextArchived = Boolean(details.archivedAt);
                    archived = nextArchived;
                    if (archived !== paused) {
                        paused = archived;
                        setAccessDenied(paused);
                        if (paused) provider.disconnect();
                        else { provider.connect(); void durability.retryPending().catch(() => {}); }
                    }
                    setSyncError(archived ? 'This space is archived and read-only.' : '');
                    cache = next.cache;
                    Y.applyUpdate(doc!, next.state, 'v2-server-replay');
                    if (sequence(next.manifest.headSequence) >= titleSequence && !pendingTitle.current && !titleInputFocused.current) {
                        titleSequence = sequence(next.manifest.headSequence);
                        titleRef.current = next.manifest.title;
                        setTitle(next.manifest.title);
                    }
                    return next;
                }).finally(() => { syncing = null; });
                return syncing;
            };
            const syncHandlers = new Map<(synced: boolean) => void, (event: { synced: boolean }) => void>();
            const boardProvider = {
                awareness: provider.awareness,
                // Database hydration is complete; readiness must not require an online peer.
                synced: true,
                on(event: 'sync' | 'synced', handler: (synced: boolean) => void) {
                    if (event !== 'synced') return;
                    const wrapped = (value: { synced: boolean }) => handler(value.synced);
                    syncHandlers.set(handler, wrapped); provider.on('synced', wrapped);
                },
                off(event: 'sync' | 'synced', handler: (synced: boolean) => void) {
                    const wrapped = syncHandlers.get(handler);
                    if (event === 'synced' && wrapped) { provider.off('synced', wrapped); syncHandlers.delete(handler); }
                },
            };
            const collaborationUser = { ...user, color: '#7c6ee6' };
            owned = { doc, provider, durability, user: collaborationUser, sync, saveTitle,
                collaboration: { doc, provider: boardProvider, user: collaborationUser, boardIdentity: `v2:${space}:${page}`, bootstrapRevision: loaded.manifest.headSequence } };
            unsubscribe = durability.subscribeStatus(() => {
                if (!active) return;
                const next = durability.getSnapshot();
                setStatus(next);
                if (next.error instanceof WhiteboardApiError && ([401, 403, 404].includes(next.error.status) || ['SPACE_ARCHIVED', 'WHITEBOARD_RESTORED'].includes(next.error.code))) {
                    paused = true; provider.disconnect(); setAccessDenied(true);
                }
            });
            const updatePeers = () => {
                if (!active) return;
                setPeers(safeAwarenessEntries(provider.awareness.getStates()).map(({ user }) => user.name));
                const newerTitle = [...provider.awareness.getStates().values()].some(value => typeof value.titleSequence === 'string' && /^\d+$/.test(value.titleSequence) && BigInt(value.titleSequence) > titleSequence);
                if (newerTitle && !busyRef.current) void sync().catch(() => {});
            };
            provider.awareness.on('change', updatePeers);
            timer = setInterval(() => {
                if (!navigator.onLine || busyRef.current) return;
                void Promise.all([saveTitle(), sync()]).catch(e => {
                    if (!active) return;
                    setSyncError(e.message);
                    if (e instanceof WhiteboardApiError && ([401, 403, 404].includes(e.status) || ['SPACE_ARCHIVED', 'WHITEBOARD_RESTORED'].includes(e.code))) {
                        paused = true; provider.disconnect(); setAccessDenied(true);
                    }
                });
            }, 10000);
            if (active) { setSession(owned); setStatus(durability.getSnapshot()); }
        };
        void start().catch(e => { if (active) setError(e.message); });
        return () => {
            active = false; abort.abort(); clearInterval(timer); unsubscribe?.();
            owned?.provider.destroy();
            void (owned ? owned.durability.dispose('cancel') : recovery?.dispose());
            doc?.destroy();
        };
    }, [base, page, space, loadAttempt]);

    useEffect(() => {
        if (!session || !board) return;
        return session.durability.attach(board.checkpoints);
    }, [session, board]);
    useEffect(() => {
        const unload = (event: BeforeUnloadEvent) => {
            if (status?.phase !== 'clean' || pendingTitle.current) { event.preventDefault(); event.returnValue = ''; }
        };
        const reconnect = () => { if (session && !busyRef.current) void Promise.all([session.saveTitle(), session.sync()]).catch(e => setSyncError(e.message)); };
        window.addEventListener('beforeunload', unload);
        window.addEventListener('online', reconnect);
        window.addEventListener('focus', reconnect);
        return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('online', reconnect); window.removeEventListener('focus', reconnect); };
    }, [status, session]);

    const rename = (value: string) => {
        setTitle(value); titleRef.current = value;
        pendingTitle.current = { title: value, key: crypto.randomUUID() };
        setTitlePending(true);
        try { localStorage.setItem(titleStorage.current, JSON.stringify(pendingTitle.current)); }
        catch { setError('Local title recovery is unavailable. Keep this tab open until the title is saved.'); }
    };
    const run = async (publish: boolean) => {
        if (!session || !board || busyRef.current) return;
        if (accessDenied) { if (!publish) navigate(`/space/${space}/view/${page}`); return; }
        busyRef.current = true; setBusy(true); setError(''); setNotice('');
        const fence = board.acquireMutationFence(publish ? 'publish' : 'close');
        try {
            if (publish && pendingPublish.current) {
                await post(`${base}/publish`, pendingPublish.current.body, pendingPublish.current.key);
                pendingPublish.current = null;
                setNotice('Published successfully.');
                return;
            }
            await board.settleActiveEdit('commit');
            await session.saveTitle();
            await session.durability.flush(await board.captureProjectionTarget());
            if (!publish) { navigate(`/space/${space}/view/${page}`); return; }
            // Other editors may have saved changes this tab has not seen yet. Preview a verified server boundary.
            for (let attempt = 0; attempt < 3; attempt++) {
                const server = await session.sync();
                const target = await board.captureProjectionTarget();
                if (target.yjs.stateDigest !== await digest(server.state)) {
                    await session.durability.flush(target);
                    continue;
                }
                const preview = await createPublishPreview(board, { target });
                const after = await board.captureProjectionTarget();
                if (after.yjs.stateDigest !== target.yjs.stateDigest) continue;
                pendingPublish.current = { key: crypto.randomUUID(), body: { sequence: server.manifest.headSequence, preview } };
                await post<PublishedBoard>(`${base}/publish`, pendingPublish.current.body, pendingPublish.current.key);
                pendingPublish.current = null;
                setNotice('Published successfully.');
                return;
            }
            throw new Error('The board changed while preparing the preview. Please publish again once edits settle.');
        } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save whiteboard'); }
        finally { fence.release(); busyRef.current = false; setBusy(false); }
    };

    if (!session) return <Flex direction="column" align="center" gap="3" p="5">{error ? <><Text role="alert">{error}</Text><Button onClick={() => setLoadAttempt(n => n + 1)}>Retry</Button></> : <Spinner />}</Flex>;
    return <div style={{ height: 'calc(100vh - 57px)', marginTop: -17, display: 'flex', flexDirection: 'column' }}>
        <Flex align="center" gap="3" px="4" py="3" style={{ borderBottom: '1px solid #ddd' }}>
            <input aria-label="Whiteboard title" value={title} disabled={busy || accessDenied} onFocus={() => { titleInputFocused.current = true; }}
                onChange={e => rename(e.target.value)} onBlur={() => { titleInputFocused.current = false; void session.saveTitle().catch(e => setError(e.message)); }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} style={{ flex: 1, minWidth: 100, padding: 6 }} />
            <Text size="1" role="status">{titlePending ? 'Title unsaved' : status?.phase === 'clean' ? 'Saved' : status?.phase === 'saving' ? 'Saving…' : status?.phase === 'offline' ? 'Saved locally' : status?.phase === 'dirty' ? 'Unsaved' : 'Save error'}</Text>
            <Text size="1" title={peers.join(', ')}>{Math.max(1, peers.length)} editing</Text>
            <WhiteboardHistoryV2 key={`${space}:${page}`} spaceId={space} pageId={page} canRestore={!accessDenied && !busy} onRestored={() => { pendingPublish.current = null; setLoadAttempt(n => n + 1); }} />
            <Button onClick={() => void run(true)} disabled={busy || !board || accessDenied}>{pendingPublish.current ? 'Retry publish' : 'Publish'}</Button>
            <Button variant="soft" onClick={() => void run(false)} disabled={busy || !board}>Close</Button>
        </Flex>
        {error || syncError || status?.error ? <Text role="alert" color="red" size="2" mx="4">{error || syncError || status?.error?.message}</Text> : null}
        {notice ? <Text role="status" color="green" size="2" mx="4">{notice}</Text> : null}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <Glideboard ref={boardRef} key={session.doc.guid} sessionKey={session.doc.guid} collaboration={session.collaboration} readOnly={accessDenied} />
        </div>
    </div>;
}
