
import { useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Response, useGet } from "@http/hooks";
import { Icon } from "@components/ui/Icon";
import { Topbar, TopbarMenuItem, TopbarUser } from "@components/primitives";

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

const USER_URI = import.meta.env.VITE_USER_SERVER_URL;

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
    const navigate = useNavigate();
    const pathname = useLocation().pathname;
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
                { id: "contact", label: "Contact", href: "/contact", active: pathname === "/contact" },
            ]}
            user={user}
            userMenuItems={userMenuItems}
            notificationOpen={pathname === "/user/notifications"}
            onNotificationsClick={() => navigate("/user/notifications")}
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
