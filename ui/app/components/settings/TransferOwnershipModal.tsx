"use client";

import { Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import User from "./User";
import RoleChip from "./RoleChip";
import type { SpaceMember } from "../../space/[spaceId]/settings/types";

export default function TransferOwnershipModal({
    open,
    onOpenChange,
    members,
    onConfirm,
    loading,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    members: SpaceMember[];
    onConfirm: (userId: string) => void;
    loading?: boolean;
}) {
    const [query, setQuery] = useState("");
    const [selectedUserId, setSelectedUserId] = useState<string>("");

    const availableMembers = useMemo(
        () =>
            members.filter((member) => {
                if (member.isOwner) return false;
                const haystack = `${member.name} ${member.email}`.toLowerCase();
                return haystack.includes(query.trim().toLowerCase());
            }),
        [members, query]
    );

    const selected = availableMembers.find((member) => member.id === selectedUserId) ?? members.find((member) => member.id === selectedUserId);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Content maxWidth="680px">
                <Dialog.Title>Transfer Ownership</Dialog.Title>
                <Dialog.Description size="2">
                    Search active members, review their current role, and choose the next owner.
                </Dialog.Description>

                <div className="mt-4 space-y-4">
                    <TextField.Root
                        placeholder="Search members by name or email"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                    />

                    {selected ? (
                        <div className="rounded-lg border border-primary-200 bg-primary-50 p-4">
                            <Text size="1" className="uppercase tracking-wide text-neutral-500">
                                Selected new owner
                            </Text>
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <User id={selected.id} name={selected.name} subtitle={selected.email} />
                                <RoleChip role={selected.role} />
                            </div>
                        </div>
                    ) : null}

                    <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
                        {availableMembers.map((member) => (
                            <button
                                key={member.id}
                                type="button"
                                onClick={() => setSelectedUserId(member.id)}
                                className={`flex w-full items-center justify-between gap-4 border-b border-neutral-200 px-4 py-3 text-left last:border-b-0 ${
                                    selectedUserId === member.id ? "bg-primary-50" : "hover:bg-neutral-50"
                                }`}
                            >
                                <User id={member.id} name={member.name} subtitle={member.email} />
                                <div className="flex items-center gap-3">
                                    <RoleChip role={member.role} />
                                    <span className="text-sm font-medium text-primary-700">
                                        {selectedUserId === member.id ? "Selected" : "Select"}
                                    </span>
                                </div>
                            </button>
                        ))}
                        {availableMembers.length === 0 ? (
                            <div className="px-4 py-6 text-sm text-neutral-500">No eligible active members found.</div>
                        ) : null}
                    </div>

                    <Text size="2" color="gray">
                        Only active members are eligible. Invited users cannot become owners.
                    </Text>
                </div>

                <Flex justify="end" gap="3" mt="5">
                    <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button disabled={!selectedUserId} loading={loading} onClick={() => selectedUserId && onConfirm(selectedUserId)}>
                        Continue
                    </Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
