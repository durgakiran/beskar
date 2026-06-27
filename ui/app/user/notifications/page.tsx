"use client";

import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet } from "@http/hooks";
import { Avatar, Box, Button, Dialog, Flex, Heading, Spinner, Text } from "@radix-ui/themes";
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";

const USER_URI = import.meta.env.VITE_USER_SERVER_URL;

interface NotificationAction {
    key: string;
    label: string;
    method: string;
    url: string;
}

interface NotificationActor {
    userId: string;
    name: string;
    email?: string;
}

interface InAppNotification {
    id: string;
    type: string;
    category: string;
    title: string;
    body?: string;
    actor?: NotificationActor;
    target: {
        type: string;
        id: string;
        spaceId?: string;
        pageId?: number;
    };
    actionRequired: boolean;
    actions: NotificationAction[];
    data: Record<string, any>;
    readAt?: string;
    resolvedAt?: string;
    createdAt: string;
}

interface NotificationFeed {
    items: InAppNotification[];
    nextCursor?: string;
}

interface NotificationCounts {
    total: number;
    unread: number;
    actionRequired: number;
}

type FilterKey = "all" | "unread" | "action_required";

async function apiPost(path: string, body: any) {
    const res = await fetch(`${USER_URI}/${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
    }
    return res.json().catch(() => null);
}

function formatTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const diffSeconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
    if (diffSeconds < 60) {
        return "just now";
    }
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
        return `${diffDays}d ago`;
    }
    return date.toLocaleDateString();
}

function roleLabel(role?: string) {
    if (!role) {
        return "";
    }
    return role.charAt(0).toUpperCase() + role.slice(1);
}

function NotificationItem({
    notification,
    onChanged,
    onToast,
}: {
    notification: InAppNotification;
    onChanged: () => void;
    onToast: (toast: { type: "success" | "warning"; message: string }) => void;
}) {
    const navigate = useNavigate();
    const [declineOpen, setDeclineOpen] = useState(false);
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const unread = !notification.readAt;
    const actionPending = notification.actionRequired && !notification.resolvedAt;
    const href = typeof notification.data?.href === "string" ? notification.data.href : "";
    const token = typeof notification.data?.token === "string" ? notification.data.token : "";
    const role = roleLabel(typeof notification.data?.role === "string" ? notification.data.role : undefined);

    const markRead = useCallback(async () => {
        if (!unread) {
            return;
        }
        await apiPost("notifications/read", { notificationIds: [notification.id] });
        window.dispatchEvent(new CustomEvent("beskar:notifications-changed"));
    }, [notification.id, unread]);

    const openPassiveTarget = async () => {
        try {
            await markRead();
        } catch {
            // Navigation is still safe even if read state update fails.
        }
        if (href) {
            navigate(href);
        }
        onChanged();
    };

    const decideInvite = async (decision: "accept" | "reject") => {
        if (!token) {
            return;
        }
        setPendingAction(decision);
        try {
            await apiPost("invite/user/decision", { token, decision });
            onToast({
                type: "success",
                message: decision === "accept" ? "Invitation accepted." : "Invitation declined.",
            });
            setDeclineOpen(false);
            window.dispatchEvent(new CustomEvent("beskar:notifications-changed"));
            onChanged();
        } catch {
            onToast({ type: "warning", message: "Could not update this invite. Try again." });
        } finally {
            setPendingAction(null);
        }
    };

    const dismiss = async () => {
        try {
            await apiPost(`notifications/${notification.id}/dismiss`, {});
            window.dispatchEvent(new CustomEvent("beskar:notifications-changed"));
            onChanged();
        } catch {
            onToast({ type: "warning", message: "Could not dismiss this notification." });
        }
    };

    return (
        <>
            <div
                className={`rounded-xl border p-4 md:p-[18px] transition-colors ${
                    unread
                        ? "border-[#bea2cc] bg-[#efe9f2]"
                        : "border-[#d4d1da] bg-[#fbfafc]"
                }`}
            >
                <div className="space-y-3.5">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                            <Avatar
                                size="4"
                                fallback={(notification.actor?.name || notification.title || "N").charAt(0).toUpperCase()}
                                radius="full"
                            />
                            <div className="min-w-0 space-y-1">
                                <Flex align="center" gap="2" wrap="wrap">
                                    {unread && <span className="h-2 w-2 rounded-full bg-[#6f507f]" />}
                                    <Text as="p" size="3" weight="medium" className="!text-[#221f26]">
                                        {notification.title}
                                    </Text>
                                </Flex>
                                {notification.body && (
                                    <Text as="p" size="2" className="!text-[#605c67]">
                                        {notification.body}
                                    </Text>
                                )}
                            </div>
                        </div>
                        <Text as="span" size="1" weight="medium" className="shrink-0 !text-[#898492]">
                            {formatTime(notification.createdAt)}
                        </Text>
                    </div>

                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <Flex gap="2" wrap="wrap">
                            {role && (
                                <span className="inline-flex items-center rounded-full border border-[#bea2cc] bg-[#e8dfed] px-3 py-1 text-sm font-semibold text-[#6f507f]">
                                    {role}
                                </span>
                            )}
                            {actionPending && (
                                <span className="inline-flex items-center rounded-full border border-[#bea2cc] bg-[#e8dfed] px-3 py-1 text-xs font-semibold text-[#6f507f]">
                                    Action required
                                </span>
                            )}
                            {notification.actionRequired && notification.resolvedAt && (
                                <span className="inline-flex items-center rounded-full border border-[#d4d1da] bg-white px-3 py-1 text-xs font-semibold text-[#605c67]">
                                    Resolved
                                </span>
                            )}
                        </Flex>

                        {notification.type === "space_invite_created" && actionPending ? (
                            <div className="flex w-full flex-col gap-2 md:w-[176px] md:flex-row md:justify-end">
                                <Button
                                    variant="outline"
                                    color="gray"
                                    size="2"
                                    className="!w-full md:!w-20"
                                    onClick={() => setDeclineOpen(true)}
                                    disabled={pendingAction !== null}
                                >
                                    Decline
                                </Button>
                                <Button
                                    size="2"
                                    className="!w-full md:!w-20"
                                    onClick={() => decideInvite("accept")}
                                    loading={pendingAction === "accept"}
                                    disabled={pendingAction !== null}
                                >
                                    Accept
                                </Button>
                            </div>
                        ) : (
                            <div className="flex w-full items-center flex-col gap-2 md:w-[176px] md:flex-row md:justify-end">
                                {href && (
                                    <Button variant="outline" color="gray" size="2" className="!w-full md:!w-20" onClick={openPassiveTarget}>
                                        Open
                                    </Button>
                                )}
                                {!actionPending && (
                                    <Button variant="ghost" color="gray" size="2" className="!w-full md:!w-20" onClick={dismiss}>
                                        Dismiss
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <Dialog.Root open={declineOpen} onOpenChange={setDeclineOpen}>
                <Dialog.Content maxWidth="456px">
                    <Dialog.Title>Decline invite?</Dialog.Title>
                    <Dialog.Description size="2" className="!text-[#605c67]">
                        Declining removes this invite from your Action Required list. You can be invited again later.
                    </Dialog.Description>
                    <Flex gap="3" justify="end" mt="4">
                        <Button variant="outline" color="gray" size="2" onClick={() => setDeclineOpen(false)}>
                            Cancel
                        </Button>
                        <Button color="red" size="2" onClick={() => decideInvite("reject")} loading={pendingAction === "reject"}>
                            Decline invite
                        </Button>
                    </Flex>
                </Dialog.Content>
            </Dialog.Root>
        </>
    );
}

export default function Page() {
    const [{ data, errors, isLoading, response }, fetchData] = useGet<Response<NotificationFeed>>("notifications");
    const [{ data: countData }, fetchCounts] = useGet<Response<NotificationCounts>>("notifications/unread-count");
    const [selectedFilter, setSelectedFilter] = useState<FilterKey>("unread");
    const [toast, setToast] = useState<{ type: "success" | "warning"; message: string } | null>(null);

    const refresh = useCallback(() => {
        fetchData({ filter: selectedFilter, limit: "50" });
        fetchCounts();
    }, [fetchCounts, fetchData, selectedFilter]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const items = data?.data?.items ?? [];
    const counts = countData?.data ?? { total: 0, unread: 0, actionRequired: 0 };

    const filterButtons = [
        { key: "all" as const, label: "All", count: counts.total },
        { key: "unread" as const, label: "Unread", count: counts.unread },
        { key: "action_required" as const, label: "Action Required", count: counts.actionRequired },
    ];

    const markAllRead = async () => {
        try {
            await apiPost("notifications/read-all", { category: null });
            window.dispatchEvent(new CustomEvent("beskar:notifications-changed"));
            refresh();
        } catch {
            setToast({ type: "warning", message: "Could not mark notifications read." });
        }
    };

    return (
        <Box className="space-y-5 md:space-y-6">
            <div className="space-y-2">
                <Heading size="9" className="!text-[28px] md:!text-[40px] !font-bold !text-[#221f26]">
                    Notifications
                </Heading>
                <Text size="4" className="max-w-3xl !text-[#605c67]">
                    Unread updates stand out, while decision-required items can be resolved directly from the feed.
                </Text>
            </div>

            <Flex direction={{ initial: "column", md: "row" }} align={{ initial: "start", md: "center" }} justify="between" gap="3">
                <Flex gap="2" wrap="wrap">
                    {filterButtons.map((filter) => {
                        const active = selectedFilter === filter.key;
                        return (
                            <button
                                key={filter.key}
                                type="button"
                                onClick={() => setSelectedFilter(filter.key)}
                                className={`inline-flex items-center rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors ${
                                    active
                                        ? "border-[#bea2cc] bg-[#e8dfed] text-[#6f507f]"
                                        : "border-[#d4d1da] bg-[#f8f7f9] text-[#605c67] hover:bg-[#f3f1f5]"
                                }`}
                            >
                                {filter.label}
                                {` ${filter.count}`}
                            </button>
                        );
                    })}
                </Flex>

                <Button variant="outline" color="gray" size="2" onClick={markAllRead} disabled={counts.unread === 0}>
                    Mark all as read
                </Button>
            </Flex>

            {isLoading ? (
                <Flex align="center" justify="center" py="8">
                    <Spinner size="3" />
                </Flex>
            ) : errors || (response && response >= 400) ? (
                <div className="rounded-xl border border-[#d4d1da] bg-[#f8f7f9] p-4">
                    <Text size="3" className="!text-[#605c67]">
                        Unable to load notifications right now.
                    </Text>
                </div>
            ) : items.length === 0 ? (
                <div className="rounded-xl border border-[#d4d1da] bg-[#f8f7f9] p-4 md:p-5">
                    <div className="space-y-1">
                        <Text size="4" weight="bold" className="!text-[#221f26]">
                            No notifications here
                        </Text>
                        <Text size="2" className="!text-[#605c67]">
                            Updates for invites, membership changes, and space activity will appear here.
                        </Text>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {items.map((item) => (
                        <NotificationItem
                            key={item.id}
                            notification={item}
                            onChanged={refresh}
                            onToast={setToast}
                        />
                    ))}
                </div>
            )}

            {toast && (
                <ToastComponent
                    icon={toast.type === "success" ? "Check" : "AlertTriangle"}
                    type={toast.type}
                    toggle
                    message={toast.message}
                />
            )}
        </Box>
    );
}
