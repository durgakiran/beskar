"use client";

import { cn } from "@/lib/utils";
import { PageTreeProps, PageTreeNode } from "./types";
import { SidebarPageItem } from "./SidebarPageItem";

function TreeBranch({
    nodes,
    expandedIds,
    activeId,
    onToggle,
    onAddChild,
    onSelect,
    depth = 0,
}: {
    nodes: PageTreeNode[];
    expandedIds: Set<string>;
    activeId?: string;
    onToggle?: (id: string) => void;
    onAddChild?: (id: string) => void;
    onSelect?: (id: string) => void;
    depth?: number;
}) {
    return (
        <div className="space-y-[6px]">
            {nodes.map((node) => {
                const expanded = expandedIds.has(node.id);
                const hasChildren = !!node.children?.length;

                return (
                    <div key={node.id} className="space-y-1">
                        <SidebarPageItem
                            id={node.id}
                            title={node.title}
                            href={node.href}
                            type={node.type}
                            active={activeId === node.id}
                            depth={depth}
                            expanded={expanded}
                            hasChildren={hasChildren}
                            onToggle={onToggle}
                            onAddChild={onAddChild}
                            onSelect={onSelect}
                        />
                        {hasChildren && expanded ? (
                            <TreeBranch
                                nodes={node.children || []}
                                expandedIds={expandedIds}
                                activeId={activeId}
                                onToggle={onToggle}
                                onAddChild={onAddChild}
                                onSelect={onSelect}
                                depth={depth + 1}
                            />
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

export function PageTree({ nodes, expandedIds = [], activeId, onToggle, onAddChild, onSelect, className }: PageTreeProps) {
    return (
        <div className={cn("space-y-[6px]", className)}>
            <TreeBranch
                nodes={nodes}
                expandedIds={new Set(expandedIds)}
                activeId={activeId}
                onToggle={onToggle}
                onAddChild={onAddChild}
                onSelect={onSelect}
            />
        </div>
    );
}
