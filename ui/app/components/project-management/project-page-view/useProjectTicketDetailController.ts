"use client";

import { getApiV1Base, uploadAttachmentData } from "@http";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
    CreateTicketPayload,
    ProjectCycleSummary,
    ProjectCycleTrackSummary,
    ProjectViewData,
    SpaceMember,
    TicketRow,
    UpdateTicketPayload,
    buildCycleAssignmentState,
    formatDateInputValue,
    parseLabelInput,
    sameCycleAssignmentState,
} from "./model";
import { MessageLike, TicketDetailSharedProps } from "./ProjectPageView.ticket-detail-shared";

export function useProjectTicketDetailController({
    spaceId,
    pageId,
    project,
    selectedTicketId,
    selectedTicketPath,
    ticketDetail,
    tickets,
    spaceUsers,
    cycleTracks,
    cyclesByTrack,
    canEditTickets,
    updatingTicket,
    updateTicketError,
    ticketDetailError,
    updateTicket,
    fetchTicketDetail,
    onOpenCreatePage,
}: {
    spaceId: string;
    pageId: string;
    project: ProjectViewData | undefined;
    selectedTicketId: string | null;
    selectedTicketPath: string;
    ticketDetail: TicketRow | undefined;
    tickets: TicketRow[];
    spaceUsers: SpaceMember[];
    cycleTracks: ProjectCycleTrackSummary[];
    cyclesByTrack: Record<string, ProjectCycleSummary[]>;
    canEditTickets: boolean;
    updatingTicket: boolean;
    updateTicketError: MessageLike;
    ticketDetailError: MessageLike;
    updateTicket: (payload: UpdateTicketPayload) => void;
    fetchTicketDetail: () => void;
    onOpenCreatePage: (prefill?: Partial<CreateTicketPayload>) => void;
}) {
    const [draftTitle, setDraftTitle] = useState("");
    const [draftDescription, setDraftDescription] = useState("");
    const [draftType, setDraftType] = useState("");
    const [draftStatus, setDraftStatus] = useState("");
    const [draftPriority, setDraftPriority] = useState("");
    const [draftParentTicketId, setDraftParentTicketId] = useState("");
    const [draftAssigneeUserId, setDraftAssigneeUserId] = useState("");
    const [draftDueAt, setDraftDueAt] = useState("");
    const [draftLabels, setDraftLabels] = useState("");
    const [draftCycleAssignmentsByTrack, setDraftCycleAssignmentsByTrack] = useState<Record<string, string>>({});

    const [commentBody, setCommentBody] = useState("");
    const [commentSubmitting, setCommentSubmitting] = useState(false);
    const [commentError, setCommentError] = useState<string | null>(null);
    const [attachmentUploading, setAttachmentUploading] = useState(false);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const [attachmentRemovingId, setAttachmentRemovingId] = useState<string | null>(null);

    useEffect(() => {
        if (!ticketDetail) return;
        setDraftTitle(ticketDetail.title);
        setDraftDescription(ticketDetail.description ?? "");
        setDraftType(ticketDetail.type);
        setDraftStatus(ticketDetail.status);
        setDraftPriority(ticketDetail.priority);
        setDraftParentTicketId(ticketDetail.parentTicketId ?? "");
        setDraftAssigneeUserId(ticketDetail.assigneeUserId ?? "");
        setDraftDueAt(formatDateInputValue(ticketDetail.dueAt));
        setDraftLabels((ticketDetail.labelNames ?? []).join(", "));
        const nextCycleAssignments = buildCycleAssignmentState(ticketDetail.cycleAssignments);
        setDraftCycleAssignmentsByTrack((current) => (sameCycleAssignmentState(current, nextCycleAssignments) ? current : nextCycleAssignments));
    }, [ticketDetail]);

    function memberForId(userId: string) {
        return spaceUsers.find((member) => member.id === userId);
    }

    function commitTicketUpdate(payload: UpdateTicketPayload) {
        if (!selectedTicketId || !canEditTickets) return;
        updateTicket(payload);
    }

    function handleTitleBlur() {
        if (!ticketDetail) return;
        const trimmed = draftTitle.trim();
        if (!trimmed) {
            setDraftTitle(ticketDetail.title);
            return;
        }
        if (trimmed !== ticketDetail.title) {
            commitTicketUpdate({ title: trimmed });
        }
    }

    function handleDescriptionBlur() {
        if (!ticketDetail) return;
        const trimmed = draftDescription.trim();
        if (trimmed !== ticketDetail.description) {
            commitTicketUpdate({ description: trimmed });
        }
    }

    function handleTypeChange(nextType: string) {
        setDraftType(nextType);
        if (ticketDetail && nextType !== ticketDetail.type) {
            commitTicketUpdate({ type: nextType });
        }
    }

    function handleStatusChange(nextStatus: string) {
        setDraftStatus(nextStatus);
        if (ticketDetail && nextStatus !== ticketDetail.status) {
            commitTicketUpdate({ status: nextStatus });
        }
    }

    function handlePriorityChange(nextPriority: string) {
        setDraftPriority(nextPriority);
        if (ticketDetail && nextPriority !== ticketDetail.priority) {
            commitTicketUpdate({ priority: nextPriority });
        }
    }

    function handleParentChange(nextParentTicketId: string) {
        setDraftParentTicketId(nextParentTicketId);
        if (!ticketDetail) return;
        const currentParentTicketId = ticketDetail.parentTicketId ?? "";
        if (nextParentTicketId === currentParentTicketId) return;
        commitTicketUpdate({ parentTicketId: nextParentTicketId });
    }

    function handleAssigneeChange(nextAssigneeUserId: string) {
        setDraftAssigneeUserId(nextAssigneeUserId);
        if (!ticketDetail) return;
        const currentAssigneeUserId = ticketDetail.assigneeUserId ?? "";
        if (nextAssigneeUserId === currentAssigneeUserId) return;
        const member = memberForId(nextAssigneeUserId);
        commitTicketUpdate({
            assigneeUserId: nextAssigneeUserId,
            assigneeName: member?.name,
        });
    }

    function handleDueAtChange(nextDueAt: string) {
        setDraftDueAt(nextDueAt);
        if (!ticketDetail) return;
        if (nextDueAt === formatDateInputValue(ticketDetail.dueAt)) return;
        commitTicketUpdate({ dueAt: nextDueAt });
    }

    function handleLabelsBlur() {
        if (!ticketDetail) return;
        const nextLabels = parseLabelInput(draftLabels);
        const currentLabels = ticketDetail.labelNames ?? [];
        if (JSON.stringify(nextLabels) !== JSON.stringify(currentLabels)) {
            commitTicketUpdate({ labelNames: nextLabels });
        }
    }

    function handleCycleAssignmentChange(trackId: string, nextCycleId: string) {
        setDraftCycleAssignmentsByTrack((current) => {
            const nextState = { ...current };
            if (nextCycleId) nextState[trackId] = nextCycleId;
            else delete nextState[trackId];

            if (ticketDetail) {
                const currentState = buildCycleAssignmentState(ticketDetail.cycleAssignments);
                if (JSON.stringify(nextState) !== JSON.stringify(currentState)) {
                    commitTicketUpdate({
                        cycleAssignments: Object.entries(nextState).map(([nextTrackId, cycleId]) => ({ trackId: nextTrackId, cycleId })),
                        cycleAssignmentsSet: true,
                    });
                }
            }

            return nextState;
        });
    }

    async function handleCreateComment() {
        if (!selectedTicketId || !commentBody.trim()) return;
        setCommentSubmitting(true);
        setCommentError(null);
        try {
            const response = await fetch(`${getApiV1Base()}/${selectedTicketPath}/comments`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ body: commentBody.trim() }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.error?.detail || payload?.error?.message || `Request failed with status ${response.status}`);
            }
            setCommentBody("");
            fetchTicketDetail();
        } catch (error) {
            setCommentError(error instanceof Error ? error.message : "Unable to add comment");
        } finally {
            setCommentSubmitting(false);
        }
    }

    async function handleAttachmentInputChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file || !selectedTicketId || !project) return;

        setAttachmentUploading(true);
        setAttachmentError(null);
        try {
            const uploaded = await uploadAttachmentData(file, project.pageId);
            const response = await fetch(`${getApiV1Base()}/${selectedTicketPath}/attachments`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ attachmentId: uploaded.attachmentId }),
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.error?.detail || payload?.error?.message || `Request failed with status ${response.status}`);
            }
            fetchTicketDetail();
        } catch (error) {
            setAttachmentError(error instanceof Error ? error.message : "Unable to attach file");
        } finally {
            setAttachmentUploading(false);
        }
    }

    async function handleRemoveAttachment(attachmentId: string) {
        if (!selectedTicketId) return;

        setAttachmentRemovingId(attachmentId);
        setAttachmentError(null);
        try {
            const response = await fetch(`${getApiV1Base()}/${selectedTicketPath}/attachments/${attachmentId}`, {
                method: "DELETE",
                credentials: "include",
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.error?.detail || payload?.error?.message || `Request failed with status ${response.status}`);
            }
            fetchTicketDetail();
        } catch (error) {
            setAttachmentError(error instanceof Error ? error.message : "Unable to remove attachment");
        } finally {
            setAttachmentRemovingId(null);
        }
    }

    const ticketDetailSharedProps = useMemo<TicketDetailSharedProps | null>(() => {
        if (!ticketDetail) return null;

        return {
            ticketDetail,
            tickets,
            spaceUsers,
            cycleTracks,
            cyclesByTrack,
            canEditTickets,
            draftTitle,
            draftDescription,
            draftType,
            draftStatus,
            draftPriority,
            draftParentTicketId,
            draftAssigneeUserId,
            draftDueAt,
            draftLabels,
            draftCycleAssignmentsByTrack,
            commentBody,
            commentSubmitting,
            commentError,
            attachmentUploading,
            attachmentError,
            attachmentRemovingId,
            updatingTicket,
            updateTicketError,
            ticketDetailError,
            onDraftTitleChange: setDraftTitle,
            onTitleBlur: handleTitleBlur,
            onDraftDescriptionChange: setDraftDescription,
            onDescriptionBlur: handleDescriptionBlur,
            onTypeChange: handleTypeChange,
            onStatusChange: handleStatusChange,
            onPriorityChange: handlePriorityChange,
            onParentChange: handleParentChange,
            onAssigneeChange: handleAssigneeChange,
            onDueAtChange: handleDueAtChange,
            onDraftLabelsChange: setDraftLabels,
            onLabelsBlur: handleLabelsBlur,
            onCycleAssignmentChange: handleCycleAssignmentChange,
            onCommentBodyChange: setCommentBody,
            onCreateComment: handleCreateComment,
            onAttachmentInputChange: handleAttachmentInputChange,
            onRemoveAttachment: handleRemoveAttachment,
            onOpenCreatePage,
        };
    }, [
        attachmentError,
        attachmentRemovingId,
        attachmentUploading,
        canEditTickets,
        commentBody,
        commentError,
        commentSubmitting,
        cycleTracks,
        cyclesByTrack,
        draftAssigneeUserId,
        draftCycleAssignmentsByTrack,
        draftDescription,
        draftDueAt,
        draftLabels,
        draftParentTicketId,
        draftPriority,
        draftStatus,
        draftTitle,
        draftType,
        onOpenCreatePage,
        spaceUsers,
        ticketDetail,
        ticketDetailError,
        tickets,
        updateTicketError,
        updatingTicket,
    ]);

    return { ticketDetailSharedProps };
}
