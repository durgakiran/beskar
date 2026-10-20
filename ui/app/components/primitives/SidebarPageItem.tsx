import { DragHandleDots2Icon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";
import { Link } from "react-router-dom";
import { SidebarPageItemProps } from "./types";
import { FiChevronRight, FiChevronDown, FiFileText, FiEdit3, FiPlus, FiCornerDownRight } from "react-icons/fi";

export function SidebarPageItem({
    id,
    title,
    href,
    type = "document",
    active,
    depth = 0,
    expanded,
    hasChildren,
    onToggle,
    onAddChild,
    onSelect,
    reorderHandle,
    className,
}: SidebarPageItemProps) {
    const quietAction = "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100";
    const label = (
        <>
            {type === "whiteboard" ? <FiEdit3 className="h-[13px] w-[13px] shrink-0" /> : <FiFileText className="h-[13px] w-[13px] shrink-0" />}
            <span className={cn("truncate text-[13px]", active || expanded ? "font-semibold" : "font-normal")}>{title}</span>
        </>
    );
    const linkClass = "flex min-w-0 flex-1 items-center gap-2 rounded-sm hover:text-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600";
    return (
        <div
            className={cn(
                "group flex w-full items-center gap-2 rounded-lg px-[10px] py-2 transition-colors",
                active ? "bg-primary-100 text-primary-700" : expanded ? "bg-neutral-50 text-neutral-800" : "bg-white text-neutral-800 hover:bg-neutral-50",
                className,
            )}
        >
            <div className="flex h-6 w-4 shrink-0 items-center justify-center">
                {reorderHandle && (
                    <button
                        type="button"
                        aria-label={`Reorder ${title}`}
                        title="Drag to reorder. Use Alt+Up or Alt+Down to reorder with the keyboard."
                        className={cn(
                            "flex h-6 w-4 cursor-grab items-center justify-center rounded-sm text-neutral-500 hover:text-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600 active:cursor-grabbing disabled:cursor-default disabled:text-neutral-400",
                            quietAction,
                        )}
                        {...reorderHandle}
                    >
                        <DragHandleDots2Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                )}
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: `${depth * 20}px` }}>
                <div className="flex h-3 w-3 shrink-0 items-center justify-center">
                    {hasChildren ? (
                        <button
                            type="button"
                            aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`}
                            aria-expanded={!!expanded}
                            onClick={() => onToggle?.(id)}
                            className="flex h-[18px] w-[18px] items-center justify-center rounded-sm hover:bg-neutral-100"
                        >
                            {expanded ? <FiChevronDown className="h-3 w-3" /> : <FiChevronRight className="h-3 w-3" />}
                        </button>
                    ) : depth > 0 ? (
                        <FiCornerDownRight className="h-3 w-3" />
                    ) : null}
                </div>
                {href ? (
                    <Link to={href} onClick={() => onSelect?.(id)} aria-current={active ? "page" : undefined} className={linkClass}>
                        {label}
                    </Link>
                ) : (
                    <button type="button" onClick={() => onSelect?.(id)} className={cn(linkClass, "text-left")}>
                        {label}
                    </button>
                )}
            </div>
            {onAddChild && (
                <button
                    type="button"
                    aria-label={`Add page under ${title}`}
                    title="Add child page"
                    onClick={() => onAddChild(id)}
                    className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600",
                        quietAction,
                    )}
                >
                    <FiPlus className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}
