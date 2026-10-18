import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import ReadOnlyContentMain from "./ReadOnlyContentMain";
import { Theme } from "@radix-ui/themes";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

it("keeps info collapsed in the shared view shell and refreshes relative time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 18, 14, 30));
    render(
        <Theme><MemoryRouter>
            <ReadOnlyContentMain
                spaceId="space" pageId="1" title="Test page" breadcrumbs={[]} archived={false}
                capabilities={{ canEdit: false, canDelete: false, canComment: false, canShare: false }}
                meta={{ createdByName: "Alice", updatedByName: "Bob", createdAt: new Date(2026, 8, 18).toISOString(), updatedAt: new Date(2026, 9, 18, 12, 31).toISOString() }}
                isCommentsOpen={false} commentPresentation="docked"
                onOpenComments={() => {}} onEdit={() => {}} onDelete={() => {}}
            >
                <div>Published content</div>
            </ReadOnlyContentMain>
        </MemoryRouter></Theme>,
    );
    const summary = screen.getByText("Info").closest("summary")!;
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText("Updated 1 hour ago")).toBeTruthy();
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText("Created by")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Last edited by")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("Created on")).toBeTruthy();
    expect(screen.getByText("Last updated")).toBeTruthy();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Updated 2 hours ago")).toBeTruthy();
    expect(screen.getByText("2 hours ago").getAttribute("aria-label")).toContain("2026");
    fireEvent.click(summary);
    expect(details.open).toBe(false);
});
