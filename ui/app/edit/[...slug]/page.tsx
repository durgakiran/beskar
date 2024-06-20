"use client";
import { useLazyQuery } from "@apollo/client";
import { TipTap } from "@editor";
import { EditorContext } from "@editor/context/editorContext";
import { Editorheader } from "@editor/header";
import TextArea from "@editor/textarea/TextArea";
import { client } from "@http";
import { GRAPHQL_GET_PAGE } from "@queries/space";
import { Editor } from "@tiptap/react";
import { Spinner } from "flowbite-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import "./styles.css";
import { useSession } from "next-auth/react";

interface IDoc {
    data: any;
    id: number;
    title: string;
    version: Date;
}

interface IPage {
    date_created: Date;
    draft: number;
    id: number;
    owner_id: string;
    parent_id: string | null;
    space_id: string;
    status: string | null;
    docs: Array<IDoc>;
}

interface IData {
    core_page: Array<IPage>;
}

export default function Page({ params }: { params: { slug: string[] } }) {
    const [editorData, setEditorData] = useState({});
    const [editorContext, setEditorContext] = useState<Editor>();
    const [getPage, { data, loading }] = useLazyQuery<IData>(GRAPHQL_GET_PAGE, { client: client, fetchPolicy: "no-cache", variables: { pageId: params.slug[1] } });
    const [title, setTitle] = useState<string>();
    const router = useRouter();
    const { data: sessionData, status } = useSession();

    const handleClose = () => {
        router.push(`/space/${params.slug[0]}/view/${params.slug[1]}`);
    };

    useEffect(() => {
        if (status === "authenticated" && sessionData) {
            getPage();
        } else if (status !== "loading") {
            router.push("/");
        }
    }, [sessionData, status]);

    useEffect(() => {
        try {
            if (data) {
                setTitle(data.core_page[0].docs[0].title);
                const eData = typeof data.core_page[0].docs[0].data === "string" ? JSON.parse(data.core_page[0].docs[0].data) : data.core_page[0].docs[0].data;
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
                            id={data.core_page[0].docs[0].id}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
