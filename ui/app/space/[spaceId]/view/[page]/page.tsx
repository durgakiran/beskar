"use client";
import ToastComponent from "@components/ui/ToastComponent";
import { TipTap } from "@editor";
import { useGet, useDelete } from "@http/hooks";
import { Button, Spinner, Tooltip, Flex, Box, IconButton, Text, Dialog } from "@radix-ui/themes";
import Link from "next/link";
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
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const router = useRouter();
    const [{ isLoading, data, errors }, fetchData] = useGet<{ data: any; status: string }>(`editor/space/${spaceId}/page/${page}`);
    const [{ isLoading: loadingBreadCrum, data: dataBreadCrum, errors: breadCrumErrors }, getBreadCrum] = useGet<{ data: BreadCrumbData[]; status: string }>(`page/${page}/breadCrumbs`);
    const [{ isLoading: loadingDelete, data: deleteData, errors: deleteErrors }, _deletePage] = useDelete<{ rowsAffected: number }, null>(`editor/space/${spaceId}/page/${page}/delete`);

    const editPage = () => {
        router.push(`/edit/${spaceId}/${page}`);
    };

    const deletePage = () => {
        setShowDeleteDialog(true);
    };

    const confirmDelete = () => {
        setShowDeleteDialog(false);
        _deletePage(null);
    };

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

    useEffect(() => {
        if (deleteData) {
            router.push(`/space/${spaceId}`);
        }
    }, [deleteData]);

    if (isLoading || status === "loading") {
        return (
            <Flex align="center" justify="center" p="4">
                <Spinner size="3" />
            </Flex>
        );
    }
    return (
        <>
        <Box className="min-h-screen mx-auto bg-white">
            {/* Header Section */}
            <Box className="bg-white border-b border-neutral-200 sticky top-0 z-10">
                <Flex 
                    py="3" 
                    px="4" 
                    justify="between" 
                    align="center" 
                    className="max-w-7xl mx-auto flex-col sm:flex-row gap-3"
                >
                    {/* Breadcrumbs */}
                    <Box className="overflow-x-auto w-full sm:w-auto">
                        {!loadingBreadCrum && dataBreadCrum && dataBreadCrum.data && dataBreadCrum.data.length ? (
                            <Flex align="center" gap="2" className="flex-nowrap">
                                <Link 
                                    href={`/space/${spaceId}`}
                                    className="flex items-center gap-1.5 px-2 py-1 rounded-sm 
                                             hover:bg-mauve-50 transition-colors group flex-shrink-0"
                                >
                                    <HiHome size={16} className="text-mauve-600 group-hover:text-primary-600" />
                                    <Text size="2" className="text-neutral-700 group-hover:text-primary-700 font-medium">
                                        Home
                                    </Text>
                                </Link>
                                {dataBreadCrum.data
                                    .sort((a: BreadCrumbData, b: BreadCrumbData) => {
                                        return a.id > b.id ? 1 : -1;
                                    })
                                    .map((item: BreadCrumbData, index: number, array: BreadCrumbData[]) => {
                                        const isLast = index === array.length - 1;
                                        return (
                                            <Flex key={item.id} align="center" gap="2" className="flex-shrink-0">
                                                <Text className="text-neutral-300">/</Text>
                                                <Link 
                                                    href={`/space/${spaceId}/view/${item.id}`}
                                                    className={`px-2 py-1 rounded-sm transition-colors ${
                                                        isLast 
                                                            ? 'bg-primary-50 text-primary-700 font-semibold' 
                                                            : 'hover:bg-mauve-50 text-neutral-700 hover:text-primary-700'
                                                    }`}
                                                >
                                                    <Text size="2" className="truncate max-w-[200px]">
                                                        {item.name}
                                                    </Text>
                                                </Link>
                                            </Flex>
                                        );
                                    })}
                            </Flex>
                        ) : null}
                    </Box>

                    {/* Action Buttons */}
                    <Flex gap="4" className="flex-shrink-0">
                        <Tooltip content="Edit page">
                            <IconButton 
                                variant="ghost"
                                size="2" 
                                onClick={editPage}
                                className="text-primary-600 hover:bg-primary-50 hover:text-primary-700 transition-colors p-2"
                            >
                                <HiPencil size={18} />
                            </IconButton>
                        </Tooltip>
                        <Tooltip content="Delete page">
                            <IconButton 
                                variant="ghost"
                                size="2" 
                                onClick={deletePage}
                                disabled={loadingDelete || deleteErrors}
                                className="text-error-600 hover:bg-error-50 hover:text-error-700 transition-colors p-2"
                            >
                                <HiOutlineTrash size={18} />
                            </IconButton>
                        </Tooltip>
                    </Flex>
                </Flex>
            </Box>

            {/* Content Section */}
            {content && (
                <Box className="px-4 md:px-8 lg:px-16 py-6 max-w-7xl mx-auto bg-white">
                    <Box className="p-6 md:p-8 lg:p-12">
                        <Box mb="8">
                            <h1 className="text-3xl md:text-4xl font-bold text-neutral-900">
                                {data.data.title}
                            </h1>
                        </Box>
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
                    </Box>
                </Box>
            )}
        </Box>
        {(deleteErrors) && !loadingDelete && <ToastComponent icon="AlertTriangle" type="warning" toggle={true} message="Unable to delete page" />}
        {deleteData && !loadingDelete && <ToastComponent icon="Check" type="success" toggle={true} message="Page deleted successfully" />}
        
        {/* Delete Confirmation Dialog */}
        <Dialog.Root open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <Dialog.Content size="2" maxWidth="450px">
                <Dialog.Title>Delete Page</Dialog.Title>
                <Flex direction="column" gap="4">
                    <Text size="3">
                        Are you sure you want to delete this page? This action cannot be undone.
                    </Text>
                    <Flex gap="3" mt="4" justify="end">
                        <Dialog.Close>
                            <Button variant="soft" color="gray">
                                Cancel
                            </Button>
                        </Dialog.Close>
                        <Button 
                            onClick={confirmDelete} 
                            disabled={loadingDelete}
                            loading={loadingDelete}
                            color="red"
                        >
                            Delete
                        </Button>
                    </Flex>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
        </>

    );
}
