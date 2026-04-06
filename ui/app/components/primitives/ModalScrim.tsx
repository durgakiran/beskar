"use client";

import { cn } from "@/lib/utils";
import { ModalScrimProps } from "./types";

export function ModalScrim({ children, className }: ModalScrimProps) {
    return (
        <div className={cn("relative min-h-[420px] overflow-hidden rounded-xl border border-neutral-200 bg-[#0B102066]", className)}>
            <div className="absolute inset-0" />
            {children ? <div className="relative z-10 flex min-h-[420px] items-center justify-center p-6">{children}</div> : null}
        </div>
    );
}
