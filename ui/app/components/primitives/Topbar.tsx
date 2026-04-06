"use client";

import { cn } from "@/lib/utils";
import * as Popover from "@radix-ui/react-popover";
import { Box, Flex, Text } from "@radix-ui/themes";
import Link from "next/link";
import { Icon } from "@components/ui/Icon";
import { NavItem, TopbarMenuItem, TopbarProps } from "./types";

function BrandMark({ compact = false }: { compact?: boolean }) {
    const sizeClass = compact ? "h-7 w-7 rounded-lg" : "h-9 w-9 rounded-[10px]";
    const topBarClass = compact ? "left-[8px] top-[6px] h-1 w-3" : "left-[10px] top-[8px] h-[5px] w-[15px]";
    const stemClass = compact ? "left-[9px] top-[9px] h-3 w-1" : "left-[11px] top-[12px] h-[15px] w-[5px]";
    const nodeClass = compact ? "left-[17px] top-[17px] h-[6px] w-[6px]" : "left-[23px] top-[23px] h-[7px] w-[7px]";

    return (
        <div className={cn("relative shrink-0 bg-primary-700", sizeClass)}>
            <span className={cn("absolute rounded-full bg-white", topBarClass)} />
            <span className={cn("absolute rounded-full bg-white", stemClass)} />
            <span className={cn("absolute rounded-full bg-primary-100", nodeClass)} />
        </div>
    );
}

function NavLink({ item }: { item: NavItem }) {
    const linkClass = cn(
        "group relative inline-flex items-center text-sm font-medium leading-5 transition-colors duration-150",
        item.active ? "text-primary-700" : "text-neutral-800 hover:text-neutral-900",
    );
    const underlineClass = cn(
        "pointer-events-none absolute inset-x-0 -bottom-3 h-0.5 rounded-full transition-colors duration-150",
        item.active ? "bg-primary-700" : "bg-transparent group-hover:bg-neutral-300",
    );

    const content = (
        <span className={linkClass}>
            {item.label}
            <span className={underlineClass} />
        </span>
    );

    if (item.href) {
        return (
            <Link key={item.id} href={item.href}>
                {content}
            </Link>
        );
    }

    return (
        <button key={item.id} type="button">
            {content}
        </button>
    );
}

function NotificationButton({
    open,
    onClick,
    slot,
}: {
    open?: boolean;
    onClick?: () => void;
    slot?: React.ReactNode;
}) {
    const className = cn(
        "flex h-9 w-9 items-center justify-center rounded-full border transition-colors duration-150",
        open
            ? "border-primary-400 bg-primary-100 text-primary-700"
            : "border-transparent bg-neutral-100 text-neutral-700 hover:bg-neutral-200 hover:text-neutral-900",
    );

    return (
        <button type="button" className={className} onClick={onClick}>
            {slot ?? <Icon name="Bell" className="h-4 w-4" strokeWidth={2} />}
        </button>
    );
}

function MenuItem({ item }: { item: TopbarMenuItem }) {
    const className = cn(
        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors duration-150",
        item.tone === "danger"
            ? "text-red-700 hover:bg-red-50"
            : "text-neutral-900 hover:bg-neutral-100",
    );

    const iconClass = item.tone === "danger" ? "text-red-600" : "text-neutral-700";

    const content = (
        <>
            <Icon name={item.icon} className={cn("h-4 w-4", iconClass)} strokeWidth={2} />
            <span>{item.label}</span>
        </>
    );

    if (item.href) {
        return (
            <Popover.Close asChild key={item.id}>
                <Link href={item.href} className={className}>
                    {content}
                </Link>
            </Popover.Close>
        );
    }

    return (
        <Popover.Close asChild key={item.id}>
            <button type="button" className={className} onClick={item.onSelect}>
                {content}
            </button>
        </Popover.Close>
    );
}

function UserMenu({ user, items }: { user: NonNullable<TopbarProps["user"]>; items: TopbarMenuItem[] }) {
    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-primary-300 bg-primary-100 text-base font-semibold leading-none text-primary-700 transition-colors duration-150 hover:border-primary-400 hover:bg-primary-200"
                >
                    {user.initials}
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    sideOffset={12}
                    align="end"
                    className="z-50 w-[248px] rounded-xl border border-neutral-200 bg-white p-2 shadow-lg outline-none"
                >
                    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-700">
                            {user.initials}
                        </div>
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-neutral-900">{user.name}</div>
                            <div className="truncate text-xs text-neutral-700">{user.email}</div>
                        </div>
                    </div>
                    <div className="my-1 h-px bg-neutral-200" />
                    <div className="flex flex-col gap-0.5">
                        {items.map((item) => (
                            <MenuItem key={item.id} item={item} />
                        ))}
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

function MobileNavMenu({ items }: { items: NavItem[] }) {
    return (
        <Popover.Root>
            <Popover.Trigger asChild>
                <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-transparent bg-transparent text-neutral-700 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-900 md:hidden"
                    aria-label="Open navigation menu"
                >
                    <Icon name="Menu" className="h-4 w-4" strokeWidth={2} />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    sideOffset={10}
                    align="end"
                    className="z-50 w-[220px] rounded-xl border border-neutral-200 bg-white p-2 shadow-lg outline-none md:hidden"
                >
                    <div className="flex flex-col gap-0.5">
                        {items.map((item) => {
                            const className = cn(
                                "flex w-full items-center rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150",
                                item.active
                                    ? "bg-primary-100 text-primary-700"
                                    : "text-neutral-800 hover:bg-neutral-100 hover:text-neutral-900",
                            );

                            if (item.href) {
                                return (
                                    <Popover.Close asChild key={item.id}>
                                        <Link href={item.href} className={className}>
                                            {item.label}
                                        </Link>
                                    </Popover.Close>
                                );
                            }

                            return (
                                <Popover.Close asChild key={item.id}>
                                    <button type="button" className={className}>
                                        {item.label}
                                    </button>
                                </Popover.Close>
                            );
                        })}
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

export function Topbar({
    brand,
    brandHref = "/",
    navItems = [],
    user,
    userMenuItems = [],
    notificationOpen,
    onNotificationsClick,
    notificationSlot,
    userSlot,
    className,
}: TopbarProps) {
    return (
        <Box
            className={cn(
                "w-full border-b border-neutral-200 bg-white",
                className,
            )}
        >
            <div className="mx-auto flex w-full max-w-[1440px] items-center justify-between px-4 py-3 sm:px-5 md:px-6 lg:px-8">
                <Link href={brandHref} className="flex items-center gap-2.5">
                    <div className="hidden md:block">
                        <BrandMark />
                    </div>
                    <div className="md:hidden">
                        <BrandMark compact />
                    </div>
                    <Text className="text-[20px] font-bold leading-none text-neutral-900 md:text-[22px]">{brand}</Text>
                </Link>

                <Flex align="center" className="gap-2 md:gap-5 lg:gap-[26px]">
                    <Flex align="center" className="hidden gap-5 md:flex lg:gap-[26px]">
                        {navItems.map((item) => (
                            <NavLink key={item.id} item={item} />
                        ))}
                    </Flex>

                    <MobileNavMenu items={navItems} />

                    <NotificationButton open={notificationOpen} onClick={onNotificationsClick} slot={notificationSlot} />

                    {userSlot ??
                        (user ? (
                            <UserMenu user={user} items={userMenuItems} />
                        ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-primary-300 bg-primary-100 text-base font-semibold text-primary-700">
                                D
                            </div>
                        ))}
                </Flex>
            </div>
        </Box>
    );
}
