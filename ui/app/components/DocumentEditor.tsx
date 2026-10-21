
import { TipTap, AttachmentPanel } from "@editor";
import type { AttachmentRef } from "@durgakiran/editor";
import type { JSONContent } from "@tiptap/core";
import { EditorContext } from "@editor/context/editorContext";
import { Editorheader } from "@editor/header";
import { DocumentTitle } from "@editor/textarea/DocumentTitle";
import { Response, useGet } from "@http/hooks";
import { Editor } from "@tiptap/react";
import { Spinner } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as y from "yjs"
import "./documentEditor.css";
import { usePUT } from "app/core/http/hooks/usePut";
import { base64ToUint8Array } from "app/core/utils/base64";
import { useNavigate } from "react-router-dom";
import { isFreshDocument, publishedDocumentSeed, mergeDocumentState } from "app/core/editor/documentYjs";
import { extractAssetReferences, type AssetReferencesPayload } from "app/core/editor/extractAssetReferences";
import { useEditorPageEvents, type PageEventV1 } from "app/core/editor/useEditorPageEvents";
import { IndexedDbYjsRecoveryAdapter } from "app/core/whiteboard/durability/IndexedDbYjsRecoveryAdapter";
import { DocumentDraftSession } from "app/core/editor/DocumentDraftSession";
import { useDocumentCollaboration } from "app/core/editor/useDocumentCollaboration";

interface User {
    name: string;
    username: string;
    email: string;
    id: string;
    emailVerified: boolean;
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
    expectedRevision?: import("app/core/editor/DocumentDraftSession").DocumentDraftRevision;
    assetReferences?: AssetReferencesPayload;
}

export default function DocumentEditor({ slug }: { slug: string[] }) {
    return <DocumentEditorSession key={`${slug[0]}:${slug[1]}`} slug={slug} />;
}

function DocumentEditorSession({ slug }: { slug: string[] }) {
    const navigate = useNavigate();

    // profile of the current user
    const [{ data: profileData, errors: profileErrors, isLoading: profileLoading }, getProfile] = useGet<Response<User>>(`profile/details`);

    // start of editor handling
    const [{ data: viewData }, fetchViewData] = useGet<Response<EditViewDTO>>(`editor/space/${slug[0]}/page/${slug[1]}`);
    const [{ data: publishigData, errors: publishErrors, isLoading: publishing }, publishDraftData] = usePUT<Response<UpdateDocDTO>, IPayloadPublish>(`editor/publish`);
    const [updating, setUpdating] = useState(false);
    const [saveNotice, setSaveNotice] = useState<string>();
    const draftSessionRef = useRef<DocumentDraftSession | undefined>(undefined);
    const draftPayloadRef = useRef<() => Record<string, unknown>>(() => ({}));
    const [{ data: documentData, errors: documentErrors }, fetchData] = useGet<Response<EditDataDTO>>(`editor/space/${slug[0]}/page/${slug[1]}/edit`);
    const [editorContext, setEditorContext] = useState<Editor>();
    const [title, setTitle] = useState<string>();
    const [titleTextProvider, setTitleTextProvider] = useState<y.Text>();
    const [docId, setDocId] = useState<number>();
    const [parentId, setParentId] = useState<number>();
    const [isEditorReady, setIsEditorReady] = useState<boolean>(false);
    const [docAttachments, setDocAttachments] = useState<AttachmentRef[]>([]);
    const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
    const [activeCollaborators, setActiveCollaborators] = useState<
        Array<{ id: string; name: string; email?: string; color?: string }>
    >([]);
    const lastMergedDraftBase64Ref = useRef<string | null>(null);
    const pendingPublishRef = useRef<IPayloadPublish | null>(null);
    const [isPreparingPublish, setIsPreparingPublish] = useState(false);
    // end of editor handling

    // wasm handling
    const [workerInitiated, setWorkerInitiated] = useState<boolean>(false);
    const workerRef = useRef<Worker>(null);
    const documentDataRef = useRef(documentData);
    documentDataRef.current = documentData;
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

    const { provider, notice: collaborationNotice } = useDocumentCollaboration(ydoc, slug[0], slug[1]);

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
        // Observe the collaborative title.
        const titleProvider = ydoc.getText("title");
        setTitleTextProvider(titleProvider);
    }, []);

    const handleUpdate = async () => {
        if (!isEditorReady || isPreparingPublish || publishing) return;
        if (editorContext) {
            setIsPreparingPublish(true);
            try { await draftSessionRef.current?.save(); } catch { setIsPreparingPublish(false); return; }
            pendingPublishRef.current = {
                title: ydoc.getText("title").toString().trim() || "Untitled",
                id: Number(slug[1]),
                spaceId: slug[0],
                ownerId: profileData.data.id,
                docId: draftSessionRef.current?.getRevision()?.docId,
                parentId: parentId,
                nodeData: null,
                expectedRevision: draftSessionRef.current?.getRevision(),
                assetReferences: extractAssetReferences(editorContext.getJSON() as JSONContent),
            };
            workerRef.current.postMessage({ type: "data", data: { data: editorContext.getJSON(), pageId: Number(slug[1]), id: docId } });
        }
    };

    draftPayloadRef.current = () => ({
        id: Number(slug[1]), spaceId: slug[0], ownerId: profileData?.data?.id,
        docId, parentId, title: ydoc.getText("title").toString().trim() || "Untitled",
        assetReferences: editorContext ? extractAssetReferences(editorContext.getJSON() as JSONContent) : undefined,
    });

    useEffect(() => {
        if (!profileData?.data?.id) return;
        let tabId: string;
        try {
            tabId = sessionStorage.getItem("beskar:document-tab") || crypto.randomUUID();
            sessionStorage.setItem("beskar:document-tab", tabId);
        } catch { tabId = crypto.randomUUID(); }
        const sessionKey = `document:${profileData.data.id}:${slug[0]}:${slug[1]}:${tabId}`;
        let recovery: IndexedDbYjsRecoveryAdapter | undefined;
        try { recovery = new IndexedDbYjsRecoveryAdapter(sessionKey, slug[1]); } catch { /* Saving to the server still works. */ }
        const session = new DocumentDraftSession(ydoc,
            (import.meta.env.VITE_USER_SERVER_URL || "").replace(/\/+$/, ""),
            `editor/space/${slug[0]}/page/${slug[1]}/edit`,
            () => draftPayloadRef.current(),
            (saving, error) => { setUpdating(saving); setSaveNotice(error); },
            undefined, remote => { setDocId(remote.docId); setParentId(remote.parentId); },
            recovery ? { adapter: recovery, sessionKey, draftId: slug[1] } : undefined);
        draftSessionRef.current = session;
        return () => { session.dispose(); draftSessionRef.current = undefined; };
    }, [ydoc, slug[0], slug[1], profileData?.data?.id]);

    const updateContent = useCallback((content: JSONContent | null, _nextTitle: string) => {
        if (!isEditorReady || !profileData?.data?.id || !content) return;
        void draftSessionRef.current?.save().catch(() => {});
    }, [isEditorReady, profileData?.data?.id]);

    const handleClose = async () => {
        if (!isEditorReady) return;
        try { await draftSessionRef.current?.save(); } catch { return; }
        navigate(`/space/${slug[0]}/view/${slug[1]}`);
    };

    const reconcileDraft = useCallback(() => {
        void draftSessionRef.current?.reconcile().catch(() => {});
    }, []);

    const handlePageEvent = useCallback((ev: PageEventV1) => {
        if (ev.schemaVersion === 1 && (ev.type === "document.published" || ev.type === "draft.updated")) reconcileDraft();
    }, [reconcileDraft]);

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

    useEffect(() => {
        const run = () => {
            if (document.visibilityState === "visible" && profileData && provider) {
                reconcileDraft();
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
    }, [profileData, provider, reconcileDraft]);

    useEffect(() => {
        if (!isEditorReady) return;
        window.addEventListener("online", reconcileDraft);
        return () => { window.removeEventListener("online", reconcileDraft); };
    }, [isEditorReady, reconcileDraft]);

    // Every participant loads its own server snapshot, independent of signaling.
    useEffect(() => { fetchData(); }, [fetchData]);

    const seedPublishedTitle = (id: number, initialTitle: string) => {
        y.applyUpdate(ydoc, publishedDocumentSeed(id, initialTitle));
    };

    const safeMerge = (base64Update: string) => {
        mergeDocumentState(ydoc, base64ToUint8Array(base64Update));
    };

    useEffect(() => {
        if (documentData || documentErrors) {

            if (!documentData?.data) return;
            draftSessionRef.current?.initialize(documentData.data);
            setDocId(documentData.data.docId);
            setParentId(documentData.data.parentId);
            // do we have draft document available
            if (documentData.data.data?.data) {
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

                seedPublishedTitle(documentData.data.docId, documentData.data.title);

                // If there's no real content, unlock the editor immediately.
                // The WASM effect below guards on hasRealContent too, so it won't fire.
                if (!hasRealContent) {
                    setIsEditorReady(true);
                }
                // else: WASM effect will call setIsEditorReady(true) via applyEditorData
            } else {
                seedPublishedTitle(documentData.data.docId, documentData.data.title);
                setIsEditorReady(true);
            }
        }
    }, [documentData, documentErrors, profileData?.data?.id]);

    // Send doc to WASM only for the nodeData path (first-time load, no draft yet).
    // The shared loaded flag lets an already bootstrapped peer supply the body.
    useEffect(() => {
        if (!workerInitiated) return;
        if (!documentData?.data) return;
        if (documentData.data.data?.data) return;        // draft → safeMerge only
        // Guard: nodeData must be a non-empty object with actual content.
        // An empty object {} is falsy for our purposes — it means a brand-new doc
        // with no content yet. Sending it to WASM produces {type:"",…} which crashes
        // ProseMirror's fromJSON with "Unknown node type: ".
        const nodeData = documentData.data.nodeData;
        if (!nodeData || typeof nodeData !== 'object' || Object.keys(nodeData).length === 0) return;
        if (!editorContext) return;
        if (!provider) return;

        const dispatch = () => {
            const documentMeta = ydoc.getMap("documentMeta");
            // Stale dbLoaded can arrive over WebRTC/BC while the body is still TipTap's init — do not skip WASM in that case.
            if (documentMeta.get("loaded") === true || ydoc.getText("dbLoaded").toString().includes("true")) {
                if (!isFreshDocument(ydoc)) {
                    setIsEditorReady(true);
                    return;
                }
                documentMeta.delete("loaded");
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

    useEffect(() => {
        if (publishErrors) { setIsPreparingPublish(false); setSaveNotice(publishErrors.message || "Unable to publish document. Retry publish."); }
    }, [publishErrors]);

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
        if (!ydoc) return;
        handleObservers();
    }, [ydoc]);

    useEffect(() => {
        if (!provider) return;
        if (!user) return;

        provider.awareness.setLocalStateField("user", user);
        return () => { provider.awareness.setLocalStateField("user", null); };
    }, [provider, user]);

    useEffect(() => {
        if (!provider) return;

        const syncCollaborators = () => {
            const states = Array.from(provider.awareness.getStates().values());

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

            setActiveCollaborators(previous => previous.length === deduped.length && previous.every((peer, index) => {
                const next = deduped[index];
                return peer.id === next.id && peer.name === next.name && peer.email === next.email && peer.color === next.color;
            }) ? previous : deduped);
        };

        syncCollaborators();
        provider.awareness.on("change", syncCollaborators);
        return () => {
            provider.awareness.off("change", syncCollaborators);
        };
    }, [provider]);

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

    // Keep ref in sync with state so worker's onmessage closure always reads latest editor
    useEffect(() => {
        editorContextRef.current = editorContext;
    }, [editorContext]);

    const applyEditorData = (data: string) => {
        if (!editorContextRef.current) {
            console.error('applyEditorData: editorContext not ready yet');
            return;
        }

        const documentMeta = ydoc.getMap("documentMeta");
        if (documentMeta.get("loaded") === true || ydoc.getText("dbLoaded").toString().includes("true")) {
            if (!isFreshDocument(ydoc)) {
                setIsEditorReady(true);
                return;
            }
            documentMeta.delete("loaded");
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
        const source = documentDataRef.current?.data;
        if (!source) return;
        mergeDocumentState(ydoc, publishedDocumentSeed(source.docId, source.title, {
            schema: editorContextRef.current.schema, json: tiptapDoc,
        }));

        setIsEditorReady(true);
    };

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

    if (!provider && collaborationNotice) {
        return <div role="alert">{collaborationNotice}</div>;
    }

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

    if (documentErrors || (documentData && !documentData.data)) {
        return <div role="alert">Unable to load document. <button onClick={() => fetchData()}>Retry</button></div>;
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
                                    presenceNotice={saveNotice || collaborationNotice}
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
                                {titleTextProvider && <DocumentTitle
                                    text={titleTextProvider}
                                    awareness={provider.awareness}
                                    editor={editorContext}
                                    disabled={!isEditorReady}
                                />}
                                <TipTap
                                    title={title || ""}
                                    setEditorContext={setEditorContext}
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
