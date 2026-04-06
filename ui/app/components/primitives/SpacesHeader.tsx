"use client";

import { cn } from "@/lib/utils";
import { Button } from "@components/ui/Button";
import { Icon } from "@components/ui/Icon";
import { SpacesHeaderProps } from "./types";

export function SpacesHeader({ title, subtitle, actionLabel, onAction, actionSlot, className }: SpacesHeaderProps) {
    return (
        <div className={cn("flex w-full flex-col items-start justify-between gap-4 md:flex-row md:items-center", className)}>
            <div className="max-w-[720px] space-y-2 text-left">
                <h1 className="text-[42px] font-bold leading-[1.15] text-neutral-900">{title}</h1>
                <p className="text-[15px] font-normal leading-6 text-neutral-800">{subtitle}</p>
            </div>
            {actionSlot || (actionLabel ? (
                <Button
                    type="button"
                    onClick={onAction}
                    className="self-start rounded-lg px-4 py-2 text-base font-semibold md:self-auto"
                >
                    <Icon name="Plus" className="h-4 w-4" strokeWidth={2.25} />
                    {actionLabel}
                </Button>
            ) : null)}
        </div>
    );
}
