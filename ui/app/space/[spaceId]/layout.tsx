"use client";

import { use, useEffect, useState, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { FiHome, FiSettings, FiPlus } from "react-icons/fi";
import { cn } from "@/lib/utils";
import { PageTree, PageTreeNode } from "@components/primitives";
import AddPage from "@components/addPage";
import { Response, useGet } from "@http/hooks";

interface IPageList {
    pageId: number;
    ownerId: string;
    title: string;
    parentId: number;
    type: "document" | "whiteboard";
}

interface SpaceState {
    id: string;
    archivedAt?: string | null;
}

export default function Layout({ children, params }: { children: React.ReactNode, params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const pathname = usePathname();
    const router = useRouter();
    
    // Sidebar Resize State
    const [sidebarWidth, setSidebarWidth] = useState(300);
    const isResizing = useRef(false);
    
    // Pages State
    const [pages, setPages] = useState<PageTreeNode[]>([]);
    const [isAddPageOpen, setIsAddPageOpen] = useState(false);
    const [addPageParentId, setAddPageParentId] = useState<number | undefined>();
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    
    // Fetch Pages
    const [{ data, isLoading: pagesLoading }, fetchPages] = useGet<Response<IPageList[]>>(`space/${spaceId}/page/list`);
    const [{ data: spaceDetails }, fetchSpaceDetails] = useGet<Response<SpaceState>>(`space/${spaceId}/details`);

    useEffect(() => {
        fetchPages();
        fetchSpaceDetails();
    }, [fetchPages, fetchSpaceDetails]);

    useEffect(() => {
        if (data?.data) {
            const documentPages = data.data.filter((page) => page.type !== "whiteboard");
            const pageMap = new Map<number, PageTreeNode[]>();
            const allNodes: PageTreeNode[] = documentPages.map(p => ({
                id: p.pageId.toString(),
                title: p.title || "Untitled",
                href: `/space/${spaceId}/view/${p.pageId}`,
                type: p.type || "document",
                children: []
            }));

            allNodes.forEach(node => {
                const parentId = documentPages.find(p => p.pageId.toString() === node.id)?.parentId || 0;
                if (parentId > 0) {
                    if (!pageMap.has(parentId)) pageMap.set(parentId, []);
                    pageMap.get(parentId)!.push(node);
                }
            });

            const rootNodes = allNodes.filter(node => {
                const parentId = documentPages.find(p => p.pageId.toString() === node.id)?.parentId || 0;
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

    const handleAddPage = (parentId?: string) => {
        if (spaceDetails?.data?.archivedAt) {
            return;
        }
        setAddPageParentId(parentId ? parseInt(parentId) : undefined);
        setIsAddPageOpen(true);
    };

    const handlePageSelect = (id: string) => {
        const node = data?.data.find(p => p.pageId.toString() === id && p.type !== "whiteboard");
        if (node) {
            router.push(`/space/${spaceId}/view/${id}`);
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
        router.push(`/edit/${spaceId}/${id}`);
    }, [fetchPages, router, spaceId]);

    const isActive = (path: string) => {
        if (path === `/space/${spaceId}`) return pathname === path;
        return pathname.startsWith(path);
    };

    return (
        <div className="flex h-full w-full overflow-hidden bg-white">
            {/* Sidebar */}
            <aside 
                className={cn(
                    "relative z-20 flex flex-shrink-0 flex-col border-r border-neutral-200 bg-white transition-[width] duration-75 ease-linear",
                    "hidden md:flex"
                )}
                style={{ width: sidebarWidth }}
            >
                <div className="flex flex-1 flex-col gap-[14px] p-5 min-h-0">
                    {/* Navigation Menu */}
                    <nav className="flex flex-col gap-1.5">
                        <Link
                            href={`/space/${spaceId}`}
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
                            href={`/space/${spaceId}/settings/users`}
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
            <main className="relative z-0 min-w-0 flex-1 overflow-y-auto bg-[var(--background)]">
                {children}
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
        </div>
    );
}
