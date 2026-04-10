"use client";
import Notification from "@components/settings/notification";
import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet } from "@http/hooks";
import { Button, Flex, Box, Heading, Spinner, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";

interface Invite {
    entity: string;
    entityId: string;
    senderId: string;
    name: string;
    senderName: string;
    role: string;
    token: string;
    createdAt?: string;
}

interface Notifications {
    invites: Invite[];
}

export default function Page() {
    const [{ data, errors, isLoading, response }, fetchData] = useGet<Response<Notifications>>(`invite/user/invites`);
    const [selectedFilter, setSelectedFilter] = useState<"all" | "unread" | "action">("unread");
    const [toast, setToast] = useState<{ type: "success" | "warning"; message: string } | null>(null);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const invites = data?.data?.invites ?? [];

    const filteredInvites = useMemo(() => {
        switch (selectedFilter) {
        case "all":
        case "unread":
        case "action":
        default:
            return invites;
        }
    }, [invites, selectedFilter]);

    const onInviteResolved = (_token: string, action: "accepted" | "declined") => {
        setToast({
            type: "success",
            message: action === "accepted" ? "Invitation accepted." : "Invitation declined.",
        });
        fetchData();
    };

    const filterButtons = [
        { key: "all" as const, label: "All", count: invites.length },
        { key: "unread" as const, label: "Unread", count: invites.length },
        { key: "action" as const, label: "Action Required", count: invites.length },
    ];

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

            <Flex
                direction={{ initial: "column", md: "row" }}
                align={{ initial: "start", md: "center" }}
                justify="between"
                gap="3"
            >
                <Flex gap="2" wrap="wrap">
                    {filterButtons.map((filter) => {
                        const active = selectedFilter === filter.key;
                        const showCount = filter.count > 0;
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
                                {showCount ? ` ${filter.count}` : ""}
                            </button>
                        );
                    })}
                </Flex>

                <Button variant="outline" color="gray" size="2" disabled>
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
            ) : filteredInvites.length === 0 ? (
                <div className="rounded-xl border border-[#d4d1da] bg-[#f8f7f9] p-4 md:p-5">
                    <div className="space-y-1">
                        <Text size="1" weight="medium" className="uppercase tracking-[0.08em] !text-[#898492]">
                            Action Required Empty State
                        </Text>
                        <Text size="4" weight="bold" className="!text-[#221f26]">
                            No notifications need your attention
                        </Text>
                        <Text size="2" className="!text-[#605c67]">
                            When invites or approval-style events arrive, they will appear here with inline actions.
                        </Text>
                    </div>
                </div>
            ) : (
                <Box className="hidden md:block rounded-xl border border-[#d4d1da] bg-[#f8f7f9] overflow-hidden">
                    <div className="space-y-0">
                        {filteredInvites.map((invite, index) => (
                            <div
                                key={invite.token}
                                className={index === filteredInvites.length - 1 ? "" : "border-b border-[#d4d1da]"}
                            >
                                <Notification
                                    invite={invite}
                                    compact={false}
                                    onResolved={onInviteResolved}
                                />
                            </div>
                        ))}
                    </div>
                </Box>
            )}

            <div className="space-y-3 md:hidden">
                {!isLoading && filteredInvites.length > 0 && filteredInvites.map((invite) => (
                    <Notification
                        key={`${invite.token}-mobile`}
                        invite={invite}
                        compact
                        onResolved={onInviteResolved}
                    />
                ))}
            </div>

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
