"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useGetCall } from "@http";
import { Response, useGet } from "@http/hooks";
import { Icon } from "@components/ui/Icon";
import { Topbar, TopbarMenuItem, TopbarUser } from "@components/primitives";

interface UserInfo {
    email: string;
    id: string;
    name: string;
    username: string;
}

interface Invite {
    token: string;
}

interface Notifications {
    invites: Invite[];
}

const USER_URI = process.env.NEXT_PUBLIC_USER_SERVER_URL;

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

export default function MenuBar() {
    const router = useRouter();
    const pathname = usePathname();
    const [, res] = useGetCall<UserInfo>(USER_URI + "/profile/details");
    const [{ data: notificationsData }, fetchNotifications] = useGet<Response<Notifications>>("invite/user/invites");
    const [notificationCountOffset, setNotificationCountOffset] = useState(0);

    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications, pathname]);

    useEffect(() => {
        const handleNotificationsChanged = () => {
            setNotificationCountOffset((count) => count - 1);
            fetchNotifications();
        };

        window.addEventListener("beskar:notifications-changed", handleNotificationsChanged);
        return () => {
            window.removeEventListener("beskar:notifications-changed", handleNotificationsChanged);
        };
    }, [fetchNotifications]);

    useEffect(() => {
        setNotificationCountOffset(0);
    }, [notificationsData?.data?.invites?.length]);

    const notificationCount = Math.max(0, (notificationsData?.data?.invites?.length ?? 0) + notificationCountOffset);

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
            { id: "profile", label: "Profile", icon: "User", href: "#" },
            { id: "settings", label: "Settings", icon: "Settings", href: "#" },
            { id: "notifications", label: "Notifications", icon: "Bell", href: "/user/notifications" },
            {
                id: "signout",
                label: "Sign out",
                icon: "LogOut",
                tone: "danger",
                onSelect: () => {
                    window.location.href = "/auth/logout";
                },
            },
        ],
        [],
    );

    return (
        <Topbar
            className="fixed inset-x-0 top-0 z-50"
            brand="Teddox"
            brandHref="/"
            navItems={[
                { id: "spaces", label: "Spaces", href: "/space", active: pathname?.startsWith("/space") },
                { id: "contact", label: "Contact", href: "#", active: false },
            ]}
            user={user}
            userMenuItems={userMenuItems}
            notificationOpen={pathname === "/user/notifications"}
            onNotificationsClick={() => router.push("/user/notifications")}
            notificationSlot={
                <span className="relative inline-flex h-4 w-4 items-center justify-center">
                    <Icon name="Bell" className="h-4 w-4" strokeWidth={2} />
                    {notificationCount > 0 && (
                        <span className="absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#b42318] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                            {notificationCount > 99 ? "99+" : notificationCount}
                        </span>
                    )}
                </span>
            }
        />
    );
}
