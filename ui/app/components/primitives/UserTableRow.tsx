"use client";

import { cn } from "@/lib/utils";
import { Avatar, Flex, Text } from "@radix-ui/themes";
import { UserRole, UserTableRowProps } from "./types";

const roleClassName: Record<UserRole, string> = {
    owner: "bg-primary-100 text-primary-900",
    admin: "bg-primary-100 text-primary-900",
    editor: "bg-mauve-100 text-mauve-800",
    commenter: "bg-amber-100 text-amber-800",
    viewer: "bg-neutral-100 text-neutral-700",
};

export function UserTableRow({ user, actionSlot, className, compact = false }: UserTableRowProps) {
    if (compact) {
        return (
            <div className={cn("rounded-md border border-neutral-200 bg-white p-4 shadow-sm", className)}>
                <Flex direction="column" gap="3">
                    <Flex align="start" justify="between">
                        <Flex align="center" gap="3">
                            <Avatar size="3" radius="full" fallback={user.avatarFallback || user.name.charAt(0).toUpperCase()} />
                            <div>
                                <Text as="div" size="2" weight="medium" className="text-neutral-900">
                                    {user.name}
                                </Text>
                                <Text as="div" size="2" className="text-neutral-600">
                                    {user.email}
                                </Text>
                            </div>
                        </Flex>
                        {actionSlot}
                    </Flex>
                    <span className={cn("inline-flex w-fit items-center rounded-sm px-2.5 py-0.5 text-xs font-medium", roleClassName[user.role])}>
                        {user.role}
                    </span>
                </Flex>
            </div>
        );
    }

    return (
        <div className={cn("grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_88px] items-center gap-3 border-t border-neutral-200 px-4 py-3", className)}>
            <Flex align="center" gap="3">
                <Avatar size="3" radius="full" fallback={user.avatarFallback || user.name.charAt(0).toUpperCase()} />
                <div className="min-w-0">
                    <Text as="div" size="2" weight="medium" className="truncate text-neutral-900">
                        {user.name}
                    </Text>
                </div>
            </Flex>
            <Text size="2" className="truncate text-neutral-600">
                {user.email}
            </Text>
            <span className={cn("inline-flex w-fit items-center rounded-sm px-2.5 py-0.5 text-xs font-medium", roleClassName[user.role])}>
                {user.role}
            </span>
            <div className="flex justify-end">{actionSlot}</div>
        </div>
    );
}
