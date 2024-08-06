"use client";
import { useLazyQuery, useQuery } from "@apollo/client";
import { TipTap } from "@editor";
import { client } from "@http";
import { useGet } from "@http/hooks";
import { GRAPHQL_GET_PAGE, GRAPHQL_GET_PAGE_BREADCRUM } from "@queries/space";
import { Breadcrumb, BreadcrumbItem, Button, Spinner, Tooltip } from "flowbite-react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HiHome, HiPencil, HiOutlineTrash } from "react-icons/hi";

interface IDoc {
    data: any;
    id: number;
    title: string;
    version: Date;
}

interface IBreadCrumSpaceData {
    name: string;
    id: number;
}

interface IBreadCrumSpace {
    name: string;
    id: string;
}

interface IBreadCrum {
    core_space: Array<IBreadCrumSpace>;
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

export default function Page({ params }: { params: { page: string; spaceId: string } }) {
    const { data: sessionData, status } = useSession();
    const workerRef = useRef<Worker>();
    const [workerInitiated, setWorkerInitiated] = useState(false);
    const [content, setContent] = useState();
    const router = useRouter();
    const [editorData, setEditorData] = useState({});
    // const [getPage, { loading, error, data }] = useLazyQuery<IData, { pageId: string }>(GRAPHQL_GET_PAGE, { client: client, fetchPolicy: "no-cache", variables: { pageId: params.page } });
    const [{ isLoading, data, errors }, fetchData] = useGet<{ data: any; status: string }>(`editor/space/${params.spaceId}/page/${params.page}`);
    const [getBreadCrum, { loading: loadingBreadCrum, error: errorBreadCrum, data: dataBreadCrum }] = useLazyQuery<IBreadCrum, { id: string }>(GRAPHQL_GET_PAGE_BREADCRUM, {
        client: client,
        variables: { id: params.spaceId },
    });

    const editPage = () => {
        router.push(`/edit/${params.spaceId}/${params.page}`);
    };

    const deletePage = () => {};

    useEffect(() => {
        workerRef.current = new Worker("/workers/editor.js", { type: "module" });
        workerRef.current.onmessage = (e) => {
            console.log(e);
            switch (e.data.type) {
                case "initiated":
                    setWorkerInitiated(true);
                    break;
                case "editorData":
                    console.log(JSON.parse(e.data.data));
                    setContent(JSON.parse(e.data.data));
                    break;
                default:
                    break;
            }
        };
        workerRef.current.onerror = (e) => {
            console.log(e);
        };
        workerRef.current.postMessage({ type: "init" });
        return () => {
            workerRef.current.terminate();
        };
    }, []);

    useEffect(() => {
        console.log(status);
        if (status === "authenticated") {
            if (workerInitiated) {
                fetchData();
                getBreadCrum();
            }
        } else if (status !== "loading") {
            router.push("/space");
        }
    }, [status, workerInitiated]);

    useEffect(() => {
        if (data) {
            workerRef.current.postMessage({ type: "doc", data: data.data });
        }
    }, [data]);

    useEffect(() => {
        try {
            if (errors && errors.message.includes("JWTExpired")) {
                signIn("keycloak");
            }
            // if (data) {
            //     const eData = typeof data.core_page[0].docs[0].data === "string" ? JSON.parse(data.core_page[0].docs[0].data) : data.core_page[0].docs[0].data;
            //     setEditorData(eData);
            // }
        } catch (e) {
            // console.log(e);
        }
    }, [data, errors]);

    if (isLoading || status === "loading") {
        <div className="text-center">
            <Spinner size="lg" />
        </div>;
    }
    return (
        <div className="min-h-screen mx-auto ">
            <div className="py-2 mb-4 flex flex-nowrap justify-between box-border shadow-sm   ">
                <div>
                    {!loadingBreadCrum && dataBreadCrum && dataBreadCrum.core_space && dataBreadCrum.core_space[0] ? (
                        <Breadcrumb aria-label="page navigation">
                            <Breadcrumb.Item href="/" icon={HiHome}>
                                Home
                            </Breadcrumb.Item>
                            <Breadcrumb.Item href={`space/${dataBreadCrum.core_space[0].id}`}>{dataBreadCrum.core_space[0].name}</Breadcrumb.Item>
                        </Breadcrumb>
                    ) : null}
                </div>

                <div className="flex space-x-4">
                    <Tooltip content="Edit page" placement="bottom">
                        <Button outline className="max-w-full" color="light" size="xs" onClick={editPage}>
                            <HiPencil size="15" />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Delete page" placement="bottom">
                        <Button outline className="max-w-full" color="light" size="xs" onClick={deletePage}>
                            <HiOutlineTrash size="15" />
                        </Button>
                    </Tooltip>
                </div>
            </div>
            {content && (
                <div className="ml-16 mr-16">
                    <div className="mb-8">
                        <h1 className="text-3xl font-bold">{data.data.title}</h1>
                    </div>
                    <TipTap title={data.data.title} setEditorContext={() => {}} editable={false} content={content} pageId={params.page} id={data.data.docId} />
                </div>
            )}
        </div>
    );
}
