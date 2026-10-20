import { createContext, useContext, useMemo, useState, DragEvent } from "react";
import { cn } from "@/lib/utils";
import { PageTreeProps, PageTreeNode, PageDropPlacement } from "./types";
import { SidebarPageItem } from "./SidebarPageItem";

type DropTarget = { id: string; placement: PageDropPlacement };
type IndexedNode = { node: PageTreeNode; parentId?: string };

const DragContext = createContext<{
    draggedId?: string;
    setDraggedId: (id?: string) => void;
    dropTarget?: DropTarget;
    setDropTarget: (target?: DropTarget) => void;
    index: Map<string, IndexedNode>;
    onReorder?: PageTreeProps["onReorder"];
    onDropPage?: PageTreeProps["onDropPage"];
    pending: boolean;
}>({ setDraggedId: () => {}, setDropTarget: () => {}, index: new Map(), pending: false });

function dropPlacement(event: DragEvent<HTMLDivElement>, allowNesting: boolean): PageDropPlacement {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;
    if (!allowNesting) return position < 0.5 ? "before" : "after";
    if (position < 0.25) return "before";
    if (position > 0.75) return "after";
    return "inside";
}

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
    const drag = useContext(DragContext);
    const source = drag.draggedId ? drag.index.get(drag.draggedId) : undefined;

    function canDrop(node: PageTreeNode) {
        if (drag.pending || !source?.node.canEdit || !node.canEdit) return false;
        // Ancestors remain valid targets; the source and its entire subtree do not.
        let current: IndexedNode | undefined = drag.index.get(node.id);
        const visited = new Set<string>();
        while (current) {
            if (current.node.id === source.node.id || visited.has(current.node.id)) return false;
            visited.add(current.node.id);
            current = current.parentId ? drag.index.get(current.parentId) : undefined;
        }
        return !!drag.onDropPage || (!!drag.onReorder && source.parentId === drag.index.get(node.id)?.parentId);
    }

    return (
        <div className="space-y-[6px]">
            {nodes.map((node) => {
                const expanded = expandedIds.has(node.id);
                const hasChildren = !!node.children?.length;
                const highlighted = drag.draggedId && drag.dropTarget?.id === node.id ? drag.dropTarget.placement : undefined;
                return (
                    <div key={node.id} className="space-y-1">
                        <div
                            data-page-id={node.id}
                            data-drop-placement={highlighted}
                            className={cn(
                                "relative",
                                highlighted === "before" && "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:border-t-2 before:border-primary-600",
                                highlighted === "after" && "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:border-b-2 after:border-primary-600",
                                highlighted === "inside" && "after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:border after:border-primary-500",
                            )}
                            onDragOver={(event) => {
                                if (!canDrop(node)) {
                                    if (drag.dropTarget) drag.setDropTarget(undefined);
                                    return;
                                }
                                event.preventDefault();
                                event.stopPropagation();
                                event.dataTransfer.dropEffect = "move";
                                const placement = dropPlacement(event, !!drag.onDropPage);
                                if (drag.dropTarget?.id !== node.id || drag.dropTarget.placement !== placement) {
                                    drag.setDropTarget({ id: node.id, placement });
                                }
                            }}
                            onDragLeave={(event) => {
                                if (drag.dropTarget?.id === node.id && !event.currentTarget.contains(event.relatedTarget as Node | null)) drag.setDropTarget(undefined);
                            }}
                            onDrop={(event) => {
                                if (!canDrop(node) || !source) return;
                                event.preventDefault();
                                event.stopPropagation();
                                const placement = dropPlacement(event, !!drag.onDropPage);
                                if (drag.onDropPage) drag.onDropPage(source.node.id, node.id, placement);
                                else if (placement !== "inside") drag.onReorder?.(source.node.id, node.id, placement);
                                drag.setDraggedId(undefined);
                                drag.setDropTarget(undefined);
                            }}
                        >
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
                                className={highlighted === "inside" ? "!bg-primary-50" : undefined}
                                reorderHandle={
                                    (drag.onDropPage || (drag.onReorder && nodes.length > 1)) && node.canEdit
                                        ? {
                                              draggable: !drag.pending,
                                              disabled: drag.pending,
                                              onDragStart: (event) => {
                                                  event.dataTransfer.effectAllowed = "move";
                                                  event.dataTransfer.setData("text/plain", node.id);
                                                  drag.setDraggedId(node.id);
                                                  drag.setDropTarget(undefined);
                                              },
                                              onDragEnd: () => {
                                                  drag.setDraggedId(undefined);
                                                  drag.setDropTarget(undefined);
                                              },
                                              onKeyDown: (event) => {
                                                  if (!event.altKey || drag.pending || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                                                  event.preventDefault();
                                                  const index = nodes.findIndex((item) => item.id === node.id);
                                                  const target = nodes[index + (event.key === "ArrowUp" ? -1 : 1)];
                                                  if (target?.canEdit) {
                                                      const placement = event.key === "ArrowUp" ? "before" : "after";
                                                      if (drag.onReorder) drag.onReorder(node.id, target.id, placement);
                                                      else drag.onDropPage?.(node.id, target.id, placement);
                                                  }
                                              },
                                          }
                                        : undefined
                                }
                            />
                            {highlighted === "inside" && (
                                <span aria-hidden="true" className="pointer-events-none absolute -bottom-2 right-2 z-20 rounded bg-primary-800 px-1.5 py-0.5 text-[10px] font-medium text-white">
                                    Move inside
                                </span>
                            )}
                        </div>
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

export function PageTree({ nodes, expandedIds = [], activeId, onToggle, onAddChild, onSelect, onReorder, onDropPage, reorderPending = false, className }: PageTreeProps) {
    const [draggedId, setDraggedId] = useState<string>();
    const [dropTarget, setDropTarget] = useState<DropTarget>();
    const index = useMemo(() => {
        const result = new Map<string, IndexedNode>();
        function visit(branch: PageTreeNode[], parentId?: string) {
            for (const node of branch) {
                result.set(node.id, { node, parentId });
                if (node.children) visit(node.children, node.id);
            }
        }
        visit(nodes);
        return result;
    }, [nodes]);
    const draggedTitle = draggedId ? index.get(draggedId)?.node.title : undefined;
    const targetTitle = dropTarget ? index.get(dropTarget.id)?.node.title : undefined;
    return (
        <DragContext.Provider value={{ draggedId, setDraggedId, dropTarget, setDropTarget, index, onReorder, onDropPage, pending: reorderPending }}>
            <div className={cn("space-y-[6px]", className)} aria-busy={reorderPending}>
                <TreeBranch nodes={nodes} expandedIds={new Set(expandedIds)} activeId={activeId} onToggle={onToggle} onAddChild={onAddChild} onSelect={onSelect} />
                <span className="sr-only" role="status" aria-live="polite">
                    {draggedTitle && targetTitle && dropTarget ? `Move ${draggedTitle} ${dropTarget.placement === "inside" ? "under" : dropTarget.placement} ${targetTitle}` : ""}
                </span>
            </div>
        </DragContext.Provider>
    );
}
