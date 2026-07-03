"use client";

import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { Badge, Button, Spinner, Text } from "@radix-ui/themes";
import {
    BoardColumn,
    GroupedBacklogSection,
    ProjectCycleSummary,
    ProjectCycleTrackSummary,
    TicketActivity,
    TicketListRow,
    TicketRow,
    cycleStateClass,
    formatActivityLabel,
    formatCycleDateRange,
    formatCycleTrackLabel,
    formatStatusLabel,
    formatTicketType,
    formatTimestamp,
    priorityColor,
    priorityLabel,
    statusPillClass,
} from "./model";
import { MessageLike, TicketCycleChips } from "./ProjectPageView.ticket-detail-shared";

export function ProjectCycleTrackSummaryGrid({
    cycleTracks,
    cycles,
    cycleTrackFilters,
    onCycleTrackFilterChange,
}: {
    cycleTracks: ProjectCycleTrackSummary[];
    cycles: ProjectCycleSummary[];
    cycleTrackFilters: Record<string, string>;
    onCycleTrackFilterChange: (trackId: string, cycleId: string) => void;
}) {
    if (cycleTracks.length === 0) return null;

    return (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cycleTracks.map((track) => {
                const trackLabel = formatCycleTrackLabel(track);
                const filteredCycleId = cycleTrackFilters[track.id] ?? "";
                const filteredCycle = filteredCycleId ? cycles.find((cycle) => cycle.id === filteredCycleId) : null;
                const displayCycle = filteredCycle ?? track.currentCycle ?? null;

                return (
                    <div key={track.id} className="rounded-[16px] border border-neutral-200 bg-white p-4 shadow-[0_10px_24px_rgba(11,10,42,0.04)]">
                        <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                                <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{trackLabel}</div>
                                <div className="text-[15px] font-semibold text-neutral-900">{displayCycle?.name ?? "No cycle selected"}</div>
                                <div className="text-[12px] text-neutral-500">
                                    {displayCycle ? formatCycleDateRange(displayCycle.startsAt, displayCycle.endsAt) : `${track.unplannedTicketCount} unplanned tickets`}
                                </div>
                            </div>
                            {track.currentCycle?.id ? (
                                <button
                                    type="button"
                                    onClick={() => onCycleTrackFilterChange(track.id, track.currentCycle!.id)}
                                    className="rounded-full border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
                                >
                                    Show current
                                </button>
                            ) : null}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-neutral-600">
                            <span>{track.unplannedTicketCount} unplanned</span>
                            {filteredCycle ? (
                                <button
                                    type="button"
                                    onClick={() => onCycleTrackFilterChange(track.id, "")}
                                    className="font-medium text-primary-700 transition hover:text-primary-800"
                                >
                                    Clear filter
                                </button>
                            ) : (
                                <span>{track.currentCycle ? formatStatusLabel(track.currentCycle.state) : "Backlog only"}</span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function ProjectActivitySummaryCard({ projectActivity }: { projectActivity: TicketActivity[] }) {
    if (projectActivity.length === 0) return null;

    return (
        <div className="rounded-[14px] border border-neutral-200 bg-white p-3 shadow-[0_10px_24px_rgba(11,10,42,0.04)]">
            <div className="mb-2 flex items-center justify-between gap-3">
                <Text size="2" weight="bold" className="text-neutral-900">
                    Recent project activity
                </Text>
                <span className="text-[12px] text-neutral-500">Auto-refreshing every 15s</span>
            </div>
            <div className="grid gap-2 lg:grid-cols-3">
                {projectActivity.slice(0, 6).map((entry) => (
                    <div key={entry.id} className="rounded-[12px] border border-neutral-200 px-3 py-2">
                        <div className="text-[13px] text-neutral-800">
                            <span className="font-semibold text-neutral-900">{entry.actorName}</span> {formatActivityLabel(entry)}
                        </div>
                        <div className="mt-1 text-[12px] text-neutral-500">
                            {entry.newValue ? `${entry.fieldName ? `${entry.fieldName.replace(/_/g, " ")}: ` : ""}${entry.newValue}` : formatTimestamp(entry.createdAt)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function ProjectBacklogTable({
    loadingTickets,
    hierarchicalRows,
    groupedBacklogSections,
    selectedGroupTrack,
    selectedTicketId,
    selectedTicketIds,
    expandedTicketIds,
    allVisibleSelected,
    onToggleSelectAll,
    onToggleTicketSelection,
    onSelectTicket,
    onToggleTicketExpansion,
    embedded = false,
}: {
    loadingTickets: boolean;
    hierarchicalRows: TicketListRow[];
    groupedBacklogSections: GroupedBacklogSection[];
    selectedGroupTrack: ProjectCycleTrackSummary | null;
    selectedTicketId: string | null;
    selectedTicketIds: string[];
    expandedTicketIds: Record<string, boolean>;
    allVisibleSelected: boolean;
    onToggleSelectAll: () => void;
    onToggleTicketSelection: (ticketId: string) => void;
    onSelectTicket: (ticketId: string) => void;
    onToggleTicketExpansion: (ticketId: string) => void;
    embedded?: boolean;
}) {
    function renderRows(rows: TicketListRow[]) {
        return rows.map(({ ticket, hasChildren }) => {
            const isSelected = selectedTicketId === ticket.id;
            const isChecked = selectedTicketIds.includes(ticket.id);
            const isExpanded = expandedTicketIds[ticket.id] ?? true;

            return (
                <div
                    key={ticket.id}
                    className={`grid grid-cols-[42px_minmax(0,1fr)_140px_90px_90px] gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0 ${
                        isSelected ? "bg-primary-50/60" : "bg-white hover:bg-neutral-50"
                    }`}
                >
                    <div className="flex items-center justify-center">
                        <input type="checkbox" checked={isChecked} onChange={() => onToggleTicketSelection(ticket.id)} className="h-4 w-4 rounded border-neutral-300" />
                    </div>
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectTicket(ticket.id)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onSelectTicket(ticket.id);
                            }
                        }}
                        className="min-w-0 cursor-pointer text-left"
                    >
                        <div className="flex items-start gap-2" style={{ paddingLeft: `${ticket.depth * 18}px` }}>
                            {hasChildren ? (
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onToggleTicketExpansion(ticket.id);
                                    }}
                                    className="mt-[1px] rounded px-1 text-[12px] text-neutral-500 transition hover:bg-neutral-100"
                                >
                                    {isExpanded ? "▾" : "▸"}
                                </button>
                            ) : (
                                <span className="mt-[3px] inline-block w-4 text-center text-[10px] text-neutral-300">•</span>
                            )}
                            <div className="min-w-0">
                                {ticket.parentIdentifier && ticket.parentTitle ? (
                                    <div className="mb-1 text-[11px] font-medium text-neutral-500">
                                        Under {ticket.parentIdentifier} {ticket.parentTitle}
                                    </div>
                                ) : null}
                                <div className="flex items-start gap-2">
                                    <span className="mt-[3px] text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{ticket.identifier}</span>
                                    <span className="min-w-0 text-[14px] font-semibold leading-5 text-neutral-900">{ticket.title}</span>
                                </div>
                                {ticket.childCount > 0 ? (
                                    <div className="mt-1 text-[11px] font-medium text-neutral-500">
                                        {ticket.childCount} children · {ticket.openChildCount} open · {ticket.doneChildCount} done
                                    </div>
                                ) : null}
                                <TicketCycleChips assignments={ticket.cycleAssignments} limit={2} />
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center">
                        <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${statusPillClass(ticket.status)}`}>{formatStatusLabel(ticket.status)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-neutral-700">
                        <span className={`h-2.5 w-2.5 rounded-full ${priorityColor(ticket.priority)}`} />
                        <span>{priorityLabel(ticket.priority)}</span>
                    </div>
                    <div className="flex items-center">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-[12px] font-semibold text-neutral-700">
                            {ticket.ownerInitials}
                        </div>
                    </div>
                </div>
            );
        });
    }

    return (
        <div className={embedded ? "overflow-hidden" : "overflow-hidden rounded-[16px] border border-neutral-200 bg-white shadow-[0_10px_24px_rgba(11,10,42,0.04)]"}>
            <div className="grid grid-cols-[42px_minmax(0,1fr)_140px_90px_90px] gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-3 text-[12px] font-semibold uppercase tracking-wide text-neutral-500">
                <label className="flex items-center justify-center">
                    <input type="checkbox" checked={allVisibleSelected} onChange={onToggleSelectAll} className="h-4 w-4 rounded border-neutral-300" />
                </label>
                <span>Ticket</span>
                <span>Status</span>
                <span>Priority</span>
                <span>Owner</span>
            </div>
            {loadingTickets ? (
                <div className="flex justify-center py-8">
                    <Spinner size="2" />
                </div>
            ) : selectedGroupTrack ? (
                groupedBacklogSections.length > 0 ? (
                    <Accordion.Root
                        key={`${selectedGroupTrack.id}:${groupedBacklogSections.map((section) => section.id).join(",")}`}
                        type="multiple"
                        defaultValue={groupedBacklogSections.map((section) => section.id)}
                        className="divide-y divide-neutral-100"
                    >
                        {groupedBacklogSections.map((section) => (
                            <Accordion.Item key={section.id} value={section.id} className="overflow-hidden">
                                <Accordion.Header>
                                    <Accordion.Trigger
                                        className={`group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-neutral-50 ${
                                            section.isUnassigned ? "bg-amber-50/70" : "bg-neutral-50/70"
                                        }`}
                                    >
                                        <div className="min-w-0">
                                            <div className="text-[13px] font-semibold text-neutral-900">{section.title}</div>
                                            <div className="text-[12px] text-neutral-500">{section.subtitle}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge color={section.isUnassigned ? "amber" : "gray"} variant="soft">
                                                {section.rows.length}
                                            </Badge>
                                            <ChevronDownIcon className="h-4 w-4 shrink-0 text-neutral-500 transition-transform group-data-[state=open]:rotate-180" />
                                        </div>
                                    </Accordion.Trigger>
                                </Accordion.Header>
                                <Accordion.Content>{renderRows(section.rows)}</Accordion.Content>
                            </Accordion.Item>
                        ))}
                    </Accordion.Root>
                ) : (
                    <div className="px-5 py-10 text-center text-[14px] text-neutral-500">No tickets matched the selected backlog grouping.</div>
                )
            ) : hierarchicalRows.length > 0 ? (
                renderRows(hierarchicalRows)
            ) : (
                <div className="px-5 py-10 text-center text-[14px] text-neutral-500">No tickets matched the current view.</div>
            )}
        </div>
    );
}

export function ProjectBoardView({
    boardColumns,
    canEditTickets,
    selectedTicketId,
    onDragStart,
    onDragEnd,
    onBoardDrop,
    onSelectTicket,
}: {
    boardColumns: BoardColumn[];
    canEditTickets: boolean;
    selectedTicketId: string | null;
    onDragStart: (ticketId: string) => void;
    onDragEnd: () => void;
    onBoardDrop: (status: string) => void;
    onSelectTicket: (ticketId: string) => void;
}) {
    return (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
            {boardColumns.map((column) => (
                <div
                    key={column.value}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => onBoardDrop(column.value)}
                    className="rounded-[16px] border border-neutral-200 bg-white p-3 shadow-[0_10px_24px_rgba(11,10,42,0.04)]"
                >
                    <div className="mb-3 flex items-center justify-between">
                        <Text size="2" weight="bold" className="text-neutral-800">
                            {column.label}
                        </Text>
                        <span className="rounded-full bg-neutral-100 px-2 py-1 text-[12px] font-medium text-neutral-600">{column.tickets.length}</span>
                    </div>
                    <div className="space-y-3">
                        {column.tickets.length > 0 ? (
                            column.tickets.map((ticket) => (
                                <button
                                    key={ticket.id}
                                    type="button"
                                    draggable={canEditTickets}
                                    onDragStart={() => onDragStart(ticket.id)}
                                    onDragEnd={onDragEnd}
                                    onClick={() => onSelectTicket(ticket.id)}
                                    className={`w-full rounded-[14px] border p-3 text-left transition hover:border-primary-300 hover:shadow-[0_8px_20px_rgba(11,10,42,0.06)] ${
                                        selectedTicketId === ticket.id ? "border-primary-300 bg-primary-50/60" : "border-neutral-200 bg-white"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{ticket.identifier}</span>
                                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                                                    {formatTicketType(ticket.type)}
                                                </span>
                                            </div>
                                            <div className="text-[14px] font-semibold leading-5 text-neutral-900">{ticket.title}</div>
                                            {ticket.parentIdentifier && ticket.parentTitle ? (
                                                <div className="text-[11px] font-medium text-neutral-500">
                                                    Under {ticket.parentIdentifier} {ticket.parentTitle}
                                                </div>
                                            ) : null}
                                            {ticket.childCount > 0 ? (
                                                <div className="text-[11px] font-medium text-neutral-500">
                                                    {ticket.childCount} children · {ticket.openChildCount} open · {ticket.doneChildCount} done
                                                </div>
                                            ) : null}
                                            <TicketCycleChips assignments={ticket.cycleAssignments} limit={2} />
                                        </div>
                                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-[12px] font-semibold text-neutral-700">
                                            {ticket.ownerInitials}
                                        </div>
                                    </div>
                                    <div className="mt-3 flex items-center gap-3 text-[12px] text-neutral-600">
                                        <span className={`h-2.5 w-2.5 rounded-full ${priorityColor(ticket.priority)}`} />
                                        <span>{priorityLabel(ticket.priority)}</span>
                                    </div>
                                </button>
                            ))
                        ) : (
                            <div className="rounded-[12px] border border-dashed border-neutral-200 px-3 py-5 text-center text-[13px] text-neutral-500">No tickets</div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

export function ProjectCyclesCanvas({
    canEditTickets,
    loadingCycles,
    cycleTracks,
    cyclesByTrack,
    cycleTrackFilters,
    tickets,
    totalResults,
    onCreateCycleClick,
    onCycleTrackFilterChange,
    onSelectCycle,
    onSelectTicket,
}: {
    canEditTickets: boolean;
    loadingCycles: boolean;
    cycleTracks: ProjectCycleTrackSummary[];
    cyclesByTrack: Record<string, ProjectCycleSummary[]>;
    cycleTrackFilters: Record<string, string>;
    tickets: TicketRow[];
    totalResults: number;
    onCreateCycleClick: () => void;
    onCycleTrackFilterChange: (trackId: string, cycleId: string) => void;
    onSelectCycle: (cycleId: string) => void;
    onSelectTicket: (ticketId: string) => void;
}) {
    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-[16px] border border-neutral-200 bg-white p-4 shadow-[0_10px_24px_rgba(11,10,42,0.04)] md:flex-row md:items-center md:justify-between">
                <div className="space-y-1">
                    <Text size="3" weight="bold" className="text-neutral-900">
                        Planning tracks
                    </Text>
                    <Text size="2" className="text-neutral-500">
                        Cycle lanes show overlapping sprint, milestone, and quarter plans against the same project work.
                    </Text>
                </div>
                <Button disabled={!canEditTickets} onClick={onCreateCycleClick}>
                    Create cycle
                </Button>
            </div>

            {loadingCycles ? (
                <div className="flex justify-center rounded-[16px] border border-neutral-200 bg-white py-10 shadow-[0_10px_24px_rgba(11,10,42,0.04)]">
                    <Spinner size="2" />
                </div>
            ) : cycleTracks.length > 0 ? (
                cycleTracks.map((track) => {
                    const trackCycles = cyclesByTrack[track.id] ?? [];
                    const activeCycleId = cycleTrackFilters[track.id] ?? "";

                    return (
                        <div key={track.id} className="rounded-[16px] border border-neutral-200 bg-white p-4 shadow-[0_10px_24px_rgba(11,10,42,0.04)]">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="space-y-1">
                                    <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-neutral-400">{formatCycleTrackLabel(track)}</div>
                                    <div className="text-[14px] font-medium text-neutral-700">
                                        {track.currentCycle?.name ? `Current: ${track.currentCycle.name}` : "No current cycle"} · {track.unplannedTicketCount} unplanned tickets
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onCycleTrackFilterChange(track.id, "")}
                                    className="self-start rounded-full border border-neutral-200 px-3 py-1 text-[12px] font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
                                >
                                    Backlog
                                </button>
                            </div>
                            {trackCycles.length > 0 ? (
                                <div className="mt-4 overflow-x-auto pb-1">
                                    <div className="flex min-w-full gap-3">
                                        {trackCycles.map((cycle) => {
                                            const active = activeCycleId === cycle.id;

                                            return (
                                                <button
                                                    key={cycle.id}
                                                    type="button"
                                                    onClick={() => {
                                                        onSelectCycle(cycle.id);
                                                        onCycleTrackFilterChange(track.id, active ? "" : cycle.id);
                                                    }}
                                                    className={`min-w-[240px] rounded-[16px] border p-4 text-left transition ${
                                                        active ? "border-primary-300 bg-primary-50/70 shadow-[0_8px_18px_rgba(11,10,42,0.08)]" : "border-neutral-200 bg-white hover:border-primary-200"
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cycleStateClass(cycle.state)}`}>
                                                            {formatStatusLabel(cycle.state)}
                                                        </span>
                                                        <span className="text-[11px] font-medium text-neutral-500">{formatCycleDateRange(cycle.startsAt, cycle.endsAt)}</span>
                                                    </div>
                                                    <div className="mt-3 text-[15px] font-semibold text-neutral-900">{cycle.name}</div>
                                                    <div className="mt-1 text-[12px] leading-5 text-neutral-600">{cycle.goal || cycle.description || "No goal set yet."}</div>
                                                    <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-neutral-500">
                                                        <span>{cycle.summary?.ticketCount ?? 0} tickets</span>
                                                        <span>{cycle.summary?.openCount ?? 0} open</span>
                                                        <span>{cycle.summary?.doneCount ?? 0} done</span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-4 rounded-[12px] border border-dashed border-neutral-200 px-4 py-6 text-[13px] text-neutral-500">
                                    No cycles have been created for this track yet.
                                </div>
                            )}
                        </div>
                    );
                })
            ) : (
                <div className="rounded-[16px] border border-dashed border-neutral-200 px-5 py-10 text-center text-[14px] text-neutral-500">
                    No planning tracks are configured for this project.
                </div>
            )}

            <div className="rounded-[16px] border border-neutral-200 bg-white p-4 shadow-[0_10px_24px_rgba(11,10,42,0.04)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <Text size="2" weight="bold" className="text-neutral-900">
                        Tickets in current planning scope
                    </Text>
                    <span className="text-[12px] text-neutral-500">
                        {Object.keys(cycleTrackFilters).length > 0 ? `${totalResults} matching tickets` : "Select a cycle to focus tickets"}
                    </span>
                </div>
                {Object.keys(cycleTrackFilters).length === 0 ? (
                    <div className="rounded-[12px] border border-dashed border-neutral-200 px-4 py-8 text-[13px] text-neutral-500">
                        Pick a cycle from any track above to filter the project backlog down to that planning scope.
                    </div>
                ) : tickets.length > 0 ? (
                    <div className="space-y-2">
                        {tickets.slice(0, 8).map((ticket) => (
                            <button
                                key={ticket.id}
                                type="button"
                                onClick={() => onSelectTicket(ticket.id)}
                                className="block w-full rounded-[12px] border border-neutral-200 px-3 py-3 text-left transition hover:border-primary-300 hover:bg-primary-50/40"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{ticket.identifier}</span>
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusPillClass(ticket.status)}`}>{formatStatusLabel(ticket.status)}</span>
                                </div>
                                <div className="mt-1 text-[14px] font-semibold text-neutral-900">{ticket.title}</div>
                                <TicketCycleChips assignments={ticket.cycleAssignments} limit={3} />
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="rounded-[12px] border border-dashed border-neutral-200 px-4 py-8 text-[13px] text-neutral-500">
                        No tickets matched the selected cycle filters.
                    </div>
                )}
            </div>
        </div>
    );
}

export function ProjectCyclesInspector({
    projectKey,
    selectedCycle,
    cycleErrors,
}: {
    projectKey: string;
    selectedCycle: ProjectCycleSummary | null;
    cycleErrors: MessageLike;
}) {
    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <Badge color="violet" variant="soft">
                        {projectKey}
                    </Badge>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">Cycles</span>
                </div>
                <Text size="3" weight="bold" className="text-neutral-900">
                    {selectedCycle?.name ?? "Planning inspector"}
                </Text>
                <Text size="2" className="text-neutral-500">
                    {selectedCycle
                        ? "Review scope, track coverage, and the tickets currently attached to this planning bucket."
                        : "Select a cycle lane to inspect its schedule and ticket coverage."}
                </Text>
            </div>

            {selectedCycle ? (
                <>
                    <div className="space-y-3 rounded-[16px] border border-neutral-200 bg-neutral-50/70 p-3">
                        <div className="flex items-center justify-between gap-3">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cycleStateClass(selectedCycle.state)}`}>
                                {formatStatusLabel(selectedCycle.state)}
                            </span>
                            <span className="text-[12px] font-medium text-neutral-500">{formatCycleDateRange(selectedCycle.startsAt, selectedCycle.endsAt)}</span>
                        </div>
                        <div className="text-[14px] font-semibold text-neutral-900">
                            {selectedCycle.track ? formatCycleTrackLabel(selectedCycle.track) : "Cycle"}
                        </div>
                        <div className="text-[13px] leading-6 text-neutral-600">
                            {selectedCycle.goal || selectedCycle.description || "No goal or description has been added to this cycle yet."}
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                        <div className="rounded-[14px] bg-neutral-50 px-3 py-3">
                            <div className="text-[12px] font-medium text-neutral-500">Tickets</div>
                            <div className="mt-1 text-[18px] font-semibold text-neutral-900">{selectedCycle.summary?.ticketCount ?? 0}</div>
                        </div>
                        <div className="rounded-[14px] bg-neutral-50 px-3 py-3">
                            <div className="text-[12px] font-medium text-neutral-500">Open</div>
                            <div className="mt-1 text-[18px] font-semibold text-neutral-900">{selectedCycle.summary?.openCount ?? 0}</div>
                        </div>
                        <div className="rounded-[14px] bg-neutral-50 px-3 py-3">
                            <div className="text-[12px] font-medium text-neutral-500">Done</div>
                            <div className="mt-1 text-[18px] font-semibold text-neutral-900">{selectedCycle.summary?.doneCount ?? 0}</div>
                        </div>
                    </div>

                    {selectedCycle.track ? (
                        <div className="rounded-[16px] border border-neutral-200 bg-white p-3">
                            <div className="mb-2 text-[12px] font-medium text-neutral-500">Track overview</div>
                            <div className="text-[13px] text-neutral-800">
                                {formatCycleTrackLabel(selectedCycle.track)} cycles overlap with other planning tracks. Use the main canvas to compare schedule windows and switch scope.
                            </div>
                        </div>
                    ) : null}
                </>
            ) : (
                <div className="rounded-[14px] border border-dashed border-neutral-200 px-4 py-10 text-center text-[14px] text-neutral-500">
                    Choose a cycle to inspect its schedule and ticket counts.
                </div>
            )}

            {cycleErrors ? (
                <Text size="2" color="red">
                    Unable to load the full cycle list right now.
                </Text>
            ) : null}
        </div>
    );
}
