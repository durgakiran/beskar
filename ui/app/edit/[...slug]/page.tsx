"use client";
import { TipTap } from "@editor";
import { EditorContext } from "@editor/context/editorContext";
import { Editorheader } from "@editor/header";
import TextArea from "@editor/textarea/TextArea";
import { Editor } from "@tiptap/react";
import { Spinner } from "flowbite-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import "./styles.css";
import { useSession } from "next-auth/react";
import { Response, useGet } from "@http/hooks";

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
    data: DraftData
}

export default function Page({ params }: { params: { slug: string[] } }) {
    const [editorData, setEditorData] = useState({});
    const [editorContext, setEditorContext] = useState<Editor>();
    const [ { data, errors, isLoading: loading }, fetchData ] = useGet<Response<IData>>(`editor/space/${params.slug[0]}/page/${params.slug[1]}/edit`)
    const [loaded, setLoaded] = useState(false);
    const [title, setTitle] = useState<string>();
    const router = useRouter();
    const { data: sessionData, status } = useSession();

    const handleClose = () => {
        router.push(`/space/${params.slug[0]}/view/${params.slug[1]}`);
    };

    useEffect(() => {
        if (status === "authenticated") {
            if (!loaded) {
                fetchData();
            }
        } else if (status !== "loading") {
            router.push("/");
        }
    }, [status]);

    useEffect(() => {
        try {
            if (data) {
                setLoaded(true);
                setTitle(data.data.title);
                const eData = typeof data.data.data.data === "string" ? JSON.parse(data.data.data.data) : data.data.data.data;
                setEditorData(eData);
            }
        } catch (e) {
            console.log(e);
        }
    }, [data]);

    if (loading || status === "loading") {
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
                            <Editorheader handleClose={handleClose} />
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
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
