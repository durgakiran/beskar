"use client";
import { useLazyQuery } from "@apollo/client";
import { TipTap } from "@editor";
import { EditorContext } from "@editor/context/editorContext";
import { Editorheader } from "@editor/header";
import TextArea from "@editor/textarea/TextArea";
import { client } from "@http";
import { Box, PageLayout } from "@primer/react";
import { GRAPHQL_GET_PAGE } from "@queries/space";
import { Editor } from "@tiptap/react";
import { useUser } from "app/core/auth/useKeycloak";
import { Spinner } from "flowbite-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import "./styles.css";

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
    const [ getPage , { data, loading }] = useLazyQuery<IData>(GRAPHQL_GET_PAGE, { client: client, variables: { pageId: params.slug[1] } });
    const [title, setTitle] = useState<string>();
    const router = useRouter();
    const user = useUser();

    const handleClose = () => {
        router.push(`/space/${params.slug[0]}/view/${params.slug[1]}`);
    }

    useEffect(() => {
        if (user && user.authenticated) {
            getPage();
        }
    }, [user])

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


    if (loading || user.loading) {
        <div className="text-center">
            <Spinner size="lg" />
        </div>;
    }

    return (
        <div style={{ minHeight: 300 }}>
            {title && (
                <Box data-testid="editor-window">
                    <Box as="header" data-testid="sticky-header" sx={{ position: "sticky", zIndex: 1, top: 0, padding: "2em 1em", display: "grid", placeItems: "center", backgroundColor: "white" }}>
                        <EditorContext.Provider value={editorContext}>
                            <Editorheader handleClose={handleClose} />
                        </EditorContext.Provider>
                    </Box>
                    <PageLayout>
                        <PageLayout.Content sx={{ maxWidth: "1024px", margin: "auto" }}>
                            <Box>
                                <TextArea value={title} handleInput={(value: string) => setTitle(value)} />
                            </Box>
                            <TipTap title={title} setEditorContext={(editorContext: Editor) =>  setEditorContext(editorContext) } content={editorData} pageId={params.slug[1]} id={data.core_page[0].docs[0].id} />
                        </PageLayout.Content>
                    </PageLayout>
                </Box>
            )}
        </div>
    );
}
