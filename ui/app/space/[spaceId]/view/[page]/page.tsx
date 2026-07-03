
import ReadOnlyContentMain, { type ReadOnlyBreadcrumb, type ReadOnlyCapabilities, type ReadOnlyMeta } from "@components/ReadOnlyContentMain";
import ProjectPageView from "@components/project-management/ProjectPageView";
import ToastComponent from "@components/ui/ToastComponent";
import WhiteboardEditor from "@components/WhiteboardEditor";
import { TipTap, AttachmentPanel } from "@editor";
import type { AttachmentRef } from "@durgakiran/editor";
import { useDelete, useGet } from "@http/hooks";
import { Box, Button, Dialog, Flex, Spinner, Text } from "@radix-ui/themes";
import { useNavigate, useParams } from "react-router-dom";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalSpacePagesRefresh } from "../../SpaceAddPageContext";

interface ViewSpaceState {
    name: string;
    archivedAt?: string | null;
}

interface ViewResponseData {
    pageId: number;
    spaceId: string;
    pageType: "document" | "whiteboard";
    title: string;
    document: any | null;
    breadcrumbs: ReadOnlyBreadcrumb[];
    space: ViewSpaceState;
    capabilities: ReadOnlyCapabilities;
    meta: ReadOnlyMeta;
    attachments: AttachmentRef[];
}

interface PageMetadataResponse {
    data: { type: "document" | "whiteboard" | "project" };
    status: string;
}

function ContentPageView({ spaceId, page, pageType }: { spaceId: string; page: string; pageType: "document" | "whiteboard" }) {
    const workerRef = useRef<Worker | null>(null);
    const [workerInitiated, setWorkerInitiated] = useState(false);
    const [content, setContent] = useState();
    const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const [isTabletViewport, setIsTabletViewport] = useState(false);
    const navigate = useNavigate();
    const refreshSpacePages = useOptionalSpacePagesRefresh();

    const [{ isLoading: loadingDocument, data: documentData, errors: documentErrors }, fetchDocument] =
        useGet<{ data: ViewResponseData | null; status: string }>(`editor/space/${spaceId}/page/${page}`);
    const [{ isLoading: loadingDelete, data: deleteData, errors: deleteErrors }, deletePageRequest] =
        useDelete<{ rowsAffected: number }, null>(`editor/space/${spaceId}/page/${page}/delete`);

    const viewData = documentData?.data ?? null;
    const title = viewData?.title || viewData?.document?.title || "";
    const attachments = viewData?.attachments ?? [];
    const commentPresentation = isMobileViewport || isTabletViewport ? "bottom-sheet" : "docked";
    const shellCapabilities = useMemo<ReadOnlyCapabilities | null>(() => {
        if (!viewData) return null;
        if (pageType !== "whiteboard") return viewData.capabilities;
        return {
            ...viewData.capabilities,
            canComment: false,
        };
    }, [pageType, viewData]);

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
        if (pageType !== "document") {
            setWorkerInitiated(false);
            workerRef.current?.terminate();
            workerRef.current = null;
            return;
        }

        workerRef.current = new Worker("/workers/editor.js", { type: "module" });
        workerRef.current.onmessage = (event) => {
            switch (event.data.type) {
                case "initiated":
                    setWorkerInitiated(true);
                    break;
                case "editorData":
                    setContent(JSON.parse(event.data.data));
                    break;
                default:
                    break;
            }
        };
        workerRef.current.onerror = (event) => {
            console.error(event);
        };
        workerRef.current.postMessage({ type: "init" });
        return () => {
            workerRef.current?.terminate();
        };
    }, [pageType]);

    useEffect(() => {
        if (pageType === "document" && !workerInitiated) {
            return;
        }
        fetchDocument();
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
            refreshSpacePages?.();
            navigate(`/space/${spaceId}`);
        }
    }, [deleteData, refreshSpacePages, navigate, spaceId]);

    const onEdit = () => {
        navigate(`/edit/${spaceId}/${page}`);
    };

    const onDelete = () => {
        setShowDeleteDialog(true);
    };

    const confirmDelete = () => {
        setShowDeleteDialog(false);
        deletePageRequest(null);
    };

    const hasMainErrors = Boolean(documentErrors);
    const isPageLoading = pageType === "document" ? (!workerInitiated || loadingDocument) : loadingDocument;
    const showShell = Boolean(!isPageLoading && !hasMainErrors && viewData && shellCapabilities);
    const readOnlyContent = useMemo(() => {
        if (!viewData?.document || !content) return null;
        return (
            <TipTap
                key={page}
                updateContent={(nextContent, nextTitle) => console.log(nextContent, nextTitle)}
                title={title}
                setEditorContext={() => { }}
                editable={false}
                content={content}
                pageId={page}
                spaceId={spaceId}
                id={Number(page)}
                user={null}
                isInlineMessageSidePanelOpen={isSidePanelOpen}
                setIsInlineMessageSidePanelOpen={setIsSidePanelOpen}
                commentPresentation={commentPresentation}
            />
        );
    }, [commentPresentation, content, isSidePanelOpen, page, spaceId, title, viewData?.document]);

    if (isPageLoading) {
        return (
            <Flex align="center" justify="center" p="4">
                <Spinner size="3" />
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
                    capabilities={shellCapabilities!}
                    meta={viewData.meta}
                    spaceName={viewData.space?.name ?? null}
                    attachments={
                        pageType === "document" && attachments.length ? (
                            <AttachmentPanel
                                attachments={attachments}
                                pageId={Number(page)}
                                variant="readonly"
                                title="Attachments"
                            />
                        ) : undefined
                    }
                    isCommentsOpen={pageType === "document" ? isSidePanelOpen : false}
                    commentPresentation={commentPresentation}
                    onOpenComments={() => {
                        if (pageType === "document") {
                            setIsSidePanelOpen((current) => !current);
                        }
                    }}
                    onEdit={onEdit}
                    onDelete={onDelete}
                >
                    {pageType === "whiteboard" ? (
                        <Box
                            className="overflow-hidden rounded-[18px] border border-[#d4d1da] bg-white shadow-[0_10px_30px_rgba(11,10,42,0.04)]"
                            style={{ height: "72vh", minHeight: "540px" }}
                        >
                            <WhiteboardEditor key={page} slug={[spaceId, page]} readOnly fillParent />
                        </Box>
                    ) : readOnlyContent ?? (
                        <Box className="rounded-[18px] border border-[#d4d1da] bg-white px-5 py-6 text-[#605c67] shadow-[0_10px_30px_rgba(11,10,42,0.04)] md:px-8">
                            <Text size="3">
                                This document has no published content yet.
                            </Text>
                        </Box>
                    )}
                </ReadOnlyContentMain>
            ) : null}

            {deleteErrors && !loadingDelete ? <ToastComponent icon="AlertTriangle" type="warning" toggle={true} message="Unable to delete page" /> : null}
            {deleteData && !loadingDelete ? <ToastComponent icon="Check" type="success" toggle={true} message="Page deleted successfully" /> : null}

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
                            <Button onClick={confirmDelete} disabled={loadingDelete} loading={loadingDelete} color="red">
                                Delete
                            </Button>
                        </Flex>
                    </Flex>
                </Dialog.Content>
            </Dialog.Root>
        </>
    );
}

export default function Page({ params }: { params: Promise<{ page: string; spaceId: string }> }) {
    const { page, spaceId } = use(params);
    const [{ isLoading, data: metadata, errors }, getMetadata] =
        useGet<PageMetadataResponse>(`editor/space/${spaceId}/page/${page}/metadata`);

    useEffect(() => {
        getMetadata();
    }, [getMetadata]);

    const pageType = metadata?.data?.type;

    if (isLoading) {
        return (
            <Flex align="center" justify="center" p="4">
                <Spinner size="3" />
            </Flex>
        );
    }

    if (errors) {
        return (
            <Flex align="center" justify="center" className="min-h-[40vh] px-6">
                <Text size="3" className="text-neutral-700">
                    Something went wrong while loading this page.
                </Text>
            </Flex>
        );
    }

    if (!pageType) {
        return (
            <Flex align="center" justify="center" className="min-h-[40vh] px-6">
                <Text size="3" className="text-neutral-700">
                    This page type is not available.
                </Text>
            </Flex>
        );
    }

    if (pageType === "project") {
        return <ProjectPageView spaceId={spaceId} pageId={page} />;
    }

    return <ContentPageView spaceId={spaceId} page={page} pageType={pageType} />;
}
