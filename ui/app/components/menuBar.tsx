"use client";

import { useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useGetCall } from "@http";
import { Topbar, TopbarMenuItem, TopbarUser } from "@components/primitives";

interface UserInfo {
    email: string;
    id: string;
    name: string;
    username: string;
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
        />
    );
}
