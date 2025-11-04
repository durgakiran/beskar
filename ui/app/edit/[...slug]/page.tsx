"use client";

import { TipTap } from "@editor";
import { EditorContext } from "@editor/context/editorContext";
import { SocketContext } from "@editor/context/SocketContext";
import { Editorheader } from "@editor/header";
import TextArea from "@editor/textarea/TextArea";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Response, useGet } from "@http/hooks";
import { Editor } from "@tiptap/react";
import { Spinner, Flex } from "@radix-ui/themes";
import { use, useContext, useEffect, useRef, useState } from "react";
import * as y from "yjs"
import "./styles.css";
import { usePUT } from "app/core/http/hooks/usePut";
import { useRouter } from "next/navigation";

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
    const socket = useContext(SocketContext);
    const [provider, setProvider] = useState<HocuspocusProvider>();
    const router = useRouter();

    // profile of the current user
    const [{ data: profileData, errors: profileErrors, isLoading: profileLoading }, getProfile] = useGet<Response<User>>(`profile/details`);

    // start of editor handling
    const [{ data: publishigData, errors: publishErrors, isLoading: publishing }, publishDraftData] = usePUT<Response<UpdateDocDTO>, IPayloadPublish>(`editor/publish`);
    const [{ errors: upadteErrors, isLoading: updating }, updateDraftData] = usePUT<Response<UpdateDocDTO>, IPayload>(`editor/update`);
    const [editorContext, setEditorContext] = useState<Editor>();
    const [isSynced, setIsSynced] = useState<boolean>(false);
    const [title, setTitle] = useState<string>();
    const [titleTextProvider, setTitleTextProvider] = useState<y.Text>();
    const [publishableDocument, setPublishableDocument] = useState<any>();
    const [updatedData, setUpdatedData] = useState<DocumentDTO>();
    const [updatedTitle, setUpdatedTitle] = useState<string>();
    const [docId, setDocId] = useState<number>();
    const [parentId, setParentId] = useState<number>();
    const [docIdProvider, setDocIdProvider] = useState<y.Text>();
    const [parentIdProvider, setParentIdProvider] = useState<y.Text>();
    // end of editor handling

    // wasm handling
    const [workerInitiated, setWorkerInitiated] = useState<boolean>(false);
    const workerRef = useRef<Worker>(null);
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
            console.log(profileErrors);
        }
    }, [profileErrors]);
    // end of profile handling

    // editor handling functions
    const handleUpdate = () => {
        if (updatedData) {
            workerRef.current.postMessage({ type: "data", data: updatedData });
        } else {
            // there is no updatedData on load and so we need to get data from editor context it self
            workerRef.current.postMessage({ type: "data", data: { data: editorContext.getJSON(), pageId: Number(slug[1]), id: docId } });
        }
    };

    const updateContent = (content: any, title: string) => {
        console.log('content', JSON.stringify(content));
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
        updateDraftData({...payLoad, data: Buffer.from(y.encodeStateAsUpdate(provider.document)).toString('base64')});
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

    // redirect to view page after publishing
    useEffect(() => {
        if (publishigData && !publishing ) {
            router.push(`/space/${slug[0]}/view/${slug[1]}`);
        }
    }, [publishigData, publishing]);

    useEffect(() => {
        const _p = new HocuspocusProvider({
            websocketProvider: socket,
            name: slug[1] + "-space-" + slug[0],
            onSynced(data) {
                setIsSynced(true);
                // Get title text after document is synced
                const titleProvider = _p.document?.getText("title");
                setTitleTextProvider(titleProvider);
                const docIdProvider = _p.document?.getText("docId");
                setDocIdProvider(docIdProvider);
                const parentIdProvider = _p.document?.getText("parentId");
                setParentIdProvider(parentIdProvider);
            },
        });
        setProvider(_p);
        _p.attach();
        socket.connect();
        return () => {
            _p.detach();
            socket.disconnect();
        };
    }, [socket, slug]);

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
    // end of editor handling functions


    // wasm worker
    useEffect(() => {
        workerRef.current = new Worker("/workers/editor.js", { type: "module" });
        workerRef.current.onmessage = (e) => {
            switch (e.data.type) {
                case "initiated":
                    setWorkerInitiated(true);
                    break;
                // case "editorData":
                //     setEditorData(e.data.data ? JSON.parse(e.data.data) : undefined);
                //     break;
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

    if (profileLoading || !provider || !isSynced) {
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
            Rendered: {rendered.current}
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
                                user={profileData.data}
                                updateContent={(content, title) => {
                                    updateContent(content, title);
                                    // console.log(content, title);
                                }}
                                provider={provider}
                            />
                        </div>
                    </div>
                )
            }
        </div>
    );
}

