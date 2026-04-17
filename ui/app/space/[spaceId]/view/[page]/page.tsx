"use client";

import ReadOnlyContentMain, { type ReadOnlyBreadcrumb, type ReadOnlyCapabilities, type ReadOnlyMeta } from "@components/ReadOnlyContentMain";
import ToastComponent from "@components/ui/ToastComponent";
import { TipTap, AttachmentPanel } from "@editor";
import type { AttachmentRef } from "@durgakiran/editor";
import { useGet, useDelete } from "@http/hooks";
import { Button, Spinner, Flex, Box, Text, Dialog } from "@radix-ui/themes";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useRef, useState } from "react";

interface ViewSpaceState {
    name: string;
    archivedAt?: string | null;
}

interface ViewResponseData {
    pageId: number;
    spaceId: string;
    pageType: "document";
    title: string;
    document: any | null;
    breadcrumbs: ReadOnlyBreadcrumb[];
    space: ViewSpaceState;
    capabilities: ReadOnlyCapabilities;
    meta: ReadOnlyMeta;
    attachments: AttachmentRef[];
}

interface PageMetadataResponse {
    data: { type: string };
    status: string;
}

export default function Page({ params }: { params: Promise<{ page: string; spaceId: string }> }) {
    const { page, spaceId } = use(params);
    const workerRef = useRef<Worker>(null);
    const [workerInitiated, setWorkerInitiated] = useState(false);
    const [content, setContent] = useState();
    const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const [isTabletViewport, setIsTabletViewport] = useState(false);
    const router = useRouter();

    const [{ isLoading: loadingDocument, data: documentData, errors: documentErrors }, fetchDocument] = useGet<{ data: ViewResponseData | null; status: string }>(`editor/space/${spaceId}/page/${page}`);
    const [{ isLoading: loadingDelete, data: deleteData, errors: deleteErrors }, deletePageRequest] = useDelete<{ rowsAffected: number }, null>(`editor/space/${spaceId}/page/${page}/delete`);
    const [{ isLoading: loadingMetadata, data: metadata, errors: metaErrors }, getMetadata] = useGet<PageMetadataResponse>(`editor/space/${spaceId}/page/${page}/metadata`);

    const pageType = metadata?.data?.type;
    const viewData = documentData?.data ?? null;
    const title = viewData?.title || viewData?.document?.title || "";
    const attachments = viewData?.attachments ?? [];
    const commentPresentation = isMobileViewport || isTabletViewport ? "bottom-sheet" : "docked";

    useEffect(() => {
        const syncViewport = () => {
            const width = window.innerWidth;
            setIsMobileViewport(width < 768);
            setIsTabletViewport(width >= 768 && width < 1024);
        };

        syncViewport();
        window.addEventListener("resize", syncViewport);
        return () => window.removeEventListener("resize", syncViewport);
    }, []);

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
            workerRef.current?.terminate();
        };
    }, []);

    useEffect(() => {
        getMetadata();
    }, [getMetadata]);

    useEffect(() => {
        if (workerInitiated && pageType === "document") {
            fetchDocument();
        }
    }, [fetchDocument, pageType, workerInitiated]);

    useEffect(() => {
        if (viewData?.document) {
            workerRef.current?.postMessage({ type: "doc", data: viewData.document });
        } else {
            setContent(undefined);
        }
    }, [viewData?.document]);

    useEffect(() => {
        if (deleteData) {
            router.push(`/space/${spaceId}`);
        }
    }, [deleteData, router, spaceId]);

    const onEdit = () => {
        router.push(`/edit/${spaceId}/${page}`);
    };

    const onDelete = () => {
        setShowDeleteDialog(true);
    };

    const confirmDelete = () => {
        setShowDeleteDialog(false);
        deletePageRequest(null);
    };

    const hasMainErrors = Boolean(metaErrors || documentErrors);
    const isDocumentLoading = pageType === "document" && (!workerInitiated || loadingDocument);
    const showShell = pageType === "document" && !loadingMetadata && !isDocumentLoading && !hasMainErrors;
    const readOnlyContent = useMemo(() => {
        if (!viewData?.document || !content) return null;
        return (
            <TipTap
                updateContent={(nextContent, nextTitle) => console.log(nextContent, nextTitle)}
                title={title}
                setEditorContext={() => { }}
                editable={false}
                content={content}
                pageId={page}
                id={Number(page)}
                user={null}
                isInlineMessageSidePanelOpen={isSidePanelOpen}
                setIsInlineMessageSidePanelOpen={setIsSidePanelOpen}
                commentPresentation={commentPresentation}
            />
        );
    }, [commentPresentation, content, isSidePanelOpen, page, title, viewData?.document]);

    if (loadingMetadata || isDocumentLoading) {
        return (
            <Flex align="center" justify="center" p="4">
                <Spinner size="3" />
            </Flex>
        );
    }

    if (metaErrors) {
        return (
            <Flex align="center" justify="center" className="min-h-[40vh] px-6">
                <Text size="3" className="text-neutral-700">
                    Something went wrong while loading this page.
                </Text>
            </Flex>
        );
    }

    if (pageType === "whiteboard") {
        return (
            <Flex align="center" justify="center" className="min-h-[40vh] px-6">
                <Text size="3" className="text-neutral-700">
                    Whiteboards are temporarily unavailable.
                </Text>
            </Flex>
        );
    }

    if (hasMainErrors || !viewData) {
        return (
            <Flex align="center" justify="center" className="min-h-[40vh] px-6">
                <Text size="3" className="text-neutral-700">
                    Something went wrong while loading this page.
                </Text>
            </Flex>
        );
    }

    return (
        <>
            {showShell ? (
                <ReadOnlyContentMain
                    spaceId={spaceId}
                    pageId={page}
                    title={title}
                    breadcrumbs={viewData.breadcrumbs}
                    archived={Boolean(viewData.space?.archivedAt)}
                    capabilities={viewData.capabilities}
                    meta={viewData.meta}
                    spaceName={viewData.space?.name ?? null}
                    attachments={
                        attachments.length ? (
                            <AttachmentPanel
                                attachments={attachments}
                                pageId={Number(page)}
                                variant="readonly"
                                title="Attachments"
                            />
                        ) : undefined
                    }
                    isCommentsOpen={isSidePanelOpen}
                    commentPresentation={commentPresentation}
                    onOpenComments={() => setIsSidePanelOpen((current) => !current)}
                    onEdit={onEdit}
                    onDelete={onDelete}
                >
                    {readOnlyContent ?? (
                        <Box className="rounded-[18px] border border-[#d4d1da] bg-white px-5 py-6 text-[#605c67] shadow-[0_10px_30px_rgba(11,10,42,0.04)] md:px-8">
                            <Text size="3">
                                This document has no published content yet.
                            </Text>
                        </Box>
                    )}
                </ReadOnlyContentMain>
            ) : null}

            {(deleteErrors) && !loadingDelete && <ToastComponent icon="AlertTriangle" type="warning" toggle={true} message="Unable to delete page" />}
            {deleteData && !loadingDelete && <ToastComponent icon="Check" type="success" toggle={true} message="Page deleted successfully" />}

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
