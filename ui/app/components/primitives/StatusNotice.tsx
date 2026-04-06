"use client";

import { cn } from "@/lib/utils";
import { Icon } from "@components/ui/Icon";
import { Button, Flex, Text } from "@radix-ui/themes";
import { NoticeTone, StatusNoticeProps } from "./types";

const toneClasses: Record<NoticeTone, { wrapper: string; icon: string }> = {
    success: {
        wrapper: "border-[#ABEFC6] bg-[#EAFBF2] text-[#067647]",
        icon: "CheckCircle2",
    },
    warning: {
        wrapper: "border-[#F7B955] bg-[#FFF7D6] text-[#946F00]",
        icon: "TriangleAlert",
    },
    error: {
        wrapper: "border-[#FFBDAD] bg-[#FFECEB] text-[#C9372C]",
        icon: "OctagonAlert",
    },
    info: {
        wrapper: "border-primary-200 bg-primary-100 text-primary-800",
        icon: "Info",
    },
};

export function StatusNotice({ tone, title, message, onDismiss, actionLabel, onAction, className }: StatusNoticeProps) {
    const palette = toneClasses[tone];

    return (
        <Flex align="center" justify="between" gap="3" className={cn("rounded-lg border px-3 py-2.5", palette.wrapper, className)}>
            <Flex align="center" gap="2">
                <Icon name={palette.icon as never} className="h-4 w-4" strokeWidth={2.2} />
                <div>
                    {title ? <Text as="div" size="2" weight="medium">{title}</Text> : null}
                    <Text as="div" size="2">{message}</Text>
                </div>
            </Flex>
            <Flex align="center" gap="2">
                {actionLabel ? (
                    <Button size="1" variant="ghost" onClick={onAction}>
                        {actionLabel}
                    </Button>
                ) : null}
                {onDismiss ? (
                    <button type="button" onClick={onDismiss} className="rounded-sm p-1 opacity-80 transition hover:opacity-100">
                        <Icon name="X" className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                ) : null}
            </Flex>
        </Flex>
    );
}
