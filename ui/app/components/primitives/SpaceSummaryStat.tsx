"use client";

import { cn } from "@/lib/utils";
import { SpaceSummaryStatProps } from "./types";

export function SpaceSummaryStat({ label, value, className }: SpaceSummaryStatProps) {
    return (
        <div 
            className={cn(
                "flex flex-1 flex-col gap-1.5 rounded-lg border border-neutral-200 bg-white p-[14px]",
                className
            )}
        >
            <span className="text-sm font-semibold leading-none text-neutral-600">{label}</span>
            <span className="text-[30px] font-bold leading-none text-neutral-900">{value}</span>
        </div>
    );
}
