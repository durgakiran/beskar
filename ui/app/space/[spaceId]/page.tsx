"use client";

import { Response, useGet, usePut } from "@http/hooks";
import { Spinner, Flex } from "@radix-ui/themes";
import { use, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SpaceSummaryStat, StatusNotice, PageTree, PageTreeNode, InlineEditable } from "@components/primitives";
import { FiHome, FiSettings, FiPlus } from "react-icons/fi";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

interface SpaceDetails {
    id: string;
    name: string;
    description?: string;
    docCount?: number;
    memberCount?: number;
    userRole?: string;
    archivedAt?: string | null;
}

interface IPageList {
    pageId: number;
    ownerId: string;
    title: string;
    parentId: number;
    type: "document" | "whiteboard";
}

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const pathname = usePathname();
    const router = useRouter();

    // Fetch Space Details
    const [{ isLoading, data, errors }, fetchDetails] = useGet<Response<SpaceDetails>>(`space/${spaceId}/details`);

    // Fetch Pages (for mobile inline view)
    const [{ data: pagesData, isLoading: pagesLoading }, fetchPages] = useGet<Response<IPageList[]>>(`space/${spaceId}/page/list`);

    // Local state for optimistic updates
    const [localName, setLocalName] = useState("");
    const [localDesc, setLocalDesc] = useState("");

    // Update Space Details
    const [{ isLoading: isUpdating }, updateSpace] = usePut<Response<SpaceDetails>, Partial<SpaceDetails>>(`space/${spaceId}`);

    const handleSave = (updates: Partial<SpaceDetails>) => {
        // Optimistic update
        if (updates.name !== undefined) setLocalName(updates.name);
        if (updates.description !== undefined) setLocalDesc(updates.description);

        updateSpace({
            name: updates.name ?? localName,
            description: updates.description ?? localDesc,
            ...updates
        });
    };

    useEffect(() => {
        fetchDetails();
        fetchPages();
    }, [fetchDetails, fetchPages]);

    // Sync local state when initial data arrives
    useEffect(() => {
        if (data?.data) {
            setLocalName(data.data.name);
            setLocalDesc(data.data.description || "");
        }
    }, [data]);

    const space = data?.data;
    const pages = (pagesData?.data || []).filter((page) => page.type !== "whiteboard");
    const isArchived = Boolean(space?.archivedAt);

    // Transform pages for mobile PageTree
    const [treeNodes, setTreeNodes] = useState<PageTreeNode[]>([]);
    useEffect(() => {
        if (pages.length > 0) {
            const allNodes: PageTreeNode[] = pages.map(p => ({
                id: p.pageId.toString(),
                title: p.title || "Untitled",
                href: `/space/${spaceId}/view/${p.pageId}`,
                type: p.type || "document",
                children: []
            }));
            // Simplified root-only for mobile inline summary? 
            // Or full tree? Let's do full tree for consistency as requested.
            const rootNodes = allNodes.filter(node => {
                const parentId = pages.find(p => p.pageId.toString() === node.id)?.parentId || 0;
                return parentId <= 0;
            });
            setTreeNodes(rootNodes);
        }
    }, [pages, spaceId]);

    if (errors) {
        return (
            <div className="p-8">
                <StatusNotice tone="error" message={errors.message} title="Error loading space" />
            </div>
        );
    }

    if (isLoading) {
        return (
            <Flex align="center" justify="center" className="h-full min-h-[400px]">
                <Spinner size="3" />
            </Flex>
        );
    }

    const isActive = (path: string) => {
        if (path === `/space/${spaceId}`) return pathname === path;
        return pathname.startsWith(path);
    };

    return (
        <div className="flex flex-col items-center overflow-y-auto pt-7 pb-8 px-[14px] md:px-8">
            <div className="flex w-full max-w-[760px] flex-col gap-5 md:gap-7">

                {/* Mobile Tab Bar */}
                <div className="flex w-full min-h-[48px] items-center gap-2 rounded-lg border border-neutral-200 bg-white p-1 md:hidden">
                    <Link
                        href={`/space/${spaceId}`}
                        className={cn(
                            "flex flex-1 items-center justify-center gap-2 rounded-md py-2 px-3 transition-colors",
                            isActive(`/space/${spaceId}`) ? "bg-primary-100 text-primary-700" : "text-neutral-500"
                        )}
                    >
                        <FiHome className="h-3 w-3" />
                        <span className="text-[12px] font-semibold">Overview</span>
                    </Link>
                    <Link
                        href={`/space/${spaceId}/settings/users`}
                        className={cn(
                            "flex flex-1 items-center justify-center gap-2 rounded-md py-2 px-3 transition-colors",
                            isActive(`/space/${spaceId}/settings`) ? "bg-primary-100 text-primary-700" : "text-neutral-500"
                        )}
                    >
                        <FiSettings className="h-3 w-3" />
                        <span className="text-[12px] font-medium">Settings</span>
                    </Link>
                </div>

                {isArchived ? (
                    <StatusNotice
                        tone="warning"
                        title="Read-only space"
                        message="This space is archived. Members can still view content, but page creation and edits are disabled until the space is unarchived."
                    />
                ) : null}

                {/* Header Section */}
                <div className="flex flex-col gap-3 md:gap-4">
                    <InlineEditable
                        value={localName}
                        onSave={(name) => handleSave({ name })}
                        canEdit={!isArchived && (space?.userRole === "owner" || space?.userRole === "admin")}
                        isLoading={isUpdating}
                        placeholder="Unnamed Space"
                        textClassName="text-[28px] font-bold leading-[1.15] text-neutral-900 md:text-[36px] lg:text-[40px]"
                        inputClassName="text-[28px] font-bold md:text-[36px] lg:text-[40px]"
                    />
                    
                    <div className="space-y-4">
                        <InlineEditable
                            value={localDesc}
                            onSave={(description) => handleSave({ description })}
                            canEdit={!isArchived && (space?.userRole === "owner" || space?.userRole === "admin")}
                            isLoading={isUpdating}
                            multiline
                            placeholder="Add a space description for your team..."
                            textClassName="text-[13px] leading-[1.65] text-neutral-800 md:text-sm lg:text-base py-1 px-1"
                            inputClassName="text-sm lg:text-base"
                        />

                        {/* Save Hint - Visibile only if user can edit */}
                        {!isArchived && (space?.userRole === "owner" || space?.userRole === "admin") && (
                            <StatusNotice
                                tone="info"
                                message="Tip: name and description save automatically as you type."
                                className="max-w-fit border-none !bg-transparent !p-0 !text-primary-600/80"
                            />
                        )}
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="flex flex-col gap-2 md:flex-row md:gap-3">
                    <SpaceSummaryStat
                        label="Documents"
                        value={space?.docCount ?? 0}
                        className="flex-row justify-between items-center md:flex-col md:items-start md:justify-start"
                    />
                    <SpaceSummaryStat
                        label="Members"
                        value={space?.memberCount ?? 0}
                        className="flex-row justify-between items-center md:flex-col md:items-start md:justify-start"
                    />
                </div>

                {/* Mobile Pages Section */}
                <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-3 md:hidden">
                    <div className="flex items-center justify-between border-b border-neutral-100 pb-2 px-1">
                        <span className="text-[12px] font-bold tracking-wider text-neutral-400 uppercase">PAGES</span>
                        <button className="text-primary-700" disabled={isArchived} title={isArchived ? "Archived spaces are read-only" : "Add page"}>
                            <FiPlus className="h-[18px] w-[18px] stroke-[2.5]" />
                        </button>
                    </div>
                    {pagesLoading ? (
                        <div className="flex justify-center py-4">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                        </div>
                    ) : treeNodes.length > 0 ? (
                        <PageTree
                            nodes={treeNodes}
                            onSelect={(id) => router.push(`/space/${spaceId}/view/${id}`)}
                        />
                    ) : (
                        <p className="text-[13px] italic text-neutral-400 px-1 py-1">No pages yet</p>
                    )}
                </div>
            </div>
        </div>
    );
}
