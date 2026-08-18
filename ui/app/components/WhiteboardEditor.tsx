
import { useGet, Response } from "@http/hooks";
import { useEffect, useMemo, useState, useRef, type MutableRefObject } from "react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { Spinner, Flex, Button, IconButton, Avatar, HoverCard, Box, Text } from "@radix-ui/themes";
import { base64ToUint8Array, uint8ArrayToBase64 } from "app/core/utils/base64";
import { useNavigate } from "react-router-dom";
import { HiHome } from "react-icons/hi";
import { FiStar } from "react-icons/fi";
import { getSignalingUrl } from "app/core/signaling";
import {
    Glideboard,
    safeAwarenessEntries,
    type GlideboardAssetStorage,
    type GlideboardHandle,
} from "@durgakiran/glideboard";
import { IndexedDbYjsRecoveryAdapter } from "app/core/whiteboard/durability/IndexedDbYjsRecoveryAdapter";
import { UnavailableYjsRecoveryAdapter } from "app/core/whiteboard/durability/UnavailableYjsRecoveryAdapter";
import { WhiteboardCheckpointHttpAdapter } from "app/core/whiteboard/durability/WhiteboardCheckpointHttpAdapter";
import { YjsDurabilityCoordinator } from "app/core/whiteboard/durability/YjsDurabilityCoordinator";
import type { DurabilityStatus, YjsRecoveryAdapter } from "app/core/whiteboard/durability/types";
import { getApiV1Base } from "app/core/http/apiBase";

const USER_URI = (import.meta.env.VITE_USER_SERVER_URL || "").replace(/\/+$/, "");
const INITIAL_DATABASE_LOAD = Symbol('whiteboard-initial-database-load');
const CONFLICT_MERGE_ORIGIN = Symbol('whiteboard-conflict-merge');

interface WhiteboardData {
    id: number;
    docId: number;
    data?: string | null;
    title: string;
    pageId: number;
    spaceId: string;
    durableRevision?: string;
    stateDigest?: string;
    serverUpdateSequence?: number;
}

interface BoardLoadState {
    sessionKey: string;
    status: 'loading' | 'ready' | 'error';
    data: WhiteboardData | null;
    error: unknown;
}

interface DocumentSession {
    doc: Y.Doc;
    durability: YjsDurabilityCoordinator | null;
}

function getOrCreateWhiteboardClientId(): string {
    const key = "beskar:whiteboard-client-id";
    try {
        const existing = localStorage.getItem(key);
        if (existing) return existing;
        const created = crypto.randomUUID();
        localStorage.setItem(key, created);
        return created;
    } catch {
        return crypto.randomUUID();
    }
}

export function trustedPortableAssetRequest(reference: string, apiV1: string): { url: string; credentials: RequestCredentials } {
    const apiBase = new URL(`${apiV1.replace(/\/+$/, "")}/`, window.location.origin);
    let target: URL;
    try {
        target = new URL(reference, window.location.origin);
    } catch {
        throw new Error("Portable whiteboard asset reference is invalid");
    }
    const escapedApiPath = apiBase.pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mediaPath = new RegExp(`^${escapedApiPath}media/whiteboard-asset/[1-9]\\d*/[a-f0-9]{64}$`);
    if (target.origin !== window.location.origin || !mediaPath.test(target.pathname) || target.search || target.hash) {
        throw new Error("Portable whiteboard asset reference is not a trusted media URL");
    }
    return {
        url: target.href,
        credentials: "include",
    };
}

type AssetHttpCategory = 'invalid-content' | 'unsupported-format' | 'limit-exceeded' | 'storage' | 'network' | 'rate-limit' | 'permission' | 'conflict' | 'not-found';

function retryAfterMilliseconds(response: Response): number | undefined {
    const value = response.headers?.get?.("retry-after")?.trim();
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const date = Date.parse(value);
    if (!Number.isFinite(date)) return undefined;
    return Math.max(0, date - Date.now());
}

function waitForAssetRetry(delayMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException('Asset import cancelled', 'AbortError'));
    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        }, delayMs);
        const abort = () => {
            window.clearTimeout(timeout);
            reject(new DOMException('Asset import cancelled', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
    });
}

async function assetHttpError(response: Response, operation: string): Promise<Error> {
    let detail = "";
    try {
        detail = (await response.clone().text()).trim();
    } catch {
        // The status remains authoritative when a proxy body cannot be read.
    }
    const quotaDenied = response.status === 507 || /quota|storage limit|limit exceeded/i.test(detail);
    let category: AssetHttpCategory = 'storage';
    let retryable = response.status >= 500;
	if (response.status === 429) {
		category = 'rate-limit';
		retryable = true;
	} else if (quotaDenied || response.status === 413) {
        category = 'limit-exceeded';
        retryable = false;
    } else if (response.status === 401 || response.status === 403) {
        category = 'permission';
        retryable = false;
    } else if (response.status === 400 || response.status === 422) {
        category = 'invalid-content';
        retryable = false;
    } else if (response.status === 415) {
        category = 'unsupported-format';
        retryable = false;
    } else if (response.status === 409) {
        category = 'conflict';
        retryable = false;
    } else if (response.status === 404) {
        category = 'not-found';
        retryable = false;
    } else if ([502, 503, 504].includes(response.status)) {
        category = 'network';
        retryable = true;
    }
    return Object.assign(new Error(`${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`), {
        category,
        retryable,
		status: response.status,
		retryAfterMs: response.status === 429 ? retryAfterMilliseconds(response) : undefined,
    });
}

function assetFetchError(error: unknown, operation: string): unknown {
    if (error instanceof DOMException && error.name === 'AbortError') return error;
    if ((error as { category?: unknown } | null)?.category) return error;
    if (error instanceof TypeError) {
        return Object.assign(new Error(`${operation} failed: ${error.message}`), {
            category: 'network' as const,
            retryable: true,
            cause: error,
        });
    }
    return error;
}

function orphanCleanupError(message: string, errors: unknown[]): Error {
    return Object.assign(new Error(message), {
        name: 'AssetOrphanCleanupError',
        code: 'orphan-cleanup',
        category: 'storage' as const,
        retryable: true,
        cause: errors[0],
        errors,
    });
}

async function fetchAsset(input: RequestInfo | URL, init: RequestInit, operation: string): Promise<Response> {
    try {
        return await fetch(input, init);
    } catch (error) {
        throw assetFetchError(error, operation);
    }
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
    const activeDraftIdRef = useRef<string | null>(null);
    const draftTransitionInFlightRef = useRef<string | null>(null);
    const [durabilityStatus, setDurabilityStatus] = useState<DurabilityStatus | null>(null);
    const whiteboardClientId = useMemo(getOrCreateWhiteboardClientId, []);
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

    const whiteboardAssetStorage = useMemo<GlideboardAssetStorage>(() => {
        const apiV1 = getApiV1Base({ fallbackBase: import.meta.env.VITE_IMAGE_SERVER_URL });
        const prepare: GlideboardAssetStorage["prepare"] = async (asset, signal) => {
            const hash = String(asset.props.hash ?? "");
            const mimeType = String(asset.props.mimeType ?? "");
            if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid whiteboard asset identity");
            if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
                throw new Error("Unsupported whiteboard asset MIME type");
            }
            const stagingBase = `${apiV1}/media/whiteboard-asset/${encodeURIComponent(pageId)}/${hash}/staging`;
            const response = await fetchAsset(stagingBase, {
                method: "POST",
                credentials: "include",
                signal,
            }, "Whiteboard asset staging prepare");
            if (!response.ok) throw await assetHttpError(response, "Whiteboard asset staging prepare");
            const payload = await response.json() as { data?: { token?: unknown } };
            const token = payload.data?.token;
            if (typeof token !== "string" || !/^[a-f0-9-]{36}$/i.test(token)) {
                throw new Error("Whiteboard asset staging prepare returned an invalid token");
            }
			const transactionUrl = `${stagingBase}/${encodeURIComponent(token)}`;
			const rollback = async () => {
					const cleanupResponse = await fetchAsset(transactionUrl, { method: "DELETE", credentials: "include" }, "Whiteboard asset rollback");
					if (!cleanupResponse.ok) throw await assetHttpError(cleanupResponse, "Whiteboard asset rollback");
			};
			return {
                token,
                stage: async (bytes, stageSignal) => {
                    const body = new Uint8Array(bytes.byteLength);
                    body.set(bytes);
                    const stageResponse = await fetchAsset(transactionUrl, {
                        method: "PUT",
                        credentials: "include",
                        headers: { "Content-Type": mimeType, "X-Content-SHA256": hash },
                        body: body.buffer,
                        signal: stageSignal,
                    }, "Whiteboard asset staging upload");
                    if (!stageResponse.ok) throw await assetHttpError(stageResponse, "Whiteboard asset staging upload");
				},
					commit: async (commitSignal) => {
						let ambiguousError: unknown;
						for (let attempt = 0; attempt < 3; attempt += 1) {
							if (commitSignal.aborted) throw new DOMException('Asset import cancelled', 'AbortError');
							const retryController = new AbortController();
							const abortRetry = () => retryController.abort();
							commitSignal.addEventListener('abort', abortRetry, { once: true });
							const timeout = attempt === 0 ? null : window.setTimeout(abortRetry, 5_000);
							try {
								const commitResponse = await fetchAsset(`${transactionUrl}/commit`, {
									method: "POST",
									credentials: "include",
									signal: retryController.signal,
								}, "Whiteboard asset commit");
								if (!commitResponse.ok) throw await assetHttpError(commitResponse, "Whiteboard asset commit");
								if (commitSignal.aborted) throw new DOMException('Asset import cancelled', 'AbortError');
								return;
							} catch (error) {
								const mapped = assetFetchError(error, "Whiteboard asset commit");
								if (commitSignal.aborted) throw new DOMException('Asset import cancelled', 'AbortError');
								ambiguousError = mapped;
								if ((mapped as { retryable?: unknown } | null)?.retryable === false) break;
								const retryAfterMs = (mapped as { category?: unknown; retryAfterMs?: unknown } | null)?.category === 'rate-limit'
									? (mapped as { retryAfterMs?: unknown }).retryAfterMs
									: undefined;
								if (attempt < 2 && typeof retryAfterMs === 'number') {
									await waitForAssetRetry(retryAfterMs, commitSignal);
								}
							} finally {
								if (timeout !== null) window.clearTimeout(timeout);
								commitSignal.removeEventListener('abort', abortRetry);
							}
					}
					try {
						await rollback();
					} catch (rollbackError) {
							throw orphanCleanupError("Whiteboard asset commit outcome and rollback both failed", [ambiguousError, rollbackError]);
					}
					throw ambiguousError;
				},
				rollback,
            };
        };
        return {
        prepare,
        resolve(asset) {
            const hash = String(asset.props.hash ?? "");
            if (!/^[a-f0-9]{64}$/.test(hash)) return null;
            return `${apiV1}/media/whiteboard-asset/${encodeURIComponent(pageId)}/${hash}`;
        },
        async download(asset, signal) {
            const hash = String(asset.props.hash ?? "");
            if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid whiteboard asset identity");
            const response = await fetchAsset(
                `${apiV1}/media/whiteboard-asset/${encodeURIComponent(pageId)}/${hash}`,
                { credentials: "include", signal },
                "Whiteboard asset download",
            );
            if (!response.ok) throw await assetHttpError(response, "Whiteboard asset download");
            return {
                bytes: new Uint8Array(await response.arrayBuffer()),
                mimeType: response.headers.get("content-type")?.split(";", 1)[0] ?? "",
            };
        },
        async retainReferences(assetIds, context, signal) {
            const response = await fetchAsset(
                `${apiV1}/media/whiteboard-asset/${encodeURIComponent(pageId)}/retain`,
                {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ assetIds, context }),
                    signal,
                },
                "Whiteboard asset retention",
            );
            if (!response.ok) throw await assetHttpError(response, "Whiteboard asset retention");
        },
        async materializePortableAsset(payload, asset, _context, signal) {
            let bytes: Uint8Array;
            if (payload.kind === "embedded") {
                bytes = base64ToUint8Array(payload.base64);
                if (bytes.byteLength !== payload.byteLength) {
                    throw new Error("Portable whiteboard asset length mismatch");
                }
            } else {
                const request = trustedPortableAssetRequest(payload.reference, apiV1);
                const response = await fetchAsset(request.url, { credentials: request.credentials, signal }, "Portable whiteboard asset download");
                if (!response.ok) throw await assetHttpError(response, "Portable whiteboard asset download");
                bytes = new Uint8Array(await response.arrayBuffer());
            }
			const staged = await prepare(asset, signal);
			try {
				await staged.stage(bytes, signal);
				await staged.commit(signal);
				return { rollback: staged.rollback };
			} catch (error) {
				try {
					await staged.rollback();
				} catch (rollbackError) {
					throw orphanCleanupError("Portable whiteboard asset persistence and rollback both failed", [error, rollbackError]);
				}
				throw error;
			}
        },
    };
    }, [pageId]);

    const documentSession = useMemo<DocumentSession>(() => ({
        doc: new Y.Doc(),
        durability: null,
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
                await documentSession.durability?.dispose("cancel");
                if (generations.get(yDoc) !== generation) return;
                generations.delete(yDoc);
                yDoc.destroy();
            });
        };
    }, [documentSession, yDoc]);

    useEffect(() => {
        if (readOnly || !isDbLoaded) return; // hydrate persistence before joining collaboration
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
    }, [documentSessionKey, isDbLoaded, yDoc, spaceId, pageId, readOnly]);

    useEffect(() => {
        const abortController = new AbortController();
        let active = true;
        let ownedDurability: YjsDurabilityCoordinator | null = null;
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

                let recovery: YjsRecoveryAdapter;
                if (!readOnly) {
                    const recoverySessionKey = `${USER_URI}:${spaceId}:${pageId}:${data.docId}`;
                    try {
                        recovery = new IndexedDbYjsRecoveryAdapter(recoverySessionKey, String(data.docId));
                        await recovery.hydrate(yDoc);
                    } catch (recoveryError) {
                        console.error("Local whiteboard recovery is unavailable", recoveryError);
                        recovery = new UnavailableYjsRecoveryAdapter(
                            recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError)),
                        );
                    }
                } else {
                    recovery = new UnavailableYjsRecoveryAdapter();
                }

                if (data.data) {
                    Y.applyUpdate(
                        yDoc,
                        base64ToUint8Array(data.data),
                        INITIAL_DATABASE_LOAD,
                    );
                }

                if (!readOnly) {
                    const durabilitySessionKey = `${USER_URI}:${spaceId}:${pageId}:${data.docId}`;
                    ownedDurability = new YjsDurabilityCoordinator({
                        sessionKey: durabilitySessionKey,
                        draftId: String(data.docId),
                        clientId: whiteboardClientId,
                        durableRevision: data.durableRevision ?? "0",
                        acknowledgedStateDigest: data.stateDigest,
                        acknowledgedServerUpdateSequence: data.serverUpdateSequence,
                        persistence: new WhiteboardCheckpointHttpAdapter({
                            baseUrl: USER_URI,
                            spaceId,
                            pageId,
                        }),
                        recovery,
                        resolveConflict: async (remoteState, localState) => {
                            const mergedDoc = new Y.Doc();
                            try {
                                Y.applyUpdate(mergedDoc, remoteState);
                                Y.applyUpdate(mergedDoc, localState);
                                Y.applyUpdate(yDoc, Y.encodeStateAsUpdate(mergedDoc), CONFLICT_MERGE_ORIGIN);
                            } finally {
                                mergedDoc.destroy();
                            }
                            const board = boardRef.current;
                            if (!board) throw new Error("Whiteboard is unavailable while resolving a save conflict.");
                            return board.captureProjectionTarget();
                        },
                    });
                    documentSession.durability = ownedDurability;
                    activeDraftIdRef.current = String(data.docId);
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
            if (documentSession.durability === ownedDurability) {
                documentSession.durability = null;
            }
            void ownedDurability?.dispose("cancel");
        };
    }, [boardRequest, documentSession, pageId, readOnly, spaceId, whiteboardClientId, yDoc]);

    useEffect(() => {
        const durability = documentSession.durability;
        const board = boardRef.current;
        if (!durability || !board || !isDbLoaded || readOnly) return;
        return durability.attach(board.checkpoints);
    }, [documentSession, isDbLoaded, provider, readOnly]);

    useEffect(() => {
        const durability = documentSession.durability;
        if (!durability) {
            setDurabilityStatus(null);
            return;
        }
        const update = () => setDurabilityStatus(durability.getSnapshot());
        update();
        return durability.subscribeStatus(update);
    }, [documentSession, isDbLoaded]);

    useEffect(() => {
        const durability = documentSession.durability;
        const board = boardRef.current;
        if (!durability || !board || !provider || !isDbLoaded || readOnly) return;
        const metadata = yDoc.getMap("glideboard-meta");
        const verifyActiveDraft = async (expectedDraftId?: string) => {
            if (draftTransitionInFlightRef.current) return;
            const operationId = expectedDraftId || "server-poll";
            draftTransitionInFlightRef.current = operationId;
            try {
                const response = await fetch(`${USER_URI}/editor/space/${spaceId}/whiteboard/${pageId}/edit`, {
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                });
                if (!response.ok) throw new Error(`Failed to verify active draft (${response.status})`);
                const body = await response.json() as Response<WhiteboardData>;
                const nextDraftId = String(body.data.docId);
                if (expectedDraftId && nextDraftId !== expectedDraftId) return;
                if (nextDraftId === activeDraftIdRef.current) return;
                if (body.data.data) {
                    Y.applyUpdate(yDoc, base64ToUint8Array(body.data.data), CONFLICT_MERGE_ORIGIN);
                }
                const mergedTarget = await board.captureProjectionTarget();
                await durability.adoptAuthoritativeDraft({
                    sessionKey: `${USER_URI}:${spaceId}:${pageId}:${nextDraftId}`,
                    draftId: nextDraftId,
                    durableRevision: body.data.durableRevision ?? "0",
                }, mergedTarget);
                activeDraftIdRef.current = nextDraftId;
            } catch (error) {
                console.error("Failed to switch to the authoritative whiteboard draft", error);
            } finally {
                if (draftTransitionInFlightRef.current === operationId) {
                    draftTransitionInFlightRef.current = null;
                }
            }
        };
        const handleDraftTransition = () => {
            const transition = metadata.get("draftTransition") as {
                draftId?: string;
                publishedFrom?: string;
            } | undefined;
            const nextDraftId = transition?.draftId ? String(transition.draftId) : "";
            if (!nextDraftId || nextDraftId === activeDraftIdRef.current) return;
            void verifyActiveDraft(nextDraftId); // Yjs is only a hint; the server verifies the identity.
        };
        metadata.observe(handleDraftTransition);
        handleDraftTransition();
        const poll = setInterval(() => { void verifyActiveDraft(); }, 5_000);
        return () => {
            clearInterval(poll);
            metadata.unobserve(handleDraftTransition);
        };
    }, [documentSession, isDbLoaded, pageId, provider, readOnly, spaceId, yDoc]);

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
            const nextCollaborators = safeAwarenessEntries(provider.awareness.getStates())
                .map(({ user }) => user);

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
        let fence: ReturnType<GlideboardHandle["acquireMutationFence"]> | null = null;
        try {
            const board = boardRef.current;
            const durability = documentSession.durability;
            if (!board || !durability) throw new Error("Whiteboard durability is not ready");
            fence = board.acquireMutationFence("close");
            await board.settleActiveEdit("commit");
            const target = await board.captureProjectionTarget();
            await durability.flush(target);
            setIsClosing(false);
            navigate(`/space/${spaceId}/view/${pageId}`);
        } catch (error) {
            console.error('Failed to save before closing whiteboard', error);
            alert('Could not save the latest whiteboard changes. Please try again.');
            setIsClosing(false);
        } finally {
            fence?.release();
        }
    };

    const handlePublish = async () => {
        setIsPublishing(true);
        let fence: ReturnType<GlideboardHandle["acquireMutationFence"]> | null = null;
        try {
            // 1. SVG snapshot
            const board = boardRef.current;
            const durability = documentSession.durability;
            if (!board || !durability) throw new Error('Whiteboard durability is not ready');
            fence = board.acquireMutationFence("publish");
            await board.settleActiveEdit("commit");
            const target = await board.captureProjectionTarget();
            const checkpoint = await durability.flush(target);
            const hasShapes = board.serialize().records.some((record) => 'x' in record && 'y' in record);
            
            let previewAssetName = '';
            if (hasShapes) {
                const svgString = await board.exportSvg({ target });
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
            const encoded = uint8ArrayToBase64(durability.getAcknowledgedState(checkpoint));

            // 3. Publish
            const publishUrl = `${USER_URI}/editor/space/${spaceId}/whiteboard/${pageId}/publish`;
            const publishRequest: RequestInit = {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        data: encoded,
                        previewAssetName,
                        draftId: checkpoint.draftId,
                        expectedDraftRevision: checkpoint.durableRevision,
                        checkpoint: checkpoint.yjs,
                        clientId: whiteboardClientId,
                        requestId: crypto.randomUUID(),
                    }),
                };
            let publishRes: Awaited<ReturnType<typeof fetch>>;
            try {
                publishRes = await fetch(publishUrl, publishRequest);
            } catch {
                // Retry ambiguous transport failure with the same idempotency key.
                publishRes = await fetch(publishUrl, publishRequest);
            }

            if (publishRes.status === 409) {
                throw new Error('Publish stopped because this draft changed on the server. Reload before trying again.');
            }
            if (!publishRes.ok) throw new Error(`Publish failed (${publishRes.status})`);
            const publishBody = await publishRes.json() as Response<{
                nextDraftId: number;
                nextRevision: string;
            }>;
            const nextDraftId = String(publishBody.data.nextDraftId);
            await durability.advanceDraft({
                sessionKey: `${USER_URI}:${spaceId}:${pageId}:${nextDraftId}`,
                draftId: nextDraftId,
                durableRevision: publishBody.data.nextRevision,
            }, checkpoint);
            activeDraftIdRef.current = nextDraftId;
            yDoc.getMap("glideboard-meta").set("draftTransition", {
                draftId: nextDraftId,
                publishedFrom: checkpoint.draftId,
                nonce: crypto.randomUUID(),
            });
            
        } catch (e: any) {
            console.error(e);
            alert(e.message ?? 'Publish failed');
        } finally {
            fence?.release();
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
                            {durabilityStatus ? (
                                <Text size="1" className="text-[#898492]">
                                    {durabilityStatus.phase === "clean" ? "Saved" :
                                        durabilityStatus.phase === "saving" ? "Saving…" :
                                            durabilityStatus.phase === "offline" ? "Saved locally" :
                                                durabilityStatus.phase === "conflict" ? "Save conflict" :
                                                    durabilityStatus.phase === "quarantined" ? "Editing paused" :
                                                        durabilityStatus.phase === "error" ? "Save error" : "Unsaved"}
                                </Text>
                            ) : null}
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
                    <WhiteboardCanvas boardRef={boardRef} sessionKey={documentSessionKey} yDoc={yDoc} provider={provider} fetchErr={fetchErr} readOnly={readOnly} collaborationUser={collaborationUser} bootstrapRevision={boardData?.durableRevision ?? "0"} assetStorage={whiteboardAssetStorage} />
                </div>
            </div>
        );
    }

    // View mode: render canvas directly, no sub-header
    return (
        <div style={{ width: '100%', height: fillParent ? '100%' : 'calc(100vh - 120px)' }}>
            <WhiteboardCanvas boardRef={boardRef} sessionKey={documentSessionKey} yDoc={yDoc} provider={provider} fetchErr={fetchErr} readOnly={readOnly} collaborationUser={collaborationUser} bootstrapRevision={boardData?.durableRevision ?? "0"} documentId={String(boardData?.docId ?? "")} assetStorage={whiteboardAssetStorage} />
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
    bootstrapRevision,
    documentId,
    assetStorage,
}: {
    boardRef: MutableRefObject<GlideboardHandle | null>;
    sessionKey: string;
    yDoc: Y.Doc;
    provider: WebrtcProvider | null;
    fetchErr: any;
    readOnly: boolean;
    collaborationUser: { id: string; name: string; color: string } | null;
    bootstrapRevision: string;
    documentId: string;
    assetStorage: GlideboardAssetStorage;
}) {
    if (fetchErr) {
        return <Flex>Error loading whiteboard.</Flex>;
    }

    const collaborationProps = useMemo(() => ({
        doc: yDoc,
        provider: provider as any,
        user: collaborationUser,
        boardIdentity: sessionKey,
        bootstrapRevision,
    }), [yDoc, provider, collaborationUser, sessionKey, bootstrapRevision]);

    return (
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <Glideboard
                ref={boardRef as any}
                sessionKey={sessionKey}
                collaboration={collaborationProps}
                readOnly={readOnly}
                assetStorage={assetStorage}
                assetResolutionContext={{ documentId }}
            />
        </div>
    );
}
