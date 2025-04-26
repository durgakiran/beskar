"use client";

import { TipTap } from "@editor";
import { EditorContext } from "@editor/context/editorContext";
import { SocketContext } from "@editor/context/SocketContext";
import { Editorheader } from "@editor/header";
import TextArea from "@editor/textarea/TextArea";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Response, useGet } from "@http/hooks";
import { Editor } from "@tiptap/react";
import { Spinner } from "flowbite-react";
import { useContext, useEffect, useRef, useState } from "react";
import * as y from "yjs"
import "./styles.css";

interface User {
    name: string;
    username: string;
    email: string;
    id: string;
    emailVerified: boolean;
}

export default function Page({ params: { slug } }: { params: { slug: string[] } }) {
    const socket = useContext(SocketContext);
    const [provider, setProvider] = useState<HocuspocusProvider>();

    // profile of the current user
    const [{ data: profileData, errors: profileErrors, isLoading: profileLoading }, getProfile] = useGet<Response<User>>(`profile/details`);

    // start of editor handling
    const [editorContext, setEditorContext] = useState<Editor>();
    const [isSynced, setIsSynced] = useState<boolean>(false);
    const [title, setTitle] = useState<string>();
    const [titleTextProvider, setTitleTextProvider] = useState<y.Text>();
    // end of editor handling

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

    useEffect(() => {
        const _p = new HocuspocusProvider({
            websocketProvider: socket,
            name: slug[1] + "-space-" + slug[0],
            onSynced(data) {
                setIsSynced(true);
                // Get title text after document is synced
                const titleProvider = _p.document?.getText("title");
                setTitleTextProvider(titleProvider);
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
        console.log("title:", title);
    }, [title]);

    if (profileLoading || !provider || !isSynced) {
        return (
            <div className="text-center">
                <Spinner size="lg" />
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
                            style={{ position: "sticky", zIndex: 1, top: 0, display: "grid", placeItems: "center", marginBottom: "2rem", backgroundColor: "white" }}
                        >
                            <EditorContext.Provider value={editorContext}>
                                <Editorheader handleClose={() => console.log("close")} handleUpdate={() => console.log("update")} />
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
                                    // updateContent(content, title);
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

// import { TipTap } from "@editor";
// import { EditorContext } from "@editor/context/editorContext";
// import { Editorheader } from "@editor/header";
// import TextArea from "@editor/textarea/TextArea";
// import { Editor } from "@tiptap/react";
// import { Spinner } from "flowbite-react";
// import { useRouter } from "next/navigation";
// import { useEffect, useMemo, useRef, useState } from "react";
// import "./styles.css";
// import { Response, useGet } from "@http/hooks";
// import { usePUT } from "app/core/http/hooks/usePut";
// import { HocuspocusProvider } from "@hocuspocus/provider";
// import { TiptapTransformer } from "@hocuspocus/transformer";
// import * as Y from "yjs";

// interface DraftData {
//     data: any;
// }

// interface IData {
//     title: string;
//     ownerId: string;
//     parentId: number;
//     id: number;
//     docId: number;
//     spaceId: string;
//     data: DraftData;
//     draft: boolean;
//     nodeData: any;
// }

// interface IPayload {
//     title: string;
//     ownerId: string;
//     parentId?: number;
//     id: number;
//     docId?: number;
//     spaceId: string;
//     data: any;
// }

// interface IPayloadPublish {
//     title: string;
//     ownerId: string;
//     parentId?: number;
//     id: number;
//     docId?: number;
//     spaceId: string;
//     nodeData: any;
// }

// interface UpdateDocDTO {
//     page: number;
// }

// interface DocumentDTO {
//     id: number;
//     pageId: number;
//     data: any;
// }

// interface User {
//     name: string;
//     username: string;
//     email: string;
//     id: string;
//     emailVerified: boolean;
// }

// interface EditorNode {
//     type: string;
//     attrs?: Record<string, any>;
//     content?: EditorNode[];
// }

// interface EditorDocument {
//     type: string;
//     content: EditorNode[];
// }

// export default function Page({ params: { slug } }: { params: { slug: string[] } }) {
//     const [editorData, setEditorData] = useState({});
//     const [editorContext, setEditorContext] = useState<Editor>();
//     const [{ data, errors, isLoading: loading }, fetchData] = useGet<Response<IData>>(`editor/space/${slug[0]}/page/${slug[1]}/edit`);
//     const [{ errors: upadteErrors, isLoading: updating }, updateDraftData] = usePUT<Response<UpdateDocDTO>, IPayload>(`editor/update`);
//     const [{ data: publishigData, errors: publishErrors, isLoading: publishing }, publishDraftData] = usePUT<Response<UpdateDocDTO>, IPayloadPublish>(`editor/publish`);
//     const [{ data: profileData, errors: profileErrors, isLoading: profileLoading }, getProfile] = useGet<Response<User>>(`profile/details`);
//     const [loaded, setLoaded] = useState(false);
//     const [title, setTitle] = useState<string>();
//     const router = useRouter();
//     const workerRef = useRef<Worker>();
//     const [workerInitiated, setWorkerInitiated] = useState(false);
//     const [updatedData, setUpdatedData] = useState<DocumentDTO>();
//     const [updatedTitle, setUpdatedTitle] = useState<string>();
//     const [publishableDocument, setPublishableDocument] = useState<any>();
//     const [page, setPage] = useState<Response<IData>>();
//     const [provider, setProvider] = useState<HocuspocusProvider>();
//     const [yDoc, setYDoc] = useState<Y.Doc>();

//     const rendered = useRef(0);
//     rendered.current += 1;

//     const handleClose = () => {
//         router.push(`/space/${slug[0]}/view/${slug[1]}`);
//     };

//     const updateContent = (content: any, title: string) => {
//         const payLoad: IPayload = {
//             data: content,
//             id: Number(slug[1]),
//             ownerId: profileData.data.id,
//             spaceId: slug[0],
//             title: title,
//         };
//         setUpdatedData({ data: content, id: page.data.docId, pageId: page.data.id });
//         setUpdatedTitle(title);
//         updateDraftData(payLoad);
//     };

//     const handleUpdate = () => {
//         workerRef.current.postMessage({ type: "data", data: updatedData });
//     };

//     const hoscusPocusProvider = () => {
//         console.log("hocuspocus provider");
//         return new HocuspocusProvider({
//             name: slug[1],
//             url: "ws://app.tededox.com:1234",
//             preserveConnection: false
//         })
//     }

//     useEffect(() => {
//         setYDoc(new Y.Doc());
//     }, []);

//     useEffect(() => {
//         fetchData();
//     }, []);

//     // useEffect(() => {
//     //     if (editorData && (editorData as any).content) {
//     //         console.log("editorData", editorData);
//     //         const yDoc = TiptapTransformer.toYdoc(editorData);
//     //         setYDoc(yDoc);
//     //     }
//     // }, [editorData]);

//     useEffect(() => {
//         if (data) {
//             console.log("data", data);
//             setPage(data);
//         }
//     }, [data]);

//     useEffect(() => {
//         if (upadteErrors) {
//             console.error("Something went wrong while updating data ", upadteErrors);
//         }
//     }, [upadteErrors]);

//     useEffect(() => {
//         if (!profileLoading && !publishing && publishableDocument) {
//             publishDraftData({
//                 title: title,
//                 id: Number(slug[1]),
//                 spaceId: slug[0],
//                 ownerId: profileData.data.id,
//                 nodeData: publishableDocument,
//                 docId: page.data.docId,
//                 parentId: page.data.parentId,
//             });
//         }
//     }, [profileLoading, publishableDocument]);

//     useEffect(() => {
//         if (publishigData) {
//             router.push(`/space/${slug[0]}/view/${slug[1]}`);
//         }
//     }, [publishigData]);

//     useEffect(() => {
//         workerRef.current = new Worker("/workers/editor.js", { type: "module" });
//         workerRef.current.onmessage = (e) => {
//             switch (e.data.type) {
//                 case "initiated":
//                     setWorkerInitiated(true);
//                     break;
//                 case "editorData":
//                     setEditorData(e.data.data ? JSON.parse(e.data.data) : undefined);
//                     break;
//                 case "contentData":
//                     setPublishableDocument(JSON.parse(e.data.data).data);
//                 default:
//                     break;
//             }
//         };
//         workerRef.current.onerror = (e) => {
//             console.error(e);
//         };
//         workerRef.current.postMessage({ type: "init" });
//         return () => {
//             workerRef.current.terminate();
//         };
//     }, []);

//     useEffect(() => {
//         try {
//             if (data) {
//                 setLoaded(true);
//                 setTitle(data.data.title);
//                 if (data.data.draft) {
//                     console.log("data", data.data.data.data);
//                     const eData = typeof data.data.data.data === "string" ? JSON.parse(data.data.data.data) : data.data.data.data;
//                     setUpdatedData({ data: eData, id: data.data.docId, pageId: data.data.id });
//                     setEditorData(eData);
//                 } else {
//                     // render by loading data from worker
//                     workerRef.current.postMessage({ type: "doc", data: data.data });
//                 }
//             }
//         } catch (e) {
//             console.error(e);
//         }
//     }, [data]);

//     useEffect(() => {
//         getProfile();
//     }, []);

//     useEffect(() => {
//         // initialise hocuspocus provider
//         console.log("setting provider");
//         setProvider(hoscusPocusProvider());
//         return () => {
//             provider?.disconnect();
//         }
//     }, [yDoc]);

//     if (loading || profileLoading) {
//         <div className="text-center">
//             <Spinner size="lg" />
//         </div>;
//     }

//     if (errors) {
//         return <div>Something went wrong</div>;
//     }

//     return (
//         <div style={{ minHeight: 300 }}>
//             Rendered: {rendered.current}
//             {title && editorData && (
//                 <div data-testid="editor-window">
//                     <div
//                         className="header"
//                         data-testid="sticky-header"
//                         style={{ position: "sticky", zIndex: 1, top: 0, display: "grid", placeItems: "center", marginBottom: "2rem", backgroundColor: "white" }}
//                     >
//                         <EditorContext.Provider value={editorContext}>
//                             <Editorheader handleClose={handleClose} handleUpdate={handleUpdate} />
//                         </EditorContext.Provider>
//                     </div>
//                     <div style={{ maxWidth: "1024px", margin: "auto" }}>
//                         <div>
//                             <TextArea value={title} handleInput={(value: string) => setTitle(value)} />
//                         </div>
//                         <TipTap
//                             title={title}
//                             setEditorContext={(editorContext: Editor) => setEditorContext(editorContext)}
//                             content={editorData}
//                             pageId={slug[1]}
//                             id={data.data.docId}
//                             user={profileData.data}
//                             updateContent={(content, title) => {
//                                 updateContent(content, title);
//                             }}
//                             provider={provider}
//                         />
//                     </div>
//                 </div>
//             )}
//         </div>
//     );
// }
