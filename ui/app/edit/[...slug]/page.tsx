"use client";

import { TipTap } from "@editor";
import { EditorContext } from "@editor/context/editorContext";
// import { SocketContext } from "@editor/context/SocketContext";
import { Editorheader } from "@editor/header";
import TextArea from "@editor/textarea/TextArea";
// import { HocuspocusProvider } from "@hocuspocus/provider";
import { Response, useGet } from "@http/hooks";
import { Editor } from "@tiptap/react";
import { Spinner, Flex } from "@radix-ui/themes";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as y from "yjs"
import "./styles.css";
import { usePUT } from "app/core/http/hooks/usePut";
import { useRouter } from "next/navigation";
import { WebrtcProvider } from "y-webrtc";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";

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
    id: number;
    nodeData: any;
    ownerId: string;
    parentId: number;
    spaceId: string;
    title: string;
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
}

export default function Page({ params }: { params: Promise<{ slug: string[] }> }) {
    const { slug } = use(params);
    // const socket = useContext(SocketContext);
    const [provider, setProvider] = useState<WebrtcProvider>();
    const router = useRouter();

    // profile of the current user
    const [{ data: profileData, errors: profileErrors, isLoading: profileLoading }, getProfile] = useGet<Response<User>>(`profile/details`);

    // start of editor handling
    const [{ data: publishigData, errors: publishErrors, isLoading: publishing }, publishDraftData] = usePUT<Response<UpdateDocDTO>, IPayloadPublish>(`editor/publish`);
    const [{ errors: upadteErrors, isLoading: updating }, updateDraftData] = usePUT<Response<UpdateDocDTO>, IPayload>(`editor/update`);
    const [{ isLoading: isDocumentLoading, data: documentData, errors: documentErrors }, fetchData] = useGet<Response<EditDataDTO>>(`editor/space/${slug[0]}/page/${slug[1]}/edit`);
    const [editorContext, setEditorContext] = useState<Editor>();
    // const [isSynced, setIsSynced] = useState<boolean>(false);
    const [title, setTitle] = useState<string>();
    const [titleTextProvider, setTitleTextProvider] = useState<y.Text>();
    const [publishableDocument, setPublishableDocument] = useState<any>();
    const [updatedData, setUpdatedData] = useState<DocumentDTO>();
    const [updatedTitle, setUpdatedTitle] = useState<string>();
    const [docId, setDocId] = useState<number>();
    const [parentId, setParentId] = useState<number>();
    const [docIdProvider, setDocIdProvider] = useState<y.Text>();
    const [parentIdProvider, setParentIdProvider] = useState<y.Text>();
    const [isEditorReady, setIsEditorReady] = useState<boolean>(false);
    const activeSockets = useRef<Map<WebSocket, number>>(new Map());
    const [isLeader, setIsLeader] = useState<boolean>(false);
    const [isDocumentFetched, setIsDocumentFetched] = useState<boolean>(false);
    // end of editor handling

    // wasm handling
    const [workerInitiated, setWorkerInitiated] = useState<boolean>(false);
    const workerRef = useRef<Worker>(null);
    const editorContextRef = useRef<Editor>(null);
    // end of wasm handling

    // to check the nunber of times component rendered
    const rendered = useRef(0);
    rendered.current += 1;

    // fetch profile data
    useEffect(() => {
        getProfile();
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

    const handleLeaderShipChange = useCallback((event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (data.type === 'leader' && data.isLeader) {
            setIsLeader(true);
        } else {
            setIsLeader(false);
        }
    }, []);

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
        if (updatedData) {
            workerRef.current.postMessage({ type: "data", data: updatedData });
        } else {
            // there is no updatedData on load and so we need to get data from editor context it self
            workerRef.current.postMessage({ type: "data", data: { data: editorContext.getJSON(), pageId: Number(slug[1]), id: docId } });
        }
    };

    const updateContent = (content: any, title: string) => {
        const payLoad: IPayload = {
            data: content,
            id: Number(slug[1]),
            ownerId: profileData.data.id,
            spaceId: slug[0],
            docId: docId,
            parentId: parentId,
            title: title,
        };
        setUpdatedData({ data: content, pageId: Number(slug[1]), id: docId });
        setUpdatedTitle(title);
        updateDraftData({ ...payLoad, data: Buffer.from(y.encodeStateAsUpdate(ydoc)).toString('base64') });
    };

    const handleClose = () => {
        router.push(`/space/${slug[0]}/view/${slug[1]}`);
    };

    useEffect(() => {
        if (!publishing && publishableDocument) {
            publishDraftData({
                title: title,
                id: Number(slug[1]),
                spaceId: slug[0],
                ownerId: profileData.data.id,
                nodeData: publishableDocument,
                docId: docId,
                parentId: parentId,
            });
        }
    }, [publishableDocument]);

    // if leader load document from database only once.
    useEffect(() => {
        if (isLeader && !isDocumentLoading && !isDocumentFetched) {
            fetchData();
        }
    }, [isLeader]);

    const safeMerge = (base64Update: string) => {
        const dbUpdate = Buffer.from(base64Update, 'base64');

        // Decode DB state into a temp doc — never touch ydoc until we know what to apply
        const dbDoc = new y.Doc();
        y.applyUpdate(dbDoc, dbUpdate);

        // Check whether ydoc only has TipTap's initialization content (empty paragraph).
        // TipTap's Collaboration extension always inserts an empty paragraph using the
        // NEW session's clientID. If the state vector has ONLY our own clientID, it means
        // no peers have synced real content yet — it's a fresh load.
        const svMap = y.decodeStateVector(y.encodeStateVector(ydoc));
        const hasOnlyLocalInit = svMap.size === 1 && svMap.has(ydoc.clientID);

        if (hasOnlyLocalInit) {
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
            // do we have draft document available
            if (documentData.data.draft && documentData.data.data.data) {
                // documentData.data.data.data is ydoc
                const data = documentData.data.data.data;
                // y.applyUpdate(ydoc, Buffer.from(data, 'base64'));
                safeMerge(data);
                setIsEditorReady(true);
            } else if (documentData.data.nodeData) {
                // create ydoc from documentData.data.nodeData
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


            } else {
                // create ydoc from documentData.data.nodeData
                // set the title of the document
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
        if (!documentData.data.nodeData) return;    // no nodeData → nothing to do
        if (!editorContext) return;
        if (!provider) return;

        const dispatch = () => {
            // If any peer already loaded from DB this session, the flag is in the ydoc
            if (ydoc.getText('dbLoaded').toString() === 'true') {
                setIsEditorReady(true);
                return;
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
            provider.off('synced', onSynced);
            clearTimeout(fallback);
        };
    }, [workerInitiated, documentData, editorContext, provider]);

    // redirect to view page after publishing
    useEffect(() => {
        if (publishigData && !publishing) {
            router.push(`/space/${slug[0]}/view/${slug[1]}`);
        }
    }, [publishigData, publishing]);

    useEffect(() => {
        const _provider = new WebrtcProvider(slug[1] + "-space-" + slug[0], ydoc, {
            signaling: [process.env.NEXT_PUBLIC_SIGNALING_URL || 'wss://app.durgakiran.com/ws'],
            filterBcConns: false
        });
        setProvider(_provider);
        return () => {
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
        provider.awareness.setLocalStateField('user', {
            id: user.id,
            name: user.name,
            color: user.color,
        });

        const messageHandler = (event: MessageEvent) => {
            // y-webrtc mixed binary and JSON. Only process strings.                
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'leader') {
                    handleLeaderShipChange(event);
                }
            } catch (e) {
                // ignore non-JSON binary frames from y-webrtc
            }
        };

        provider.signalingConns.forEach((conn) => {
            const socket = conn.ws as WebSocket;
            if (socket && !activeSockets.current.has(socket)) {

                const handleAmILeader = () => {
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({
                            type: 'amIleader',
                            topic: slug[1] + "-space-" + slug[0],
                        }));
                    }
                };

                const startPolling = () => {
                    socket.addEventListener('message', messageHandler);
                    handleAmILeader(); // ask immediately — don't wait 10s
                    const timeInterval = setInterval(handleAmILeader, 10000) as unknown as number;
                    socket.addEventListener('close', () => {
                        socket.removeEventListener('message', messageHandler);
                        activeSockets.current.delete(socket);
                        clearInterval(timeInterval);
                    });
                    activeSockets.current.set(socket, timeInterval);
                };

                if (socket.readyState === WebSocket.OPEN) {
                    // Socket already open — open event already fired, call directly
                    startPolling();
                } else {
                    // Socket not yet open — wait for it
                    socket.addEventListener('open', startPolling);
                }
            }
        });


        return () => {
            // Clean up awareness state on unmount
            provider.awareness.setLocalStateField('user', null);

            activeSockets.current.forEach((timeInterval, socket) => {
                clearInterval(timeInterval);
                socket.removeEventListener('message', messageHandler);
                activeSockets.current.delete(socket);
            });
        };
    }, [provider, user]);

    // useEffect(() => {
    //     const _p = new HocuspocusProvider({
    //         websocketProvider: socket,
    //         name: slug[1] + "-space-" + slug[0],
    //         onSynced(data) {
    //             setIsSynced(true);
    //             // Get title text after document is synced
    //             const titleProvider = _p.document?.getText("title");
    //             setTitleTextProvider(titleProvider);
    //             const docIdProvider = _p.document?.getText("docId");
    //             setDocIdProvider(docIdProvider);
    //             const parentIdProvider = _p.document?.getText("parentId");
    //             setParentIdProvider(parentIdProvider);
    //         },
    //     });
    //     setProvider(_p);
    //     _p.attach();
    //     socket.connect();
    //     return () => {
    //         _p.detach();
    //         socket.disconnect();
    //     };
    // }, [socket, slug]);

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
            setDocId(Number(newDocId));
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

        // If the dbLoaded flag is already in the ydoc, another peer (e.g. a BC tab)
        // already loaded and synced the content — skip to avoid duplication.
        if (ydoc.getText('dbLoaded').toString() === 'true') {
            setIsEditorReady(true);
            return;
        }

        const tiptapDoc = JSON.parse(data);
        const tempYDoc = prosemirrorJSONToYDoc(editorContextRef.current.schema, tiptapDoc, 'default');

        // Clear TipTap's init paragraph before applying DB content
        const fragment = ydoc.getXmlFragment('default');
        if (fragment.length > 0) fragment.delete(0, fragment.length);

        y.applyUpdate(ydoc, y.encodeStateAsUpdate(tempYDoc));

        // Set the flag — propagates to all peers via WebRTC/BC
        const dbLoadedText = ydoc.getText('dbLoaded');
        if (dbLoadedText.length === 0) dbLoadedText.insert(0, 'true');

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
                    setPublishableDocument(JSON.parse(e.data.data).data);
                default:
                    break;
            }
        };
        workerRef.current.onerror = (e) => {
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

    return (
        <div style={{ minHeight: 300 }}>
            Rendered: {rendered.current} Leader: {isLeader ? "Yes" : "No"}
            {
                profileData && (
                    <div data-testid="editor-window">
                        <div
                            className="header"
                            data-testid="sticky-header"
                            style={{
                                position: "sticky",
                                zIndex: 1,
                                top: 0,
                                marginBottom: "2rem",
                                backgroundColor: "white",
                                width: "100%"
                            }}
                        >
                            <EditorContext.Provider value={editorContext}>
                                <Editorheader handleClose={handleClose} handleUpdate={handleUpdate} />
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
                                    editable={true}
                                    id={49}
                                    user={user}
                                    updateContent={(content, title) => {
                                        updateContent(content, title);
                                    }}
                                    provider={provider}
                                    ydoc={ydoc}
                                />
                            </div>
                        </div>
                    </div>
                )
            }
        </div>
    );
}

