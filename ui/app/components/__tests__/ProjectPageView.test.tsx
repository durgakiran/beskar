import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectPageView from "../project-management/ProjectPageView";

const useGet = vi.fn();
const useDelete = vi.fn();
const usePost = vi.fn();
const usePut = vi.fn();
const fetchProject = vi.fn();
const fetchTickets = vi.fn();
const fetchTicketDetail = vi.fn();
const deleteProject = vi.fn();
const createCycle = vi.fn();
const updateTicket = vi.fn();
const routerPush = vi.fn();
const routerReplace = vi.fn();
const globalFetch = vi.fn();
const searchParams = new URLSearchParams();

vi.mock("@http/hooks", () => ({
    useGet: (...args: unknown[]) => useGet(...args),
    useDelete: (...args: unknown[]) => useDelete(...args),
    usePost: (...args: unknown[]) => usePost(...args),
    usePut: (...args: unknown[]) => usePut(...args),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: routerPush, replace: routerReplace }),
    usePathname: () => "/space/space-1/view/42",
    useSearchParams: () => searchParams,
}));

describe("ProjectPageView", () => {
    function openQaReviewFlowTicket() {
        const ticketNode = screen.getAllByText("QA review flow")[0];
        const clickable = ticketNode.closest('[role="button"],button');
        if (!clickable) {
            throw new Error("Unable to locate clickable ticket row");
        }
        fireEvent.click(clickable);
    }

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        searchParams.forEach((_, key) => searchParams.delete(key));
        vi.stubGlobal("fetch", globalFetch);
        vi.spyOn(window, "setInterval").mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);
        vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
        Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "visible",
        });
        globalFetch.mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes("/project/space/space-1/page/42/activity")) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        data: {
                            activity: [
                                {
                                    id: "activity-1",
                                    ticketId: "ticket-1",
                                    projectId: "project-1",
                                    activityType: "ticket_field_updated",
                                    fieldName: "status",
                                    oldValue: "todo",
                                    newValue: "in_review",
                                    actorId: "user-1",
                                    actorName: "Asha Patel",
                                    createdAt: "2026-05-25T10:30:00Z",
                                },
                            ],
                            total: 1,
                            latestAt: "2026-05-25T10:30:00Z",
                        },
                        status: "success",
                    }),
                } as Response);
            }
            return Promise.resolve({
                ok: true,
                json: async () => ({ data: {}, status: "success" }),
            } as Response);
        });
        useGet.mockImplementation((url: string) => {
            if (url === "project/space/space-1/page/42") {
                return [
                    {
                        data: {
                            data: {
                                pageId: 42,
                                spaceId: "space-1",
                                projectId: "project-1",
                                projectKey: "WEB",
                                title: "Website Launch",
                                description: "Track launch readiness",
                                defaultView: "list",
                                breadcrumbs: [{ id: 42, title: "Website Launch" }],
                                space: { name: "Launch Space", archivedAt: null },
                                capabilities: { canEdit: true, canDelete: true, canCreateTicket: true },
                                summary: { ticketCount: 2, openCount: 1, doneCount: 1 },
                                cycleTracks: [
                                    {
                                        id: "track-sprint",
                                        projectId: "project-1",
                                        key: "sprint",
                                        name: "Sprint",
                                        position: 10,
                                        displayStyle: "range",
                                        activationPolicy: "single_active",
                                        maxAssignmentsPerTicket: 1,
                                        currentCycle: { id: "cycle-sprint-14", name: "Sprint 14", state: "active", endsAt: "2026-05-31T00:00:00Z" },
                                        unplannedTicketCount: 1,
                                    },
                                ],
                            },
                            status: "success",
                        },
                        isLoading: false,
                        errors: null,
                    },
                    fetchProject,
                ];
            }
            if (url === "space/space-1/users") {
                return [
                    {
                        data: {
                            data: [
                                { id: "user-1", name: "Asha Patel", email: "asha@example.com", role: "owner", isOwner: true },
                                { id: "user-2", name: "Mina Shah", email: "mina@example.com", role: "editor", isOwner: false },
                            ],
                            status: "success",
                        },
                        isLoading: false,
                        errors: null,
                    },
                    vi.fn(),
                ];
            }
            if (url === "project/space/space-1/page/42/tickets") {
                return [
                    {
                        data: {
                            data: {
                                tickets: [
                                    {
                                        id: "ticket-1",
                                        projectId: "project-1",
                                        sequenceNo: 2,
                                        identifier: "WEB-2",
                                        title: "QA review flow",
                                        description: "",
                                        type: "story",
                                        status: "in_review",
                                        priority: "medium",
                                        depth: 1,
                                        parentTicketId: "ticket-2",
                                        ownerInitials: "AP",
                                        reporterName: "Asha Patel",
                                        labelNames: [],
                                        parentIdentifier: "WEB-1",
                                        parentTitle: "Launch roadmap",
                                        updatedAt: "2026-05-25T10:00:00Z",
                                        cycleAssignments: [
                                            {
                                                track: { id: "track-sprint", key: "sprint", name: "Sprint", position: 10, displayStyle: "range" },
                                                cycle: {
                                                    id: "cycle-sprint-14",
                                                    projectId: "project-1",
                                                    trackId: "track-sprint",
                                                    name: "Sprint 14",
                                                    goal: "Ship QA hardening",
                                                    description: "",
                                                    state: "active",
                                                    startsAt: "2026-05-18T00:00:00Z",
                                                    endsAt: "2026-05-31T00:00:00Z",
                                                    position: 10,
                                                },
                                            },
                                        ],
                                        childCount: 0,
                                        openChildCount: 0,
                                        doneChildCount: 0,
                                    },
                                    {
                                        id: "ticket-2",
                                        projectId: "project-1",
                                        sequenceNo: 1,
                                        identifier: "WEB-1",
                                        title: "Launch roadmap",
                                        description: "",
                                        type: "epic",
                                        status: "backlog",
                                        priority: "high",
                                        depth: 0,
                                        parentTicketId: null,
                                        ownerInitials: "AP",
                                        reporterName: "Asha Patel",
                                        labelNames: [],
                                        updatedAt: "2026-05-25T09:00:00Z",
                                        childCount: 1,
                                        openChildCount: 1,
                                        doneChildCount: 0,
                                    },
                                ],
                                total: 2,
                            },
                            status: "success",
                        },
                        isLoading: false,
                        errors: null,
                    },
                    fetchTickets,
                ];
            }
            if (url === "project/space/space-1/page/42/cycle-tracks") {
                return [
                    {
                        data: {
                            data: {
                                tracks: [
                                    {
                                        id: "track-sprint",
                                        projectId: "project-1",
                                        key: "sprint",
                                        name: "Sprint",
                                        position: 10,
                                        displayStyle: "range",
                                        activationPolicy: "single_active",
                                        maxAssignmentsPerTicket: 1,
                                        currentCycle: { id: "cycle-sprint-14", name: "Sprint 14", state: "active", endsAt: "2026-05-31T00:00:00Z" },
                                        unplannedTicketCount: 1,
                                    },
                                    {
                                        id: "track-milestone",
                                        projectId: "project-1",
                                        key: "milestone",
                                        name: "Milestone",
                                        position: 20,
                                        displayStyle: "marker",
                                        activationPolicy: "multi_active",
                                        maxAssignmentsPerTicket: 1,
                                        currentCycle: { id: "cycle-launch", name: "Launch readiness", state: "planned", endsAt: "2026-06-15T00:00:00Z" },
                                        unplannedTicketCount: 0,
                                    },
                                ],
                            },
                            status: "success",
                        },
                        isLoading: false,
                        errors: null,
                    },
                    vi.fn(),
                ];
            }
            if (url === "project/space/space-1/page/42/cycles") {
                return [
                    {
                        data: {
                            data: {
                                cycles: [
                                    {
                                        id: "cycle-sprint-14",
                                        projectId: "project-1",
                                        trackId: "track-sprint",
                                        name: "Sprint 14",
                                        goal: "Ship QA hardening",
                                        description: "",
                                        state: "active",
                                        startsAt: "2026-05-18T00:00:00Z",
                                        endsAt: "2026-05-31T00:00:00Z",
                                        position: 10,
                                        summary: { ticketCount: 1, openCount: 1, doneCount: 0 },
                                        track: { id: "track-sprint", key: "sprint", name: "Sprint", position: 10, displayStyle: "range" },
                                    },
                                    {
                                        id: "cycle-launch",
                                        projectId: "project-1",
                                        trackId: "track-milestone",
                                        name: "Launch readiness",
                                        goal: "Prepare release",
                                        description: "",
                                        state: "planned",
                                        endsAt: "2026-06-15T00:00:00Z",
                                        position: 20,
                                        summary: { ticketCount: 2, openCount: 1, doneCount: 1 },
                                        track: { id: "track-milestone", key: "milestone", name: "Milestone", position: 20, displayStyle: "marker" },
                                    },
                                ],
                            },
                            status: "success",
                        },
                        isLoading: false,
                        errors: null,
                    },
                    vi.fn(),
                ];
            }
            if (url === "project/space/space-1/page/42/tickets/pending") {
                return [
                    {
                        data: null,
                        isLoading: false,
                        errors: null,
                    },
                    fetchTicketDetail,
                ];
            }
            if (url === "project/space/space-1/page/42/tickets/ticket-1") {
                return [
                    {
                        data: {
                            data: {
                                id: "ticket-1",
                                projectId: "project-1",
                                sequenceNo: 2,
                                identifier: "WEB-2",
                                title: "QA review flow",
                                description: "Confirm the new release checklist",
                                type: "story",
                                parentTicketId: "ticket-2",
                                status: "in_review",
                                priority: "medium",
                                depth: 1,
                                assigneeUserId: "user-1",
                                assigneeName: "Asha Patel",
                                ownerInitials: "AP",
                                reporterName: "Asha Patel",
                                labelNames: ["qa", "launch"],
                                dueAt: "2026-05-31T00:00:00Z",
                                parentIdentifier: "WEB-1",
                                parentTitle: "Launch roadmap",
                                updatedAt: "2026-05-25T10:00:00Z",
                                cycleAssignments: [
                                    {
                                        track: { id: "track-sprint", key: "sprint", name: "Sprint", position: 10, displayStyle: "range" },
                                        cycle: {
                                            id: "cycle-sprint-14",
                                            projectId: "project-1",
                                            trackId: "track-sprint",
                                            name: "Sprint 14",
                                            goal: "Ship QA hardening",
                                            description: "",
                                            state: "active",
                                            startsAt: "2026-05-18T00:00:00Z",
                                            endsAt: "2026-05-31T00:00:00Z",
                                            position: 10,
                                        },
                                    },
                                ],
                                childCount: 1,
                                openChildCount: 1,
                                doneChildCount: 0,
                                links: [
                                    {
                                        id: "link-1",
                                        ticketId: "ticket-1",
                                        url: "https://example.com/spec",
                                        title: "https://example.com/spec",
                                        source: "description",
                                        createdAt: "2026-05-25T10:00:00Z",
                                    },
                                ],
                                attachments: [
                                    {
                                        attachmentId: "attachment-1",
                                        fileName: "launch-plan.pdf",
                                        fileSize: 2048,
                                        mimeType: "application/pdf",
                                        url: "/api/v1/attachments/attachment-1",
                                        attachedAt: "2026-05-25T10:00:00Z",
                                    },
                                ],
                                comments: [
                                    {
                                        id: "comment-1",
                                        ticketId: "ticket-1",
                                        body: "Need QA sign-off before release.",
                                        createdBy: "user-1",
                                        createdByName: "Asha Patel",
                                        createdAt: "2026-05-25T10:00:00Z",
                                        updatedAt: "2026-05-25T10:00:00Z",
                                    },
                                ],
                                children: [
                                    {
                                        id: "ticket-3",
                                        identifier: "WEB-3",
                                        title: "Run regression suite",
                                        projectId: "project-1",
                                        sequenceNo: 3,
                                        description: "",
                                        type: "subtask",
                                        status: "todo",
                                        priority: "medium",
                                        depth: 2,
                                        ownerInitials: "AP",
                                        reporterName: "Asha Patel",
                                        labelNames: [],
                                        updatedAt: "2026-05-25T11:00:00Z",
                                        childCount: 0,
                                        openChildCount: 0,
                                        doneChildCount: 0,
                                    },
                                ],
                            },
                            status: "success",
                        },
                        isLoading: false,
                        errors: null,
                    },
                    fetchTicketDetail,
                ];
            }
            throw new Error(`Unexpected GET ${url}`);
        });
        useDelete.mockReturnValue([{ data: null, isLoading: false, errors: null }, deleteProject]);
        usePost.mockReturnValue([{ data: null, isLoading: false, errors: null }, createCycle]);
        usePut.mockReturnValue([{ data: null, isLoading: false, errors: null }, updateTicket]);
    });

    it("renders project list details and fetches the default ticket query", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        expect(screen.getByRole("heading", { name: "Website Launch" })).not.toBeNull();
        expect(screen.getByText("WEB")).not.toBeNull();
        expect(screen.getByText("Under WEB-1 Launch roadmap")).not.toBeNull();
        expect(screen.getByText("QA review flow")).not.toBeNull();
        expect(screen.getByDisplayValue("Group: none")).not.toBeNull();
        expect(screen.queryByRole("button", { name: "Show current" })).toBeNull();
        expect(screen.queryByText("Select a ticket from the list or board to open a direct-edit detail view.")).toBeNull();

        await waitFor(() => expect(fetchProject).toHaveBeenCalled());
        await waitFor(() => expect(fetchTickets).toHaveBeenCalledWith({}));
        expect(screen.queryByText("Recent project activity")).toBeNull();
        expect(screen.getByText("Export CSV")).not.toBeNull();
        expect(screen.getByText("Export JSON")).not.toBeNull();
    });

    it("groups backlog tickets by cycle track", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        fireEvent.change(screen.getByDisplayValue("Group: none"), {
            target: { value: "track-sprint" },
        });

        expect(routerReplace.mock.calls.some(([url]) => String(url).includes("groupByTrack=track-sprint"))).toBe(true);
        expect(await screen.findByText("May 18 - May 31 · 1 ticket")).not.toBeNull();
        expect(screen.getByText("Unassigned Sprint")).not.toBeNull();
        expect(screen.queryByText("Select a ticket from the list or board to open a direct-edit detail view.")).toBeNull();

        const sprintSectionTrigger = screen.getByText("May 18 - May 31 · 1 ticket").closest("button");
        if (!sprintSectionTrigger) {
            throw new Error("Missing sprint accordion trigger");
        }

        fireEvent.click(sprintSectionTrigger);
        await waitFor(() => expect(screen.queryByText("QA review flow")).toBeNull());

        fireEvent.click(sprintSectionTrigger);
        expect(await screen.findByText("QA review flow")).not.toBeNull();
    });

    it("refetches the ticket query when the view and filters change", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        await waitFor(() => expect(fetchTickets).toHaveBeenCalledWith({}));

        fireEvent.click(screen.getByRole("button", { name: "My work" }));
        expect(routerReplace).toHaveBeenCalledWith("/space/space-1/view/42?view=my_work", { scroll: false });

        fireEvent.change(screen.getByPlaceholderText("Search ticket title or description"), {
            target: { value: "QA" },
        });
        expect(routerReplace.mock.calls.some(([url]) => String(url).includes("search=QA"))).toBe(true);

        fireEvent.change(screen.getByDisplayValue("All statuses"), {
            target: { value: "in_review" },
        });
        expect(routerReplace.mock.calls.some(([url]) => String(url).includes("status=in_review"))).toBe(true);

        fireEvent.click(screen.getByText("Advanced filters"));
        fireEvent.change(screen.getByDisplayValue("All assignees"), {
            target: { value: "user-1" },
        });
        expect(routerReplace.mock.calls.some(([url]) => String(url).includes("assignee=user-1"))).toBe(true);

        fireEvent.click(screen.getByLabelText("Leaf tickets only"));
        expect(routerReplace.mock.calls.some(([url]) => String(url).includes("leafOnly=true"))).toBe(true);
    });

    it("navigates to the dedicated create-ticket route", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        fireEvent.click(screen.getByRole("button", { name: "Add" }));
        expect(routerPush).toHaveBeenCalledWith("/space/space-1/view/42/tickets/new?returnTo=%2Fspace%2Fspace-1%2Fview%2F42");
    });

    it("confirms and triggers project deletion", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
        expect(screen.getByText("Are you sure you want to delete this project? This action cannot be undone.")).not.toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Delete" }));
        expect(deleteProject).toHaveBeenCalledWith(null);
    });

    it("opens ticket detail and submits inline status updates", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        openQaReviewFlowTicket();

        expect(await screen.findByDisplayValue("QA review flow")).not.toBeNull();
        expect(screen.getByText("launch-plan.pdf")).not.toBeNull();
        expect(screen.getByText("Need QA sign-off before release.")).not.toBeNull();

        fireEvent.change(screen.getByDisplayValue("In review"), {
            target: { value: "done" },
        });

        expect(updateTicket).toHaveBeenCalledWith({ status: "done" });
    });

    it("supports assignee and due-date updates from ticket detail", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        openQaReviewFlowTicket();

        await screen.findByDisplayValue("QA review flow");

        fireEvent.change(screen.getByDisplayValue("Asha Patel"), {
            target: { value: "user-2" },
        });
        expect(updateTicket).toHaveBeenCalledWith({ assigneeUserId: "user-2", assigneeName: "Mina Shah" });

        fireEvent.change(screen.getByDisplayValue("2026-05-31"), {
            target: { value: "2026-06-02" },
        });
        expect(updateTicket).toHaveBeenCalledWith({ dueAt: "2026-06-02" });
    });

    it("supports type and parent updates from ticket detail", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        openQaReviewFlowTicket();

        await screen.findByDisplayValue("QA review flow");

        fireEvent.change(screen.getByDisplayValue("Story"), {
            target: { value: "task" },
        });
        expect(updateTicket).toHaveBeenCalledWith({ type: "task" });

        fireEvent.change(screen.getByDisplayValue("WEB-1 Launch roadmap"), {
            target: { value: "" },
        });
        expect(updateTicket).toHaveBeenCalledWith({ parentTicketId: "" });
    });

    it("opens the dedicated ticket page from the detail drawer", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        openQaReviewFlowTicket();

        await screen.findByDisplayValue("QA review flow");

        fireEvent.click(screen.getByRole("button", { name: "Open page" }));

        expect(routerPush).toHaveBeenCalledWith("/space/space-1/view/42/tickets/ticket-1");
    });

    it("renders board columns with ticket cards", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        fireEvent.click(screen.getByRole("button", { name: "Board" }));

        expect(screen.getAllByText("Backlog").length).toBeGreaterThan(0);
        expect(screen.getAllByText("In review").length).toBeGreaterThan(0);
        expect(screen.getByText("Launch roadmap")).not.toBeNull();
        expect(screen.getByText("QA review flow")).not.toBeNull();
    });

    it("supports selecting list rows for bulk actions", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        const selectionCheckboxes = screen.getAllByRole("checkbox").filter((checkbox) => !checkbox.closest("label")?.textContent?.includes("Leaf tickets only"));
        fireEvent.click(selectionCheckboxes[1]);

        await waitFor(() => expect(screen.getByText("1 ticket selected")).not.toBeNull());
        expect(screen.getByRole("button", { name: "Apply" })).not.toBeNull();
    });

    it("prefills child creation from ticket detail", async () => {
        render(React.createElement(ProjectPageView, { spaceId: "space-1", pageId: "42" }));

        openQaReviewFlowTicket();
        await screen.findByDisplayValue("QA review flow");

        fireEvent.click(screen.getByRole("button", { name: "Add child" }));
        expect(routerPush).toHaveBeenCalledWith("/space/space-1/view/42/tickets/new?returnTo=%2Fspace%2Fspace-1%2Fview%2F42&type=task&parentTicketId=ticket-1");
    });
});
