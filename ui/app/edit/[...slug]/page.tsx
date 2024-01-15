"use client";
import { useQuery } from "@apollo/client";
import { TipTap } from "@editor";
import { CollaboratorProps, CollaboratorsContext } from "@editor/context/collaborators";
import { Editorheader } from "@editor/header";
import { client } from "@http";
import { Box, Heading, PageLayout, Spinner } from "@primer/react";
import { GRAPHQL_GET_PAGE } from "@queries/space";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

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
    const { data: sessionData, status } = useSession();
    const [collaborators, setCollaborators] = useState<CollaboratorProps[]>();
    const { data, loading, error, refetch } = useQuery<IData>(GRAPHQL_GET_PAGE, { client: client, variables: { pageId: params.slug[0] } });

    useEffect(() => {
        try {
            if (data) {
                const eData = typeof data.core_page[0].docs[0].data === "string" ? JSON.parse(data.core_page[0].docs[0].data) : data.core_page[0].docs[0].data;
                setEditorData(eData);
            }
        } catch (e) {
            // console.log(e);
        }
    }, [data, error]);

    useEffect(() => {
        if (status === "authenticated" && sessionData.user) {
            console.log("setting value", sessionData.user);
            const user = { name: sessionData.user.name, image: sessionData.user.image, id: sessionData.user.id };
            setCollaborators([user]);
        }
    }, [status]);

    if (loading) {
        <Box sx={{ textAlign: "center" }}>
            <Spinner size="medium" />
        </Box>;
    }

    return (
        <div style={{ minHeight: 300 }}>
            {data && (
                <Box data-testid="editor-window">
                    <Box as="header" data-testid="sticky-header" sx={{ position: "sticky", zIndex: 1, top: 0, padding: "2em 1em", display: "grid", placeItems: "center", backgroundColor: "white" }}>
                        <CollaboratorsContext.Provider value={collaborators}>
                            <Editorheader />
                        </CollaboratorsContext.Provider>
                    </Box>
                    <PageLayout>
                        <PageLayout.Content sx={{ maxWidth: "1024px", margin: "auto" }}>
                            <Box>
                                <Heading as="h1">{data.core_page[0].docs[0].title}</Heading>
                            </Box>
                            <TipTap content={editorData} pageId={params.slug[0]} id={data.core_page[0].docs[0].id} />
                        </PageLayout.Content>
                    </PageLayout>
                </Box>
            )}
        </div>
    );
}
