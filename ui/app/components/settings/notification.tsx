"use client";

import ModifiedIcon from "@components/modifiedIcon";
import { formatInviteRole, formatInviteTime } from "@components/invite/formatters";
import { useInviteDecision } from "@components/invite/useInviteDecision";
import { Avatar, Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";

interface NotificationInvite {
    entity: string;
    entityId: string;
    senderId: string;
    name: string;
    senderName: string;
    role: string;
    token: string;
    createdAt?: string;
}

interface NotificationItemProps {
    invite: NotificationInvite;
    compact?: boolean;
    onResolved: (token: string, action: "accepted" | "declined") => void;
}

export default function Notification({ invite, compact = false, onResolved }: NotificationItemProps) {
    const { isLoading, data: decisionData, errors: decisionErrors, response: decisionResponse, pendingDecision, submitDecision } = useInviteDecision();
    const [showDeclineDialog, setShowDeclineDialog] = useState(false);

    const roleLabel = useMemo(() => {
        return formatInviteRole(invite.role);
    }, [invite.role]);

    useEffect(() => {
        if (decisionResponse !== 200 || !decisionData || !pendingDecision) {
            return;
        }
        if (pendingDecision === "accept") {
            onResolved(invite.token, "accepted");
        } else {
            onResolved(invite.token, "declined");
            setShowDeclineDialog(false);
        }
    }, [decisionData, decisionResponse, invite.token, onResolved, pendingDecision]);

    const acceptInvite = () => {
        submitDecision(invite.token, "accept");
    };

    const declineInvite = () => {
        submitDecision(invite.token, "reject");
    };

    const isAccepting = isLoading && pendingDecision === "accept";
    const isRejecting = isLoading && pendingDecision === "reject";
    const inviteTime = formatInviteTime(invite.createdAt).replace(" ago", "");

    return (
        <>
            <div
                className={`rounded-xl border border-[#d4d1da] ${compact ? "bg-[#fbfafc]" : "bg-[#efe9f2]"} p-4 md:p-[18px]`}
            >
                <div className={`${compact ? "space-y-3" : "space-y-3.5"}`}>
                    <div className={`flex ${compact ? "flex-col gap-3" : "items-start justify-between gap-4"}`}>
                        <div className="flex items-start gap-3 min-w-0">
                            <Avatar
                                size={compact ? "3" : "4"}
                                fallback={invite.senderName.charAt(0).toUpperCase()}
                                radius="full"
                            />
                            <div className="min-w-0 space-y-1">
                                <Text as="p" size={compact ? "2" : "3"} weight="medium" className="!text-[#221f26]">
                                    {invite.senderName} invited you to join {invite.name}
                                </Text>
                                <Text as="p" size="2" className="!text-[#605c67]">
                                    Accept the invite to join this space, or decline to remove it from your action list.
                                </Text>
                            </div>
                        </div>
                        <Text as="span" size="1" weight="medium" className="shrink-0 !text-[#898492]">
                            {inviteTime}
                        </Text>
                    </div>

                    <div className={`flex ${compact ? "flex-col gap-3" : "items-center justify-between gap-4"}`}>
                        <div className={`flex ${compact ? "flex-col items-start gap-2" : "items-center gap-3"}`}>
                            <span className="inline-flex items-center rounded-full border border-[#bea2cc] bg-[#e8dfed] px-3 py-1 text-sm font-semibold text-[#6f507f]">
                                {roleLabel}
                            </span>
                            <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#898492]">
                                <ModifiedIcon name="Bell" size={14} />
                                Action required
                            </span>
                        </div>

                        <Flex gap="2" direction={compact ? "column" : "row"} className={compact ? "w-full" : ""}>
                            <Button
                                variant="outline"
                                color="gray"
                                size={compact ? "3" : "2"}
                                className={compact ? "!w-full" : ""}
                                onClick={() => setShowDeclineDialog(true)}
                                disabled={isAccepting || isRejecting}
                            >
                                Decline
                            </Button>
                            <Button
                                size={compact ? "3" : "2"}
                                className={compact ? "!w-full" : ""}
                                onClick={acceptInvite}
                                loading={isAccepting}
                                disabled={isAccepting || isRejecting}
                            >
                                Accept
                            </Button>
                        </Flex>
                    </div>
                    {decisionErrors && (
                        <Text as="p" size="2" className="!text-[#b42318]">
                            Could not update this invite. Try again.
                        </Text>
                    )}
                </div>
            </div>

            <Dialog.Root open={showDeclineDialog} onOpenChange={setShowDeclineDialog}>
                <Dialog.Content maxWidth={compact ? "360px" : "456px"}>
                    <Dialog.Title>{compact ? "Decline invite?" : "Decline invite?"}</Dialog.Title>
                    <Dialog.Description size="2" className="!text-[#605c67]">
                        Declining removes the {invite.name} invite from your Action Required list. You can be invited again later.
                    </Dialog.Description>
                    <Flex gap="3" justify={compact ? "between" : "end"} mt="4" direction={compact ? "column" : "row"}>
                        <Button
                            variant="outline"
                            color="gray"
                            size="2"
                            onClick={() => setShowDeclineDialog(false)}
                            className={compact ? "!w-full" : ""}
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            size="2"
                            onClick={declineInvite}
                            loading={isRejecting}
                            className={compact ? "!w-full" : ""}
                        >
                            Decline invite
                        </Button>
                    </Flex>
                </Dialog.Content>
            </Dialog.Root>
        </>
    );
}
