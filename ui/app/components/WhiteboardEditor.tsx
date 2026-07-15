
import { useGet, Response } from "@http/hooks";
import { useCallback, useEffect, useMemo, useState, useRef, type RefObject } from "react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { Spinner, Flex, Button, IconButton, Avatar, HoverCard, Box, Text } from "@radix-ui/themes";
import { base64ToUint8Array, uint8ArrayToBase64 } from "app/core/utils/base64";
import { useNavigate } from "react-router-dom";
import { HiHome } from "react-icons/hi";
import { FiStar } from "react-icons/fi";
import { getSignalingUrl } from "app/core/signaling";
import { Glideboard, type GlideboardHandle } from "@durgakiran/glideboard";

const USER_URI = (import.meta.env.VITE_USER_SERVER_URL || "").replace(/\/+$/, "");
const INITIAL_DATABASE_LOAD = Symbol('whiteboard-initial-database-load');

interface WhiteboardData {
    id: number;
    docId: number;
    data?: string | null;
    title: string;
    pageId: number;
    spaceId: string;
}

interface BoardLoadState {
    sessionKey: string;
    status: 'loading' | 'ready' | 'error';
    data: WhiteboardData | null;
    error: unknown;
}

interface DocumentSession {
    doc: Y.Doc;
    save: {
        dirty: boolean;
        revision: number;
        inFlight: Promise<void> | null;
    };
}

export default function WhiteboardEditor({
    slug,
    readOnly = false,
    fillParent = false,
}: {
    slug: string[];
    readOnly?: boolean;
    fillParent?: boolean;
}) {
    const spaceId = slug[0];
    const pageId = slug[1];
    const navigate = useNavigate();
    const fetchPath = readOnly
        ? `editor/space/${spaceId}/whiteboard/${pageId}`
        : `editor/space/${spaceId}/whiteboard/${pageId}/edit`;
    const [{ data: profileData }, getProfile] = useGet<Response<{ id: string; name: string; email: string }>>(`profile/details`);

    const documentSessionKey = `${spaceId}:${pageId}`;
    const boardRequestRef = useRef({
        sessionKey: documentSessionKey,
        path: fetchPath,
    });
    // The request path is startup configuration for a board session. Capture
    // a new path only when the board identity changes; toggling readOnly for
    // the same board must update policy without reloading its Y.Doc.
    if (boardRequestRef.current.sessionKey !== documentSessionKey) {
        boardRequestRef.current = { sessionKey: documentSessionKey, path: fetchPath };
    }
    const boardRequest = boardRequestRef.current;
    const [boardLoad, setBoardLoad] = useState<BoardLoadState>({
        sessionKey: documentSessionKey,
        status: 'loading',
        data: null,
        error: null,
    });
    const [providerSession, setProviderSession] = useState<{
        sessionKey: string;
        provider: WebrtcProvider;
    } | null>(null);
    const yDocLifetimeGenerationsRef = useRef(new WeakMap<Y.Doc, number>());
    const boardRef = useRef<GlideboardHandle | null>(null);
    const getProfileRef = useRef(getProfile);
    getProfileRef.current = getProfile;
    // React preserves state while route props change. Until the new session's
    // request is accepted, expose a loading state instead of briefly showing
    // the previous board's title, error, or loaded status.
    const currentBoardLoad = boardLoad.sessionKey === documentSessionKey
        ? boardLoad
        : { sessionKey: documentSessionKey, status: 'loading' as const, data: null, error: null };
    const fetching = currentBoardLoad.status === 'loading';
    const fetchErr = currentBoardLoad.status === 'error' ? currentBoardLoad.error : null;
    const boardData = currentBoardLoad.status === 'ready' ? currentBoardLoad.data : null;
    const isDbLoaded = currentBoardLoad.status === 'ready';
    const provider = !readOnly && providerSession?.sessionKey === documentSessionKey
        ? providerSession.provider
        : null;

    const collaborationUser = useMemo(() => {
        if (!profileData?.data) return null;
        const r = Math.floor(Math.random() * 106) + 150;
        const g = Math.floor(Math.random() * 106) + 150;
        const b = Math.floor(Math.random() * 106) + 150;
        const color = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
        return { id: profileData.data.id, name: profileData.data.name, color };
    }, [profileData]);

    const documentSession = useMemo<DocumentSession>(() => ({
        doc: new Y.Doc(),
        save: { dirty: false, revision: 0, inFlight: null },
    }), [documentSessionKey]);
    const yDoc = documentSession.doc;

    useEffect(() => {
        const generations = yDocLifetimeGenerationsRef.current;
        const generation = (generations.get(yDoc) ?? 0) + 1;
        generations.set(yDoc, generation);

        return () => {
            // Defer destruction for two reasons:
            // 1. StrictMode immediately reattaches the same Y.Doc and advances
            //    its generation, so this simulated cleanup must do nothing.
            // 2. A real route change/unmount may have started a final save, so
            //    keep the document alive until that save has finished.
            queueMicrotask(async () => {
                if (generations.get(yDoc) !== generation) return;
                while (documentSession.save.inFlight) {
                    try {
                        await documentSession.save.inFlight;
                    } catch {
                        break;
                    }
                }
                if (generations.get(yDoc) !== generation) return;
                generations.delete(yDoc);
                yDoc.destroy();
            });
        };
    }, [documentSession, yDoc]);

    useEffect(() => {
        if (readOnly) return; // no collaboration in view mode
        const _provider = new WebrtcProvider(pageId + "-space-" + spaceId, yDoc, {
            signaling: [getSignalingUrl()],
            filterBcConns: false
        });
        setProviderSession({ sessionKey: documentSessionKey, provider: _provider });
        return () => {
            _provider.disconnect();
            _provider.destroy();
            setProviderSession(current => current?.provider === _provider ? null : current);
        };
    }, [documentSessionKey, yDoc, spaceId, pageId, readOnly]);

    useEffect(() => {
        const abortController = new AbortController();
        let active = true;
        setBoardLoad({
            sessionKey: boardRequest.sessionKey,
            status: 'loading',
            data: null,
            error: null,
        });
        getProfileRef.current();

        const loadBoard = async () => {
            try {
                const response = await fetch(`${USER_URI}/${boardRequest.path}`, {
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    signal: abortController.signal,
                });
                if (!response.ok) {
                    throw new Error(`Failed to load whiteboard (${response.status})`);
                }

                const result = await response.json() as Response<WhiteboardData>;
                if (!active || abortController.signal.aborted) return;
                const data = result.data;
                if (
                    !data ||
                    String(data.pageId) !== String(pageId) ||
                    String(data.spaceId).toLowerCase() !== String(spaceId).toLowerCase()
                ) {
                    throw new Error('Whiteboard response does not match the requested session');
                }

                if (data.data) {
                    Y.applyUpdate(
                        yDoc,
                        base64ToUint8Array(data.data),
                        INITIAL_DATABASE_LOAD,
                    );
                }

                if (!active) return;
                setBoardLoad({
                    sessionKey: boardRequest.sessionKey,
                    status: 'ready',
                    data,
                    error: null,
                });
            } catch (error) {
                if (!active || abortController.signal.aborted) return;
                console.error('Error loading whiteboard', error);
                setBoardLoad({
                    sessionKey: boardRequest.sessionKey,
                    status: 'error',
                    data: null,
                    error,
                });
            }
        };

        void loadBoard();
        return () => {
            active = false;
            abortController.abort();
        };
    }, [boardRequest, documentSession, pageId, spaceId, yDoc]);

    const persistYDoc = useCallback(async (keepalive = false): Promise<void> => {
        const save = documentSession.save;
        if (readOnly || !isDbLoaded) return;

        while (save.dirty) {
            if (save.inFlight) {
                await save.inFlight;
                continue;
            }

            const revision = save.revision;
            const data = uint8ArrayToBase64(Y.encodeStateAsUpdate(yDoc));
            const savePromise = (async () => {
                const response = await fetch(
                    `${USER_URI}/editor/space/${spaceId}/whiteboard/${pageId}`,
                    {
                        method: 'PUT',
                        credentials: 'include',
                        keepalive,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data }),
                    },
                );
                if (!response.ok) {
                    throw new Error(`Failed to save whiteboard (${response.status})`);
                }
            })();
            save.inFlight = savePromise;

            try {
                await savePromise;
                if (save.revision === revision) save.dirty = false;
            } finally {
                if (save.inFlight === savePromise) save.inFlight = null;
            }
        }
    }, [documentSession, isDbLoaded, pageId, readOnly, spaceId, yDoc]);

    useEffect(() => {
        if (readOnly) return;

        const handleUpdate = (_update: Uint8Array, origin: unknown) => {
            if (origin === INITIAL_DATABASE_LOAD) return;
            documentSession.save.dirty = true;
            documentSession.save.revision += 1;
        };
        yDoc.on('update', handleUpdate);

        const syncInterval = setInterval(() => {
            void persistYDoc().catch(error => {
                console.error('Error saving whiteboard', error);
            });
        }, 5000);

        const handlePageHide = () => {
            void persistYDoc(true).catch(() => {
                // The browser may terminate the page before reporting failure.
            });
        };
        window.addEventListener('pagehide', handlePageHide);

        return () => {
            yDoc.off('update', handleUpdate);
            clearInterval(syncInterval);
            window.removeEventListener('pagehide', handlePageHide);
            void persistYDoc(true).catch(error => {
                console.error('Error flushing whiteboard during cleanup', error);
            });
        };
    }, [documentSession, persistYDoc, readOnly, yDoc]);

    const [isPublishing, setIsPublishing] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [activeCollaborators, setActiveCollaborators] = useState<
        Array<{ id: string; name: string; email?: string; color?: string }>
    >([]);

    useEffect(() => {
        if (!provider) {
            setActiveCollaborators([]);
            return;
        }

        const syncCollaborators = () => {
            const states = Array.from(provider.awareness.getStates().values());
            const nextCollaborators = states
                .map((state) => state?.user as { id?: string; name?: string; email?: string; color?: string } | undefined)
                .filter((candidate): candidate is { id: string; name: string; email?: string; color?: string } => Boolean(candidate?.id && candidate?.name));

            const deduped = Array.from(
                new Map(nextCollaborators.map((candidate) => [candidate.id, candidate])).values(),
            );

            setActiveCollaborators(deduped);
        };

        syncCollaborators();
        provider.awareness.on("change", syncCollaborators);
        return () => {
            provider.awareness.off("change", syncCollaborators);
        };
    }, [provider]);

    const visibleCollaborators = activeCollaborators.slice(0, 3);

    if (fetchErr) {
        return <Flex>Error loading whiteboard.</Flex>;
    }

    if (fetching || !isDbLoaded || (!readOnly && !provider)) {
        return (
            <Flex justify="center" style={{ marginTop: '20vh' }}>
                <Spinner size="3" />
            </Flex>
        );
    }

    const handleClose = async () => {
        setIsClosing(true);
        try {
            await boardRef.current?.flush();
            await persistYDoc();
            setIsClosing(false);
            navigate(`/space/${spaceId}/view/${pageId}`);
        } catch (error) {
            console.error('Failed to save before closing whiteboard', error);
            alert('Could not save the latest whiteboard changes. Please try again.');
            setIsClosing(false);
        }
    };

    const handlePublish = async () => {
        setIsPublishing(true);
        try {
            // 1. SVG snapshot
            const board = boardRef.current;
            if (!board) throw new Error('Whiteboard is not ready');
            await board.flush();
            await persistYDoc();
            const hasShapes = board.serialize().records.some((record) => 'x' in record && 'y' in record);
            
            let previewAssetName = '';
            if (hasShapes) {
                const svgString = await board.exportSvg();
                const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
                
                const formData = new FormData();
                formData.append('file', svgBlob, 'whiteboard-preview.svg');
                formData.append('pageId', pageId);
                
                const uploadRes = await fetch('/api/v1/media/upload', {
                    method: 'POST',
                    body: formData,
                });
                
                if (uploadRes.ok) {
                    const uploadJson = await uploadRes.json();
                    previewAssetName = uploadJson.data?.name ?? '';
                }
            }

            // 2. Yjs state
            const encoded = uint8ArrayToBase64(Y.encodeStateAsUpdate(yDoc));

            // 3. Publish
            const publishRes = await fetch(
                `/api/v1/editor/space/${spaceId}/whiteboard/${pageId}/publish`,
                {
                    method: 'PUT', // Route in editorController.go is PUT
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: encoded, previewAssetName }),
                }
            );

            if (!publishRes.ok) throw new Error('Publish failed');
            
        } catch (e: any) {
            console.error(e);
            alert(e.message ?? 'Publish failed');
        } finally {
            setIsPublishing(false);
        }
    };

    const pageTitle = boardData?.title || 'Untitled Whiteboard';

    // Edit mode: pull flush under the fixed navbar, with our own sub-header.
    // View mode: the page already has a header, so render canvas directly.
    if (!readOnly) {
        return (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: 'calc(100vh - 57px)',
                    marginTop: '-17px',
                    width: '100%',
                    maxWidth: '100%',
                    minWidth: 0,
                    overflow: 'hidden',
                }}
            >
                {/* Header — same visual language as FixedMenu in the document editor */}
                <Flex
                    align="center"
                    justify="between"
                    py="3"
                    px="4"
                    gap="4"
                    style={{
                        width: '100%',
                        maxWidth: '100%',
                        minWidth: 0,
                        borderBottom: '1px solid var(--gray-6)',
                        minHeight: '52px',
                        backgroundColor: 'white',
                        position: 'sticky',
                        top: 0,
                        zIndex: 10,
                    }}
                >
                    {/* Left: Home icon */}
                    <Flex align="center" gap="2" pr="4" style={{ borderRight: '1px solid var(--gray-6)', height: '32px', flexShrink: 0 }}>
                        <IconButton
                            variant="ghost"
                            size="2"
                            aria-label="home"
                            onClick={handleClose}
                            disabled={isClosing}
                            style={{ height: '32px', width: '32px' }}
                        >
                            <HiHome size={18} />
                        </IconButton>
                    </Flex>

                    {/* Center: Page title */}
                    <Flex style={{ flex: 1, minWidth: 0 }} align="center">
                        <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--gray-11)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pageTitle}
                        </span>
                    </Flex>

                    {/* Right: Publish & Close button */}
                    <Flex align="center" gap="3" style={{ flexShrink: 0 }}>
                        <Flex align="center" gap="2">
                            {visibleCollaborators.length ? (
                                <Flex align="center" style={{ marginRight: "4px" }}>
                                    {visibleCollaborators.map((collaborator, index) => (
                                        <HoverCard.Root key={collaborator.id} openDelay={120} closeDelay={100}>
                                            <HoverCard.Trigger>
                                                <span
                                                    aria-label={`${collaborator.name} profile`}
                                                    style={{
                                                        position: "relative",
                                                        marginLeft: index === 0 ? 0 : -6,
                                                        display: "inline-block",
                                                        lineHeight: 0,
                                                        cursor: "default",
                                                        verticalAlign: "middle",
                                                    }}
                                                >
                                                    <Avatar
                                                        fallback={collaborator.name.charAt(0).toUpperCase()}
                                                        radius="full"
                                                        size="2"
                                                        style={{
                                                            backgroundColor: collaborator.color || "#f1eff4",
                                                            color: "#221f26",
                                                            border: "2px solid white",
                                                        }}
                                                    />
                                                </span>
                                            </HoverCard.Trigger>
                                            <HoverCard.Content
                                                size="2"
                                                side="top"
                                                sideOffset={8}
                                                style={{ minWidth: 220, maxWidth: 280 }}
                                            >
                                                <Flex gap="3" align="start">
                                                    <Avatar
                                                        fallback={collaborator.name.charAt(0).toUpperCase()}
                                                        radius="full"
                                                        size="2"
                                                        style={{
                                                            backgroundColor: collaborator.color || "#f1eff4",
                                                            color: "#221f26",
                                                            border: "2px solid white",
                                                            flexShrink: 0,
                                                        }}
                                                    />
                                                    <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                                                        <Text size="2" weight="medium" className="text-[#221f26]">
                                                            {collaborator.name}
                                                        </Text>
                                                        {collaborator.email ? (
                                                            <Text size="1" className="text-[#605c67] break-all">
                                                                {collaborator.email}
                                                            </Text>
                                                        ) : (
                                                            <Text size="1" className="text-[#898492]">
                                                                Email not shared
                                                            </Text>
                                                        )}
                                                    </Flex>
                                                </Flex>
                                            </HoverCard.Content>
                                        </HoverCard.Root>
                                    ))}
                                </Flex>
                            ) : null}
                            <Text size="2" className="text-[#898492]">
                                {activeCollaborators.length > 0
                                    ? `${activeCollaborators.length} editing`
                                    : "Solo editing"}
                            </Text>
                        </Flex>

                        <Flex align="center" gap="2">
                            <Button 
                                size="2" 
                                variant="solid" 
                                color="blue" 
                                onClick={handlePublish}
                                disabled={isPublishing}
                                loading={isPublishing}
                            >
                                Publish
                            </Button>
                            <Button size="2" variant="ghost" color="gray" onClick={handleClose} disabled={isClosing} loading={isClosing}>
                                Close
                            </Button>
                        </Flex>
                    </Flex>
                </Flex>

                {/* Canvas */}
                <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                    <WhiteboardCanvas boardRef={boardRef} sessionKey={documentSessionKey} yDoc={yDoc} provider={provider} fetchErr={fetchErr} readOnly={readOnly} collaborationUser={collaborationUser} />
                </div>
            </div>
        );
    }

    // View mode: render canvas directly, no sub-header
    return (
        <div style={{ width: '100%', height: fillParent ? '100%' : 'calc(100vh - 120px)' }}>
            <WhiteboardCanvas boardRef={boardRef} sessionKey={documentSessionKey} yDoc={yDoc} provider={provider} fetchErr={fetchErr} readOnly={readOnly} collaborationUser={collaborationUser} />
        </div>
    );
}

function WhiteboardCanvas({
    boardRef,
    sessionKey,
    yDoc,
    provider,
    fetchErr,
    readOnly,
    collaborationUser,
}: {
    boardRef: RefObject<GlideboardHandle | null>;
    sessionKey: string;
    yDoc: Y.Doc;
    provider: WebrtcProvider | null;
    fetchErr: any;
    readOnly: boolean;
    collaborationUser: { id: string; name: string; color: string } | null;
}) {
    if (fetchErr) {
        return <Flex>Error loading whiteboard.</Flex>;
    }

    const collaborationProps = useMemo(() => ({
        doc: yDoc,
        provider: provider as any,
        user: collaborationUser,
    }), [yDoc, provider, collaborationUser]);

    return (
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <Glideboard
                ref={boardRef}
                sessionKey={sessionKey}
                collaboration={collaborationProps}
                readOnly={readOnly}
            />
        </div>
    );
}
