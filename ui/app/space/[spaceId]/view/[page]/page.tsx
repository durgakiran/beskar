'use client'
import { useLazyQuery, useQuery } from "@apollo/client";
import { TipTap } from "@editor";
import { client } from "@http";
import { Box, Heading, Spinner } from "@primer/react";
import { GRAPHQL_GET_PAGE } from "@queries/space";
import { useUser } from "app/core/auth/useKeycloak";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface IDoc {
    data: any;
    id: number;
    title: string;
    version: Date
}

interface IPage {
    date_created: Date;
    draft: number;
    id: number;
    owner_id: string;
    parent_id: string | null;
    space_id: string;
    status: string | null;
    docs: Array<IDoc>
}

interface IData {
    core_page: Array<IPage>
}

export default function Page({ params }: { params: { page: string } }) {
    const user = useUser();
    const router = useRouter();
    const  [editorData, setEditorData] = useState({});
    const [ getPage, { loading, error, data } ] = useLazyQuery<IData, { pageId: string }>(GRAPHQL_GET_PAGE, { client: client, variables: { pageId: params.page } });

    useEffect(() => {
        console.log(user);
        if (user && user.authenticated) {
            getPage();
        }
        if (user && !user.authenticated) {
            router.push("/space");
        }
    }, [user]);

    useEffect(() => {
        try {
            if (data) {
                const eData = typeof data.core_page[0].docs[0].data === 'string' ? JSON.parse(data.core_page[0].docs[0].data) : data.core_page[0].docs[0].data;
                setEditorData(eData);
            }
        } catch (e){
            // console.log(e);
        }
    }, [data, error]);

    if (loading || user.loading) {
        <Box sx={{textAlign: "center"}}>
            <Spinner size="medium" />
        </Box>
    }

    return (
        <div style={{height: 300 }}>
            {
                data && (
                    <Box>
                        <Box>
                            <Heading as="h1">{data.core_page[0].docs[0].title}</Heading>
                        </Box>
                        <TipTap title={data.core_page[0].docs[0].title} setEditorContext={() => {}} editable={false} content={editorData} pageId={params.page} id={data.core_page[0].docs[0].id} />
                    </Box>
                )
            }
            
        </div>
    )
}
