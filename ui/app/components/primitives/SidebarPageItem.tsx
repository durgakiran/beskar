"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
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
    className,
}: SidebarPageItemProps) {
    const isChild = depth > 0;

    const content = (
        <div
            className={cn(
                "group flex w-full items-center justify-between rounded-lg py-2 px-[10px] transition-colors gap-2",
                active ? "bg-primary-100" : expanded ? "bg-neutral-50" : "bg-white hover:bg-neutral-50",
                className,
            )}
        >
            <div 
                className="flex min-w-0 items-center gap-2" 
                style={{ paddingLeft: isChild ? "20px" : "0px" }}
            >
                {/* Chevron/Toggle Section */}
                <div className="flex h-3 w-3 items-center justify-center">
                    {hasChildren ? (
                        <button
                            type="button"
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onToggle?.(id);
                            }}
                            className={cn(
                                "flex h-[18px] w-[18px] items-center justify-center rounded-sm transition-colors hover:bg-neutral-100",
                                "group/chevron"
                            )}
                        >
                            {expanded ? (
                                <FiChevronDown className="h-3 w-3 text-neutral-700" />
                            ) : (
                                <FiChevronRight className="h-3 w-3 text-neutral-700" />
                            )}
                        </button>
                    ) : isChild ? (
                        <FiCornerDownRight className="h-3 w-3 text-neutral-700" />
                    ) : (
                        <div className="h-3 w-3" />
                    )}
                </div>

                {/* Page Icon */}
                <div className="flex h-[13px] w-[13px] items-center justify-center">
                    {type === "whiteboard" ? (
                        <FiEdit3 className={cn("h-[13px] w-[13px]", active ? "text-primary-700" : "text-neutral-800")} />
                    ) : (
                        <FiFileText className={cn("h-[13px] w-[13px]", active ? "text-primary-700" : "text-neutral-800")} />
                    )}
                </div>

                {/* Title */}
                <div className="group/title relative flex min-w-0 items-center">
                    <span 
                        className={cn(
                            "truncate text-[13px] transition-colors",
                            active ? "font-semibold text-primary-700" : 
                            expanded ? "font-semibold text-neutral-800" : "font-normal text-neutral-800",
                            "group-hover/title:text-primary-700 group-hover/title:font-semibold"
                        )}
                    >
                        {title}
                    </span>
                    {/* Title Hover Chip Background */}
                    <div className="absolute -inset-x-1 -inset-y-0.5 -z-10 hidden rounded-sm bg-primary-50 group-hover/title:block" />
                </div>
            </div>

            {/* Add Button Section */}
            {!isChild && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onAddChild?.(id);
                    }}
                    className={cn(
                        "flex h-[18px] w-[18px] items-center justify-center rounded-sm transition-colors",
                        "text-neutral-700",
                        "group-hover:text-neutral-800 hover:!bg-primary-100 hover:!text-primary-700",
                        active ? "text-primary-600" : ""
                    )}
                >
                    <FiPlus className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );

    if (href) {
        return (
            <Link href={href} onClick={() => onSelect?.(id)} className="block focus:outline-none">
                {content}
            </Link>
        );
    }

    return (
        <button type="button" onClick={() => onSelect?.(id)} className="block w-full text-left focus:outline-none">
            {content}
        </button>
    );
}
