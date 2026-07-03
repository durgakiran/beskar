"use client";

import { getApiV1Base } from "@http";
import { Response, useDelete, useGet, usePost, usePut } from "@http/hooks";
import ToastComponent from "@components/ui/ToastComponent";
import { Flex, Separator, Spinner, Text } from "@radix-ui/themes";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOptionalSpacePagesRefresh } from "../../space/[spaceId]/SpaceAddPageContext";
import {
    BOARD_STATUSES,
    BULK_NO_CHANGE,
    BULK_UNASSIGNED,
    BulkUpdateResponse,
    CreateCyclePayload,
    CreateTicketPayload,
    ProjectActivityListResponse,
    ProjectCycleSummary,
    ProjectCycleTrackSummary,
    ProjectViewData,
    ProjectViewMode,
    SpaceMember,
    TicketActivity,
    TicketListResponse,
    TicketListRow,
    TicketRow,
    UpdateTicketPayload,
    buildCreateTicketHref,
    buildExportHref,
    buildTicketQuery,
    flattenHierarchy,
    formatCycleDateRange,
    formatCycleTrackLabel,
    mergeUniqueActivity,
    parseSortParam,
    parseViewParam,
    readCycleTrackFilters,
    readGroupByTrackParam,
} from "./project-page-view/model";
import { ProjectCreateCycleDialog, ProjectDeleteDialog } from "./project-page-view/ProjectPageView.dialogs";
import { ProjectTicketPageContent } from "./project-page-view/ProjectPageView.ticket-detail";
import { ProjectPageAside, ProjectPageHero, ProjectPageToolbar } from "./project-page-view/ProjectPageView.shell";
import { useProjectTicketDetailController } from "./project-page-view/useProjectTicketDetailController";
import {
    ProjectBacklogTable,
    ProjectBoardView,
    ProjectCyclesCanvas,
} from "./project-page-view/ProjectPageView.views";

export default function ProjectPageView({
    spaceId,
    pageId,
    initialTicketId = null,
    detailMode = "drawer",
}: {
    spaceId: string;
    pageId: string;
    initialTicketId?: string | null;
    detailMode?: "drawer" | "page";
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const refreshSpacePages = useOptionalSpacePagesRefresh();
    const [search, setSearch] = useState(searchParams?.get("search") ?? "");
    const [statusFilter, setStatusFilter] = useState(searchParams?.get("status") ?? "");
    const [typeFilter, setTypeFilter] = useState(searchParams?.get("type") ?? "");
    const [sort, setSort] = useState(parseSortParam(searchParams?.get("sort")));
    const [activeView, setActiveView] = useState<ProjectViewMode>(parseViewParam(searchParams?.get("view")));
    const [assigneeFilter, setAssigneeFilter] = useState(searchParams?.get("assignee") ?? "");
    const [labelFilter, setLabelFilter] = useState(searchParams?.get("label") ?? "");
    const [parentFilter, setParentFilter] = useState(searchParams?.get("parent") ?? "");
    const [rootFilter, setRootFilter] = useState(searchParams?.get("root") ?? "");
    const [leafOnlyFilter, setLeafOnlyFilter] = useState(searchParams?.get("leafOnly") === "true");
    const [cycleTrackFilters, setCycleTrackFilters] = useState<Record<string, string>>(() => readCycleTrackFilters(searchParams));
    const [groupByTrackId, setGroupByTrackId] = useState(() => readGroupByTrackParam(searchParams));
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [showCreateCycleDialog, setShowCreateCycleDialog] = useState(false);
    const [selectedTicketId, setSelectedTicketId] = useState<string | null>(initialTicketId);
    const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
    const [expandedTicketIds, setExpandedTicketIds] = useState<Record<string, boolean>>({});
    const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);

    const [draftCycleTrackId, setDraftCycleTrackId] = useState("");
    const [draftCycleName, setDraftCycleName] = useState("");
    const [draftCycleGoal, setDraftCycleGoal] = useState("");
    const [draftCycleDescription, setDraftCycleDescription] = useState("");
    const [draftCycleStartsAt, setDraftCycleStartsAt] = useState("");
    const [draftCycleEndsAt, setDraftCycleEndsAt] = useState("");
    const [draftCycleState, setDraftCycleState] = useState("planned");

    const [bulkStatus, setBulkStatus] = useState(BULK_NO_CHANGE);
    const [bulkPriority, setBulkPriority] = useState(BULK_NO_CHANGE);
    const [bulkAssigneeUserId, setBulkAssigneeUserId] = useState(BULK_NO_CHANGE);
    const [bulkSubmitting, setBulkSubmitting] = useState(false);
    const [bulkError, setBulkError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [draggingTicketId, setDraggingTicketId] = useState<string | null>(null);
    const [projectActivity, setProjectActivity] = useState<TicketActivity[]>([]);
    const [projectActivityCursor, setProjectActivityCursor] = useState<string | null>(null);

    const [{ isLoading: loadingProject, data: projectData, errors: projectErrors }, fetchProject] = useGet<Response<ProjectViewData>>(`project/space/${spaceId}/page/${pageId}`);
    const [{ data: spaceUsersData }, fetchSpaceUsers] = useGet<Response<SpaceMember[]>>(`space/${spaceId}/users`);
    const [{ isLoading: loadingTickets, data: ticketsData, errors: ticketErrors }, fetchTickets] = useGet<Response<TicketListResponse>>(`project/space/${spaceId}/page/${pageId}/tickets`);
    const [{ data: cycleTracksData }, fetchCycleTracks] = useGet<Response<{ tracks: ProjectCycleTrackSummary[] }>>(`project/space/${spaceId}/page/${pageId}/cycle-tracks`);
    const [{ isLoading: loadingCycles, data: cyclesData, errors: cycleErrors }, fetchCycles] = useGet<Response<{ cycles: ProjectCycleSummary[] }>>(`project/space/${spaceId}/page/${pageId}/cycles`);
    const [{ isLoading: creatingCycle, data: createdCycleData, errors: createCycleError }, createCycle] = usePost<Response<ProjectCycleSummary>, CreateCyclePayload>(
        `project/space/${spaceId}/page/${pageId}/cycles`,
    );
    const [{ isLoading: loadingDelete, data: deleteData, errors: deleteErrors }, deleteProjectRequest] = useDelete<{ rowsAffected: number }, null>(
        `editor/space/${spaceId}/page/${pageId}/delete`,
    );

    const selectedTicketPath = selectedTicketId ? `project/space/${spaceId}/page/${pageId}/tickets/${selectedTicketId}` : `project/space/${spaceId}/page/${pageId}/tickets/pending`;
    const [{ isLoading: loadingTicketDetail, data: ticketDetailData, errors: ticketDetailError }, fetchTicketDetail] = useGet<Response<TicketRow>>(selectedTicketPath);
    const [{ isLoading: updatingTicket, data: updatedTicketData, errors: updateTicketError }, updateTicket] = usePut<Response<TicketRow>, UpdateTicketPayload>(selectedTicketPath);
    const fetchProjectActivity = useCallback(
        async (after?: string | null) => {
            const params = new URLSearchParams();
            params.set("limit", "12");
            if (after) params.set("after", after);

            const response = await fetch(`${getApiV1Base()}/project/space/${spaceId}/page/${pageId}/activity?${params.toString()}`, {
                credentials: "include",
            });
            if (!response.ok) return null;
            const payload = (await response.json()) as Response<ProjectActivityListResponse>;
            return payload.data ?? null;
        },
        [pageId, spaceId],
    );

    useEffect(() => {
        fetchProject();
        fetchSpaceUsers();
        fetchCycleTracks();
        fetchCycles();
    }, [fetchCycleTracks, fetchCycles, fetchProject, fetchSpaceUsers]);

    useEffect(() => {
        fetchTickets(
            buildTicketQuery(search, statusFilter, typeFilter, activeView, sort, {
                assignee: assigneeFilter,
                label: labelFilter,
                parent: parentFilter,
                root: rootFilter,
                leafOnly: leafOnlyFilter,
            }, cycleTrackFilters),
        );
    }, [activeView, assigneeFilter, cycleTrackFilters, fetchTickets, labelFilter, leafOnlyFilter, parentFilter, rootFilter, search, sort, statusFilter, typeFilter]);

    useEffect(() => {
        setSearch(searchParams?.get("search") ?? "");
        setStatusFilter(searchParams?.get("status") ?? "");
        setTypeFilter(searchParams?.get("type") ?? "");
        setSort(parseSortParam(searchParams?.get("sort")));
        setActiveView(parseViewParam(searchParams?.get("view")));
        setAssigneeFilter(searchParams?.get("assignee") ?? "");
        setLabelFilter(searchParams?.get("label") ?? "");
        setParentFilter(searchParams?.get("parent") ?? "");
        setRootFilter(searchParams?.get("root") ?? "");
        setLeafOnlyFilter(searchParams?.get("leafOnly") === "true");
        setCycleTrackFilters(readCycleTrackFilters(searchParams));
        setGroupByTrackId(readGroupByTrackParam(searchParams));
    }, [searchParams]);

    useEffect(() => {
        if (!searchParams?.get("view")) {
            if (projectData?.data?.defaultView === "board") setActiveView("board");
            if (projectData?.data?.defaultView === "cycles") setActiveView("cycles");
        }
    }, [projectData?.data?.defaultView, searchParams]);

    useEffect(() => {
        setSelectedTicketId(initialTicketId);
    }, [initialTicketId]);

    useEffect(() => {
        if (deleteData) {
            refreshSpacePages?.();
            router.push(`/space/${spaceId}`);
        }
    }, [deleteData, refreshSpacePages, router, spaceId]);

    useEffect(() => {
        if (selectedTicketId) {
            fetchTicketDetail();
        }
    }, [fetchTicketDetail, selectedTicketId]);

    useEffect(() => {
        const createdCycle = createdCycleData?.data;
        if (!createdCycle) return;
        setShowCreateCycleDialog(false);
        setSelectedCycleId(createdCycle.id);
        setDraftCycleName("");
        setDraftCycleGoal("");
        setDraftCycleDescription("");
        setDraftCycleStartsAt("");
        setDraftCycleEndsAt("");
        setDraftCycleState("planned");
        fetchProject();
        fetchCycleTracks();
        fetchCycles();
    }, [createdCycleData, fetchCycleTracks, fetchCycles, fetchProject]);

    useEffect(() => {
        if (!updatedTicketData?.data?.id) return;
        fetchProject();
        fetchTickets(
            buildTicketQuery(search, statusFilter, typeFilter, activeView, sort, {
                assignee: assigneeFilter,
                label: labelFilter,
                parent: parentFilter,
                root: rootFilter,
                leafOnly: leafOnlyFilter,
            }, cycleTrackFilters),
        );
        fetchTicketDetail();
        fetchCycleTracks();
        fetchCycles();
    }, [activeView, assigneeFilter, cycleTrackFilters, fetchCycleTracks, fetchCycles, fetchProject, fetchTicketDetail, fetchTickets, labelFilter, leafOnlyFilter, parentFilter, rootFilter, search, sort, statusFilter, typeFilter, updatedTicketData]);

    const project = projectData?.data;
    const spaceUsers = useMemo(() => spaceUsersData?.data ?? [], [spaceUsersData]);
    const cycleTracks = useMemo(() => cycleTracksData?.data?.tracks ?? project?.cycleTracks ?? [], [cycleTracksData?.data?.tracks, project?.cycleTracks]);
    const cycles = useMemo(() => cyclesData?.data?.cycles ?? [], [cyclesData?.data?.cycles]);
    const cyclesByTrack = useMemo(() => {
        const next: Record<string, ProjectCycleSummary[]> = {};
        for (const cycle of cycles) {
            next[cycle.trackId] = next[cycle.trackId] ?? [];
            next[cycle.trackId].push(cycle);
        }
        for (const values of Object.values(next)) {
            values.sort((left, right) => {
                if (left.position !== right.position) return left.position - right.position;
                const leftEnds = left.endsAt ? new Date(left.endsAt).getTime() : Number.MAX_SAFE_INTEGER;
                const rightEnds = right.endsAt ? new Date(right.endsAt).getTime() : Number.MAX_SAFE_INTEGER;
                return leftEnds - rightEnds;
            });
        }
        return next;
    }, [cycles]);
    const selectedCycle = useMemo(() => {
        if (selectedCycleId) {
            return cycles.find((cycle) => cycle.id === selectedCycleId) ?? null;
        }
        for (const cycleId of Object.values(cycleTrackFilters)) {
            const match = cycles.find((cycle) => cycle.id === cycleId);
            if (match) return match;
        }
        return null;
    }, [cycleTrackFilters, cycles, selectedCycleId]);
    const fetchedTickets = useMemo(() => ticketsData?.data?.tickets ?? [], [ticketsData]);
    const [tickets, setTickets] = useState<TicketRow[]>([]);
    const ticketDetail = ticketDetailData?.data;
    const isArchived = Boolean(project?.space?.archivedAt);
    const canEditTickets = Boolean(project?.capabilities.canEdit) && !isArchived;
    const isLoading = loadingProject || loadingTickets;
    const hasError = projectErrors || ticketErrors;
    const queryState = useMemo(
        () =>
            buildTicketQuery(search, statusFilter, typeFilter, activeView, sort, {
                assignee: assigneeFilter,
                label: labelFilter,
                parent: parentFilter,
                root: rootFilter,
                leafOnly: leafOnlyFilter,
            }, cycleTrackFilters),
        [activeView, assigneeFilter, cycleTrackFilters, labelFilter, leafOnlyFilter, parentFilter, rootFilter, search, sort, statusFilter, typeFilter],
    );
    const csvExportHref = buildExportHref(spaceId, pageId, "csv", queryState);
    const jsonExportHref = buildExportHref(spaceId, pageId, "json", queryState);

    useEffect(() => {
        setTickets((current) => {
            const isSameSnapshot =
                current.length === fetchedTickets.length &&
                current.every((ticket, index) => {
                    const nextTicket = fetchedTickets[index];
                    return (
                        nextTicket &&
                        ticket.id === nextTicket.id &&
                        ticket.status === nextTicket.status &&
                        ticket.priority === nextTicket.priority &&
                        ticket.updatedAt === nextTicket.updatedAt &&
                        ticket.parentTicketId === nextTicket.parentTicketId
                    );
                });
            return isSameSnapshot ? current : fetchedTickets;
        });
    }, [fetchedTickets]);

    useEffect(() => {
        const visibleIds = new Set(tickets.map((ticket) => ticket.id));
        setSelectedTicketIds((current) => current.filter((ticketId) => visibleIds.has(ticketId)));
    }, [tickets]);

    useEffect(() => {
        if (activeView === "list") {
            setProjectActivity([]);
            setProjectActivityCursor(null);
            return;
        }

        let isActive = true;

        fetchProjectActivity(null)
            .then((activity) => {
                if (!isActive || !activity) return;
                setProjectActivity(activity.activity ?? []);
                setProjectActivityCursor(activity.latestAt ?? activity.activity?.[0]?.createdAt ?? null);
            })
            .catch(() => undefined);

        return () => {
            isActive = false;
        };
    }, [activeView, fetchProjectActivity]);

    useEffect(() => {
        if (activeView === "list") return;

        const intervalId = window.setInterval(() => {
            if (document.visibilityState === "hidden") return;

            fetchProjectActivity(projectActivityCursor)
                .then((activity) => {
                    if (!activity || (activity.activity ?? []).length === 0) return;
                    setProjectActivity((current) => mergeUniqueActivity(current, activity.activity).slice(0, 12));
                    setProjectActivityCursor(activity.latestAt ?? activity.activity[0]?.createdAt ?? projectActivityCursor);
                    fetchProject();
                    fetchTickets(queryState);
                    if (selectedTicketId) {
                        fetchTicketDetail();
                    }
                })
                .catch(() => undefined);
        }, 15000);

        return () => window.clearInterval(intervalId);
    }, [activeView, fetchProject, fetchProjectActivity, fetchTicketDetail, fetchTickets, projectActivityCursor, queryState, selectedTicketId]);

    const subtitle = useMemo(() => {
        if (!project) return "";
        if (project.description?.trim()) return project.description;
        return "Track project work with a compact ticket list, direct ticket updates, and lightweight discussion on the page.";
    }, [project]);

    const hierarchicalRows = useMemo(() => flattenHierarchy(tickets, expandedTicketIds), [expandedTicketIds, tickets]);
    const groupedTicketRows = useMemo(() => {
        const orderedTickets = [...tickets].sort((left, right) => left.sequenceNo - right.sequenceNo);
        return orderedTickets.map((ticket) => ({
            ticket,
            hasChildren: orderedTickets.some((candidate) => candidate.parentTicketId === ticket.id),
        }));
    }, [tickets]);
    const boardColumns = useMemo(() => {
        const visibleStatuses = BOARD_STATUSES.filter((column) => column.value !== "canceled" || tickets.some((ticket) => ticket.status === "canceled"));
        return visibleStatuses.map((column) => ({
            ...column,
            tickets: tickets.filter((ticket) => ticket.status === column.value),
        }));
    }, [tickets]);
    const selectedGroupTrack = useMemo(() => cycleTracks.find((track) => track.id === groupByTrackId) ?? null, [cycleTracks, groupByTrackId]);
    const groupedBacklogSections = useMemo(() => {
        if (!selectedGroupTrack) return [];

        const rowsBySection = new Map<string, TicketListRow[]>();
        const cycleIndex = new Map<string, ProjectCycleSummary>();
        for (const cycle of cyclesByTrack[selectedGroupTrack.id] ?? []) {
            cycleIndex.set(cycle.id, cycle);
            rowsBySection.set(cycle.id, []);
        }
        rowsBySection.set("unassigned", []);

        for (const row of groupedTicketRows) {
            const assignment = (row.ticket.cycleAssignments ?? []).find((item) => item.track.id === selectedGroupTrack.id);
            const sectionId = assignment?.cycle.id ?? "unassigned";
            const currentRows = rowsBySection.get(sectionId) ?? [];
            currentRows.push(row);
            rowsBySection.set(sectionId, currentRows);
        }

        const sections: Array<{
            id: string;
            title: string;
            subtitle: string;
            rows: TicketListRow[];
            isUnassigned: boolean;
        }> = [];

        for (const cycle of cyclesByTrack[selectedGroupTrack.id] ?? []) {
            const rows = rowsBySection.get(cycle.id) ?? [];
            if (rows.length === 0) continue;
            sections.push({
                id: cycle.id,
                title: cycle.name,
                subtitle: `${formatCycleDateRange(cycle.startsAt, cycle.endsAt)} · ${rows.length} ${rows.length === 1 ? "ticket" : "tickets"}`,
                rows,
                isUnassigned: false,
            });
        }

        const unassignedRows = rowsBySection.get("unassigned") ?? [];
        if (unassignedRows.length > 0) {
            sections.push({
                id: "unassigned",
                title: `Unassigned ${formatCycleTrackLabel(selectedGroupTrack)}`,
                subtitle: `${unassignedRows.length} ${unassignedRows.length === 1 ? "ticket" : "tickets"} without ${formatCycleTrackLabel(selectedGroupTrack).toLowerCase()} assignment`,
                rows: unassignedRows,
                isUnassigned: true,
            });
        }

        return sections;
    }, [cyclesByTrack, groupedTicketRows, selectedGroupTrack]);

    useEffect(() => {
        if (!draftCycleTrackId && cycleTracks.length > 0) {
            setDraftCycleTrackId(cycleTracks[0].id);
        }
    }, [cycleTracks, draftCycleTrackId]);

    useEffect(() => {
        if (!groupByTrackId) return;
        if (cycleTracks.some((track) => track.id === groupByTrackId)) return;
        setGroupByTrackId("");
        updateViewQuery({ groupByTrack: "" });
    }, [cycleTracks, groupByTrackId]);

    useEffect(() => {
        if (selectedCycleId) return;
        const filteredCycleId = Object.values(cycleTrackFilters)[0];
        if (filteredCycleId) {
            setSelectedCycleId(filteredCycleId);
            return;
        }
        const currentCycle = cycleTracks.find((track) => track.currentCycle?.id)?.currentCycle;
        if (currentCycle?.id) {
            setSelectedCycleId(currentCycle.id);
            return;
        }
        if (cycles[0]?.id) {
            setSelectedCycleId(cycles[0].id);
        }
    }, [cycleTrackFilters, cycleTracks, cycles, selectedCycleId]);

    function updateViewQuery(
        next: Partial<{
            search: string;
            status: string;
            type: string;
            sort: string;
            view: ProjectViewMode;
            assignee: string;
            label: string;
            parent: string;
            root: string;
            leafOnly: boolean;
            cycleTrackFilters: Record<string, string>;
            groupByTrack: string;
        }>,
    ) {
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        const nextSearch = next.search ?? search;
        const nextStatus = next.status ?? statusFilter;
        const nextType = next.type ?? typeFilter;
        const nextSort = next.sort ?? sort;
        const nextView = next.view ?? activeView;
        const nextAssignee = next.assignee ?? assigneeFilter;
        const nextLabel = next.label ?? labelFilter;
        const nextParent = next.parent ?? parentFilter;
        const nextRoot = next.root ?? rootFilter;
        const nextLeafOnly = next.leafOnly ?? leafOnlyFilter;
        const nextCycleTrackFilters = next.cycleTrackFilters ?? cycleTrackFilters;
        const nextGroupByTrack = next.groupByTrack ?? groupByTrackId;

        if (nextSearch.trim()) params.set("search", nextSearch.trim());
        else params.delete("search");
        if (nextStatus) params.set("status", nextStatus);
        else params.delete("status");
        if (nextType) params.set("type", nextType);
        else params.delete("type");
        if (nextSort && nextSort !== "rank_asc") params.set("sort", nextSort);
        else params.delete("sort");
        if (nextView !== "list") params.set("view", nextView);
        else params.delete("view");
        if (nextAssignee) params.set("assignee", nextAssignee);
        else params.delete("assignee");
        if (nextLabel.trim()) params.set("label", nextLabel.trim());
        else params.delete("label");
        if (nextParent) params.set("parent", nextParent);
        else params.delete("parent");
        if (nextRoot) params.set("root", nextRoot);
        else params.delete("root");
        if (nextLeafOnly) params.set("leafOnly", "true");
        else params.delete("leafOnly");
        if (nextGroupByTrack) params.set("groupByTrack", nextGroupByTrack);
        else params.delete("groupByTrack");
        for (const key of Array.from(params.keys())) {
            if (key.startsWith("cycleTrack_")) params.delete(key);
        }
        for (const [trackId, cycleId] of Object.entries(nextCycleTrackFilters)) {
            if (!cycleId) continue;
            params.set(`cycleTrack_${trackId}`, cycleId);
        }

        const nextQuery = params.toString();
        router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }

    function memberForId(userId: string) {
        return spaceUsers.find((member) => member.id === userId);
    }

    function openTicketDetailPage(ticketId: string) {
        const suffix = searchParams?.toString() ? `?${searchParams.toString()}` : "";
        router.push(`/space/${spaceId}/view/${pageId}/tickets/${ticketId}${suffix}`);
    }

    function openCreatePage(prefill?: Partial<CreateTicketPayload>) {
        const returnSearch = searchParams?.toString();
        const returnTo = returnSearch ? `${pathname}?${returnSearch}` : pathname;
        router.push(buildCreateTicketHref(spaceId, pageId, returnTo, prefill));
    }

    function confirmDeleteProject() {
        setShowDeleteDialog(false);
        deleteProjectRequest(null);
    }

    async function updateTicketById(ticketId: string, payload: UpdateTicketPayload) {
        const response = await fetch(`${getApiV1Base()}/project/space/${spaceId}/page/${pageId}/tickets/${ticketId}`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error?.detail || body?.error?.message || `Request failed with status ${response.status}`);
        }
        return (await response.json()) as Response<TicketRow>;
    }

    function handleCycleTrackFilterChange(trackId: string, nextCycleId: string) {
        const nextFilters = { ...cycleTrackFilters };
        if (nextCycleId) nextFilters[trackId] = nextCycleId;
        else delete nextFilters[trackId];
        setCycleTrackFilters(nextFilters);
        if (nextCycleId) setSelectedCycleId(nextCycleId);
        updateViewQuery({ cycleTrackFilters: nextFilters });
    }

    function handleCreateCycle() {
        if (!draftCycleTrackId || !draftCycleName.trim() || !draftCycleEndsAt) return;
        createCycle({
            trackId: draftCycleTrackId,
            name: draftCycleName.trim(),
            goal: draftCycleGoal.trim(),
            description: draftCycleDescription.trim(),
            state: draftCycleState,
            startsAt: draftCycleStartsAt || undefined,
            endsAt: draftCycleEndsAt,
        });
    }

    function toggleTicketSelection(ticketId: string) {
        setSelectedTicketIds((current) => (current.includes(ticketId) ? current.filter((id) => id !== ticketId) : [...current, ticketId]));
    }

    function toggleSelectAllVisible() {
        const visibleIds = hierarchicalRows.map((row) => row.ticket.id);
        const allSelected = visibleIds.length > 0 && visibleIds.every((ticketId) => selectedTicketIds.includes(ticketId));
        setSelectedTicketIds(allSelected ? [] : visibleIds);
    }

    function toggleTicketExpansion(ticketId: string) {
        setExpandedTicketIds((current) => ({ ...current, [ticketId]: !(current[ticketId] ?? true) }));
    }

    async function handleBulkApply() {
        if (!canEditTickets || selectedTicketIds.length === 0) return;

        const payload: Record<string, unknown> = { ticketIds: selectedTicketIds };
        if (bulkStatus !== BULK_NO_CHANGE) payload.status = bulkStatus;
        if (bulkPriority !== BULK_NO_CHANGE) payload.priority = bulkPriority;
        if (bulkAssigneeUserId !== BULK_NO_CHANGE) {
            payload.assigneeUserId = bulkAssigneeUserId === BULK_UNASSIGNED ? "" : bulkAssigneeUserId;
            if (bulkAssigneeUserId !== BULK_UNASSIGNED) {
                payload.assigneeName = memberForId(bulkAssigneeUserId)?.name;
            }
        }
        if (Object.keys(payload).length === 1) return;

        setBulkSubmitting(true);
        setBulkError(null);
        try {
            const response = await fetch(`${getApiV1Base()}/project/space/${spaceId}/page/${pageId}/tickets/bulk-update`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error?.detail || body?.error?.message || `Request failed with status ${response.status}`);
            }
            const result = (await response.json()) as Response<BulkUpdateResponse>;
            if ((result.data?.failed ?? []).length > 0) {
                throw new Error(result.data!.failed.map((entry) => entry.message).join("; "));
            }
            setSelectedTicketIds([]);
            setBulkStatus(BULK_NO_CHANGE);
            setBulkPriority(BULK_NO_CHANGE);
            setBulkAssigneeUserId(BULK_NO_CHANGE);
            fetchProject();
            fetchTickets(queryState);
            if (selectedTicketId && selectedTicketIds.includes(selectedTicketId)) {
                fetchTicketDetail();
            }
        } catch (error) {
            setBulkError(error instanceof Error ? error.message : "Unable to update tickets");
        } finally {
            setBulkSubmitting(false);
        }
    }

    async function handleBoardDrop(nextStatus: string) {
        if (!draggingTicketId || !canEditTickets) return;
        const movingTicket = tickets.find((ticket) => ticket.id === draggingTicketId);
        if (!movingTicket || movingTicket.status === nextStatus) {
            setDraggingTicketId(null);
            return;
        }

        const previousTickets = tickets;
        setActionError(null);
        setTickets((current) => current.map((ticket) => (ticket.id === draggingTicketId ? { ...ticket, status: nextStatus } : ticket)));
        try {
            await updateTicketById(draggingTicketId, { status: nextStatus });
            fetchProject();
            fetchTickets(queryState);
            if (selectedTicketId === draggingTicketId) {
                fetchTicketDetail();
            }
        } catch (error) {
            setTickets(previousTickets);
            setActionError(error instanceof Error ? error.message : "Unable to move ticket");
        } finally {
            setDraggingTicketId(null);
        }
    }
    const allVisibleSelected = hierarchicalRows.length > 0 && hierarchicalRows.every((row) => selectedTicketIds.includes(row.ticket.id));
    const isBacklogView = activeView === "list";
    const showAside = activeView !== "list" || selectedTicketId !== null;
    const { ticketDetailSharedProps } = useProjectTicketDetailController({
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
        onOpenCreatePage: openCreatePage,
    });

    if (isLoading && !project) {
        return (
            <Flex align="center" justify="center" className="h-full min-h-[420px]">
                <Spinner size="3" />
            </Flex>
        );
    }

    if (hasError || !project) {
        return (
            <Flex align="center" justify="center" className="min-h-[420px] px-6">
                <Text size="3" className="text-neutral-700">
                    Something went wrong while loading this project.
                </Text>
            </Flex>
        );
    }

    if (detailMode === "page") {
        if (!selectedTicketId) {
            return (
                <Flex align="center" justify="center" className="min-h-[420px] px-6">
                    <Text size="3" className="text-neutral-700">
                        Select a ticket from the project to open its detail page.
                    </Text>
                </Flex>
            );
        }

        if (loadingTicketDetail && !ticketDetail) {
            return (
                <Flex align="center" justify="center" className="h-full min-h-[420px]">
                    <Spinner size="3" />
                </Flex>
            );
        }

        if (!ticketDetail || !ticketDetailSharedProps) {
            return (
                <div className="rounded-[14px] border border-dashed border-neutral-200 px-4 py-10 text-center text-[14px] text-neutral-500">
                    Something went wrong while loading this ticket.
                </div>
            );
        }

        return (
            <ProjectTicketPageContent
                {...ticketDetailSharedProps}
                projectKey={project.projectKey}
                projectTitle={project.title}
                onBackToProject={() => {
                    const suffix = searchParams?.toString() ? `?${searchParams.toString()}` : "";
                    router.push(`/space/${spaceId}/view/${pageId}${suffix}`);
                }}
                onChildTicketClick={openTicketDetailPage}
            />
        );
    }

    return (
        <div className="flex h-full flex-col overflow-y-auto bg-[var(--background)] px-4 py-6 md:px-6 md:py-7">
            <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-5">
                <ProjectPageHero
                    project={project}
                    isArchived={isArchived}
                    subtitle={subtitle}
                    activeView={activeView}
                    cycleTracks={cycleTracks}
                    cycles={cycles}
                    cycleTrackFilters={cycleTrackFilters}
                    projectActivity={projectActivity}
                    onDeleteProject={() => setShowDeleteDialog(true)}
                    onAddTicket={() => openCreatePage()}
                    onActiveViewChange={(view) => {
                        setActiveView(view);
                        updateViewQuery({ view });
                    }}
                    onCycleTrackFilterChange={handleCycleTrackFilterChange}
                />

                <div className={showAside ? "flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1fr)_400px]" : "flex flex-col gap-5"}>
                    <div className="space-y-4">
                        {isBacklogView ? (
                            <div className="overflow-hidden rounded-[16px] border border-neutral-200 bg-white shadow-[0_10px_24px_rgba(11,10,42,0.04)]">
                                <ProjectPageToolbar
                                    search={search}
                                    statusFilter={statusFilter}
                                    typeFilter={typeFilter}
                                    sort={sort}
                                    activeView={activeView}
                                    groupByTrackId={groupByTrackId}
                                    assigneeFilter={assigneeFilter}
                                    labelFilter={labelFilter}
                                    parentFilter={parentFilter}
                                    rootFilter={rootFilter}
                                    leafOnlyFilter={leafOnlyFilter}
                                    cycleTrackFilters={cycleTrackFilters}
                                    cycleTracks={cycleTracks}
                                    cyclesByTrack={cyclesByTrack}
                                    tickets={tickets}
                                    spaceUsers={spaceUsers}
                                    totalResults={ticketsData?.data?.total ?? 0}
                                    csvExportHref={csvExportHref}
                                    jsonExportHref={jsonExportHref}
                                    selectedTicketIds={selectedTicketIds}
                                    bulkStatus={bulkStatus}
                                    bulkPriority={bulkPriority}
                                    bulkAssigneeUserId={bulkAssigneeUserId}
                                    bulkSubmitting={bulkSubmitting}
                                    bulkError={bulkError}
                                    actionError={actionError}
                                    canEditTickets={canEditTickets}
                                    embedded={true}
                                    onSearchChange={(value) => {
                                        setSearch(value);
                                        updateViewQuery({ search: value });
                                    }}
                                    onStatusFilterChange={(value) => {
                                        setStatusFilter(value);
                                        updateViewQuery({ status: value });
                                    }}
                                    onTypeFilterChange={(value) => {
                                        setTypeFilter(value);
                                        updateViewQuery({ type: value });
                                    }}
                                    onSortChange={(value) => {
                                        setSort(value);
                                        updateViewQuery({ sort: value });
                                    }}
                                    onGroupByTrackChange={(value) => {
                                        setGroupByTrackId(value);
                                        updateViewQuery({ groupByTrack: value });
                                    }}
                                    onAssigneeFilterChange={(value) => {
                                        setAssigneeFilter(value);
                                        updateViewQuery({ assignee: value });
                                    }}
                                    onLabelFilterChange={(value) => {
                                        setLabelFilter(value);
                                        updateViewQuery({ label: value });
                                    }}
                                    onParentFilterChange={(value) => {
                                        setParentFilter(value);
                                        updateViewQuery({ parent: value });
                                    }}
                                    onRootFilterChange={(value) => {
                                        setRootFilter(value);
                                        updateViewQuery({ root: value });
                                    }}
                                    onLeafOnlyFilterChange={(value) => {
                                        setLeafOnlyFilter(value);
                                        updateViewQuery({ leafOnly: value });
                                    }}
                                    onCycleTrackFilterChange={handleCycleTrackFilterChange}
                                    onClearPlanningFilters={() => {
                                        setCycleTrackFilters({});
                                        updateViewQuery({ cycleTrackFilters: {} });
                                    }}
                                    onClearSelectedTickets={() => setSelectedTicketIds([])}
                                    onBulkStatusChange={setBulkStatus}
                                    onBulkPriorityChange={setBulkPriority}
                                    onBulkAssigneeUserIdChange={setBulkAssigneeUserId}
                                    onBulkApply={handleBulkApply}
                                />
                                <Separator size="4" />
                                <ProjectBacklogTable
                                    loadingTickets={loadingTickets}
                                    hierarchicalRows={hierarchicalRows}
                                    groupedBacklogSections={groupedBacklogSections}
                                    selectedGroupTrack={selectedGroupTrack}
                                    selectedTicketId={selectedTicketId}
                                    selectedTicketIds={selectedTicketIds}
                                    expandedTicketIds={expandedTicketIds}
                                    allVisibleSelected={allVisibleSelected}
                                    onToggleSelectAll={toggleSelectAllVisible}
                                    onToggleTicketSelection={toggleTicketSelection}
                                    onSelectTicket={setSelectedTicketId}
                                    onToggleTicketExpansion={toggleTicketExpansion}
                                    embedded={true}
                                />
                            </div>
                        ) : (
                            <ProjectPageToolbar
                                search={search}
                                statusFilter={statusFilter}
                                typeFilter={typeFilter}
                                sort={sort}
                                activeView={activeView}
                                groupByTrackId={groupByTrackId}
                                assigneeFilter={assigneeFilter}
                                labelFilter={labelFilter}
                                parentFilter={parentFilter}
                                rootFilter={rootFilter}
                                leafOnlyFilter={leafOnlyFilter}
                                cycleTrackFilters={cycleTrackFilters}
                                cycleTracks={cycleTracks}
                                cyclesByTrack={cyclesByTrack}
                                tickets={tickets}
                                spaceUsers={spaceUsers}
                                totalResults={ticketsData?.data?.total ?? 0}
                                csvExportHref={csvExportHref}
                                jsonExportHref={jsonExportHref}
                                selectedTicketIds={selectedTicketIds}
                                bulkStatus={bulkStatus}
                                bulkPriority={bulkPriority}
                                bulkAssigneeUserId={bulkAssigneeUserId}
                                bulkSubmitting={bulkSubmitting}
                                bulkError={bulkError}
                                actionError={actionError}
                                canEditTickets={canEditTickets}
                                onSearchChange={(value) => {
                                    setSearch(value);
                                    updateViewQuery({ search: value });
                                }}
                                onStatusFilterChange={(value) => {
                                    setStatusFilter(value);
                                    updateViewQuery({ status: value });
                                }}
                                onTypeFilterChange={(value) => {
                                    setTypeFilter(value);
                                    updateViewQuery({ type: value });
                                }}
                                onSortChange={(value) => {
                                    setSort(value);
                                    updateViewQuery({ sort: value });
                                }}
                                onGroupByTrackChange={(value) => {
                                    setGroupByTrackId(value);
                                    updateViewQuery({ groupByTrack: value });
                                }}
                                onAssigneeFilterChange={(value) => {
                                    setAssigneeFilter(value);
                                    updateViewQuery({ assignee: value });
                                }}
                                onLabelFilterChange={(value) => {
                                    setLabelFilter(value);
                                    updateViewQuery({ label: value });
                                }}
                                onParentFilterChange={(value) => {
                                    setParentFilter(value);
                                    updateViewQuery({ parent: value });
                                }}
                                onRootFilterChange={(value) => {
                                    setRootFilter(value);
                                    updateViewQuery({ root: value });
                                }}
                                onLeafOnlyFilterChange={(value) => {
                                    setLeafOnlyFilter(value);
                                    updateViewQuery({ leafOnly: value });
                                }}
                                onCycleTrackFilterChange={handleCycleTrackFilterChange}
                                onClearPlanningFilters={() => {
                                    setCycleTrackFilters({});
                                    updateViewQuery({ cycleTrackFilters: {} });
                                }}
                                onClearSelectedTickets={() => setSelectedTicketIds([])}
                                onBulkStatusChange={setBulkStatus}
                                onBulkPriorityChange={setBulkPriority}
                                onBulkAssigneeUserIdChange={setBulkAssigneeUserId}
                                onBulkApply={handleBulkApply}
                            />
                        )}

                        {activeView === "cycles" ? (
                            <ProjectCyclesCanvas
                                canEditTickets={canEditTickets}
                                loadingCycles={loadingCycles}
                                cycleTracks={cycleTracks}
                                cyclesByTrack={cyclesByTrack}
                                cycleTrackFilters={cycleTrackFilters}
                                tickets={tickets}
                                totalResults={ticketsData?.data?.total ?? 0}
                                onCreateCycleClick={() => setShowCreateCycleDialog(true)}
                                onCycleTrackFilterChange={handleCycleTrackFilterChange}
                                onSelectCycle={setSelectedCycleId}
                                onSelectTicket={setSelectedTicketId}
                            />
                        ) : activeView === "board" ? (
                            <ProjectBoardView
                                boardColumns={boardColumns}
                                canEditTickets={canEditTickets}
                                selectedTicketId={selectedTicketId}
                                onDragStart={setDraggingTicketId}
                                onDragEnd={() => setDraggingTicketId(null)}
                                onBoardDrop={handleBoardDrop}
                                onSelectTicket={setSelectedTicketId}
                            />
                        ) : isBacklogView ? null : (
                            <ProjectBacklogTable
                                loadingTickets={loadingTickets}
                                hierarchicalRows={hierarchicalRows}
                                groupedBacklogSections={groupedBacklogSections}
                                selectedGroupTrack={selectedGroupTrack}
                                selectedTicketId={selectedTicketId}
                                selectedTicketIds={selectedTicketIds}
                                expandedTicketIds={expandedTicketIds}
                                allVisibleSelected={allVisibleSelected}
                                onToggleSelectAll={toggleSelectAllVisible}
                                onToggleTicketSelection={toggleTicketSelection}
                                onSelectTicket={setSelectedTicketId}
                                onToggleTicketExpansion={toggleTicketExpansion}
                            />
                        )}
                    </div>

                    {showAside ? (
                        <ProjectPageAside
                            activeView={activeView}
                            projectKey={project.projectKey}
                            selectedCycle={selectedCycle}
                            cycleErrors={cycleErrors}
                            selectedTicketId={selectedTicketId}
                            loadingTicketDetail={loadingTicketDetail}
                            ticketDetail={ticketDetail}
                            ticketDetailSharedProps={ticketDetailSharedProps}
                            onOpenTicketPage={openTicketDetailPage}
                            onCloseTicket={() => setSelectedTicketId(null)}
                            onChildTicketClick={setSelectedTicketId}
                        />
                    ) : null}
                </div>
            </div>

            {deleteErrors && !loadingDelete ? <ToastComponent icon="AlertTriangle" type="warning" toggle={true} message="Unable to delete project" /> : null}
            {deleteData && !loadingDelete ? <ToastComponent icon="Check" type="success" toggle={true} message="Project deleted successfully" /> : null}

            <ProjectCreateCycleDialog
                open={showCreateCycleDialog}
                onOpenChange={setShowCreateCycleDialog}
                cycleTracks={cycleTracks}
                draftCycleTrackId={draftCycleTrackId}
                draftCycleName={draftCycleName}
                draftCycleGoal={draftCycleGoal}
                draftCycleDescription={draftCycleDescription}
                draftCycleStartsAt={draftCycleStartsAt}
                draftCycleEndsAt={draftCycleEndsAt}
                draftCycleState={draftCycleState}
                creatingCycle={creatingCycle}
                createCycleError={createCycleError}
                onDraftCycleTrackIdChange={setDraftCycleTrackId}
                onDraftCycleNameChange={setDraftCycleName}
                onDraftCycleGoalChange={setDraftCycleGoal}
                onDraftCycleDescriptionChange={setDraftCycleDescription}
                onDraftCycleStartsAtChange={setDraftCycleStartsAt}
                onDraftCycleEndsAtChange={setDraftCycleEndsAt}
                onDraftCycleStateChange={setDraftCycleState}
                onCreateCycle={handleCreateCycle}
            />

            <ProjectDeleteDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog} loadingDelete={loadingDelete} onConfirmDelete={confirmDeleteProject} />
        </div>
    );
}
