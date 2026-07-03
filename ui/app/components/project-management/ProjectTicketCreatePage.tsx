"use client";

import { Response, useGet, usePost } from "@http/hooks";
import { Button, Flex, Spinner, Text, TextArea, TextField } from "@radix-ui/themes";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type ProjectViewData = {
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

type ProjectCycleTrackSummary = {
    id: string;
    projectId: string;
    key: string;
    name: string;
    position: number;
    displayStyle: string;
    activationPolicy: string;
    maxAssignmentsPerTicket: number;
    currentCycle?: { id: string; name: string; endsAt?: string | null } | null;
    unplannedTicketCount: number;
};

type ProjectCycleSummary = {
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
    track?: { id: string; key: string; name: string; position: number; displayStyle: string } | null;
    summary?: { ticketCount: number; openCount: number; doneCount: number };
};

type SpaceMember = {
    id: string;
    name: string;
    email: string;
};

type TicketRow = {
    id: string;
    identifier: string;
    title: string;
    type: string;
};

type TicketListResponse = {
    tickets: TicketRow[];
};

type CreateTicketPayload = {
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

const TYPE_OPTIONS = [
    { value: "epic", label: "Epic" },
    { value: "story", label: "Story" },
    { value: "task", label: "Task" },
    { value: "subtask", label: "Subtask" },
    { value: "bug", label: "Bug" },
];

const STATUS_OPTIONS = [
    { value: "backlog", label: "Backlog" },
    { value: "todo", label: "Todo" },
    { value: "in_progress", label: "In progress" },
    { value: "in_review", label: "In review" },
    { value: "done", label: "Done" },
    { value: "canceled", label: "Canceled" },
];

const PRIORITY_OPTIONS = [
    { value: "none", label: "None" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "urgent", label: "Urgent" },
];

function formatDateInputValue(value?: string | null) {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    try {
        return new Date(value).toISOString().slice(0, 10);
    } catch {
        return "";
    }
}

function parseLabelInput(value: string) {
    return value
        .split(",")
        .map((label) => label.trim())
        .filter((label, index, list) => label && list.indexOf(label) === index);
}

function normalizeReturnTo(spaceId: string, pageId: string, value?: string | null) {
    if (!value) return `/space/${spaceId}/view/${pageId}`;
    if (!value.startsWith(`/space/${spaceId}/view/${pageId}`)) return `/space/${spaceId}/view/${pageId}`;
    return value;
}

export default function ProjectTicketCreatePage({ spaceId, pageId, prefill, returnTo }: { spaceId: string; pageId: string; prefill?: Partial<CreateTicketPayload>; returnTo?: string | null }) {
    const router = useRouter();
    const normalizedReturnTo = normalizeReturnTo(spaceId, pageId, returnTo);

    const [title, setTitle] = useState(prefill?.title ?? "");
    const [description, setDescription] = useState(prefill?.description ?? "");
    const [type, setType] = useState(prefill?.type ?? "task");
    const [status, setStatus] = useState(prefill?.status ?? "todo");
    const [priority, setPriority] = useState(prefill?.priority ?? "medium");
    const [parentTicketId, setParentTicketId] = useState(prefill?.parentTicketId ?? "");
    const [assigneeUserId, setAssigneeUserId] = useState(prefill?.assigneeUserId ?? "");
    const [dueAt, setDueAt] = useState(formatDateInputValue(prefill?.dueAt));
    const [labels, setLabels] = useState((prefill?.labelNames ?? []).join(", "));
    const [cycleAssignmentsByTrack, setCycleAssignmentsByTrack] = useState<Record<string, string>>(
        Object.fromEntries((prefill?.cycleAssignments ?? []).map((assignment) => [assignment.trackId, assignment.cycleId])),
    );

    const [{ isLoading: loadingProject, data: projectData, errors: projectErrors }, fetchProject] = useGet<Response<ProjectViewData>>(`project/space/${spaceId}/page/${pageId}`);
    const [{ data: spaceUsersData }, fetchSpaceUsers] = useGet<Response<SpaceMember[]>>(`space/${spaceId}/users`);
    const [{ isLoading: loadingTickets, data: ticketsData }, fetchTickets] = useGet<Response<TicketListResponse>>(`project/space/${spaceId}/page/${pageId}/tickets`);
    const [{ data: cycleTracksData }, fetchCycleTracks] = useGet<Response<{ tracks: ProjectCycleTrackSummary[] }>>(`project/space/${spaceId}/page/${pageId}/cycle-tracks`);
    const [{ data: cyclesData }, fetchCycles] = useGet<Response<{ cycles: ProjectCycleSummary[] }>>(`project/space/${spaceId}/page/${pageId}/cycles`);
    const [{ isLoading: creatingTicket, data: createdTicket, errors: createTicketError }, createTicket] = usePost<Response<{ id: string }>, CreateTicketPayload>(
        `project/space/${spaceId}/page/${pageId}/tickets`,
    );

    useEffect(() => {
        fetchProject();
        fetchSpaceUsers();
        fetchTickets({});
        fetchCycleTracks();
        fetchCycles();
    }, [fetchProject, fetchSpaceUsers, fetchTickets, fetchCycleTracks, fetchCycles]);

    useEffect(() => {
        const nextTicketId = createdTicket?.data?.id;
        if (!nextTicketId) return;
        router.push(`/space/${spaceId}/view/${pageId}/tickets/${nextTicketId}`);
    }, [createdTicket, pageId, router, spaceId]);

    const project = projectData?.data;
    const spaceUsers = useMemo(() => spaceUsersData?.data ?? [], [spaceUsersData?.data]);
    const tickets = useMemo(() => ticketsData?.data?.tickets ?? [], [ticketsData?.data?.tickets]);
    const cycleTracks = useMemo(() => cycleTracksData?.data?.tracks ?? project?.cycleTracks ?? [], [cycleTracksData?.data?.tracks, project?.cycleTracks]);
    const cycles = useMemo(() => cyclesData?.data?.cycles ?? [], [cyclesData?.data?.cycles]);
    const cyclesByTrack = useMemo(() => {
        const next: Record<string, ProjectCycleSummary[]> = {};
        for (const cycle of cycles) {
            next[cycle.trackId] = next[cycle.trackId] ?? [];
            next[cycle.trackId].push(cycle);
        }
        return next;
    }, [cycles]);
    const selectedParent = useMemo(() => tickets.find((ticket) => ticket.id === parentTicketId) ?? null, [parentTicketId, tickets]);
    const isArchived = Boolean(project?.space.archivedAt);
    const canCreate = Boolean(project?.capabilities.canCreateTicket) && !isArchived;

    function submitCreateTicket() {
        const cycleAssignments = Object.entries(cycleAssignmentsByTrack)
            .filter(([, cycleId]) => cycleId)
            .map(([trackId, cycleId]) => ({ trackId, cycleId }));

        createTicket({
            title,
            description,
            type,
            status,
            priority,
            parentTicketId: parentTicketId || undefined,
            assigneeUserId: assigneeUserId || undefined,
            assigneeName: assigneeUserId ? spaceUsers.find((member) => member.id === assigneeUserId)?.name : undefined,
            labelNames: parseLabelInput(labels),
            dueAt: dueAt || undefined,
            cycleAssignments: cycleAssignments.length > 0 ? cycleAssignments : undefined,
        });
    }

    if (loadingProject && !project) {
        return (
            <Flex align="center" justify="center" className="min-h-[320px]">
                <Spinner size="2" />
            </Flex>
        );
    }

    if (!project) {
        return (
            <div className="mx-auto max-w-[960px] p-6">
                <div className="rounded-[18px] border border-red-200 bg-red-50 px-4 py-5 text-[14px] text-red-700">{projectErrors?.message || "Unable to load the project create flow right now."}</div>
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-4 py-6 lg:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                    <button
                        type="button"
                        onClick={() => router.push(normalizedReturnTo)}
                        className="rounded-full border border-neutral-200 px-3 py-1 text-[12px] font-medium text-neutral-600 transition hover:border-neutral-300 hover:bg-neutral-50"
                    >
                        Back to project
                    </button>
                    <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{project.projectKey} · New ticket</div>
                    <h1 className="text-[30px] font-semibold tracking-[-0.02em] text-neutral-950">Create ticket in {project.title}</h1>
                    <Text size="2" className="max-w-[760px] text-neutral-600">
                        Capture the work item with the same direct-edit grammar used by ticket detail. Keep the operational metadata visible while you write the description.
                    </Text>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="soft" color="gray" onClick={() => router.push(normalizedReturnTo)}>
                        Cancel
                    </Button>
                    <Button onClick={submitCreateTicket} disabled={!title.trim() || creatingTicket || !canCreate} loading={creatingTicket}>
                        Create ticket
                    </Button>
                </div>
            </div>

            {isArchived ? <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-4 text-[14px] text-amber-800">This project is archived and read-only.</div> : null}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                <section className="space-y-6">
                    <div className="rounded-[20px] border border-neutral-200 bg-white p-5 shadow-[0_14px_28px_rgba(11,10,42,0.06)]">
                        <div className="space-y-4">
                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Title
                                </Text>
                                <TextField.Root value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Summarize the work" disabled={!canCreate} />
                            </label>
                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Description
                                </Text>
                                <TextArea
                                    value={description}
                                    onChange={(event) => setDescription(event.target.value)}
                                    placeholder="Add context, requirements, and any page or external links that should be normalized into ticket links."
                                    rows={16}
                                    disabled={!canCreate}
                                />
                            </label>
                            <Text size="2" className="text-neutral-500">
                                Links pasted into the description are captured as ticket links after create, so you do not need a separate linked-page field here.
                            </Text>
                        </div>
                    </div>

                    {selectedParent ? (
                        <div className="rounded-[20px] border border-primary-100 bg-primary-50/60 p-4">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-700">Parent context</div>
                            <div className="mt-2 text-[14px] font-semibold text-primary-950">
                                {selectedParent.identifier} · {selectedParent.title}
                            </div>
                            <div className="mt-1 text-[13px] text-primary-800">This ticket will be created under the selected parent so hierarchy, rollups, and child progress remain connected.</div>
                        </div>
                    ) : null}
                </section>

                <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
                    <div className="rounded-[20px] border border-neutral-200 bg-white p-5 shadow-[0_14px_28px_rgba(11,10,42,0.06)]">
                        <div className="space-y-4">
                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Type
                                </Text>
                                <select
                                    value={type}
                                    onChange={(event) => setType(event.target.value)}
                                    disabled={!canCreate}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                >
                                    {TYPE_OPTIONS.map((option) => (
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
                                    value={parentTicketId}
                                    onChange={(event) => setParentTicketId(event.target.value)}
                                    disabled={!canCreate || loadingTickets}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                >
                                    <option value="">No parent</option>
                                    {tickets.map((ticket) => (
                                        <option key={ticket.id} value={ticket.id}>
                                            {ticket.identifier} {ticket.title}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Status
                                </Text>
                                <select
                                    value={status}
                                    onChange={(event) => setStatus(event.target.value)}
                                    disabled={!canCreate}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                >
                                    {STATUS_OPTIONS.map((option) => (
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
                                    value={priority}
                                    onChange={(event) => setPriority(event.target.value)}
                                    disabled={!canCreate}
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
                                    Assignee
                                </Text>
                                <select
                                    value={assigneeUserId}
                                    onChange={(event) => setAssigneeUserId(event.target.value)}
                                    disabled={!canCreate}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                >
                                    <option value="">Assign to me</option>
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
                                    value={dueAt}
                                    onChange={(event) => setDueAt(event.target.value)}
                                    disabled={!canCreate}
                                    className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                />
                            </label>

                            <label className="block">
                                <Text as="div" size="2" mb="1" weight="bold">
                                    Labels
                                </Text>
                                <TextField.Root value={labels} onChange={(event) => setLabels(event.target.value)} placeholder="launch, qa, follow-up" disabled={!canCreate} />
                            </label>

                            <div className="space-y-3 rounded-[16px] border border-neutral-200 bg-neutral-50/70 p-3">
                                <Text as="div" size="2" weight="bold">
                                    Planning
                                </Text>
                                {cycleTracks.length > 0 ? (
                                    cycleTracks.map((track) => (
                                        <label key={track.id} className="block">
                                            <Text as="div" size="2" mb="1" weight="bold">
                                                {track.name}
                                            </Text>
                                            <select
                                                value={cycleAssignmentsByTrack[track.id] ?? ""}
                                                onChange={(event) =>
                                                    setCycleAssignmentsByTrack((current) => ({
                                                        ...current,
                                                        [track.id]: event.target.value,
                                                    }))
                                                }
                                                disabled={!canCreate}
                                                className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-[14px] text-neutral-900 outline-none transition focus:border-primary-400 disabled:bg-neutral-100"
                                            >
                                                <option value="">No {track.name.toLowerCase()}</option>
                                                {(cyclesByTrack[track.id] ?? []).map((cycle) => (
                                                    <option key={cycle.id} value={cycle.id}>
                                                        {cycle.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    ))
                                ) : (
                                    <Text size="2" className="text-neutral-500">
                                        Create project cycles first to assign planning context to this ticket.
                                    </Text>
                                )}
                            </div>
                        </div>
                    </div>

                    {createTicketError ? <div className="rounded-[18px] border border-red-200 bg-red-50 px-4 py-4 text-[14px] text-red-700">{createTicketError.message}</div> : null}
                </aside>
            </div>
        </div>
    );
}
