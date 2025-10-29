"use client";
import { TipTap } from "@editor";
import { useGet } from "@http/hooks";
import { Breadcrumb, Button, Spinner, Tooltip } from "flowbite-react";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { HiHome, HiPencil, HiOutlineTrash } from "react-icons/hi";

interface BreadCrumbData {
    name: string;
    id: number;
    parentId: number;
}

export default function Page({ params }: { params: Promise<{ page: string; spaceId: string }> }) {
    const { page, spaceId } = use(params);
    const workerRef = useRef<Worker>(null);
    const [workerInitiated, setWorkerInitiated] = useState(false);
    const [content, setContent] = useState();
    const router = useRouter();
    const [{ isLoading, data, errors }, fetchData] = useGet<{ data: any; status: string }>(`editor/space/${spaceId}/page/${page}`);
    const [{ isLoading: loadingBreadCrum, data: dataBreadCrum, errors: breadCrumErrors }, getBreadCrum] = useGet<{ data: BreadCrumbData[]; status: string }>(`page/${page}/breadCrumbs`);

    const editPage = () => {
        router.push(`/edit/${spaceId}/${page}`);
    };

    const deletePage = () => {};

    useEffect(() => {
        workerRef.current = new Worker("/workers/editor.js", { type: "module" });
        workerRef.current.onmessage = (e) => {
            switch (e.data.type) {
                case "initiated":
                    setWorkerInitiated(true);
                    break;
                case "editorData":
                    setContent(JSON.parse(e.data.data));
                    break;
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
        if (workerInitiated) {
            fetchData();
            getBreadCrum();
        }
    }, [workerInitiated]);

    useEffect(() => {
        if (data) {
            workerRef.current.postMessage({ type: "doc", data: data.data });
        }
    }, [data]);

    if (isLoading || status === "loading") {
        <div className="text-center">
            <Spinner size="lg" />
        </div>;
    }
    return (
        <div className="min-h-screen mx-auto ">
            <div className="py-2 mb-4 flex flex-nowrap justify-between box-border shadow-sm   ">
                <div>
                    {!loadingBreadCrum && dataBreadCrum && dataBreadCrum.data && dataBreadCrum.data.length ? (
                        <Breadcrumb aria-label="page navigation">
                            <Breadcrumb.Item href="/" icon={HiHome}>
                                Home
                            </Breadcrumb.Item>
                            {dataBreadCrum.data
                                .sort((a: BreadCrumbData, b: BreadCrumbData) => {
                                    return a.id > b.id ? 1 : -1;
                                })
                                .map((item: BreadCrumbData) => {
                                    return (
                                        <Breadcrumb.Item key={item.id} href={`space/${spaceId}/view/${item.id}`}>
                                            {item.name}
                                        </Breadcrumb.Item>
                                    );
                                })}
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
                    <TipTap
                        updateContent={(content, title) => console.log(content, title)}
                        title={data.data.title}
                        setEditorContext={() => {}}
                        editable={false}
                        content={content}
                        pageId={page}
                        id={data.data.docId}
                        user={null}
                    />
                </div>
            )}
        </div>
    );
}
