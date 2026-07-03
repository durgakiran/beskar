import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectTicketCreatePage from "../project-management/ProjectTicketCreatePage";

const useGet = vi.fn();
const usePost = vi.fn();
const fetchProject = vi.fn();
const fetchTickets = vi.fn();
const fetchCycleTracks = vi.fn();
const fetchCycles = vi.fn();
const createTicket = vi.fn();
const routerPush = vi.fn();

vi.mock("@http/hooks", () => ({
    useGet: (...args: unknown[]) => useGet(...args),
    usePost: (...args: unknown[]) => usePost(...args),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: routerPush }),
}));

describe("ProjectTicketCreatePage", () => {
    beforeEach(() => {
        vi.clearAllMocks();

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
                                { id: "user-1", name: "Asha Patel", email: "asha@example.com" },
                                { id: "user-2", name: "Mina Shah", email: "mina@example.com" },
                            ],
                            status: "success",
                        },
                        isLoading: false,
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
                                    { id: "ticket-1", identifier: "WEB-1", title: "Launch roadmap", type: "story" },
                                    { id: "ticket-2", identifier: "WEB-2", title: "QA review flow", type: "task" },
                                ],
                                total: 2,
                            },
                            status: "success",
                        },
                        isLoading: false,
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
                                ],
                            },
                            status: "success",
                        },
                        isLoading: false,
                    },
                    fetchCycleTracks,
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
                                        track: { id: "track-sprint", key: "sprint", name: "Sprint", position: 10, displayStyle: "range" },
                                    },
                                ],
                            },
                            status: "success",
                        },
                        isLoading: false,
                    },
                    fetchCycles,
                ];
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        usePost.mockReturnValue([{ data: null, isLoading: false, errors: null }, createTicket]);
    });

    it("submits the dedicated create-ticket form with route prefills", async () => {
        render(
            React.createElement(ProjectTicketCreatePage, {
                spaceId: "space-1",
                pageId: "42",
                returnTo: "/space/space-1/view/42?view=board",
                prefill: {
                    type: "task",
                    parentTicketId: "ticket-1",
                    labelNames: ["launch"],
                    dueAt: "2026-06-02",
                },
            }),
        );

        await waitFor(() => expect(fetchProject).toHaveBeenCalled());
        await waitFor(() => expect(fetchTickets).toHaveBeenCalledWith({}));

        expect(screen.getByText("WEB-1 · Launch roadmap")).not.toBeNull();

        fireEvent.change(screen.getByPlaceholderText("Summarize the work"), {
            target: { value: "Ship hierarchy controls" },
        });
        fireEvent.change(screen.getByPlaceholderText(/Add context, requirements/), {
            target: { value: "Mirror the create route inside project management." },
        });
        fireEvent.change(screen.getByDisplayValue("Assign to me"), {
            target: { value: "user-2" },
        });

        fireEvent.click(screen.getByRole("button", { name: "Create ticket" }));

        expect(createTicket).toHaveBeenCalledWith({
            title: "Ship hierarchy controls",
            description: "Mirror the create route inside project management.",
            type: "task",
            status: "todo",
            priority: "medium",
            parentTicketId: "ticket-1",
            assigneeUserId: "user-2",
            assigneeName: "Mina Shah",
            labelNames: ["launch"],
            dueAt: "2026-06-02",
        });
    });

    it("redirects to the created ticket detail page on success", async () => {
        usePost.mockReturnValue([
            {
                data: {
                    data: {
                        id: "ticket-9",
                    },
                    status: "success",
                },
                isLoading: false,
                errors: null,
            },
            createTicket,
        ]);

        render(
            React.createElement(ProjectTicketCreatePage, {
                spaceId: "space-1",
                pageId: "42",
            }),
        );

        await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/space/space-1/view/42/tickets/ticket-9"));
    });
});
