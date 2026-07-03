"use client";

import { Badge, Text, TextArea, TextField } from "@radix-ui/themes";
import {
    PRIORITY_OPTIONS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    formatTicketType,
} from "./model";
import {
    TicketActivityCard,
    TicketAttachmentsCard,
    TicketCommentsCard,
    TicketDetailSharedProps,
    TicketLinksCard,
    TicketOverviewCard,
    TicketStatusMessages,
    PlanningEditor,
    inlineCardClassName,
    pageCardClassName,
} from "./ProjectPageView.ticket-detail-shared";

export function ProjectTicketPageContent({
    projectKey,
    projectTitle,
    onBackToProject,
    onChildTicketClick,
    ...props
}: TicketDetailSharedProps & {
    projectKey: string;
    projectTitle: string;
    onBackToProject: () => void;
    onChildTicketClick: (ticketId: string) => void;
}) {
    const {
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
        onDraftTitleChange,
        onTitleBlur,
        onDraftDescriptionChange,
        onDescriptionBlur,
        onTypeChange,
        onStatusChange,
        onPriorityChange,
        onParentChange,
        onAssigneeChange,
        onDueAtChange,
        onDraftLabelsChange,
        onLabelsBlur,
        onCycleAssignmentChange,
        onCommentBodyChange,
        onCreateComment,
        onAttachmentInputChange,
        onRemoveAttachment,
        onOpenCreatePage,
    } = props;

    return (
        <div className="flex h-full flex-col overflow-y-auto bg-[var(--background)] px-4 py-6 md:px-6 md:py-7">
            <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-2">
                        <button
                            type="button"
                            onClick={onBackToProject}
                            className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
                        >
                            Back to project
                        </button>
                        <div className="flex items-center gap-2">
                            <Badge color="violet" variant="soft">
                                {projectKey}
                            </Badge>
                            <Badge color="gray" variant="soft">
                                {ticketDetail.identifier}
                            </Badge>
                        </div>
                        <h1 className="text-[30px] font-bold leading-[1.1] text-neutral-900 md:text-[36px]">{projectTitle}</h1>
                        <p className="max-w-[860px] text-[14px] leading-6 text-neutral-700">
                            Work through ticket details, attachments, and discussion in a focused view without losing the project context.
                        </p>
                    </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="space-y-4">
                        <label className={`block ${pageCardClassName}`}>
                            <Text as="div" size="2" mb="2" weight="bold">
                                Title
                            </Text>
                            <TextField.Root value={draftTitle} onChange={(event) => onDraftTitleChange(event.target.value)} onBlur={onTitleBlur} disabled={!canEditTickets} />
                        </label>

                        <label className={`block ${pageCardClassName}`}>
                            <Text as="div" size="2" mb="2" weight="bold">
                                Description
                            </Text>
                            <TextArea
                                value={draftDescription}
                                onChange={(event) => onDraftDescriptionChange(event.target.value)}
                                onBlur={onDescriptionBlur}
                                disabled={!canEditTickets}
                                rows={12}
                                placeholder="Add context, links, and implementation notes"
                            />
                        </label>

                        <TicketLinksCard links={ticketDetail.links} className={pageCardClassName} />
                        <TicketAttachmentsCard
                            attachments={ticketDetail.attachments}
                            canEditTickets={canEditTickets}
                            attachmentUploading={attachmentUploading}
                            attachmentRemovingId={attachmentRemovingId}
                            attachmentError={attachmentError}
                            onAttachmentInputChange={onAttachmentInputChange}
                            onRemoveAttachment={onRemoveAttachment}
                            className={pageCardClassName}
                        />
                        <TicketCommentsCard
                            comments={ticketDetail.comments}
                            commentBody={commentBody}
                            commentSubmitting={commentSubmitting}
                            commentError={commentError}
                            canEditTickets={canEditTickets}
                            onCommentBodyChange={onCommentBodyChange}
                            onCreateComment={onCreateComment}
                            className={pageCardClassName}
                        />
                        <TicketActivityCard activity={ticketDetail.activity} className={pageCardClassName} />
                    </div>

                    <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
                        <div className={`space-y-3 ${pageCardClassName}`}>
                            <div className="flex items-center gap-2">
                                <Badge color="violet" variant="soft">
                                    {ticketDetail.identifier}
                                </Badge>
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">{formatTicketType(ticketDetail.type)}</span>
                            </div>
                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Type
                                </Text>
                                <select
                                    value={draftType}
                                    onChange={(event) => onTypeChange(event.target.value)}
                                    disabled={!canEditTickets}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                >
                                    {TYPE_OPTIONS.filter((option) => option.value !== "").map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Status
                                </Text>
                                <select
                                    value={draftStatus}
                                    onChange={(event) => onStatusChange(event.target.value)}
                                    disabled={!canEditTickets}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                >
                                    {STATUS_OPTIONS.filter((option) => option.value !== "").map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Priority
                                </Text>
                                <select
                                    value={draftPriority}
                                    onChange={(event) => onPriorityChange(event.target.value)}
                                    disabled={!canEditTickets}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                >
                                    {PRIORITY_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Parent ticket
                                </Text>
                                <select
                                    value={draftParentTicketId}
                                    onChange={(event) => onParentChange(event.target.value)}
                                    disabled={!canEditTickets}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                >
                                    <option value="">No parent</option>
                                    {tickets
                                        .filter((ticket) => ticket.id !== ticketDetail.id)
                                        .map((ticket) => (
                                            <option key={ticket.id} value={ticket.id}>
                                                {ticket.identifier} {ticket.title}
                                            </option>
                                        ))}
                                </select>
                            </label>
                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Assignee
                                </Text>
                                <select
                                    value={draftAssigneeUserId}
                                    onChange={(event) => onAssigneeChange(event.target.value)}
                                    disabled={!canEditTickets}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                >
                                    <option value="">Unassigned</option>
                                    {spaceUsers.map((member) => (
                                        <option key={member.id} value={member.id}>
                                            {member.name || member.email}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Due date
                                </Text>
                                <input
                                    type="date"
                                    value={draftDueAt}
                                    onChange={(event) => onDueAtChange(event.target.value)}
                                    disabled={!canEditTickets}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                />
                            </label>
                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Labels
                                </Text>
                                <TextField.Root
                                    value={draftLabels}
                                    onChange={(event) => onDraftLabelsChange(event.target.value)}
                                    onBlur={onLabelsBlur}
                                    disabled={!canEditTickets}
                                    placeholder="launch, qa, follow-up"
                                />
                            </label>
                            <PlanningEditor
                                cycleTracks={cycleTracks}
                                cyclesByTrack={cyclesByTrack}
                                draftCycleAssignmentsByTrack={draftCycleAssignmentsByTrack}
                                canEditTickets={canEditTickets}
                                onCycleAssignmentChange={onCycleAssignmentChange}
                            />
                        </div>

                        <TicketOverviewCard
                            ticketDetail={ticketDetail}
                            canEditTickets={canEditTickets}
                            showDueDate={false}
                            onOpenCreatePage={onOpenCreatePage}
                            onChildTicketClick={onChildTicketClick}
                            className={`space-y-3 ${pageCardClassName}`}
                        />

                        <TicketStatusMessages updatingTicket={updatingTicket} updateTicketError={updateTicketError} ticketDetailError={ticketDetailError} />
                    </aside>
                </div>
            </div>
        </div>
    );
}

export function ProjectTicketInlineInspector({
    onOpenPage,
    onClose,
    onChildTicketClick,
    ...props
}: TicketDetailSharedProps & {
    onOpenPage: () => void;
    onClose: () => void;
    onChildTicketClick: (ticketId: string) => void;
}) {
    const {
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
        onDraftTitleChange,
        onTitleBlur,
        onDraftDescriptionChange,
        onDescriptionBlur,
        onTypeChange,
        onStatusChange,
        onPriorityChange,
        onParentChange,
        onAssigneeChange,
        onDueAtChange,
        onDraftLabelsChange,
        onLabelsBlur,
        onCycleAssignmentChange,
        onCommentBodyChange,
        onCreateComment,
        onAttachmentInputChange,
        onRemoveAttachment,
        onOpenCreatePage,
    } = props;

    return (
        <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Badge color="violet" variant="soft">
                            {ticketDetail.identifier}
                        </Badge>
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">{formatTicketType(ticketDetail.type)}</span>
                    </div>
                    <Text size="2" className="text-neutral-500">
                        Update core fields, attach files, and continue discussion without leaving the project page.
                    </Text>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onOpenPage}
                        className="rounded-full border border-neutral-200 px-3 py-1 text-[12px] font-medium text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50"
                    >
                        Open page
                    </button>
                    <button type="button" onClick={onClose} className="rounded-full border border-neutral-200 px-2 py-1 text-[12px] font-medium text-neutral-500">
                        Close
                    </button>
                </div>
            </div>

            <div className="space-y-3 rounded-[16px] border border-neutral-200 bg-neutral-50/60 p-3">
                <label className="block">
                    <Text as="div" size="2" mb="1" weight="bold">
                        Title
                    </Text>
                    <TextField.Root value={draftTitle} onChange={(event) => onDraftTitleChange(event.target.value)} onBlur={onTitleBlur} disabled={!canEditTickets} />
                </label>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                    <label className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            Type
                        </Text>
                        <select
                            value={draftType}
                            onChange={(event) => onTypeChange(event.target.value)}
                            disabled={!canEditTickets}
                            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                        >
                            {TYPE_OPTIONS.filter((option) => option.value !== "").map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            Status
                        </Text>
                        <select
                            value={draftStatus}
                            onChange={(event) => onStatusChange(event.target.value)}
                            disabled={!canEditTickets}
                            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                        >
                            {STATUS_OPTIONS.filter((option) => option.value !== "").map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            Priority
                        </Text>
                        <select
                            value={draftPriority}
                            onChange={(event) => onPriorityChange(event.target.value)}
                            disabled={!canEditTickets}
                            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                        >
                            {PRIORITY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                    <label className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            Parent ticket
                        </Text>
                        <select
                            value={draftParentTicketId}
                            onChange={(event) => onParentChange(event.target.value)}
                            disabled={!canEditTickets}
                            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                        >
                            <option value="">No parent</option>
                            {tickets
                                .filter((ticket) => ticket.id !== ticketDetail.id)
                                .map((ticket) => (
                                    <option key={ticket.id} value={ticket.id}>
                                        {ticket.identifier} {ticket.title}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <label className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            Assignee
                        </Text>
                        <select
                            value={draftAssigneeUserId}
                            onChange={(event) => onAssigneeChange(event.target.value)}
                            disabled={!canEditTickets}
                            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                        >
                            <option value="">Unassigned</option>
                            {spaceUsers.map((member) => (
                                <option key={member.id} value={member.id}>
                                    {member.name || member.email}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <Text as="div" size="2" mb="1" weight="bold">
                            Due date
                        </Text>
                        <input
                            type="date"
                            value={draftDueAt}
                            onChange={(event) => onDueAtChange(event.target.value)}
                            disabled={!canEditTickets}
                            className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                        />
                    </label>
                </div>
                <label className="block">
                    <Text as="div" size="2" mb="1" weight="bold">
                        Labels
                    </Text>
                    <TextField.Root
                        value={draftLabels}
                        onChange={(event) => onDraftLabelsChange(event.target.value)}
                        onBlur={onLabelsBlur}
                        disabled={!canEditTickets}
                        placeholder="launch, qa, follow-up"
                    />
                </label>
                <PlanningEditor
                    cycleTracks={cycleTracks}
                    cyclesByTrack={cyclesByTrack}
                    draftCycleAssignmentsByTrack={draftCycleAssignmentsByTrack}
                    canEditTickets={canEditTickets}
                    onCycleAssignmentChange={onCycleAssignmentChange}
                />
            </div>

            <TicketOverviewCard
                ticketDetail={ticketDetail}
                canEditTickets={canEditTickets}
                showDueDate={true}
                onOpenCreatePage={onOpenCreatePage}
                onChildTicketClick={onChildTicketClick}
                className="space-y-3 rounded-[16px] border border-neutral-200 bg-white p-3"
            />

            <label className={`block ${inlineCardClassName}`}>
                <Text as="div" size="2" mb="2" weight="bold">
                    Description
                </Text>
                <TextArea
                    value={draftDescription}
                    onChange={(event) => onDraftDescriptionChange(event.target.value)}
                    onBlur={onDescriptionBlur}
                    disabled={!canEditTickets}
                    rows={8}
                    placeholder="Add context, links, and implementation notes"
                />
            </label>

            <TicketLinksCard links={ticketDetail.links} className={inlineCardClassName} />
            <TicketAttachmentsCard
                attachments={ticketDetail.attachments}
                canEditTickets={canEditTickets}
                attachmentUploading={attachmentUploading}
                attachmentRemovingId={attachmentRemovingId}
                attachmentError={attachmentError}
                onAttachmentInputChange={onAttachmentInputChange}
                onRemoveAttachment={onRemoveAttachment}
                className={inlineCardClassName}
            />
            <TicketCommentsCard
                comments={ticketDetail.comments}
                commentBody={commentBody}
                commentSubmitting={commentSubmitting}
                commentError={commentError}
                canEditTickets={canEditTickets}
                onCommentBodyChange={onCommentBodyChange}
                onCreateComment={onCreateComment}
                className={inlineCardClassName}
            />
            <TicketActivityCard activity={ticketDetail.activity} className={inlineCardClassName} />

            <TicketStatusMessages updatingTicket={updatingTicket} updateTicketError={updateTicketError} ticketDetailError={ticketDetailError} />
        </div>
    );
}
