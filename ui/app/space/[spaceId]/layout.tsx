
import { useEffect, useState, useRef, useCallback, useId } from "react";
import { useLocation, useNavigate, useParams, Link, Outlet } from "react-router-dom";
import { FiHome, FiSettings, FiPlus, FiX } from "react-icons/fi";
import { Dialog } from "@radix-ui/themes";
import { Icon } from "@components/ui/Icon";
import SpaceLayout from "@components/spaceLayout";
import { railButtonClass, railActiveClass } from "@components/workspaceRailStyles";
import { cn } from "@/lib/utils";
import { PageTree, PageTreeNode, PageDropPlacement } from "@components/primitives";
import AddPage from "@components/addPage";
import { Response, useGet } from "@http/hooks";
import { reorderPage, movePage } from "app/core/http/pageApiHandler";
import { SpaceAddPageProvider } from "./SpaceAddPageContext";

interface IPageList {
    pageId: number;
    ownerId: string;
    title: string;
    parentId: number;
    type: "document" | "whiteboard";
    canEdit?: boolean;
}

interface SpaceState {
    id: string;
    name: string;
    archivedAt?: string | null;
}

const dockedSidebarQuery = "(min-width: 1024px)";
const sidebarPreferenceKey = "workspace-pages-collapsed";
const clampWidth = (width: number) => Math.min(Math.max(220, width), 480);

export default function Layout() {
    const { spaceId } = useParams() as any;
    const pathname = useLocation().pathname;
    const navigate = useNavigate();
    
    const [sidebarWidth, setSidebarWidth] = useState(272);
    const sidebar = useRef<HTMLElement>(null);
    const sidebarId = useId();
    const [canDockSidebar, setCanDockSidebar] = useState(() => window.matchMedia(dockedSidebarQuery).matches);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => localStorage.getItem(sidebarPreferenceKey) === "true");
    
    // Pages State
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [pages, setPages] = useState<PageTreeNode[]>([]);
    const [orderPending, setOrderPending] = useState(false);
    const [orderError, setOrderError] = useState("");
    const [pageChangeMessage, setPageChangeMessage] = useState("");
    const savingOrder = useRef(false);
    const [isAddPageOpen, setIsAddPageOpen] = useState(false);
    const [addPageParentId, setAddPageParentId] = useState<number | undefined>();
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    
    // Fetch Pages
    const [{ data, isLoading: pagesLoading }, fetchPages] = useGet<Response<IPageList[]>>(`space/${spaceId}/page/list`);
    const [{ data: spaceDetails }, fetchSpaceDetails] = useGet<Response<SpaceState>>(`space/${spaceId}/details`);

    const match = pathname.match(/\/(?:view|edit)\/(\d+)/);
    const activePageId = match ? match[1] : undefined;

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
                canEdit: p.canEdit,
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
    }, [data, spaceId]);

    useEffect(() => {
        if (activePageId && data?.data) {
            const ancestors = new Set<string>();
            let currentId = parseInt(activePageId);
            let maxDepth = 20;
            while (currentId && maxDepth > 0) {
                const node = data.data.find(p => p.pageId === currentId);
                if (node && node.parentId > 0) {
                    ancestors.add(node.parentId.toString());
                    currentId = node.parentId;
                    maxDepth--;
                } else {
                    break;
                }
            }

            if (ancestors.size > 0) {
                setExpandedIds(prev => {
                    const newIds = new Set(prev);
                    let changed = false;
                    ancestors.forEach(id => {
                        if (!newIds.has(id)) {
                            newIds.add(id);
                            changed = true;
                        }
                    });
                    return changed ? Array.from(newIds) : prev;
                });
            }
        }
    }, [activePageId, data]);

    useEffect(() => {
        const savedWidth = Number(localStorage.getItem(`sidebar-width-${spaceId}`));
        setSidebarWidth(savedWidth ? clampWidth(savedWidth) : 272);
    }, [spaceId]);

    useEffect(() => {
        const media = window.matchMedia(dockedSidebarQuery);
        const onChange = () => {
            setCanDockSidebar(media.matches);
            setIsMobileSidebarOpen(false);
        };
        media.addEventListener("change", onChange);
        return () => media.removeEventListener("change", onChange);
    }, []);

    const resizeSidebar = (width: number) => {
        const clampedWidth = clampWidth(width);
        setSidebarWidth(clampedWidth);
        localStorage.setItem(`sidebar-width-${spaceId}`, String(clampedWidth));
    };

    const handleAddPage = useCallback((parentId?: string) => {
        if (spaceDetails?.data?.archivedAt) {
            return;
        }
        setIsMobileSidebarOpen(false);
        setAddPageParentId(parentId ? parseInt(parentId) : undefined);
        setIsAddPageOpen(true);
    }, [spaceDetails?.data?.archivedAt]);

    const handleDropPage = async (id: string, targetId: string, placement: PageDropPlacement) => {
        if (savingOrder.current || pagesLoading || !spaceDetails?.data || spaceDetails.data.archivedAt) return;
        const source = data?.data?.find(page => String(page.pageId) === id);
        const target = data?.data?.find(page => String(page.pageId) === targetId);
        if (!source?.canEdit || !target?.canEdit || id === targetId) return;
        const destination = placement === "inside" ? target.pageId : Math.max(target.parentId || 0, 0);
        const sameParent = Math.max(source.parentId || 0, 0) === destination;
        savingOrder.current = true;
        setOrderPending(true);
        setOrderError("");
        setPageChangeMessage("");
        try {
            if (placement !== "inside" && sameParent) {
                await reorderPage(spaceId, id, targetId, placement);
            } else {
                await movePage(spaceId, id, destination > 0 ? String(destination) : null,
                    placement === "inside" ? undefined : { targetPageId: targetId, placement });
            }
            if (destination > 0) setExpandedIds(ids => [...new Set([...ids, String(destination)])]);
            setPageChangeMessage(`Page moved ${placement === "inside" ? "under" : placement} ${target.title || "Untitled"}`);
            fetchPages();
            window.dispatchEvent(new CustomEvent(placement !== "inside" && sameParent ? "pages-reordered" : "pages-moved", { detail: { spaceId } }));
        } catch (error) {
            setOrderError(error instanceof Error ? error.message : "Unable to save page changes");
            fetchPages();
        } finally {
            savingOrder.current = false;
            setOrderPending(false);
        }
    };

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

    const handleCreatedPage = useCallback((id: number) => {
        fetchPages();
        setIsAddPageOpen(false);
        navigate(`/edit/${spaceId}/${id}`);
    }, [fetchPages, navigate, spaceId]);

    const isActive = (path: string) => {
        if (path === `/space/${spaceId}`) return pathname === path;
        return pathname.startsWith(path);
    };

    const sidebarOpen = canDockSidebar ? !isSidebarCollapsed : isMobileSidebarOpen;
    const pagesButton = (
        <button type="button"
            className={cn(railButtonClass, sidebarOpen && railActiveClass)}
            aria-label={sidebarOpen ? "Hide space pages" : "Show space pages"}
            title={sidebarOpen ? "Hide space pages" : "Show space pages"}
            {...(canDockSidebar && {
                "aria-expanded": sidebarOpen,
                "aria-controls": sidebarOpen ? sidebarId : undefined,
            })}
            onClick={canDockSidebar ? () => {
                localStorage.setItem(sidebarPreferenceKey, String(!isSidebarCollapsed));
                setIsSidebarCollapsed(!isSidebarCollapsed);
            } : undefined}
        >
            <Icon name="PanelLeft" className="h-5 w-5" strokeWidth={1.75} />
        </button>
    );

    const pageNavigation = (
        <div className="flex flex-1 flex-col gap-3 p-3 min-h-0">
            {/* Navigation Menu */}
            <nav aria-label="Space navigation" className="flex flex-col gap-1">
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
                    <FiHome className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 truncate text-sm">{spaceDetails?.data?.name || "Space"}</span>
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
                    <FiSettings className="h-4 w-4 shrink-0" />
                    <span className="text-sm">Settings</span>
                </Link>
            </nav>

            {/* Pages Section Header */}
            <div className="flex items-center justify-between border-y border-neutral-200 py-2 px-1">
                <span className="text-xs font-semibold text-neutral-800">Pages</span>
                <button
                    type="button"
                    aria-label="Add page"
                    onClick={() => handleAddPage()}
                    disabled={Boolean(spaceDetails?.data?.archivedAt)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-primary-700 transition-colors hover:bg-primary-100"
                    title={spaceDetails?.data?.archivedAt ? "Archived spaces are read-only" : "Add page"}
                >
                    <FiPlus className="h-[18px] w-[18px] stroke-[2.5]" />
                </button>
            </div>

            <p role="status" aria-live="polite" className="sr-only">
                {orderPending ? "Saving page changes" : pageChangeMessage}
            </p>
            {orderError && <p role="alert" className="px-3 py-2 text-xs text-red-700">{orderError}</p>}

            {/* Page Tree */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                {pagesLoading && pages.length === 0 ? (
                    <div className="flex items-center justify-center py-4">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                    </div>
                ) : pages.length > 0 ? (
                    <PageTree
                        nodes={pages}
                        expandedIds={expandedIds}
                        activeId={activePageId}
                        onToggle={handleToggleNode}
                        onAddChild={handleAddPage}
                        onSelect={handlePageSelect}
                        onReorder={spaceDetails?.data && !spaceDetails.data.archivedAt ? handleDropPage : undefined}
                        onDropPage={spaceDetails?.data && !spaceDetails.data.archivedAt ? handleDropPage : undefined}
                        reorderPending={orderPending || pagesLoading}
                        className="w-full"
                    />
                ) : (
                    <div className="px-3 py-2">
                        <p className="text-[13px] italic text-neutral-700">No pages yet</p>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <SpaceAddPageProvider openAddPage={handleAddPage}>
            <Dialog.Root open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
                <SpaceLayout railActions={canDockSidebar ? pagesButton : <Dialog.Trigger>{pagesButton}</Dialog.Trigger>}>
                    <div className="flex h-full min-h-0 w-full overflow-hidden">
                        {canDockSidebar && sidebarOpen && (
                            <aside ref={sidebar} id={sidebarId} aria-label="Space pages"
                                className="relative flex shrink-0 flex-col border-r border-neutral-200 bg-white"
                                style={{ width: sidebarWidth }}>
                                {pageNavigation}
                                <div role="separator" tabIndex={0} aria-label="Resize space pages" aria-orientation="vertical"
                                    aria-valuemin={220} aria-valuemax={480} aria-valuenow={sidebarWidth}
                                    className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none outline-none hover:bg-primary-200 focus-visible:bg-primary-300 active:bg-primary-300"
                                    onPointerDown={(event) => {
                                        if (event.button !== 0) return;
                                        event.currentTarget.setPointerCapture(event.pointerId);
                                    }}
                                    onPointerMove={(event) => {
                                        if (!sidebar.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
                                        resizeSidebar(event.clientX - sidebar.current.getBoundingClientRect().left);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                                        event.preventDefault();
                                        resizeSidebar(sidebarWidth + (event.key === "ArrowRight" ? 16 : -16));
                                    }}
                                />
                            </aside>
                        )}
                        <main className="relative z-0 min-h-0 min-w-0 flex-1 overflow-y-auto bg-[var(--background)]">
                            <Outlet />
                        </main>
                    </div>
                </SpaceLayout>

                {!canDockSidebar && (
                    <Dialog.Content maxWidth="min(300px, calc(100vw - 48px))" aria-describedby={undefined}
                        className="!fixed inset-y-0 left-0 !m-0 flex flex-col !rounded-none !p-0"
                        onCloseAutoFocus={(event) => { if (isAddPageOpen) event.preventDefault(); }}>
                        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
                            <Dialog.Title className="!m-0 !text-sm">Space navigation</Dialog.Title>
                            <Dialog.Close>
                                <button type="button" aria-label="Close space navigation" className={railButtonClass}>
                                    <FiX className="h-5 w-5" />
                                </button>
                            </Dialog.Close>
                        </div>
                        {pageNavigation}
                    </Dialog.Content>
                )}
            </Dialog.Root>

            <AddPage
                isOpen={isAddPageOpen}
                setIsOpen={setIsAddPageOpen}
                spaceId={spaceId}
                parentId={addPageParentId}
                disabled={Boolean(spaceDetails?.data?.archivedAt)}
                disabledMessage="Archived spaces cannot create new pages until the space is unarchived."
                editPage={handleCreatedPage}
            />
        </SpaceAddPageProvider>
    );
}
