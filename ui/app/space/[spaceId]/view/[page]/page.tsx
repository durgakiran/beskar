'use client'
import { useLazyQuery, useQuery } from "@apollo/client";
import { TipTap } from "@editor";
import { client } from "@http";
import { GRAPHQL_GET_PAGE, GRAPHQL_GET_PAGE_BREADCRUM } from "@queries/space";
import { Breadcrumb, BreadcrumbItem, Button, Spinner } from "flowbite-react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HiHome, HiPencil } from "react-icons/hi"

interface IDoc {
    data: any;
    id: number;
    title: string;
    version: Date
}

interface IBreadCrumSpaceData {
    name: string;
    id: number;
}

interface IBreadCrumSpace {
    space: IBreadCrumSpaceData;
    id: number;
}

interface IBreadCrum {
    core_space_url: Array<IBreadCrumSpace>;
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

export default function Page({ params }: { params: { page: string, spaceId: string } }) {
    const { data: sessionData, status } = useSession();
    const router = useRouter();
    const [editorData, setEditorData] = useState({});
    const [getPage, { loading, error, data }] = useLazyQuery<IData, { pageId: string }>(GRAPHQL_GET_PAGE, { client: client, variables: { pageId: params.page } });
    const [getBreadCrum, { loading: loadingBreadCrum, error: errorBreadCrum, data: dataBreadCrum }] = useLazyQuery<IBreadCrum, { id: string }>(GRAPHQL_GET_PAGE_BREADCRUM, { client: client, variables: { id: params.spaceId } });
    
    const editPage = () => {
        router.push(`/edit/${params.spaceId}/${params.page}`);
    }

    useEffect(() => {
        if (status === "authenticated" && sessionData) {
            getPage();
            getBreadCrum();
        } else if (status !== "loading") {
            router.push("/space");
        }
    }, [sessionData, status]);

    useEffect(() => {
        try {
            if (error && error.message.includes("JWTExpired")) {
                signIn("keycloak")
            }
            if (data) {
                const eData = typeof data.core_page[0].docs[0].data === 'string' ? JSON.parse(data.core_page[0].docs[0].data) : data.core_page[0].docs[0].data;
                setEditorData(eData);
            }
        } catch (e) {
            // console.log(e);
        }
    }, [data, error]);

    if (loading || status === "loading") {
        <div className="text-center">
            <Spinner size="lg" />
        </div>
    }
    return (
        <div className="min-h-screen mx-auto ">
            <div className="py-2 mb-4 flex flex-nowrap justify-between box-border shadow-sm   ">

                <div>
                    {
                        !loadingBreadCrum && dataBreadCrum && dataBreadCrum.core_space_url && dataBreadCrum.core_space_url[0] ?
                            <Breadcrumb aria-label="page navigation">
                                <Breadcrumb.Item href="/" icon={HiHome}>Home</Breadcrumb.Item>
                                <Breadcrumb.Item href={`space/${dataBreadCrum.core_space_url[0].id}`} >{dataBreadCrum.core_space_url[0].space.name}</Breadcrumb.Item>
                            </Breadcrumb> : null
                    }
                 </div>
                
                <div>
                    <Button  className="max-w-full "  size="sm" onClick={editPage}>
                        <HiPencil size="15" />
                    </Button>
                </div>
               
            </div>
            {
                data && (
                    <div className="ml-16 mr-16">
                        <div className="mb-8">
                            <h1 className="text-3xl font-bold">{data.core_page[0].docs[0].title}</h1>
                        </div>
                        <TipTap title={data.core_page[0].docs[0].title} setEditorContext={() => { }} editable={false} content={editorData} pageId={params.page} id={data.core_page[0].docs[0].id} />
                    </div>
                )
            }

        </div>
    )
}
