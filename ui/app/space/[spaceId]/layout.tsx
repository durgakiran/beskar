
import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation, useNavigate, useParams, Link, Outlet } from "react-router-dom";
import { FiHome, FiSettings, FiPlus, FiMenu } from "react-icons/fi";
import { cn } from "@/lib/utils";
import ToastComponent from "@components/ui/ToastComponent";
import { PageTree, PageTreeNode } from "@components/primitives";
import AddPage from "@components/addPage";
import { getApiV1Base } from "@http";
import { Response, useGet } from "@http/hooks";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { SpaceAddPageProvider } from "./SpaceAddPageContext";

interface IPageList {
    pageId: number;
    ownerId: string;
    title: string;
    parentId: number;
    type: "document" | "whiteboard" | "project";
    canDelete?: boolean;
}

interface SpaceState {
    id: string;
    archivedAt?: string | null;
}

export default function Layout() {
    const { spaceId } = useParams() as any;
    const pathname = useLocation().pathname;
    const navigate = useNavigate();

    // Sidebar Resize State
    const [sidebarWidth, setSidebarWidth] = useState(300);
    const isResizing = useRef(false);

    // Pages State
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [pages, setPages] = useState<PageTreeNode[]>([]);
    const [isAddPageOpen, setIsAddPageOpen] = useState(false);
    const [addPageParentId, setAddPageParentId] = useState<number | undefined>();
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    const [deletePageId, setDeletePageId] = useState<string | null>(null);
    const [isDeletingPage, setIsDeletingPage] = useState(false);
    const [deletePageError, setDeletePageError] = useState<string | null>(null);
    const [deletePageSuccess, setDeletePageSuccess] = useState(false);

    // Fetch Pages
    const [{ data, isLoading: pagesLoading }, fetchPages] = useGet<Response<IPageList[]>>(`space/${spaceId}/page/list`);
    const [{ data: spaceDetails }, fetchSpaceDetails] = useGet<Response<SpaceState>>(`space/${spaceId}/details`);

    useEffect(() => {
        fetchPages();
        fetchSpaceDetails();
    }, [fetchPages, fetchSpaceDetails]);

    useEffect(() => {
        if (data?.data) {
            const pageMap = new Map<number, PageTreeNode[]>();
            const allNodes: PageTreeNode[] = data.data.map(p => ({
                id: p.pageId.toString(),
                title: p.title || "Untitled",
                href: `/space/${spaceId}/view/${p.pageId}`,
                type: p.type || "document",
                canDelete: Boolean(p.canDelete) && !Boolean(spaceDetails?.data?.archivedAt),
                children: []
            }));

            allNodes.forEach(node => {
                const parentId = data.data.find(p => p.pageId.toString() === node.id)?.parentId || 0;
                if (parentId > 0) {
                    if (!pageMap.has(parentId)) pageMap.set(parentId, []);
                    pageMap.get(parentId)!.push(node);
                }
            });

            const rootNodes = allNodes.filter(node => {
                const parentId = data.data.find(p => p.pageId.toString() === node.id)?.parentId || 0;
                if (parentId <= 0) {
                    node.children = pageMap.get(parseInt(node.id)) || [];
                    return true;
                }
                node.children = pageMap.get(parseInt(node.id)) || [];
                return false;
            });

            setPages(rootNodes);
        }
    }, [data, spaceDetails?.data?.archivedAt, spaceId]);

    // Resize Logic
    useEffect(() => {
        const savedWidth = localStorage.getItem(`sidebar-width-${spaceId}`);
        if (savedWidth) {
            setSidebarWidth(parseInt(savedWidth));
        }
    }, [spaceId]);

    const startResizing = useCallback(() => {
        isResizing.current = true;
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", stopResizing);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    }, []);

    const stopResizing = useCallback(() => {
        isResizing.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", stopResizing);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current) return;
        const newWidth = Math.min(Math.max(220, e.clientX), 480);
        setSidebarWidth(newWidth);
        localStorage.setItem(`sidebar-width-${spaceId}`, newWidth.toString());
    }, [spaceId]);

    const handleAddPage = useCallback((parentId?: string) => {
        if (spaceDetails?.data?.archivedAt) {
            return;
        }
        setAddPageParentId(parentId ? parseInt(parentId) : undefined);
        setIsAddPageOpen(true);
    }, [spaceDetails?.data?.archivedAt]);

    const handleDeletePage = useCallback((pageId: string) => {
        if (spaceDetails?.data?.archivedAt) {
            return;
        }
        setDeletePageError(null);
        setDeletePageSuccess(false);
        setDeletePageId(pageId);
    }, [spaceDetails?.data?.archivedAt]);

    const handlePageSelect = (id: string) => {
        const node = data?.data.find(p => p.pageId.toString() === id);
        if (node) {
            setIsMobileSidebarOpen(false);
            navigate(`/space/${spaceId}/view/${id}`);
        }
    };

    const handleToggleNode = (id: string) => {
        setExpandedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleCreatedPage = useCallback((id: number, createdType?: "document" | "whiteboard" | "project") => {
        fetchPages();
        setIsAddPageOpen(false);
        if (createdType === "project") {
            navigate(`/space/${spaceId}/view/${id}`);
            return;
        }
        navigate(`/edit/${spaceId}/${id}`);
    }, [fetchPages, navigate, spaceId]);

    const confirmDeletePage = useCallback(async () => {
        if (!deletePageId) {
            return;
        }
        setIsDeletingPage(true);
        setDeletePageError(null);
        setDeletePageSuccess(false);
        try {
            const response = await fetch(`${getApiV1Base()}/editor/space/${spaceId}/page/${deletePageId}/delete`, {
                method: "DELETE",
                credentials: "include",
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error?.detail || body?.error?.message || `Request failed with status ${response.status}`);
            }
            const deletedPath = `/space/${spaceId}/view/${deletePageId}`;
            setDeletePageId(null);
            setDeletePageSuccess(true);
            fetchPages();
            if (pathname.startsWith(deletedPath)) {
                router.push(`/space/${spaceId}`);
            }
        } catch (error) {
            setDeletePageError(error instanceof Error ? error.message : "Unable to delete page");
        } finally {
            setIsDeletingPage(false);
        }
    }, [deletePageId, fetchPages, pathname, router, spaceId]);

    const deleteTarget = data?.data?.find((page) => page.pageId.toString() === deletePageId) ?? null;

    const isActive = (path: string) => {
        if (path === `/space/${spaceId}`) return pathname === path;
        return pathname.startsWith(path);
    };

    return (
        <SpaceAddPageProvider openAddPage={handleAddPage} refreshPages={fetchPages}>
            <div className="flex h-full w-full overflow-hidden bg-white">
                {/* Mobile Sidebar Scrim */}
                {isMobileSidebarOpen && (
                    <div
                        className="absolute inset-0 z-40 bg-black/40 md:hidden"
                        onClick={() => setIsMobileSidebarOpen(false)}
                    />
                )}
                {/* Sidebar */}
                <aside
                    className={cn(
                        "relative z-50 flex flex-shrink-0 flex-col border-r border-neutral-200 bg-white transition-all duration-200 ease-in-out",
                        isMobileSidebarOpen ? "absolute inset-y-0 left-0 flex w-[280px]" : "hidden md:flex"
                    )}
                    style={{ width: isMobileSidebarOpen ? 280 : sidebarWidth }}
                >
                    <div className="flex flex-1 flex-col gap-[14px] p-5 min-h-0">
                        {/* Navigation Menu */}
                        <nav className="flex flex-col gap-1.5">
                            <Link
                                to={`/space/${spaceId}`}
                                onClick={() => setIsMobileSidebarOpen(false)}
                                className={cn(
                                    "flex items-center gap-[10px] rounded-lg py-[9px] px-3 transition-colors",
                                    isActive(`/space/${spaceId}`)
                                        ? "bg-primary-100 text-primary-700 font-semibold"
                                        : "text-neutral-800 font-medium hover:bg-neutral-50 hover:text-neutral-900"
                                )}
                            >
                                <FiHome className="h-3.5 w-3.5" />
                                <span className="text-sm">Overview</span>
                            </Link>
                            <Link
                                to={`/space/${spaceId}/settings/users`}
                                onClick={() => setIsMobileSidebarOpen(false)}
                                className={cn(
                                    "flex items-center gap-[10px] rounded-lg py-[9px] px-3 transition-colors",
                                    isActive(`/space/${spaceId}/settings`)
                                        ? "bg-primary-100 text-primary-700 font-semibold"
                                        : "text-neutral-800 font-medium hover:bg-neutral-50 hover:text-neutral-900"
                                )}
                            >
                                <FiSettings className="h-3.5 w-3.5" />
                                <span className="text-sm">Settings</span>
                            </Link>
                        </nav>

                        {/* Pages Section Header */}
                        <div className="flex items-center justify-between border-y border-neutral-200 py-2 px-1">
                            <span className="text-[12px] font-bold tracking-wider text-neutral-700 uppercase">PAGES</span>
                            <button
                                onClick={() => handleAddPage()}
                                disabled={Boolean(spaceDetails?.data?.archivedAt)}
                                className="flex h-6 w-6 items-center justify-center rounded-md text-primary-700 transition-colors hover:bg-primary-100"
                                title={spaceDetails?.data?.archivedAt ? "Archived spaces are read-only" : "Add page"}
                            >
                                <FiPlus className="h-[18px] w-[18px] stroke-[2.5]" />
                            </button>
                        </div>

                        {/* Page Tree */}
                        <div className="flex-1 min-h-0 overflow-y-auto">
                            {pagesLoading ? (
                                <div className="flex items-center justify-center py-4">
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                                </div>
                            ) : pages.length > 0 ? (
                                <PageTree
                                    nodes={pages}
                                    expandedIds={expandedIds}
                                    onToggle={handleToggleNode}
                                    onAddChild={handleAddPage}
                                    onDelete={handleDeletePage}
                                    onSelect={handlePageSelect}
                                    className="w-full"
                                />
                            ) : (
                                <div className="px-3 py-2">
                                    <p className="text-[13px] italic text-neutral-700">No pages yet</p>
                                </div>
                            )}
                        </div>
                    </div>
                </aside>

                {/* Resize Handle */}
                <div
                    onMouseDown={startResizing}
                    className={cn(
                        "relative z-10 w-[12px] flex-shrink-0 cursor-col-resize items-center justify-center bg-white transition-colors hover:bg-neutral-50",
                        "hidden lg:flex border-x border-neutral-200"
                    )}
                >
                    <div className="h-11 w-[4px] rounded-full bg-neutral-300" />
                </div>

                {/* Main Content Area */}
                <main className="relative z-0 min-w-0 flex-1 flex flex-col overflow-y-auto bg-[var(--background)]">
                    {/* Mobile Header Toggle */}
                    <div className="flex md:hidden items-center px-4 py-3 border-b border-neutral-200 bg-white sticky top-0 z-30">
                        <button
                            onClick={() => setIsMobileSidebarOpen(true)}
                            className="flex items-center gap-2 text-neutral-700 hover:text-neutral-900"
                        >
                            <FiMenu className="h-5 w-5" />
                            <span className="text-sm font-semibold text-neutral-900">Pages</span>
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto relative z-0">
                        <Outlet />
                    </div>
                </main>

                <AddPage
                    isOpen={isAddPageOpen}
                    setIsOpen={setIsAddPageOpen}
                    spaceId={spaceId}
                    parentId={addPageParentId}
                    disabled={Boolean(spaceDetails?.data?.archivedAt)}
                    disabledMessage="Archived spaces cannot create new pages until the space is unarchived."
                    editPage={handleCreatedPage}
                />
                {deletePageError ? <ToastComponent icon="AlertTriangle" type="warning" toggle={true} message={deletePageError} /> : null}
                {deletePageSuccess ? <ToastComponent icon="Check" type="success" toggle={true} message="Page deleted successfully" /> : null}
                <Dialog.Root open={Boolean(deletePageId)} onOpenChange={(open) => !open && setDeletePageId(null)}>
                    <Dialog.Content size="2" maxWidth="450px">
                        <Dialog.Title>{deleteTarget?.type === "project" ? "Delete Project" : "Delete Page"}</Dialog.Title>
                        <Flex direction="column" gap="4">
                            <Text size="3">
                                {deleteTarget?.type === "project"
                                    ? `Are you sure you want to delete the project "${deleteTarget?.title || "Untitled"}"? This action cannot be undone.`
                                    : `Are you sure you want to delete the page "${deleteTarget?.title || "Untitled"}"? This action cannot be undone.`}
                            </Text>
                            <Flex gap="3" mt="4" justify="end">
                                <Dialog.Close>
                                    <Button variant="soft" color="gray">
                                        Cancel
                                    </Button>
                                </Dialog.Close>
                                <Button onClick={confirmDeletePage} disabled={isDeletingPage} loading={isDeletingPage} color="red">
                                    Delete
                                </Button>
                            </Flex>
                        </Flex>
                    </Dialog.Content>
                </Dialog.Root>
            </div>
        </SpaceAddPageProvider>
    );
}
