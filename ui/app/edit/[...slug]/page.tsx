"use client";
import { TipTap } from "@editor";
import { EditorContext } from "@editor/context/editorContext";
import { Editorheader } from "@editor/header";
import TextArea from "@editor/textarea/TextArea";
import { Editor } from "@tiptap/react";
import { Spinner } from "flowbite-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import "./styles.css";
import { Response, useGet } from "@http/hooks";
import { usePUT } from "app/core/http/hooks/usePut";

interface DraftData {
    data: any;
}

interface IData {
    title: string;
    ownerId: string;
    parentId: number;
    id: number;
    docId: number;
    spaceId: string;
    data: DraftData;
    draft: boolean;
    nodeData: any;
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

interface IPayloadPublish {
    title: string;
    ownerId: string;
    parentId?: number;
    id: number;
    docId?: number;
    spaceId: string;
    nodeData: any;
}

interface UpdateDocDTO {
    page: number
}

interface DocumentDTO {
    id: number;
    pageId: number;
    data: any;
}

interface User {
    name: string;
    username: string;
    email: string;
    id: string;
    emailVerified: boolean;
}

export default function Page({ params }: { params: { slug: string[] } }) {
    const [editorData, setEditorData] = useState({});
    const [editorContext, setEditorContext] = useState<Editor>();
    const [ { data, errors, isLoading: loading }, fetchData ] = useGet<Response<IData>>(`editor/space/${params.slug[0]}/page/${params.slug[1]}/edit`)
    const [ { errors: upadteErrors, isLoading: updating }, updateDraftData ] = usePUT<Response<UpdateDocDTO>, IPayload>(`editor/update`)
    const [ { data:  publishigData,errors: publishErrors, isLoading: publishing }, publishDraftData ] = usePUT<Response<UpdateDocDTO>, IPayloadPublish>(`editor/publish`)
    const [ { data: profileData, errors: profileErrors, isLoading: profileLoading }, getProfile ] = useGet<Response<User>>(`profile/details`)
    const [loaded, setLoaded] = useState(false);
    const [title, setTitle] = useState<string>();
    const router = useRouter();
    const workerRef = useRef<Worker>();
    const [workerInitiated, setWorkerInitiated] = useState(false);
    const [updatedData, setUpdatedData] = useState<DocumentDTO>();
    const [updatedTitle, setUpdatedTitle] = useState<string>();
    const [publishableDocument, setPublishableDocument] = useState<any>();
    const [page, setPage] = useState<Response<IData>>();

    const handleClose = () => {
        router.push(`/space/${params.slug[0]}/view/${params.slug[1]}`);
    };

    const updateContent = (content: any, title: string) => {
        const payLoad: IPayload = {
            data: content,
            id: Number(params.slug[1]),
            ownerId: profileData.data.id,
            spaceId: params.slug[0],
            title: title
        }
        setUpdatedData({ data: content, id: page.data.docId, pageId: page.data.id });
        setUpdatedTitle(title);
        updateDraftData(payLoad);
    }

    const handleUpdate = () => {
        workerRef.current.postMessage({ type: "data", data: updatedData })
    }

    useEffect(() => {
        if (data) {
            setUpdatedData({ data: editorData, id: data.data.docId, pageId: data.data.id });
        }
    }, [editorData]);

    useEffect(() => {
        if (data) {
            setPage(data);
        }
    }, [data])

    useEffect(() => {
        if (upadteErrors) {
            console.error("Something went wrong while updating data ",upadteErrors)
        }
    }, [upadteErrors])


    useEffect(() => {
        if (!profileLoading && !publishing && publishableDocument) {
            publishDraftData({ title: title, id: Number(params.slug[1]), spaceId: params.slug[0], ownerId: profileData.data.id, nodeData: publishableDocument, docId: page.data.docId, parentId: page.data.parentId  })
        }
    }, [profileLoading, publishableDocument]);

    useEffect(() => {
        if (publishigData) {
            router.push(`/space/${params.slug[0]}/view/${params.slug[1]}`);
        }
    }, [publishigData])


    useEffect(() => {
        workerRef.current = new Worker("/workers/editor.js", { type: "module" });
        workerRef.current.onmessage = (e) => {
            switch (e.data.type) {
                case "initiated":
                    setWorkerInitiated(true);
                    break;
                case "editorData":
                    setEditorData(e.data.data ? JSON.parse(e.data.data) : undefined);
                    break;
                case "contentData":
                    setPublishableDocument(JSON.parse(e.data.data).data)
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

    useEffect(() => {
        try {
            if (data) {
                setLoaded(true);
                setTitle(data.data.title);
                if (data.data.draft) {
                    const eData = typeof data.data.data.data === "string" ? JSON.parse(data.data.data.data) : data.data.data.data;
                    setUpdatedData({ data: eData, id: data.data.docId, pageId: data.data.id });
                    setEditorData(eData);
                } else {
                    // render by loading data from worker
                    workerRef.current.postMessage({ type: "doc", data: data.data });
                }
            }
        } catch (e) {
            console.error(e);
        }
    }, [data]);

    useEffect(() => {
        getProfile();
    }, []);

    if (loading || profileLoading) {
        <div className="text-center">
            <Spinner size="lg" />
        </div>;
    }

    if (errors) {
        return <div>Something went wrong</div>
    }

    return (
        <div style={{ minHeight: 300 }}>
            {title && (
                <div data-testid="editor-window">
                    <div
                        className="header"
                        data-testid="sticky-header"
                        style={{ position: "sticky", zIndex: 1, top: 0, display: "grid", placeItems: "center", marginBottom: "2rem", backgroundColor: "white" }}
                    >
                        <EditorContext.Provider value={editorContext}>
                            <Editorheader handleClose={handleClose} handleUpdate={handleUpdate}/>
                        </EditorContext.Provider>
                    </div>
                    <div style={{ maxWidth: "1024px", margin: "auto" }}>
                        <div>
                            <TextArea value={title} handleInput={(value: string) => setTitle(value)} />
                        </div>
                        <TipTap
                            title={title}
                            setEditorContext={(editorContext: Editor) => setEditorContext(editorContext)}
                            content={editorData}
                            pageId={params.slug[1]}
                            id={data.data.docId}
                            updateContent={(content, title) => updateContent(content, title)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
