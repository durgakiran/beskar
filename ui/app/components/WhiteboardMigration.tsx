import '@durgakiran/glideboard/styles.css';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Button, Flex, Spinner, Text } from '@radix-ui/themes';
import { Glideboard, type GlideboardHandle } from '@durgakiran/glideboard';
import { boardUrl, jsonRequest, post, WhiteboardApiError } from 'app/core/whiteboard/v2/api';
import { hasLegacyRecovery, loadMigrationDocument, prepareMigration, type MigrationRequest, type MigrationSource } from 'app/core/whiteboard/v2/migration';
import { WhiteboardMigrationAssetStorage } from 'app/core/whiteboard/v2/WhiteboardMigrationAssetStorage';

const LegacyEditor = lazy(() => import('./WhiteboardEditor'));
const V2Editor = lazy(() => import('./WhiteboardEditorV2'));
type Session = {
    source: MigrationSource;
    doc: Awaited<ReturnType<typeof loadMigrationDocument>>;
    assetStorage: WhiteboardMigrationAssetStorage;
    assetResolutionContext: { documentId: string };
    signal: AbortSignal;
    collaboration: { doc: Awaited<ReturnType<typeof loadMigrationDocument>>; boardIdentity: string; provider: { synced: boolean } };
};

export default function WhiteboardMigration({ slug }: { slug: string[] }) {
    // Route ownership also isolates an uncertain POST's immutable body and key.
    return <MigrationSession key={JSON.stringify(slug.slice(0, 2))} slug={slug} />;
}

function MigrationSession({ slug }: { slug: string[] }) {
    const [space, page] = slug;
    const base = boardUrl(space, page);
    const [session, setSession] = useState<Session | null>(null);
    const [binding, setBinding] = useState<{ session: Session; board: GlideboardHandle } | null>(null);
    const [mode, setMode] = useState<'migration' | 'v2' | 'legacy'>('migration');
    const [error, setError] = useState('');
    const [phase, setPhase] = useState('Preparing whiteboard migration…');
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [sendAttempt, setSendAttempt] = useState(0);
    const [pending, setPending] = useState<{ session: Session; key: string; body: MigrationRequest } | null>(null);
    const boardRef = useCallback((value: GlideboardHandle | null) => setBinding(value && session ? { session, board: value } : null), [session]);

    useEffect(() => {
        if (mode !== 'migration') return;
        let active = true;
        const abort = new AbortController();
        let owned: Session['doc'] | null = null;
        let assets: WhiteboardMigrationAssetStorage | null = null;
        setError(''); setSession(null); setBinding(null); setPending(null); setPhase('Preparing whiteboard migration…');
        void (async () => {
            const source = await jsonRequest<MigrationSource>(`${base}/migration-source`, { signal: abort.signal });
            if (!active) return;
            if (source.contentApiVersion === 2) { setMode('v2'); return; }
            if (await hasLegacyRecovery(space, page, source.sourceDocId)) throw new Error('Unsaved changes are retained in this browser. Open the existing editor to save them before migrating.');
            if (!active) return;
            owned = await loadMigrationDocument(source, space, page, abort.signal);
            if (!active) { owned.destroy(); return; }
            assets = new WhiteboardMigrationAssetStorage({ pageId: page, sourceDocId: source.sourceDocId, signal: abort.signal });
            setSession({ source, doc: owned, assetStorage: assets, assetResolutionContext: { documentId: source.sourceDocId }, signal: abort.signal,
                collaboration: { doc: owned, boardIdentity: `v2:${space}:${page}`, provider: { synced: true } } });
        })().catch(e => { if (active) setError(e.message); });
        return () => { active = false; abort.abort(); assets?.dispose(); owned?.destroy(); };
    }, [base, space, page, loadAttempt, mode]);

    useEffect(() => {
        if (!session || !binding || binding.session !== session || mode !== 'migration') return;
        let active = true;
        const abort = new AbortController();
        void prepareMigration(binding.board, session.doc, session.source, abort.signal).then(body => {
            if (active && !session.signal.aborted) { setPhase('Publishing migrated whiteboard…'); setPending({ session, key: crypto.randomUUID(), body }); }
        }).catch(e => { if (active && !session.signal.aborted) setError(e.message); });
        return () => { active = false; abort.abort(); };
    }, [session, binding, mode]);

    useEffect(() => {
        if (!pending || pending.session !== session || session.signal.aborted || mode !== 'migration') return;
        let active = true;
        const abort = new AbortController();
        setError('');
        void post(`${base}/migrate`, pending.body, pending.key, abort.signal).then(() => {
            if (active) { setPending(null); setMode('v2'); }
        }).catch(e => {
            if (!active) return;
            if (e instanceof WhiteboardApiError && e.code === 'WHITEBOARD_MIGRATED') { setPending(null); setMode('v2'); return; }
            if (e instanceof WhiteboardApiError && !e.retryable) setPending(null);
            setError(e.message);
        });
        return () => { active = false; abort.abort(); };
    }, [base, pending, session, sendAttempt, mode]);

    // An uncertain POST keeps the exact bytes and key in this mounted host.
    // Reload can safely discover a committed board through migration-source.
    useEffect(() => {
        const unload = (event: BeforeUnloadEvent) => { if (pending) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', unload);
        return () => window.removeEventListener('beforeunload', unload);
    }, [pending]);

    if (mode === 'v2') return <Suspense fallback={<Spinner />}><V2Editor slug={slug} /></Suspense>;
    if (mode === 'legacy') return <Suspense fallback={<Spinner />}><LegacyEditor slug={slug} /></Suspense>;
    return <Flex direction="column" height="100%" gap="3">
        <Flex align="center" gap="3" p="3">
            {error ? <>
                <Text role="alert">{error}</Text>
                <Button onClick={() => pending ? setSendAttempt(n => n + 1) : setLoadAttempt(n => n + 1)}>{pending ? 'Retry publication' : 'Retry migration'}</Button>
                {!pending && <Button variant="soft" onClick={() => setMode('legacy')}>Open existing editor</Button>}
            </> : <><Spinner /><Text role="status">{phase}</Text></>}
        </Flex>
        {session && <div style={{ flex: 1, minHeight: 300, pointerEvents: 'none' }} inert>
            <Glideboard key={session.doc.guid} ref={boardRef} sessionKey={session.doc.guid} collaboration={session.collaboration}
                assetStorage={session.assetStorage} assetResolutionContext={session.assetResolutionContext} readOnly />
        </div>}
    </Flex>;
}
