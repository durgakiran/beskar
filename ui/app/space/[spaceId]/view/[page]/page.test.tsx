import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

const useGet = vi.fn();
const useDelete = vi.fn();

vi.mock("@http/hooks", () => ({
    useGet: (...args: unknown[]) => useGet(...args),
    useDelete: (...args: unknown[]) => useDelete(...args),
}));

vi.mock("@components/project-management/ProjectPageView", () => ({
    default: ({ spaceId, pageId }: { spaceId: string; pageId: string }) =>
        React.createElement("div", { "data-testid": "project-page-view" }, `${spaceId}:${pageId}`),
}));

vi.mock("@components/ReadOnlyContentMain", () => ({
    default: ({ children }: { children: React.ReactNode }) => React.createElement("div", { "data-testid": "readonly-shell" }, children),
}));

vi.mock("@components/ui/ToastComponent", () => ({
    default: () => null,
}));

vi.mock("@components/WhiteboardEditor", () => ({
    default: () => React.createElement("div", { "data-testid": "whiteboard-editor" }),
}));

vi.mock("@editor", () => ({
    TipTap: () => React.createElement("div", { "data-testid": "tiptap" }),
    AttachmentPanel: () => React.createElement("div", { "data-testid": "attachment-panel" }),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn() }),
}));

describe("space view page route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useDelete.mockReturnValue([{ data: null, isLoading: false, errors: null }, vi.fn()]);
    });

    it("routes project pages to the project-management view", async () => {
        const fetchMetadata = vi.fn();
        useGet.mockImplementation((url: string) => {
            if (url === "editor/space/space-1/page/42/metadata") {
                return [
                    {
                        data: { data: { type: "project" }, status: "success" },
                        isLoading: false,
                        errors: null,
                    },
                    fetchMetadata,
                ];
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        await act(async () => {
            render(React.createElement(Page, { params: Promise.resolve({ spaceId: "space-1", page: "42" }) }));
        });

        await waitFor(() => expect(fetchMetadata).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId("project-page-view").textContent).toBe("space-1:42");
    });
});
