"use client";

import { Badge, Button, Flex, Spinner, Text } from "@radix-ui/themes";
import {
    BULK_NO_CHANGE,
    BULK_UNASSIGNED,
    PROJECT_VIEW_TABS,
    SORT_OPTIONS,
    STATUS_OPTIONS,
    TYPE_OPTIONS,
    ProjectCycleSummary,
    ProjectCycleTrackSummary,
    ProjectViewData,
    ProjectViewMode,
    SpaceMember,
    TicketActivity,
    TicketListRow,
    TicketRow,
    formatCycleTrackLabel,
    formatStatusLabel,
} from "./model";
import { TicketDetailSharedProps, MessageLike } from "./ProjectPageView.ticket-detail-shared";
import { ProjectTicketInlineInspector } from "./ProjectPageView.ticket-detail";
import { ProjectActivitySummaryCard, ProjectCycleTrackSummaryGrid, ProjectCyclesInspector } from "./ProjectPageView.views";

export function ProjectPageHero({
    project,
    isArchived,
    subtitle,
    activeView,
    cycleTracks,
    cycles,
    cycleTrackFilters,
    projectActivity,
    onDeleteProject,
    onAddTicket,
    onActiveViewChange,
    onCycleTrackFilterChange,
}: {
    project: ProjectViewData;
    isArchived: boolean;
    subtitle: string;
    activeView: ProjectViewMode;
    cycleTracks: ProjectCycleTrackSummary[];
    cycles: ProjectCycleSummary[];
    cycleTrackFilters: Record<string, string>;
    projectActivity: TicketActivity[];
    onDeleteProject: () => void;
    onAddTicket: () => void;
    onActiveViewChange: (view: ProjectViewMode) => void;
    onCycleTrackFilterChange: (trackId: string, cycleId: string) => void;
}) {
    return (
        <>
            <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-neutral-500">
                    {project.breadcrumbs.map((crumb) => (
                        <span key={crumb.id}>{crumb.title}</span>
                    ))}
                </div>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Badge color="violet" variant="soft">
                                {project.projectKey}
                            </Badge>
                            {isArchived ? (
                                <Badge color="gray" variant="soft">
                                    Archived
                                </Badge>
                            ) : null}
                        </div>
                        <h1 className="text-[30px] font-bold leading-[1.1] text-neutral-900 md:text-[36px]">{project.title}</h1>
                        <p className="max-w-[860px] text-[14px] leading-6 text-neutral-700">{subtitle}</p>
                    </div>
                    <div className="flex items-center gap-2 self-start">
                        {project.capabilities.canDelete && !isArchived ? (
                            <Button variant="soft" color="red" onClick={onDeleteProject}>
                                Delete project
                            </Button>
                        ) : null}
                        <Button disabled={!project.capabilities.canCreateTicket || isArchived} onClick={onAddTicket}>
                            Add
                        </Button>
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                <div className="rounded-lg border border-neutral-200 bg-white p-1">
                    <div className="flex flex-wrap gap-1">
                        {PROJECT_VIEW_TABS.map((tab) => {
                            const Icon = tab.icon;
                            const active = activeView === tab.key;

                            return (
                                <button
                                    key={tab.key}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => onActiveViewChange(tab.key)}
                                    className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                                        active ? "bg-primary-100 text-primary-700" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                                    }`}
                                >
                                    <Icon className="h-4 w-4" />
                                    <span className="font-medium">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-neutral-700">
                    <span>{project.summary.ticketCount} tickets</span>
                    <span>{project.summary.openCount} open</span>
                    <span>{project.summary.doneCount} done</span>
                </div>
                {activeView !== "list" ? (
                    <ProjectCycleTrackSummaryGrid
                        cycleTracks={cycleTracks}
                        cycles={cycles}
                        cycleTrackFilters={cycleTrackFilters}
                        onCycleTrackFilterChange={onCycleTrackFilterChange}
                    />
                ) : null}
            </div>

            {activeView !== "list" ? <ProjectActivitySummaryCard projectActivity={projectActivity} /> : null}
        </>
    );
}

export function ProjectPageToolbar({
    search,
    statusFilter,
    typeFilter,
    sort,
    activeView,
    groupByTrackId,
    assigneeFilter,
    labelFilter,
    parentFilter,
    rootFilter,
    leafOnlyFilter,
    cycleTrackFilters,
    cycleTracks,
    cyclesByTrack,
    tickets,
    spaceUsers,
    totalResults,
    csvExportHref,
    jsonExportHref,
    selectedTicketIds,
    bulkStatus,
    bulkPriority,
    bulkAssigneeUserId,
    bulkSubmitting,
    bulkError,
    actionError,
    canEditTickets,
    onSearchChange,
    onStatusFilterChange,
    onTypeFilterChange,
    onSortChange,
    onGroupByTrackChange,
    onAssigneeFilterChange,
    onLabelFilterChange,
    onParentFilterChange,
    onRootFilterChange,
    onLeafOnlyFilterChange,
    onCycleTrackFilterChange,
    onClearPlanningFilters,
    onClearSelectedTickets,
    onBulkStatusChange,
    onBulkPriorityChange,
    onBulkAssigneeUserIdChange,
    onBulkApply,
    embedded = false,
}: {
    search: string;
    statusFilter: string;
    typeFilter: string;
    sort: string;
    activeView: ProjectViewMode;
    groupByTrackId: string;
    assigneeFilter: string;
    labelFilter: string;
    parentFilter: string;
    rootFilter: string;
    leafOnlyFilter: boolean;
    cycleTrackFilters: Record<string, string>;
    cycleTracks: ProjectCycleTrackSummary[];
    cyclesByTrack: Record<string, ProjectCycleSummary[]>;
    tickets: TicketRow[];
    spaceUsers: SpaceMember[];
    totalResults: number;
    csvExportHref: string;
    jsonExportHref: string;
    selectedTicketIds: string[];
    bulkStatus: string;
    bulkPriority: string;
    bulkAssigneeUserId: string;
    bulkSubmitting: boolean;
    bulkError: string | null;
    actionError: string | null;
    canEditTickets: boolean;
    onSearchChange: (value: string) => void;
    onStatusFilterChange: (value: string) => void;
    onTypeFilterChange: (value: string) => void;
    onSortChange: (value: string) => void;
    onGroupByTrackChange: (value: string) => void;
    onAssigneeFilterChange: (value: string) => void;
    onLabelFilterChange: (value: string) => void;
    onParentFilterChange: (value: string) => void;
    onRootFilterChange: (value: string) => void;
    onLeafOnlyFilterChange: (value: boolean) => void;
    onCycleTrackFilterChange: (trackId: string, cycleId: string) => void;
    onClearPlanningFilters: () => void;
    onClearSelectedTickets: () => void;
    onBulkStatusChange: (value: string) => void;
    onBulkPriorityChange: (value: string) => void;
    onBulkAssigneeUserIdChange: (value: string) => void;
    onBulkApply: () => void;
    embedded?: boolean;
}) {
    return (
        <div className={embedded ? "flex flex-col gap-3 px-4 py-4" : "flex flex-col gap-3 rounded-[14px] border border-neutral-200 bg-white p-3"}>
            <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
                <input
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="Search ticket title or description"
                    className="h-10 w-full rounded-lg border border-neutral-200 px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 lg:max-w-[360px]"
                />
                <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)} className="h-10 rounded-lg border border-neutral-200 px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400">
                    {STATUS_OPTIONS.map((option) => (
                        <option key={option.value || "all"} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <select value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)} className="h-10 rounded-lg border border-neutral-200 px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400">
                    {TYPE_OPTIONS.map((option) => (
                        <option key={option.value || "all"} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <select value={sort} onChange={(event) => onSortChange(event.target.value)} className="h-10 rounded-lg border border-neutral-200 px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400">
                    {SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            Sort: {option.label}
                        </option>
                    ))}
                </select>
                {activeView === "list" && cycleTracks.length > 0 ? (
                    <select value={groupByTrackId} onChange={(event) => onGroupByTrackChange(event.target.value)} className="h-10 rounded-lg border border-neutral-200 px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400">
                        <option value="">Group: none</option>
                        {cycleTracks.map((track) => (
                            <option key={track.id} value={track.id}>
                                Group: {formatCycleTrackLabel(track)}
                            </option>
                        ))}
                    </select>
                ) : null}
            </div>

            <details className="rounded-[12px] border border-neutral-200 bg-neutral-50/60 px-3 py-2">
                <summary className="cursor-pointer text-[13px] font-medium text-neutral-700">Advanced filters</summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
                    <select value={assigneeFilter} onChange={(event) => onAssigneeFilterChange(event.target.value)} className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400">
                        <option value="">All assignees</option>
                        {spaceUsers.map((member) => (
                            <option key={member.id} value={member.id}>
                                {member.name || member.email}
                            </option>
                        ))}
                    </select>
                    <input
                        value={labelFilter}
                        onChange={(event) => onLabelFilterChange(event.target.value)}
                        placeholder="Filter by label"
                        className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400"
                    />
                    <select value={parentFilter} onChange={(event) => onParentFilterChange(event.target.value)} className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400">
                        <option value="">Any parent</option>
                        {tickets
                            .filter((ticket) => ticket.childCount > 0)
                            .map((ticket) => (
                                <option key={ticket.id} value={ticket.id}>
                                    {ticket.identifier} {ticket.title}
                                </option>
                            ))}
                    </select>
                    <select value={rootFilter} onChange={(event) => onRootFilterChange(event.target.value)} className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400">
                        <option value="">Any root ticket</option>
                        {tickets
                            .filter((ticket) => ticket.depth === 0)
                            .map((ticket) => (
                                <option key={ticket.id} value={ticket.id}>
                                    {ticket.identifier} {ticket.title}
                                </option>
                            ))}
                    </select>
                    <label className="flex h-10 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900">
                        <input type="checkbox" checked={leafOnlyFilter} onChange={(event) => onLeafOnlyFilterChange(event.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
                        Leaf tickets only
                    </label>
                </div>
                {cycleTracks.length > 0 ? (
                    <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                        {cycleTracks.map((track) => (
                            <select
                                key={track.id}
                                value={cycleTrackFilters[track.id] ?? ""}
                                onChange={(event) => onCycleTrackFilterChange(track.id, event.target.value)}
                                className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400"
                            >
                                <option value="">{formatCycleTrackLabel(track)}: any</option>
                                {(cyclesByTrack[track.id] ?? []).map((cycle) => (
                                    <option key={cycle.id} value={cycle.id}>
                                        {cycle.name} · {formatStatusLabel(cycle.state)}
                                    </option>
                                ))}
                            </select>
                        ))}
                    </div>
                ) : null}
            </details>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <Text size="2" className="text-neutral-500">
                    {totalResults} results
                </Text>
                <div className="flex flex-wrap items-center gap-2">
                    {Object.keys(cycleTrackFilters).length > 0 ? (
                        <button
                            type="button"
                            onClick={onClearPlanningFilters}
                            className="rounded-lg border border-neutral-200 px-3 py-2 text-[13px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
                        >
                            Clear planning filters
                        </button>
                    ) : null}
                    <a href={csvExportHref} className="rounded-lg border border-neutral-200 px-3 py-2 text-[13px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50">
                        Export CSV
                    </a>
                    <a href={jsonExportHref} className="rounded-lg border border-neutral-200 px-3 py-2 text-[13px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50">
                        Export JSON
                    </a>
                </div>
            </div>

            {(activeView === "list" || activeView === "my_work") && selectedTicketIds.length > 0 ? (
                <div className="flex flex-col gap-3 rounded-[12px] border border-primary-100 bg-primary-50/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <Text size="2" weight="bold" className="text-primary-800">
                            {selectedTicketIds.length} {selectedTicketIds.length === 1 ? "ticket" : "tickets"} selected
                        </Text>
                        <button
                            type="button"
                            onClick={onClearSelectedTickets}
                            className="rounded-lg border border-primary-200 px-2.5 py-1.5 text-[12px] font-medium text-primary-700 transition hover:bg-white"
                        >
                            Clear
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <select value={bulkStatus} onChange={(event) => onBulkStatusChange(event.target.value)} className="h-10 rounded-lg border border-primary-200 bg-white px-3 text-[14px] text-neutral-900 outline-none">
                            <option value={BULK_NO_CHANGE}>Status: keep current</option>
                            {STATUS_OPTIONS.filter((option) => option.value !== "").map((option) => (
                                <option key={option.value} value={option.value}>
                                    Status: {option.label}
                                </option>
                            ))}
                        </select>
                        <select value={bulkPriority} onChange={(event) => onBulkPriorityChange(event.target.value)} className="h-10 rounded-lg border border-primary-200 bg-white px-3 text-[14px] text-neutral-900 outline-none">
                            <option value={BULK_NO_CHANGE}>Priority: keep current</option>
                            <option value="none">Priority: None</option>
                            <option value="low">Priority: Low</option>
                            <option value="medium">Priority: Medium</option>
                            <option value="high">Priority: High</option>
                            <option value="urgent">Priority: Urgent</option>
                        </select>
                        <select value={bulkAssigneeUserId} onChange={(event) => onBulkAssigneeUserIdChange(event.target.value)} className="h-10 rounded-lg border border-primary-200 bg-white px-3 text-[14px] text-neutral-900 outline-none">
                            <option value={BULK_NO_CHANGE}>Assignee: keep current</option>
                            <option value={BULK_UNASSIGNED}>Assignee: Unassigned</option>
                            {spaceUsers.map((member) => (
                                <option key={member.id} value={member.id}>
                                    Assignee: {member.name || member.email}
                                </option>
                            ))}
                        </select>
                        <Button onClick={onBulkApply} disabled={bulkSubmitting || !canEditTickets} loading={bulkSubmitting}>
                            Apply
                        </Button>
                    </div>
                    {bulkError ? (
                        <Text size="2" color="red">
                            {bulkError}
                        </Text>
                    ) : null}
                </div>
            ) : null}

            {actionError ? (
                <Text size="2" color="red">
                    {actionError}
                </Text>
            ) : null}
        </div>
    );
}

export function ProjectPageAside({
    activeView,
    projectKey,
    selectedCycle,
    cycleErrors,
    selectedTicketId,
    loadingTicketDetail,
    ticketDetail,
    ticketDetailSharedProps,
    onOpenTicketPage,
    onCloseTicket,
    onChildTicketClick,
}: {
    activeView: ProjectViewMode;
    projectKey: string;
    selectedCycle: ProjectCycleSummary | null;
    cycleErrors: MessageLike;
    selectedTicketId: string | null;
    loadingTicketDetail: boolean;
    ticketDetail: TicketRow | undefined;
    ticketDetailSharedProps: TicketDetailSharedProps | null;
    onOpenTicketPage: (ticketId: string) => void;
    onCloseTicket: () => void;
    onChildTicketClick: (ticketId: string) => void;
}) {
    return (
        <aside className="rounded-[18px] border border-neutral-200 bg-white p-4 shadow-[0_14px_28px_rgba(11,10,42,0.06)] xl:sticky xl:top-4 xl:self-start">
            {activeView === "cycles" ? (
                <ProjectCyclesInspector projectKey={projectKey} selectedCycle={selectedCycle} cycleErrors={cycleErrors} />
            ) : selectedTicketId ? (
                loadingTicketDetail && !ticketDetail ? (
                    <Flex align="center" justify="center" className="min-h-[320px]">
                        <Spinner size="2" />
                    </Flex>
                ) : ticketDetail && ticketDetailSharedProps ? (
                    <ProjectTicketInlineInspector
                        {...ticketDetailSharedProps}
                        onOpenPage={() => onOpenTicketPage(ticketDetail.id)}
                        onClose={onCloseTicket}
                        onChildTicketClick={onChildTicketClick}
                    />
                ) : (
                    <div className="rounded-[14px] border border-dashed border-neutral-200 px-4 py-10 text-center text-[14px] text-neutral-500">
                        Select a ticket to inspect and update it in place.
                    </div>
                )
            ) : (
                <div className="rounded-[14px] border border-dashed border-neutral-200 px-4 py-10 text-center text-[14px] text-neutral-500">
                    Select a ticket from the list or board to open a direct-edit detail view.
                </div>
            )}
        </aside>
    );
}
