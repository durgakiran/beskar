"use client";

import { Button, Dialog, Flex, Text, TextArea, TextField } from "@radix-ui/themes";
import { ProjectCycleTrackSummary, formatCycleTrackLabel } from "./model";
import { MessageLike } from "./ProjectPageView.ticket-detail-shared";

export function ProjectCreateCycleDialog({
    open,
    onOpenChange,
    cycleTracks,
    draftCycleTrackId,
    draftCycleName,
    draftCycleGoal,
    draftCycleDescription,
    draftCycleStartsAt,
    draftCycleEndsAt,
    draftCycleState,
    creatingCycle,
    createCycleError,
    onDraftCycleTrackIdChange,
    onDraftCycleNameChange,
    onDraftCycleGoalChange,
    onDraftCycleDescriptionChange,
    onDraftCycleStartsAtChange,
    onDraftCycleEndsAtChange,
    onDraftCycleStateChange,
    onCreateCycle,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    cycleTracks: ProjectCycleTrackSummary[];
    draftCycleTrackId: string;
    draftCycleName: string;
    draftCycleGoal: string;
    draftCycleDescription: string;
    draftCycleStartsAt: string;
    draftCycleEndsAt: string;
    draftCycleState: string;
    creatingCycle: boolean;
    createCycleError: MessageLike;
    onDraftCycleTrackIdChange: (value: string) => void;
    onDraftCycleNameChange: (value: string) => void;
    onDraftCycleGoalChange: (value: string) => void;
    onDraftCycleDescriptionChange: (value: string) => void;
    onDraftCycleStartsAtChange: (value: string) => void;
    onDraftCycleEndsAtChange: (value: string) => void;
    onDraftCycleStateChange: (value: string) => void;
    onCreateCycle: () => void;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Content size="3" maxWidth="560px">
                <Dialog.Title>Create cycle</Dialog.Title>
                <Dialog.Description>Define a planning cycle for this project and make it available in ticket planning selectors.</Dialog.Description>
                <Flex direction="column" gap="4">
                    <label className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            Track
                        </Text>
                        <select
                            value={draftCycleTrackId}
                            onChange={(event) => onDraftCycleTrackIdChange(event.target.value)}
                            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400"
                        >
                            {cycleTracks.map((track) => (
                                <option key={track.id} value={track.id}>
                                    {formatCycleTrackLabel(track)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            Name
                        </Text>
                        <TextField.Root value={draftCycleName} onChange={(event) => onDraftCycleNameChange(event.target.value)} placeholder="Sprint 14, Launch readiness, Q3 FY26" />
                    </label>
                    <label className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            Goal
                        </Text>
                        <TextField.Root value={draftCycleGoal} onChange={(event) => onDraftCycleGoalChange(event.target.value)} placeholder="Ship the onboarding refactor" />
                    </label>
                    <label className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            Description
                        </Text>
                        <TextArea
                            value={draftCycleDescription}
                            onChange={(event) => onDraftCycleDescriptionChange(event.target.value)}
                            rows={4}
                            placeholder="Capture the outcome, scope, or release notes for this cycle."
                        />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block">
                            <Text as="div" size="2" mb="1" weight="bold">
                                State
                            </Text>
                            <select
                                value={draftCycleState}
                                onChange={(event) => onDraftCycleStateChange(event.target.value)}
                                className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400"
                            >
                                <option value="planned">Planned</option>
                                <option value="active">Active</option>
                                <option value="completed">Completed</option>
                                <option value="canceled">Canceled</option>
                            </select>
                        </label>
                        <label className="block">
                            <Text as="div" size="2" mb="1" weight="bold">
                                Starts at
                            </Text>
                            <input
                                type="date"
                                value={draftCycleStartsAt}
                                onChange={(event) => onDraftCycleStartsAtChange(event.target.value)}
                                className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400"
                            />
                        </label>
                        <label className="block">
                            <Text as="div" size="2" mb="1" weight="bold">
                                Ends at
                            </Text>
                            <input
                                type="date"
                                value={draftCycleEndsAt}
                                onChange={(event) => onDraftCycleEndsAtChange(event.target.value)}
                                className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400"
                            />
                        </label>
                    </div>
                    {createCycleError ? (
                        <Text size="2" color="red">
                            {createCycleError.message}
                        </Text>
                    ) : null}
                    <Flex gap="3" mt="2" justify="end">
                        <Dialog.Close>
                            <Button variant="soft" color="gray">
                                Cancel
                            </Button>
                        </Dialog.Close>
                        <Button
                            onClick={onCreateCycle}
                            disabled={!draftCycleTrackId || !draftCycleName.trim() || !draftCycleEndsAt || creatingCycle}
                            loading={creatingCycle}
                        >
                            Create cycle
                        </Button>
                    </Flex>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}

export function ProjectDeleteDialog({
    open,
    onOpenChange,
    loadingDelete,
    onConfirmDelete,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    loadingDelete: boolean;
    onConfirmDelete: () => void;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Content size="2" maxWidth="450px">
                <Dialog.Title>Delete Project</Dialog.Title>
                <Dialog.Description>Delete this project page and all project-management records under it.</Dialog.Description>
                <Flex direction="column" gap="4">
                    <Text size="3">Are you sure you want to delete this project? This action cannot be undone.</Text>
                    <Flex gap="3" mt="4" justify="end">
                        <Dialog.Close>
                            <Button variant="soft" color="gray">
                                Cancel
                            </Button>
                        </Dialog.Close>
                        <Button onClick={onConfirmDelete} disabled={loadingDelete} loading={loadingDelete} color="red">
                            Delete
                        </Button>
                    </Flex>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
