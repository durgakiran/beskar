
import { TipTap, AttachmentPanel } from "@editor";
import type { AttachmentRef } from "@durgakiran/editor";
import type { JSONContent } from "@tiptap/core";
import { EditorContext } from "@editor/context/editorContext";
import { Editorheader } from "@editor/header";
import TextArea from "@editor/textarea/TextArea";
import { Response, useGet } from "@http/hooks";
import { Editor } from "@tiptap/react";
import { Spinner, Flex } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as y from "yjs"
import "./documentEditor.css";
import { usePUT } from "app/core/http/hooks/usePut";
import { base64ToUint8Array, uint8ArrayToBase64 } from "app/core/utils/base64";
import { useNavigate } from "react-router-dom";
import { WebrtcProvider } from "y-webrtc";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { getSignalingUrl } from "app/core/signaling";
import { extractAssetReferences, type AssetReferencesPayload } from "app/core/editor/extractAssetReferences";
import { useEditorPageEvents, type PageEventV1 } from "app/core/editor/useEditorPageEvents";
import { useEditorPresenceHeartbeat } from "app/core/editor/useEditorPresenceHeartbeat";

const FRESH_INIT_BLOCK_NAMES = new Set([
    "paragraph",
    "heading",
    "blockquote",
    "codeBlock",
    "horizontalRule",
    "bulletList",
    "orderedList",
    "listItem",
    "taskList",
    "taskItem",
]);

function xmlElementHasNoVisibleText(el: y.XmlElement): boolean {
    for (let i = 0; i < el.length; i++) {
        const c = el.get(i);
        if (c instanceof y.XmlText) {
            if (c.toString().trim().length > 0) return false;
        } else if (c instanceof y.XmlElement) {
            if (!xmlElementHasNoVisibleText(c)) return false;
        }
    }
    return true;
}

/** True when the Yjs "default" fragment is still TipTap Collaboration's initial empty doc (possibly after a BC/WebRTC peer joined with no real body yet). */
function defaultFragmentLooksLikeFreshTipTapInit(doc: y.Doc): boolean {
    const frag = doc.getXmlFragment("default");
    const n = frag.length;
    if (n === 0) return true;
    if (n !== 1) return false;
    const first = frag.get(0);
    if (!(first instanceof y.XmlElement)) return false;
    if (!FRESH_INIT_BLOCK_NAMES.has(first.nodeName)) return false;
    return xmlElementHasNoVisibleText(first);
}

interface User {
    name: string;
    username: string;
    email: string;
    id: string;
    emailVerified: boolean;
}

interface IPayload {
    title: string;
    ownerId: string;
    parentId?: number;
    id: number;
    docId?: number;
    spaceId: string;
    data: any;
    /** Matches signaling draft leader; server refreshes draft_leader_ts on save when true. */
    isDraftLeader?: boolean;
    assetReferences?: AssetReferencesPayload;
}

interface DocumentDTO {
    id: number;
    pageId: number;
    data: any;
}

interface EditDataDTO {
    data: DocumentDTO;
    docId: number;
    draft: boolean;
    draftGeneration?: number;
    id: number;
    nodeData: any;
    ownerId: string;
    parentId: number;
    spaceId: string;
    title: string;
}

interface EditDocumentMetaDTO {
    docId: number;
    draftGeneration: number;
    updatedAt: string;
    title: string;
    parentId: number;
    draft: boolean;
}

interface EditBreadcrumb {
    id: number;
    title: string;
    href: string | null;
}

interface EditCapabilities {
    canComment: boolean;
}

interface EditViewDTO {
    capabilities: EditCapabilities;
    space: {
        name: string;
    };
}

interface UpdateDocDTO {
    page: number;
}

interface IPayloadPublish {
    title: string;
    ownerId: string;
    parentId?: number;
    id: number;
    docId?: number;
    spaceId: string;
    nodeData: any;
    assetReferences?: AssetReferencesPayload;
}

export default function DocumentEditor({ slug }: { slug: string[] }) {
    const [provider, setProvider] = useState<WebrtcProvider>();
    const navigate = useNavigate();

    // profile of the current user
    const [{ data: profileData, errors: profileErrors, isLoading: profileLoading }, getProfile] = useGet<Response<User>>(`profile/details`);

    // start of editor handling
    const [{ data: viewData }, fetchViewData] = useGet<Response<EditViewDTO>>(`editor/space/${slug[0]}/page/${slug[1]}`);
    const [{ data: publishigData, errors: publishErrors, isLoading: publishing }, publishDraftData] = usePUT<Response<UpdateDocDTO>, IPayloadPublish>(`editor/publish`);
    const [{ errors: upadteErrors, isLoading: updating }, updateDraftData] = usePUT<Response<UpdateDocDTO>, IPayload>(`editor/update`);
    const [{ isLoading: isDocumentLoading, data: documentData, errors: documentErrors }, fetchData] = useGet<Response<EditDataDTO>>(`editor/space/${slug[0]}/page/${slug[1]}/edit`);
    const [editorContext, setEditorContext] = useState<Editor>();
    const [title, setTitle] = useState<string>();
    const [titleTextProvider, setTitleTextProvider] = useState<y.Text>();
    const [updatedTitle, setUpdatedTitle] = useState<string>();
    const [docId, setDocId] = useState<number>();
    const [parentId, setParentId] = useState<number>();
    const [docIdProvider, setDocIdProvider] = useState<y.Text>();
    const [parentIdProvider, setParentIdProvider] = useState<y.Text>();
    const [isEditorReady, setIsEditorReady] = useState<boolean>(false);
    const activeSockets = useRef<Map<WebSocket, { interval: number; onMessage: (e: MessageEvent) => void; onClose: () => void }>>(new Map());
    /** y-webrtc can open multiple signaling sockets; the server picks one connection as "leader", so OR across sockets for this tab. */
    const leaderBySignalingSocketRef = useRef(new Map<WebSocket, boolean>());
    const [isLeader, setIsLeader] = useState<boolean>(false);
    const [isDocumentFetched, setIsDocumentFetched] = useState<boolean>(false);
    const [docAttachments, setDocAttachments] = useState<AttachmentRef[]>([]);
    const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
    const [activeCollaborators, setActiveCollaborators] = useState<
        Array<{ id: string; name: string; email?: string; color?: string }>
    >([]);
    const [draftLeaderUserId, setDraftLeaderUserId] = useState<string | undefined>(undefined);
    const draftLeaderUserIdRef = useRef<string | undefined>(undefined);
    const [saveLeaderOfflineNotice, setSaveLeaderOfflineNotice] = useState(false);
    /** True after we have ever been draft leader this mount (used to detect real handoff vs first election). */
    const hadLeadershipRef = useRef(false);
    /** Set when we were leader and then lost leadership; next time we become leader we refetch server draft. */
    const lostLeadershipRef = useRef(false);
    const lastMergedDraftBase64Ref = useRef<string | null>(null);
    const lastAppliedDraftGenerationRef = useRef(0);
    const pendingPublishRef = useRef<IPayloadPublish | null>(null);
    const [isPreparingPublish, setIsPreparingPublish] = useState(false);
    // end of editor handling

    // wasm handling
    const [workerInitiated, setWorkerInitiated] = useState<boolean>(false);
    const workerRef = useRef<Worker>(null);
    const editorContextRef = useRef<Editor>(null);
    // end of wasm handling

    // fetch profile data
    useEffect(() => {
        getProfile();
        fetchViewData();
    }, []);

    useEffect(() => {
        if (profileErrors) {
        }
    }, [profileErrors]);
    // end of profile handling

    // editor handling functions
    const ydoc = useMemo(() => {
        return new y.Doc();
    }, []);

    useEffect(() => {
        lastMergedDraftBase64Ref.current = null;
        leaderBySignalingSocketRef.current.clear();
    }, [slug[0], slug[1]]);

    const pageIdNum = useMemo(() => {
        const n = parseInt(slug[1], 10);
        return Number.isFinite(n) ? n : 0;
    }, [slug]);

    const user = useMemo(() => {
        if (!profileData) return;
        const r = Math.floor(Math.random() * 106) + 150;
        const g = Math.floor(Math.random() * 106) + 150;
        const b = Math.floor(Math.random() * 106) + 150;
        const color = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
        return {
            id: profileData.data.id,
            name: profileData.data.name,
            email: profileData.data.email,
            color: color,
        };
    }, [profileData]);

    const handleObservers = useCallback(() => {
        // setIsSynced(true);
        // Get title text after document is synced
        const titleProvider = ydoc.getText("title");
        setTitleTextProvider(titleProvider);
        const docIdProvider = ydoc.getText("docId");
        setDocIdProvider(docIdProvider);
        const parentIdProvider = ydoc.getText("parentId");
        setParentIdProvider(parentIdProvider);
    }, []);

    const handleUpdate = () => {
        if (!isEditorReady || isPreparingPublish || publishing) return;
        if (editorContext) {
            pendingPublishRef.current = {
                title: title ?? "",
                id: Number(slug[1]),
                spaceId: slug[0],
                ownerId: profileData.data.id,
                docId: docId,
                parentId: parentId,
                nodeData: null,
                assetReferences: extractAssetReferences(editorContext.getJSON() as JSONContent),
            };
            setIsPreparingPublish(true);
            workerRef.current.postMessage({ type: "data", data: { data: editorContext.getJSON(), pageId: Number(slug[1]), id: docId } });
        }
    };

    const updateContent = useCallback(
        (content: JSONContent | null, title: string) => {
            // Only the signaling-room leader persists draft to the API (one writer avoids overwrite churn).
            if (!isLeader || !isEditorReady || !profileData?.data?.id) return;
            if (content == null) return;

            const resolvedTitle =
                (typeof title === "string" ? title.trim() : "") ||
                titleTextProvider?.toString().trim() ||
                "";
            if (!resolvedTitle) return;

            const payLoad: IPayload = {
                data: content,
                id: Number(slug[1]),
                ownerId: profileData.data.id,
                spaceId: slug[0],
                docId: docId,
                parentId: parentId,
                title: resolvedTitle,
                isDraftLeader: isLeader,
                assetReferences: extractAssetReferences(content),
            };
            setUpdatedTitle(resolvedTitle);
            updateDraftData({ ...payLoad, data: uint8ArrayToBase64(y.encodeStateAsUpdate(ydoc)) });
        },
        [
            isLeader,
            isEditorReady,
            profileData?.data?.id,
            slug,
            docId,
            parentId,
            titleTextProvider,
            ydoc,
            updateDraftData,
        ],
    );

    const handleClose = () => {
        navigate(`/space/${slug[0]}/view/${slug[1]}`);
    };

    const applyServerMetaFromFetch = useCallback(
        async (ev?: PageEventV1) => {
            if (ev?.type === "document.published" && ev.docId > 0) {
                const dText = ydoc.getText("docId");
                const s = String(ev.docId);
                if (dText.toString() !== s) {
                    dText.delete(0, dText.length);
                    dText.insert(0, s);
                }
                lastAppliedDraftGenerationRef.current = Math.max(
                    lastAppliedDraftGenerationRef.current,
                    typeof ev.draftGeneration === "number" ? ev.draftGeneration : 0,
                );
            }
            const base = (import.meta.env.VITE_USER_SERVER_URL || "").replace(/\/+$/, "");
            if (!base) return;
            const res = await fetch(`${base}/editor/space/${slug[0]}/page/${slug[1]}/edit/meta`, {
                credentials: "include",
                headers: { "Content-Type": "application/json" },
            });
            if (!res.ok) return;
            const json = (await res.json()) as { data?: EditDocumentMetaDTO };
            const meta = json?.data;
            if (!meta || typeof meta.draftGeneration !== "number") return;

            const alreadyHaveGeneration =
                meta.draftGeneration <= lastAppliedDraftGenerationRef.current;
            // After publish, still apply title/parent from meta even when generation matches what we set from the event.
            if (alreadyHaveGeneration && ev?.type !== "document.published") {
                return;
            }
            lastAppliedDraftGenerationRef.current = Math.max(
                lastAppliedDraftGenerationRef.current,
                meta.draftGeneration,
            );

            const titleText = ydoc.getText("title");
            if (meta.title != null && titleText.toString() !== meta.title) {
                titleText.delete(0, titleText.length);
                titleText.insert(0, meta.title);
                setTitle(meta.title);
            }
            if (ev?.type !== "document.published") {
                const docIdText = ydoc.getText("docId");
                const nextDoc = String(meta.docId);
                if (docIdText.toString() !== nextDoc) {
                    docIdText.delete(0, docIdText.length);
                    docIdText.insert(0, nextDoc);
                }
            }
            const parentIdText = ydoc.getText("parentId");
            const nextParent = String(meta.parentId ?? "");
            if (parentIdText.toString() !== nextParent) {
                parentIdText.delete(0, parentIdText.length);
                parentIdText.insert(0, nextParent);
            }
        },
        [slug, ydoc],
    );

    const handlePageEvent = useCallback(
        (ev: PageEventV1) => {
            if (ev.schemaVersion !== 1) return;
            if (ev.type === "editor.inactive") {
                if (ev.userId && ev.userId === draftLeaderUserIdRef.current && user?.id !== ev.userId) {
                    setSaveLeaderOfflineNotice(true);
                }
                return;
            }
            if (ev.type === "document.published" || ev.type === "draft.updated") {
                setSaveLeaderOfflineNotice(false);
            }
            if (ev.type !== "document.published" && ev.type !== "draft.updated") return;
            if (ev.type === "draft.updated" && ev.draftGeneration <= lastAppliedDraftGenerationRef.current) {
                return;
            }
            void applyServerMetaFromFetch(ev);
        },
        [applyServerMetaFromFetch, user?.id],
    );

    useEditorPageEvents({
        spaceId: slug[0],
        pageId: slug[1],
        enabled: Boolean(profileData && provider),
        onPageEvent: handlePageEvent,
        onTransport: (transport) => {
            if (import.meta.env.VITE_PAGE_EVENTS_TRANSPORT_LOG === "1") {
                console.info("[page-events] transport", transport);
            }
        },
    });

    useEditorPresenceHeartbeat({
        spaceId: slug[0],
        pageId: slug[1],
        enabled: Boolean(profileData && provider),
        isDraftLeader: isLeader,
    });

    useEffect(() => {
        const run = () => {
            if (document.visibilityState === "visible" && profileData && provider) {
                void applyServerMetaFromFetch();
            }
        };
        const onPageShow = (e: Event) => {
            if ((e as PageTransitionEvent).persisted) run();
        };
        document.addEventListener("visibilitychange", run);
        window.addEventListener("pageshow", onPageShow);
        return () => {
            document.removeEventListener("visibilitychange", run);
            window.removeEventListener("pageshow", onPageShow);
        };
    }, [profileData, provider, applyServerMetaFromFetch]);

    // Refetch server draft only after we lost leadership and regained it (handoff), not on
    // first false→true (avoids duplicate fetch / double safeMerge when signaling flickers).
    useEffect(() => {
        if (!isLeader) {
            if (hadLeadershipRef.current) {
                lostLeadershipRef.current = true;
            }
            return;
        }
        hadLeadershipRef.current = true;
        if (lostLeadershipRef.current) {
            setIsDocumentFetched(false);
            lostLeadershipRef.current = false;
        }
    }, [isLeader]);

    // Leader loads document from database when not yet fetched for this session.
    useEffect(() => {
        if (isLeader && !isDocumentLoading && !isDocumentFetched) {
            fetchData();
        }
    }, [isLeader, isDocumentLoading, isDocumentFetched, fetchData]);

    // Draft save leader matches signaling leader: collaborators resolve leader pills from awareness.
    useEffect(() => {
        if (!provider) return;
        provider.awareness.setLocalStateField("isDraftLeader", isLeader);
    }, [provider, isLeader]);

    const safeMerge = (base64Update: string) => {
        const dbUpdate = base64ToUint8Array(base64Update);

        // Decode DB state into a temp doc — never touch ydoc until we know what to apply
        const dbDoc = new y.Doc();
        y.applyUpdate(dbDoc, dbUpdate);

        // Check whether ydoc only has TipTap's initialization content (empty paragraph).
        // TipTap's Collaboration extension always inserts an empty paragraph using the
        // NEW session's clientID. If the state vector has ONLY our own clientID, it means
        // no peers have synced real content yet — it's a fresh load.
        const svMap = y.decodeStateVector(y.encodeStateVector(ydoc));
        const hasOnlyLocalInit = svMap.size === 1 && svMap.has(ydoc.clientID);
        const treatAsFreshEmptySession =
            hasOnlyLocalInit || defaultFragmentLooksLikeFreshTipTapInit(ydoc);

        if (treatAsFreshEmptySession) {
            // Fresh reload — clear TipTap's empty paragraph first, then apply
            // the full DB state. Without this, the empty paragraph and the DB content
            // both exist in the CRDT → visible duplication.
            const fragment = ydoc.getXmlFragment('default');
            if (fragment.length > 0) fragment.delete(0, fragment.length);
            y.applyUpdate(ydoc, dbUpdate);

            // Mark DB as loaded — propagates to all peers via WebRTC/BC
            const dbLoadedText = ydoc.getText('dbLoaded');
            if (dbLoadedText.length === 0) dbLoadedText.insert(0, 'true');
            return;
        }

        // ydoc has real peer content — do the careful delta merge
        const localSV = y.encodeStateVector(ydoc);
        const dbSV = y.encodeStateVector(dbDoc);
        const dbDelta = y.encodeStateAsUpdate(dbDoc, localSV);  // DB has, we don't
        const localDelta = y.encodeStateAsUpdate(ydoc, dbSV);      // We have, DB doesn't
        const dbHasNew = dbDelta.length > 2;
        const localHasNew = localDelta.length > 2;

        if (localHasNew && !dbHasNew) {
            // ydoc ahead — nothing to do
        } else if (dbHasNew) {
            y.applyUpdate(ydoc, dbDelta);
        }

        // Mark that DB content has been loaded into this ydoc session.
        // This flag propagates to all peers via WebRTC/BC automatically.
        const dbLoadedText = ydoc.getText('dbLoaded');
        if (dbLoadedText.length === 0) dbLoadedText.insert(0, 'true');
    };

    useEffect(() => {
        if (documentData || documentErrors) {
            setIsDocumentFetched(true);
            if (!documentData) return;
            if (typeof documentData.data.draftGeneration === "number") {
                lastAppliedDraftGenerationRef.current = Math.max(
                    lastAppliedDraftGenerationRef.current,
                    documentData.data.draftGeneration,
                );
            }
            // do we have draft document available
            if (documentData.data.draft && documentData.data.data.data) {
                // documentData.data.data.data is ydoc
                const data = documentData.data.data.data;
                if (lastMergedDraftBase64Ref.current === data) {
                    setIsEditorReady(true);
                    return;
                }
                safeMerge(data);
                lastMergedDraftBase64Ref.current = data;
                setIsEditorReady(true);
            } else if (documentData.data.nodeData) {
                // nodeData exists — but it may be an empty object {} for a brand-new doc.
                // Only treat it as real content if it has actual keys (e.g. "type", "content").
                const hasRealContent =
                    typeof documentData.data.nodeData === 'object' &&
                    Object.keys(documentData.data.nodeData).length > 0;

                // set the title of the document
                const titleText = ydoc.getText("title");
                if (titleText.length === 0) {  // ← only insert if empty
                    titleText.insert(0, documentData.data.title);
                }
                const docIdText = ydoc.getText("docId");
                if (docIdText.length === 0) {
                    docIdText.insert(0, documentData.data.docId.toString());
                }
                const parentIdText = ydoc.getText("parentId");
                if (parentIdText.length === 0) {
                    parentIdText.insert(0, documentData.data.parentId.toString());
                }

                // If there's no real content, unlock the editor immediately.
                // The WASM effect below guards on hasRealContent too, so it won't fire.
                if (!hasRealContent) {
                    setIsEditorReady(true);
                }
                // else: WASM effect will call setIsEditorReady(true) via applyEditorData
            } else {
                // No nodeData at all — brand new empty document
                const titleText = ydoc.getText("title");
                if (titleText.length === 0) {  // ← only insert if empty
                    titleText.insert(0, "");
                }
                const docIdText = ydoc.getText("docId");
                if (docIdText.length === 0) {
                    docIdText.insert(0, documentData.data.docId.toString());
                }
                const parentIdText = ydoc.getText("parentId");
                if (parentIdText.length === 0) {
                    parentIdText.insert(0, documentData.data.parentId.toString());
                }
                setIsEditorReady(true);
            }
        }
    }, [documentData, documentErrors]);

    // Send doc to WASM only for the nodeData path (first-time load, no draft yet).
    // Uses the 'dbLoaded' Y.Text flag stored in the ydoc itself to determine if
    // any peer in the session has already loaded from DB. The flag travels with
    // the ydoc content via WebRTC/BC, so checking it after 'synced' is reliable.
    useEffect(() => {
        if (!workerInitiated) return;
        if (!documentData?.data) return;
        if (documentData.data.draft) return;        // draft → safeMerge only
        // Guard: nodeData must be a non-empty object with actual content.
        // An empty object {} is falsy for our purposes — it means a brand-new doc
        // with no content yet. Sending it to WASM produces {type:"",…} which crashes
        // ProseMirror's fromJSON with "Unknown node type: ".
        const nodeData = documentData.data.nodeData;
        if (!nodeData || typeof nodeData !== 'object' || Object.keys(nodeData).length === 0) return;
        if (!editorContext) return;
        if (!provider) return;

        const dispatch = () => {
            const dbLoadedText = ydoc.getText("dbLoaded");
            // Stale dbLoaded can arrive over WebRTC/BC while the body is still TipTap's init — do not skip WASM in that case.
            if (dbLoadedText.toString() === "true") {
                if (!defaultFragmentLooksLikeFreshTipTapInit(ydoc)) {
                    setIsEditorReady(true);
                    return;
                }
                dbLoadedText.delete(0, dbLoadedText.length);
            }
            workerRef.current.postMessage({ type: "doc", data: documentData.data });
        };

        let fired = false;
        const onSynced = () => {
            if (fired) return;
            fired = true;
            provider.off('synced', onSynced);
            clearTimeout(fallback);
            dispatch();
        };

        // Fallback: no peers within 2s → solo session → apply from DB
        const fallback = setTimeout(() => {
            if (fired) return;
            fired = true;
            provider.off('synced', onSynced);
            dispatch();
        }, 2000) as unknown as number;

        provider.on('synced', onSynced);

        return () => {
            if (!fired) {
                provider.off('synced', onSynced);
            }
            clearTimeout(fallback);
        };
    }, [workerInitiated, documentData, editorContext, provider]);

    // redirect to view page after publishing
    useEffect(() => {
        if (publishigData && !publishing) {
            navigate(`/space/${slug[0]}/view/${slug[1]}`);
        }
    }, [publishigData, publishing]);

    useEffect(() => {
        if (publishing) {
            setIsPreparingPublish(false);
        }
    }, [publishing]);

    useEffect(() => {
        const _provider = new WebrtcProvider(slug[1] + "-space-" + slug[0], ydoc, {
            signaling: [getSignalingUrl()],
            filterBcConns: false
        });
        setProvider(_provider);
        return () => {
            // y-webrtc: destroy() does not unregister from the shared SignalingConn — WS stays open.
            _provider.disconnect();
            _provider.destroy();
            setProvider(null);
        };
    }, [ydoc]);

    useEffect(() => {
        if (!ydoc) return;
        handleObservers();
    }, [ydoc]);

    useEffect(() => {
        if (!provider) return;
        if (!user) return;

        const topic = `${slug[1]}-space-${slug[0]}`;

        provider.awareness.setLocalStateField("user", {
            id: user.id,
            name: user.name,
            email: user.email,
            color: user.color,
        });

        const recomputeLeaderFromSignalingSockets = () => {
            setIsLeader([...leaderBySignalingSocketRef.current.values()].some(Boolean));
        };

        const attachSignalingSocket = (socket: WebSocket | null | undefined) => {
            if (!socket || activeSockets.current.has(socket)) return;
            if (socket.readyState !== WebSocket.OPEN) return;

            const messageHandler = (event: MessageEvent) => {
                try {
                    const data = JSON.parse(event.data as string) as { type?: string; topic?: string; isLeader?: boolean };
                    if (data.type === "leader" && data.topic === topic) {
                        leaderBySignalingSocketRef.current.set(socket, Boolean(data.isLeader));
                        recomputeLeaderFromSignalingSockets();
                    }
                } catch {
                    // ignore non-JSON binary frames from y-webrtc
                }
            };

            const handleAmILeader = () => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: "amIleader", topic }));
                }
            };

            socket.addEventListener("message", messageHandler);
            handleAmILeader();
            const timeInterval = setInterval(handleAmILeader, 3000) as unknown as number;
            const onClose = () => {
                socket.removeEventListener("message", messageHandler);
                socket.removeEventListener("close", onClose);
                leaderBySignalingSocketRef.current.delete(socket);
                recomputeLeaderFromSignalingSockets();
                const meta = activeSockets.current.get(socket);
                if (meta) {
                    clearInterval(meta.interval);
                    activeSockets.current.delete(socket);
                }
            };
            socket.addEventListener("close", onClose);
            activeSockets.current.set(socket, { interval: timeInterval, onMessage: messageHandler, onClose });
        };

        const scanSignalingConnections = () => {
            provider.signalingConns.forEach((conn) => {
                attachSignalingSocket(conn.ws as WebSocket);
            });
        };

        scanSignalingConnections();
        const reconnectInterval = setInterval(scanSignalingConnections, 2000);

        return () => {
            clearInterval(reconnectInterval);
            provider.awareness.setLocalStateField("user", null);
            provider.awareness.setLocalStateField("isDraftLeader", null);

            leaderBySignalingSocketRef.current.clear();
            setIsLeader(false);

            activeSockets.current.forEach(({ interval, onMessage, onClose }, socket) => {
                clearInterval(interval);
                socket.removeEventListener("message", onMessage);
                socket.removeEventListener("close", onClose);
                activeSockets.current.delete(socket);
            });
        };
    }, [provider, user, slug[0], slug[1]]);

    useEffect(() => {
        if (!provider) return;

        const syncCollaborators = () => {
            const states = Array.from(provider.awareness.getStates().values());

            let leaderId: string | undefined;
            for (const state of states) {
                const u = state?.user as { id?: string; name?: string; color?: string } | undefined;
                if (state?.isDraftLeader === true && u?.id) {
                    leaderId = u.id;
                    break;
                }
            }
            setDraftLeaderUserId(leaderId);
            draftLeaderUserIdRef.current = leaderId;

            const nextCollaborators = states
                .map(
                    (state) =>
                        state?.user as { id?: string; name?: string; email?: string; color?: string } | undefined,
                )
                .filter(
                    (candidate): candidate is { id: string; name: string; email?: string; color?: string } =>
                        Boolean(candidate?.id && candidate?.name),
                );

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

    useEffect(() => {
        setSaveLeaderOfflineNotice(false);
    }, [draftLeaderUserId]);

    useEffect(() => {
        if (!titleTextProvider) return;

        // Create title observer
        const titleObserver = () => {
            const newTitle = titleTextProvider.toString();
            setTitle(newTitle);
        };

        // Set initial title and observe changes
        titleObserver(); // Call immediately to set initial title
        titleTextProvider.observe(titleObserver);

        // Clean up function
        return () => {
            titleTextProvider.unobserve(titleObserver);
        };
    }, [titleTextProvider]);

    useEffect(() => {
        if (!docIdProvider) return;

        const docIdObserver = () => {
            const newDocId = docIdProvider.toString();
            if (newDocId) {
                setDocId(Number(newDocId));
            }
        };

        const parentIdObserver = () => {
            const newParentId = parentIdProvider.toString();
            setParentId(Number(newParentId));
        };

        docIdObserver();
        parentIdObserver();

        return () => {
            docIdProvider.unobserve(docIdObserver);
            parentIdProvider.unobserve(parentIdObserver);
        };
    }, [docIdProvider, parentIdProvider]);

    // Keep ref in sync with state so worker's onmessage closure always reads latest editor
    useEffect(() => {
        editorContextRef.current = editorContext;
    }, [editorContext]);

    const applyEditorData = (data: string) => {
        if (!editorContextRef.current) {
            console.error('applyEditorData: editorContext not ready yet');
            return;
        }

        const dbLoadedText = ydoc.getText("dbLoaded");
        if (dbLoadedText.toString() === "true") {
            if (!defaultFragmentLooksLikeFreshTipTapInit(ydoc)) {
                setIsEditorReady(true);
                return;
            }
            dbLoadedText.delete(0, dbLoadedText.length);
        }

        const tiptapDoc = JSON.parse(data);
        // Safety net: if WASM returned an empty or malformed document (e.g. nodeData was
        // an empty object), tiptapDoc.type will be falsy. Passing such a doc to ProseMirror
        // causes "Unknown node type: ". Bail out gracefully and unlock the editor instead.
        if (!tiptapDoc || !tiptapDoc.type) {
            console.warn('applyEditorData: WASM returned empty/invalid doc, unlocking editor gracefully');
            setIsEditorReady(true);
            return;
        }
        const tempYDoc = prosemirrorJSONToYDoc(editorContextRef.current.schema, tiptapDoc, 'default');

        // Clear TipTap's init paragraph before applying DB content
        const fragment = ydoc.getXmlFragment('default');
        if (fragment.length > 0) fragment.delete(0, fragment.length);

        y.applyUpdate(ydoc, y.encodeStateAsUpdate(tempYDoc));

        // Set the flag — propagates to all peers via WebRTC/BC
        if (dbLoadedText.length === 0) dbLoadedText.insert(0, "true");

        setIsEditorReady(true);
    };

    // Non-leader: set isEditorReady when leader pushes content via WebRTC.
    // We check the update *origin*: y-webrtc sets the WebrtcProvider instance
    // as origin for remote updates. TipTap's own init uses the ProseMirror
    // binding as origin — a different object — so this is a reliable signal.
    useEffect(() => {
        if (isLeader) return;      // leader handles this via documentData flow
        if (isEditorReady) return; // already unlocked
        if (!provider) return;

        const onUpdate = (_update: Uint8Array, origin: unknown) => {
            // origin === provider → update came from a remote peer via WebRTC
            if (origin === provider) {
                setIsEditorReady(true);
            }
        };
        ydoc.on('update', onUpdate);

        // Fallback: new/empty doc — leader will never push content, unlock after timeout
        const fallback = setTimeout(() => setIsEditorReady(true), 4000);

        return () => {
            ydoc.off('update', onUpdate);
            clearTimeout(fallback);
        };
    }, [isLeader, isEditorReady, provider]);

    // end of editor handling functions


    // wasm worker
    useEffect(() => {
        workerRef.current = new Worker("/workers/editor.js", { type: "module" });
        workerRef.current.onmessage = (e) => {
            switch (e.data.type) {
                case "initiated":
                    setWorkerInitiated(true);
                    break;
                case "editorData":
                    // apply to ydoc
                    e.data.data ? applyEditorData(e.data.data) : console.error("No editor data received");
                    break;
                case "contentData":
                    if (!pendingPublishRef.current) {
                        setIsPreparingPublish(false);
                        break;
                    }
                    publishDraftData({
                        ...pendingPublishRef.current,
                        nodeData: JSON.parse(e.data.data).data,
                    });
                    pendingPublishRef.current = null;
                    break;
                default:
                    break;
            }
        };
        workerRef.current.onerror = (e) => {
            pendingPublishRef.current = null;
            setIsPreparingPublish(false);
            console.error(e);
        };
        workerRef.current.postMessage({ type: "init" });
        return () => {
            workerRef.current.terminate();
        };
    }, []);

    if (profileLoading || !provider || !ydoc) {
        return (
            <div className="text-center">
                <Spinner size="3" />
            </div>
        );
    }

    if (profileErrors) {
        return <div>Something went wrong</div>;
    }

    const canComment = viewData?.data?.capabilities?.canComment ?? true;
    const spaceName = viewData?.data?.space?.name ?? "Space";

    return (
        <div style={{ minHeight: 300 }}>
            {
                profileData && (
                    <div data-testid="editor-window">
                        <div
                            className="header"
                            data-testid="sticky-header"
                            style={{
                                position: "sticky",
                                zIndex: 120,
                                top: 0,
                                marginBottom: "2rem",
                                backgroundColor: "white",
                                width: "100%"
                            }}
                        >
                            <EditorContext.Provider value={editorContext}>
                                <Editorheader
                                    isEditorReady={isEditorReady}
                                    handleClose={handleClose}
                                    handleUpdate={handleUpdate}
                                    isUpdating={updating || publishing || isPreparingPublish}
                                    isSidePanelOpen={isSidePanelOpen}
                                    setIsSidePanelOpen={setIsSidePanelOpen}
                                    spaceId={slug[0]}
                                    pageId={slug[1]}
                                    spaceName={spaceName}
                                    pageTitle={title || "Untitled"}
                                    collaborators={activeCollaborators}
                                    canComment={canComment}
                                    currentUserId={user?.id}
                                    isLeader={isLeader}
                                    leaderUserId={draftLeaderUserId}
                                    presenceNotice={
                                        saveLeaderOfflineNotice
                                            ? "Save leader may be offline. Changes might not persist until the leader reconnects."
                                            : undefined
                                    }
                                />
                            </EditorContext.Provider>
                        </div>
                        <div style={{ maxWidth: "1024px", margin: "auto" }}>
                            {/* Overlay blocks all pointer interaction until editor is ready */}
                            <div style={{ position: "relative" }}>
                                {!isEditorReady && (
                                    <div
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            zIndex: 10,
                                            cursor: "wait",
                                            pointerEvents: "all",
                                            backgroundColor: "rgba(255,255,255,0.4)",
                                        }}
                                    />
                                )}
                                <div>
                                    <TextArea
                                        value={title || ""}
                                        handleInput={(value: string) => {
                                            setTitle(value);
                                            // Update the shared title when user edits
                                            if (titleTextProvider) {
                                                titleTextProvider.delete(0, titleTextProvider.length);
                                                titleTextProvider.insert(0, value);
                                            }
                                        }}
                                    />
                                </div>
                                <TipTap
                                    title={title || ""}
                                    setEditorContext={(editorContext: Editor) => setEditorContext(editorContext)}
                                    content={""}
                                    pageId={slug[1]}
                                    spaceId={slug[0]}
                                    editable={true}
                                    id={pageIdNum}
                                    user={user}
                                    updateContent={updateContent}
                                    provider={provider}
                                    ydoc={ydoc}
                                    onDocAttachmentsChange={setDocAttachments}
                                    isInlineMessageSidePanelOpen={isSidePanelOpen}
                                    setIsInlineMessageSidePanelOpen={setIsSidePanelOpen}
                                />
                                <AttachmentPanel attachments={docAttachments} pageId={pageIdNum} />
                            </div>
                        </div>
                    </div>
                )
            }
        </div>
    );
}
