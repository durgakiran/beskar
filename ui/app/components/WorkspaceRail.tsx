import { useEffect, useMemo, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useDesktopLogout, useLogout } from "../core/auth/useLogout";
import { Response, useGet } from "@http/hooks";
import { Icon } from "@components/ui/Icon";
import DocumentSearch from "./DocumentSearch";
import type { TopbarMenuItem, TopbarUser } from "@components/primitives";
import { BrandMark, UserMenu } from "./primitives/Topbar";
import { cn } from "@/lib/utils";
import { railButtonClass, railActiveClass } from "./workspaceRailStyles";

interface UserInfo {
    email: string;
    id: string;
    name: string;
    username: string;
}

interface NotificationCounts {
    total: number;
    unread: number;
    actionRequired: number;
}

function getInitials(name?: string) {
    if (!name) {
        return "U";
    }

    const initials = name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("");

    return initials || "U";
}

export default function WorkspaceRail({ actions }: { actions?: ReactNode }) {
    const pathname = useLocation().pathname;
    const desktopLogout = useDesktopLogout();
    const { logout, error: logoutError } = useLogout();
    const [{ data: res }, fetchUser] = useGet<Response<UserInfo>>("profile/details");
    const [{ data: notificationsData }, fetchNotifications] = useGet<Response<NotificationCounts>>("notifications/unread-count");

    useEffect(() => {
        fetchUser();
        fetchNotifications();
    }, [fetchUser, fetchNotifications, pathname]);

    useEffect(() => {
        const handleNotificationsChanged = () => {
            fetchNotifications();
        };

        window.addEventListener("beskar:notifications-changed", handleNotificationsChanged);
        return () => {
            window.removeEventListener("beskar:notifications-changed", handleNotificationsChanged);
        };
    }, [fetchNotifications]);

    const notificationCount = Math.max(0, notificationsData?.data?.unread ?? 0);

    const user: TopbarUser = useMemo(
        () => ({
            name: res?.data?.name || "Unknown User",
            email: res?.data?.email || "",
            initials: getInitials(res?.data?.name),
        }),
        [res?.data?.email, res?.data?.name],
    );

    const userMenuItems: TopbarMenuItem[] = useMemo(
        () => [
            { id: "storage", label: "Storage & Limits", icon: "HardDrive", href: "/user/storage" },
            { id: "notifications", label: "Notifications", icon: "Bell", href: "/user/notifications" },
            {
                id: "signout",
                label: "Sign out",
                icon: "LogOut",
                tone: "danger",
                onSelect: () => {
                    // @ts-ignore
                    if (window.wails) {
                        desktopLogout();
                    } else {
                        void logout();
                    }
                },
            },
        ],
        [desktopLogout, logout],
    );

    const inSpaces = pathname === "/space" || pathname.startsWith("/space/") || pathname.startsWith("/edit/");
    const onNotifications = pathname === "/user/notifications";
    const onContact = pathname === "/contact";
    const notificationLabel = notificationCount
        ? `Notifications (${notificationCount} unread)`
        : "Notifications";

    return (
        <nav aria-label="Workspace navigation" className="z-10 flex w-12 shrink-0 flex-col items-center gap-2 overflow-x-hidden overflow-y-auto border-r border-neutral-200 bg-[var(--surface)] py-2 [scrollbar-width:thin] sm:w-14">
            <Link to="/space" aria-label="Teddox home" title="Teddox home" className={railButtonClass}>
                <BrandMark />
            </Link>
            <div className="h-px w-6 shrink-0 bg-neutral-200" />
            <Link to="/space" aria-label="Spaces" title="Spaces"
                aria-current={pathname === "/space" ? "page" : inSpaces ? "location" : undefined}
                className={cn(railButtonClass, inSpaces && railActiveClass)}>
                <Icon name="Folders" className="h-5 w-5" strokeWidth={1.75} />
            </Link>
            <DocumentSearch />
            {actions}

            <div className="mt-auto flex flex-col items-center gap-2 pt-2">
                <Link to="/user/notifications" aria-label={notificationLabel} title={notificationLabel}
                    aria-current={onNotifications ? "page" : undefined}
                    className={cn(railButtonClass, onNotifications && railActiveClass)}>
                    <Icon name="Bell" className="h-5 w-5" strokeWidth={1.75} />
                    {notificationCount > 0 && (
                        <span aria-hidden="true" className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#b42318] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-[var(--surface)]">
                            {notificationCount > 99 ? "99+" : notificationCount}
                        </span>
                    )}
                </Link>
                <Link to="/contact" aria-label="Contact support" title="Contact support"
                    aria-current={onContact ? "page" : undefined}
                    className={cn(railButtonClass, onContact && railActiveClass)}>
                    <Icon name="CircleQuestionMark" className="h-5 w-5" strokeWidth={1.75} />
                </Link>
                <UserMenu user={user} items={userMenuItems} side="right" />
            </div>
            {logoutError && <div role="alert" className="fixed bottom-4 left-16 right-4 z-[70] max-w-sm rounded bg-white p-4 text-red-700 shadow">{logoutError}</div>}
        </nav>
    );
}
