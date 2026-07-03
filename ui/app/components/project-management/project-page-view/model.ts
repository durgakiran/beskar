import { getApiV1Base } from "@http";
import { FiColumns, FiFlag, FiList, FiUser } from "react-icons/fi";

export type ProjectViewMode = "list" | "my_work" | "board" | "cycles";

export type ProjectViewData = {
    pageId: number;
    spaceId: string;
    projectId: string;
    projectKey: string;
    title: string;
    description: string;
    defaultView: string;
    breadcrumbs: Array<{ id: number; title: string; href?: string | null }>;
    space: { name: string; archivedAt?: string | null };
    capabilities: { canEdit: boolean; canDelete: boolean; canCreateTicket: boolean };
    summary: { ticketCount: number; openCount: number; doneCount: number };
    cycleTracks?: ProjectCycleTrackSummary[];
};

export type ProjectCycleTrackSummary = {
    id: string;
    projectId: string;
    key: string;
    name: string;
    position: number;
    displayStyle: string;
    activationPolicy: string;
    maxAssignmentsPerTicket: number;
    colorToken?: string | null;
    currentCycle?: { id: string; name: string; state: string; startsAt?: string | null; endsAt?: string | null } | null;
    unplannedTicketCount: number;
};

export type ProjectCycleSummary = {
    id: string;
    projectId: string;
    trackId: string;
    name: string;
    goal: string;
    description: string;
    state: string;
    startsAt?: string | null;
    endsAt?: string | null;
    position: number;
    completedAt?: string | null;
    track?: {
        id: string;
        key: string;
        name: string;
        position: number;
        displayStyle: string;
        activationPolicy?: string;
    } | null;
    summary?: { ticketCount: number; openCount: number; doneCount: number };
};

export type TicketCycleAssignment = {
    track: {
        id: string;
        key: string;
        name: string;
        position: number;
        displayStyle: string;
    };
    cycle: ProjectCycleSummary;
};

export type SpaceMember = {
    id: string;
    name: string;
    email: string;
    role: string;
    isOwner?: boolean;
};

export type TicketLink = {
    id: string;
    ticketId: string;
    url: string;
    title: string;
    source: string;
    createdAt: string;
};

export type TicketAttachment = {
    attachmentId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    url: string;
    attachedAt: string;
};

export type TicketComment = {
    id: string;
    ticketId: string;
    body: string;
    createdBy: string;
    createdByName: string;
    createdAt: string;
    updatedAt: string;
};

export type TicketActivity = {
    id: string;
    ticketId: string;
    projectId: string;
    activityType: string;
    fieldName?: string | null;
    oldValue?: string | null;
    newValue?: string | null;
    actorId: string;
    actorName: string;
    createdAt: string;
};

export type ProjectActivityListResponse = {
    activity: TicketActivity[];
    total: number;
    latestAt?: string | null;
};

export type TicketRow = {
    id: string;
    projectId: string;
    sequenceNo: number;
    identifier: string;
    title: string;
    description: string;
    type: string;
    status: string;
    priority: string;
    depth: number;
    parentTicketId?: string | null;
    rootTicketId?: string | null;
    assigneeUserId?: string | null;
    assigneeName?: string | null;
    ownerInitials: string;
    reporterName: string;
    labelNames: string[];
    dueAt?: string | null;
    parentIdentifier?: string | null;
    parentTitle?: string | null;
    updatedAt: string;
    links?: TicketLink[];
    attachments?: TicketAttachment[];
    comments?: TicketComment[];
    activity?: TicketActivity[];
    children?: TicketRow[];
    cycleAssignments?: TicketCycleAssignment[];
    childCount: number;
    openChildCount: number;
    doneChildCount: number;
};

export type TicketListResponse = {
    tickets: TicketRow[];
    total: number;
};

export type TicketListRow = {
    ticket: TicketRow;
    hasChildren: boolean;
};

export type GroupedBacklogSection = {
    id: string;
    title: string;
    subtitle: string;
    rows: TicketListRow[];
    isUnassigned: boolean;
};

export type BoardColumn = {
    value: string;
    label: string;
    tickets: TicketRow[];
};

export type BulkUpdateResponse = {
    updated: TicketRow[];
    failed: Array<{ ticketId: string; message: string }>;
};

export type CreateTicketPayload = {
    title: string;
    description: string;
    type: string;
    status: string;
    priority: string;
    parentTicketId?: string;
    assigneeUserId?: string;
    assigneeName?: string;
    labelNames?: string[];
    dueAt?: string;
    cycleAssignments?: Array<{ trackId: string; cycleId: string }>;
};

export type UpdateTicketPayload = {
    title?: string;
    description?: string;
    type?: string;
    status?: string;
    priority?: string;
    parentTicketId?: string;
    assigneeUserId?: string;
    assigneeName?: string;
    labelNames?: string[];
    dueAt?: string;
    cycleAssignments?: Array<{ trackId: string; cycleId: string }>;
    cycleAssignmentsSet?: boolean;
};

export type CreateCyclePayload = {
    trackId: string;
    name: string;
    goal: string;
    description: string;
    state: string;
    startsAt?: string;
    endsAt: string;
};

export const STATUS_OPTIONS = [
    { value: "", label: "All statuses" },
    { value: "backlog", label: "Backlog" },
    { value: "todo", label: "Todo" },
    { value: "in_progress", label: "In progress" },
    { value: "in_review", label: "In review" },
    { value: "done", label: "Done" },
    { value: "canceled", label: "Canceled" },
] as const;

export const TYPE_OPTIONS = [
    { value: "", label: "All types" },
    { value: "epic", label: "Epic" },
    { value: "story", label: "Story" },
    { value: "task", label: "Task" },
    { value: "subtask", label: "Subtask" },
    { value: "bug", label: "Bug" },
] as const;

export const BOARD_STATUSES = [
    { value: "backlog", label: "Backlog" },
    { value: "todo", label: "Todo" },
    { value: "in_progress", label: "In progress" },
    { value: "in_review", label: "In review" },
    { value: "done", label: "Done" },
    { value: "canceled", label: "Canceled" },
] as const;

export const SORT_OPTIONS = [
    { value: "rank_asc", label: "Rank" },
    { value: "updated_desc", label: "Updated" },
    { value: "created_desc", label: "Created" },
    { value: "due_asc", label: "Due date" },
    { value: "priority_desc", label: "Priority" },
] as const;

export const PRIORITY_OPTIONS = [
    { value: "none", label: "None" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "urgent", label: "Urgent" },
] as const;

export const BULK_NO_CHANGE = "__unchanged__";
export const BULK_UNASSIGNED = "__unassigned__";

export const PROJECT_VIEW_TABS = [
    { key: "list", label: "Backlog", icon: FiList },
    { key: "board", label: "Board", icon: FiColumns },
    { key: "my_work", label: "My work", icon: FiUser },
    { key: "cycles", label: "Cycles", icon: FiFlag },
] as const;

export function readCycleTrackFilters(params: URLSearchParams | null) {
    const filters: Record<string, string> = {};
    if (!params) return filters;
    for (const [key, value] of params.entries()) {
        if (!key.startsWith("cycleTrack_")) continue;
        const trackId = key.replace("cycleTrack_", "").trim();
        if (!trackId || !value.trim()) continue;
        filters[trackId] = value.trim();
    }
    return filters;
}

export function readGroupByTrackParam(params: URLSearchParams | null) {
    return params?.get("groupByTrack")?.trim() ?? "";
}

export function buildCycleAssignmentState(assignments?: TicketCycleAssignment[]) {
    const next: Record<string, string> = {};
    for (const assignment of assignments ?? []) {
        next[assignment.track.id] = assignment.cycle.id;
    }
    return next;
}

export function sameCycleAssignmentState(left: Record<string, string>, right: Record<string, string>) {
    const leftEntries = Object.entries(left);
    const rightEntries = Object.entries(right);
    if (leftEntries.length !== rightEntries.length) return false;
    return leftEntries.every(([trackId, cycleId]) => right[trackId] === cycleId);
}

export function sortCycleAssignments(assignments?: TicketCycleAssignment[]) {
    return [...(assignments ?? [])].sort((left, right) => left.track.position - right.track.position);
}

export function cycleChipClass(trackKey: string) {
    switch (trackKey) {
        case "sprint":
            return "border-sky-200 bg-sky-50 text-sky-700";
        case "milestone":
            return "border-amber-200 bg-amber-50 text-amber-700";
        case "quarter":
            return "border-emerald-200 bg-emerald-50 text-emerald-700";
        default:
            return "border-neutral-200 bg-neutral-50 text-neutral-700";
    }
}

export function cycleStateClass(state: string) {
    switch (state) {
        case "active":
            return "bg-emerald-100 text-emerald-700";
        case "completed":
            return "bg-neutral-200 text-neutral-700";
        case "canceled":
            return "bg-rose-100 text-rose-700";
        default:
            return "bg-amber-100 text-amber-700";
    }
}

export function formatCycleDateRange(startsAt?: string | null, endsAt?: string | null) {
    if (!startsAt && !endsAt) return "No schedule";
    const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
    const formatValue = (value?: string | null) => {
        if (!value) return "";
        try {
            return formatter.format(new Date(value));
        } catch {
            return value;
        }
    };
    if (startsAt && endsAt) return `${formatValue(startsAt)} - ${formatValue(endsAt)}`;
    return endsAt ? `Target ${formatValue(endsAt)}` : `Starts ${formatValue(startsAt)}`;
}

export function formatCycleTrackLabel(track: { name: string; key: string }) {
    return track.name?.trim() || track.key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatStatusLabel(status: string) {
    switch (status) {
        case "in_progress":
            return "In progress";
        case "in_review":
            return "In review";
        default:
            return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    }
}

export function formatTicketType(type: string) {
    return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function priorityColor(priority: string) {
    switch (priority) {
        case "urgent":
            return "bg-red-500";
        case "high":
            return "bg-orange-500";
        case "medium":
            return "bg-amber-500";
        case "low":
            return "bg-emerald-500";
        default:
            return "bg-neutral-300";
    }
}

export function priorityLabel(priority: string) {
    return priority.replace(/\b\w/g, (char) => char.toUpperCase());
}

export function statusPillClass(status: string) {
    switch (status) {
        case "done":
            return "bg-emerald-100 text-emerald-700";
        case "in_review":
            return "bg-violet-100 text-violet-700";
        case "in_progress":
            return "bg-sky-100 text-sky-700";
        case "backlog":
            return "bg-neutral-100 text-neutral-700";
        case "canceled":
            return "bg-rose-100 text-rose-700";
        default:
            return "bg-amber-100 text-amber-700";
    }
}

export function formatActivityLabel(entry: TicketActivity) {
    switch (entry.activityType) {
        case "ticket_created":
            return "created the ticket";
        case "ticket_field_updated":
            return `updated ${entry.fieldName?.replace(/_/g, " ") ?? "a field"}`;
        case "comment_added":
            return "added a comment";
        case "attachment_added":
            return "attached a file";
        case "attachment_removed":
            return "removed an attachment";
        default:
            return entry.activityType.replace(/_/g, " ");
    }
}

export function buildTicketQuery(
    search: string,
    statusFilter: string,
    typeFilter: string,
    activeView: ProjectViewMode,
    sort: string,
    filters: {
        assignee: string;
        label: string;
        parent: string;
        root: string;
        leafOnly: boolean;
    },
    cycleTrackFilters: Record<string, string>,
) {
    const query: Record<string, string> = {};
    if (search.trim()) query.search = search.trim();
    if (statusFilter) query.status = statusFilter;
    if (typeFilter) query.type = typeFilter;
    if (sort && sort !== "rank_asc") query.sort = sort;
    if (filters.assignee) query.assignee = filters.assignee;
    if (filters.label.trim()) query.label = filters.label.trim();
    if (filters.parent) query.parent = filters.parent;
    if (filters.root) query.root = filters.root;
    if (filters.leafOnly) query.leafOnly = "true";
    if (activeView === "my_work") query.mine = "true";
    for (const [trackId, cycleId] of Object.entries(cycleTrackFilters)) {
        if (cycleId) query[`cycleTrack_${trackId}`] = cycleId;
    }
    return query;
}

export function formatTimestamp(value?: string | null) {
    if (!value) return "";
    try {
        return new Date(value).toLocaleString();
    } catch {
        return value;
    }
}

export function formatFileSize(size: number) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDateInputValue(value?: string | null) {
    if (!value) return "";
    try {
        return new Date(value).toISOString().slice(0, 10);
    } catch {
        return "";
    }
}

export function parseLabelInput(value: string) {
    return value
        .split(",")
        .map((label) => label.trim())
        .filter((label, index, list) => label && list.indexOf(label) === index);
}

export function buildExportHref(spaceId: string, pageId: string, extension: "csv" | "json", query: Record<string, string>) {
    const search = new URLSearchParams(query);
    const suffix = search.toString() ? `?${search.toString()}` : "";
    return `${getApiV1Base()}/project/space/${spaceId}/page/${pageId}/tickets/export.${extension}${suffix}`;
}

export function buildCreateTicketHref(spaceId: string, pageId: string, returnTo: string, prefill?: Partial<CreateTicketPayload>) {
    const params = new URLSearchParams();
    params.set("returnTo", returnTo);

    if (prefill?.title?.trim()) params.set("title", prefill.title.trim());
    if (prefill?.description?.trim()) params.set("description", prefill.description.trim());
    if (prefill?.type) params.set("type", prefill.type);
    if (prefill?.status) params.set("status", prefill.status);
    if (prefill?.priority) params.set("priority", prefill.priority);
    if (prefill?.parentTicketId) params.set("parentTicketId", prefill.parentTicketId);
    if (prefill?.assigneeUserId) params.set("assigneeUserId", prefill.assigneeUserId);
    if (prefill?.dueAt) params.set("dueAt", prefill.dueAt);
    if (prefill?.labelNames?.length) params.set("labels", prefill.labelNames.join(", "));

    return `/space/${spaceId}/view/${pageId}/tickets/new?${params.toString()}`;
}

export function parseViewParam(value: string | null): ProjectViewMode {
    if (value === "board" || value === "my_work" || value === "cycles") return value;
    return "list";
}

export function parseSortParam(value: string | null) {
    return SORT_OPTIONS.some((option) => option.value === value) ? value! : "rank_asc";
}

export function suggestChildType(parentType: string) {
    switch (parentType) {
        case "epic":
            return "story";
        case "story":
            return "task";
        case "task":
        case "bug":
            return "subtask";
        default:
            return "task";
    }
}

export function mergeUniqueActivity(current: TicketActivity[], incoming: TicketActivity[]) {
    const merged = [...incoming, ...current];
    const seen = new Set<string>();
    return merged.filter((entry) => {
        if (seen.has(entry.id)) return false;
        seen.add(entry.id);
        return true;
    });
}

export function flattenHierarchy(tickets: TicketRow[], expanded: Record<string, boolean>) {
    const byId = new Map(tickets.map((ticket) => [ticket.id, ticket]));
    const children = new Map<string, TicketRow[]>();
    const roots: TicketRow[] = [];
    const ordered = [...tickets].sort((left, right) => left.sequenceNo - right.sequenceNo);

    for (const ticket of ordered) {
        const parentId = ticket.parentTicketId ?? undefined;
        if (parentId && byId.has(parentId)) {
            const siblings = children.get(parentId) ?? [];
            siblings.push(ticket);
            children.set(parentId, siblings);
        } else {
            roots.push(ticket);
        }
    }

    const rows: TicketListRow[] = [];
    const visit = (ticket: TicketRow) => {
        const ticketChildren = children.get(ticket.id) ?? [];
        rows.push({ ticket, hasChildren: ticketChildren.length > 0 });
        if (ticketChildren.length === 0) return;
        const isExpanded = expanded[ticket.id] ?? true;
        if (!isExpanded) return;
        ticketChildren.forEach(visit);
    };

    roots.forEach(visit);
    return rows;
}
