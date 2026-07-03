"use client";

import { Button, Badge, Text, TextArea, TextField } from "@radix-ui/themes";
import { ChangeEvent } from "react";
import {
    PRIORITY_OPTIONS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    CreateTicketPayload,
    ProjectCycleSummary,
    ProjectCycleTrackSummary,
    SpaceMember,
    TicketActivity,
    TicketAttachment,
    TicketComment,
    TicketCycleAssignment,
    TicketLink,
    TicketRow,
    cycleChipClass,
    formatActivityLabel,
    formatCycleTrackLabel,
    formatDateInputValue,
    formatFileSize,
    formatStatusLabel,
    formatTicketType,
    formatTimestamp,
    sortCycleAssignments,
    suggestChildType,
} from "./model";

export type MessageLike = { message: string } | null | undefined;

export type TicketDetailSharedProps = {
    ticketDetail: TicketRow;
    tickets: TicketRow[];
    spaceUsers: SpaceMember[];
    cycleTracks: ProjectCycleTrackSummary[];
    cyclesByTrack: Record<string, ProjectCycleSummary[]>;
    canEditTickets: boolean;
    draftTitle: string;
    draftDescription: string;
    draftType: string;
    draftStatus: string;
    draftPriority: string;
    draftParentTicketId: string;
    draftAssigneeUserId: string;
    draftDueAt: string;
    draftLabels: string;
    draftCycleAssignmentsByTrack: Record<string, string>;
    commentBody: string;
    commentSubmitting: boolean;
    commentError: string | null;
    attachmentUploading: boolean;
    attachmentError: string | null;
    attachmentRemovingId: string | null;
    updatingTicket: boolean;
    updateTicketError: MessageLike;
    ticketDetailError: MessageLike;
    onDraftTitleChange: (value: string) => void;
    onTitleBlur: () => void;
    onDraftDescriptionChange: (value: string) => void;
    onDescriptionBlur: () => void;
    onTypeChange: (value: string) => void;
    onStatusChange: (value: string) => void;
    onPriorityChange: (value: string) => void;
    onParentChange: (value: string) => void;
    onAssigneeChange: (value: string) => void;
    onDueAtChange: (value: string) => void;
    onDraftLabelsChange: (value: string) => void;
    onLabelsBlur: () => void;
    onCycleAssignmentChange: (trackId: string, cycleId: string) => void;
    onCommentBodyChange: (value: string) => void;
    onCreateComment: () => void;
    onAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onRemoveAttachment: (attachmentId: string) => void;
    onOpenCreatePage: (prefill?: Partial<CreateTicketPayload>) => void;
};

export const pageCardClassName = "rounded-[18px] border border-neutral-200 bg-white p-4 shadow-[0_10px_24px_rgba(11,10,42,0.04)]";
export const inlineCardClassName = "rounded-[16px] border border-neutral-200 bg-white p-3";

export function TicketCycleChips({ assignments, limit = 3 }: { assignments?: TicketCycleAssignment[]; limit?: number }) {
    const sortedAssignments = sortCycleAssignments(assignments);
    if (sortedAssignments.length === 0) return null;

    const visibleAssignments = sortedAssignments.slice(0, limit);
    const hiddenCount = sortedAssignments.length - visibleAssignments.length;

    return (
        <div className="mt-2 flex flex-wrap gap-1.5">
            {visibleAssignments.map((assignment) => (
                <span
                    key={`${assignment.track.id}-${assignment.cycle.id}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cycleChipClass(assignment.track.key)}`}
                >
                    <span className="uppercase tracking-wide opacity-70">{formatCycleTrackLabel(assignment.track)}</span>
                    <span>{assignment.cycle.name}</span>
                </span>
            ))}
            {hiddenCount > 0 ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">+{hiddenCount} more</span> : null}
        </div>
    );
}

export function PlanningEditor({
    cycleTracks,
    cyclesByTrack,
    draftCycleAssignmentsByTrack,
    canEditTickets,
    onCycleAssignmentChange,
}: {
    cycleTracks: ProjectCycleTrackSummary[];
    cyclesByTrack: Record<string, ProjectCycleSummary[]>;
    draftCycleAssignmentsByTrack: Record<string, string>;
    canEditTickets: boolean;
    onCycleAssignmentChange: (trackId: string, cycleId: string) => void;
}) {
    if (cycleTracks.length === 0) return null;

    return (
        <div className="space-y-3 rounded-[14px] border border-neutral-200 bg-neutral-50/70 p-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <Text size="2" weight="bold" className="text-neutral-900">
                        Planning
                    </Text>
                    <Text size="1" className="text-neutral-500">
                        Assign one cycle per planning track.
                    </Text>
                </div>
            </div>
            <div className="grid gap-3">
                {cycleTracks.map((track) => (
                    <label key={track.id} className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            {formatCycleTrackLabel(track)}
                        </Text>
                        <select
                            value={draftCycleAssignmentsByTrack[track.id] ?? ""}
                            onChange={(event) => onCycleAssignmentChange(track.id, event.target.value)}
                            disabled={!canEditTickets}
                            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                        >
                            <option value="">No {formatCycleTrackLabel(track).toLowerCase()}</option>
                            {(cyclesByTrack[track.id] ?? []).map((cycle) => (
                                <option key={cycle.id} value={cycle.id}>
                                    {cycle.name} · {formatStatusLabel(cycle.state)}
                                </option>
                            ))}
                        </select>
                    </label>
                ))}
            </div>
        </div>
    );
}

export function TicketLinksCard({ links, className }: { links?: TicketLink[]; className: string }) {
    return (
        <div className={className}>
            <div className="mb-3 flex items-center justify-between">
                <Text size="2" weight="bold">
                    Links
                </Text>
                <span className="text-[12px] text-neutral-500">Auto-extracted from description</span>
            </div>
            {links && links.length > 0 ? (
                <div className="space-y-2">
                    {links.map((link) => (
                        <a
                            key={link.id}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-[12px] border border-neutral-200 px-3 py-2 text-[13px] text-neutral-800 transition hover:border-primary-300 hover:bg-primary-50/40"
                        >
                            <div className="font-medium">{link.title}</div>
                            <div className="truncate text-[12px] text-neutral-500">{link.url}</div>
                        </a>
                    ))}
                </div>
            ) : (
                <div className="rounded-[12px] border border-dashed border-neutral-200 px-3 py-4 text-[13px] text-neutral-500">
                    Paste links into the description and they will appear here.
                </div>
            )}
        </div>
    );
}

export function TicketAttachmentsCard({
    attachments,
    canEditTickets,
    attachmentUploading,
    attachmentRemovingId,
    attachmentError,
    onAttachmentInputChange,
    onRemoveAttachment,
    className,
}: {
    attachments?: TicketAttachment[];
    canEditTickets: boolean;
    attachmentUploading: boolean;
    attachmentRemovingId: string | null;
    attachmentError: string | null;
    onAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onRemoveAttachment: (attachmentId: string) => void;
    className: string;
}) {
    return (
        <div className={className}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <Text size="2" weight="bold">
                    Attachments
                </Text>
                <label
                    className={`cursor-pointer rounded-lg border border-neutral-200 px-3 py-2 text-[13px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 ${attachmentUploading || !canEditTickets ? "pointer-events-none opacity-60" : ""}`}
                >
                    {attachmentUploading ? "Uploading..." : "Attach file"}
                    <input type="file" className="hidden" onChange={onAttachmentInputChange} disabled={attachmentUploading || !canEditTickets} />
                </label>
            </div>
            {attachments && attachments.length > 0 ? (
                <div className="space-y-2">
                    {attachments.map((attachment) => (
                        <div key={attachment.attachmentId} className="flex items-center justify-between gap-3 rounded-[12px] border border-neutral-200 px-3 py-2">
                            <div className="min-w-0">
                                <a href={attachment.url} className="block truncate text-[13px] font-medium text-neutral-900 hover:text-primary-700">
                                    {attachment.fileName}
                                </a>
                                <div className="text-[12px] text-neutral-500">
                                    {attachment.mimeType} · {formatFileSize(attachment.fileSize)}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onRemoveAttachment(attachment.attachmentId)}
                                disabled={attachmentRemovingId === attachment.attachmentId || !canEditTickets}
                                className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[12px] font-medium text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-60"
                            >
                                {attachmentRemovingId === attachment.attachmentId ? "Removing..." : "Remove"}
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="rounded-[12px] border border-dashed border-neutral-200 px-3 py-4 text-[13px] text-neutral-500">No attachments on this ticket yet.</div>
            )}
            {attachmentError ? (
                <Text size="2" color="red" className="mt-2">
                    {attachmentError}
                </Text>
            ) : null}
        </div>
    );
}

export function TicketCommentsCard({
    comments,
    commentBody,
    commentSubmitting,
    commentError,
    canEditTickets,
    onCommentBodyChange,
    onCreateComment,
    className,
}: {
    comments?: TicketComment[];
    commentBody: string;
    commentSubmitting: boolean;
    commentError: string | null;
    canEditTickets: boolean;
    onCommentBodyChange: (value: string) => void;
    onCreateComment: () => void;
    className: string;
}) {
    const commentList = comments ?? [];

    return (
        <div className={className}>
            <div className="mb-3 flex items-center justify-between">
                <Text size="2" weight="bold">
                    Comments
                </Text>
                <span className="text-[12px] text-neutral-500">
                    {commentList.length} {commentList.length === 1 ? "comment" : "comments"}
                </span>
            </div>
            <div className="space-y-3">
                {commentList.length > 0 ? (
                    commentList.map((comment) => (
                        <div key={comment.id} className="rounded-[12px] border border-neutral-200 px-3 py-3">
                            <div className="mb-1 flex items-center justify-between gap-3">
                                <div className="text-[13px] font-semibold text-neutral-900">{comment.createdByName}</div>
                                <div className="text-[11px] text-neutral-500">{formatTimestamp(comment.createdAt)}</div>
                            </div>
                            <div className="whitespace-pre-wrap text-[13px] leading-6 text-neutral-700">{comment.body}</div>
                        </div>
                    ))
                ) : (
                    <div className="rounded-[12px] border border-dashed border-neutral-200 px-3 py-4 text-[13px] text-neutral-500">
                        No comments yet. Add context or handoff notes here.
                    </div>
                )}

                <div className="rounded-[12px] bg-neutral-50 p-3">
                    <TextArea
                        value={commentBody}
                        onChange={(event) => onCommentBodyChange(event.target.value)}
                        rows={3}
                        placeholder="Add a comment"
                        disabled={!canEditTickets || commentSubmitting}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <Text size="1" className="text-neutral-500">
                            Comments stay on the ticket and are visible from list, board, and my work.
                        </Text>
                        <Button onClick={onCreateComment} disabled={!commentBody.trim() || !canEditTickets || commentSubmitting} loading={commentSubmitting}>
                            Comment
                        </Button>
                    </div>
                    {commentError ? (
                        <Text size="2" color="red" className="mt-2">
                            {commentError}
                        </Text>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

export function TicketActivityCard({ activity, className }: { activity?: TicketActivity[]; className: string }) {
    const activityList = activity ?? [];

    return (
        <div className={className}>
            <div className="mb-3 flex items-center justify-between">
                <Text size="2" weight="bold">
                    Activity
                </Text>
                <span className="text-[12px] text-neutral-500">
                    {activityList.length} {activityList.length === 1 ? "event" : "events"}
                </span>
            </div>
            {activityList.length > 0 ? (
                <div className="space-y-2">
                    {activityList.map((entry) => (
                        <div key={entry.id} className="rounded-[12px] border border-neutral-200 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-[13px] text-neutral-800">
                                    <span className="font-semibold text-neutral-900">{entry.actorName}</span> {formatActivityLabel(entry)}
                                </div>
                                <div className="text-[11px] text-neutral-500">{formatTimestamp(entry.createdAt)}</div>
                            </div>
                            {entry.newValue ? (
                                <div className="mt-1 text-[12px] text-neutral-500">
                                    {entry.fieldName ? `${entry.fieldName.replace(/_/g, " ")} → ` : ""}
                                    {entry.newValue}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="rounded-[12px] border border-dashed border-neutral-200 px-3 py-4 text-[13px] text-neutral-500">No activity recorded yet.</div>
            )}
        </div>
    );
}

export function TicketOverviewCard({
    ticketDetail,
    canEditTickets,
    showDueDate,
    onOpenCreatePage,
    onChildTicketClick,
    className,
}: {
    ticketDetail: TicketRow;
    canEditTickets: boolean;
    showDueDate: boolean;
    onOpenCreatePage: (prefill?: Partial<CreateTicketPayload>) => void;
    onChildTicketClick: (ticketId: string) => void;
    className: string;
}) {
    return (
        <div className={className}>
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-[13px] font-semibold text-neutral-700">
                    {ticketDetail.ownerInitials}
                </div>
                <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-neutral-900">{ticketDetail.assigneeName ?? "Unassigned"}</div>
                    <div className="text-[12px] text-neutral-500">Assignee</div>
                </div>
            </div>
            <div className="rounded-[12px] bg-neutral-50 px-3 py-2">
                <div className="text-[12px] font-medium text-neutral-500">Reporter</div>
                <div className="text-[13px] text-neutral-800">{ticketDetail.reporterName}</div>
            </div>
            {showDueDate ? (
                <div className="rounded-[12px] bg-neutral-50 px-3 py-2">
                    <div className="text-[12px] font-medium text-neutral-500">Due date</div>
                    <div className="text-[13px] text-neutral-800">{ticketDetail.dueAt ? formatDateInputValue(ticketDetail.dueAt) : "No due date"}</div>
                </div>
            ) : null}
            {ticketDetail.parentIdentifier && ticketDetail.parentTitle ? (
                <div className="rounded-[12px] bg-neutral-50 px-3 py-2">
                    <div className="text-[12px] font-medium text-neutral-500">Parent ticket</div>
                    <div className="text-[13px] text-neutral-800">
                        {ticketDetail.parentIdentifier} {ticketDetail.parentTitle}
                    </div>
                </div>
            ) : null}
            {ticketDetail.children && ticketDetail.children.length > 0 ? (
                <div className="rounded-[12px] bg-neutral-50 px-3 py-2">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-[12px] font-medium text-neutral-500">
                            Child tickets · {ticketDetail.childCount} total · {ticketDetail.openChildCount} open · {ticketDetail.doneChildCount} done
                        </div>
                        <button
                            type="button"
                            onClick={() =>
                                onOpenCreatePage({
                                    parentTicketId: ticketDetail.id,
                                    type: suggestChildType(ticketDetail.type),
                                })
                            }
                            className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
                        >
                            Add child
                        </button>
                    </div>
                    <div className="space-y-2">
                        {ticketDetail.children.map((child) => (
                            <button
                                key={child.id}
                                type="button"
                                onClick={() => onChildTicketClick(child.id)}
                                className="block w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-[13px] text-neutral-800 transition hover:border-primary-300"
                            >
                                <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{child.identifier}</span>
                                {child.title}
                            </button>
                        ))}
                    </div>
                </div>
            ) : canEditTickets ? (
                <div className="rounded-[12px] bg-neutral-50 px-3 py-3">
                    <div className="mb-2 text-[12px] font-medium text-neutral-500">Child tickets</div>
                    <button
                        type="button"
                        onClick={() =>
                            onOpenCreatePage({
                                parentTicketId: ticketDetail.id,
                                type: suggestChildType(ticketDetail.type),
                            })
                        }
                        className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
                    >
                        Add child ticket
                    </button>
                </div>
            ) : null}
        </div>
    );
}

export function TicketStatusMessages({
    updatingTicket,
    updateTicketError,
    ticketDetailError,
}: {
    updatingTicket: boolean;
    updateTicketError: MessageLike;
    ticketDetailError: MessageLike;
}) {
    return (
        <>
            {updatingTicket ? (
                <Text size="2" className="text-neutral-500">
                    Saving changes...
                </Text>
            ) : null}
            {updateTicketError ? (
                <Text size="2" color="red">
                    {updateTicketError.message}
                </Text>
            ) : null}
            {ticketDetailError ? (
                <Text size="2" color="red">
                    Something went wrong while loading ticket details.
                </Text>
            ) : null}
        </>
    );
}
