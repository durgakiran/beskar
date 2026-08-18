import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

const useGet = vi.fn();
const useDelete = vi.fn();
const push = vi.hoisted(() => vi.fn());

vi.mock("@http/hooks", () => ({
    useGet: (...args: unknown[]) => useGet(...args),
    useDelete: (...args: unknown[]) => useDelete(...args),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push }),
}));

vi.mock("react-router-dom", async importOriginal => ({
    ...(await importOriginal<typeof import("react-router-dom")>()),
    useNavigate: () => push,
}));

vi.mock("@components/WhiteboardEditor", () => ({
    default: ({ slug, readOnly, fillParent }: { slug: string[]; readOnly?: boolean; fillParent?: boolean }) => (
        <div
            data-testid="whiteboard-editor"
            data-slug={slug.join("/")}
            data-readonly={String(Boolean(readOnly))}
            data-fill-parent={String(Boolean(fillParent))}
        />
    ),
}));

vi.mock("@components/ReadOnlyContentMain", () => ({
    default: ({
        title,
        capabilities,
        onEdit,
        onDelete,
        children,
    }: {
        title: string;
        capabilities: { canEdit: boolean; canDelete: boolean; canComment: boolean; canShare: boolean };
        onEdit: () => void;
        onDelete: () => void;
        children: React.ReactNode;
    }) => (
        <div data-testid="readonly-shell">
            <div>{title}</div>
            <div data-testid="shell-capabilities">{JSON.stringify(capabilities)}</div>
            <button onClick={onEdit}>Edit page</button>
            <button onClick={onDelete}>Delete page</button>
            {children}
        </div>
    ),
}));

vi.mock("@editor", () => ({
    TipTap: () => <div data-testid="tiptap" />,
    AttachmentPanel: () => <div data-testid="attachments" />,
}));

describe("whiteboard view page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useDelete.mockReturnValue([{ isLoading: false, data: null, errors: null }, vi.fn()]);
        useGet.mockImplementation((url: string) => {
            if (url === "editor/space/space-1/page/42/metadata") {
                return [{ isLoading: false, data: { data: { type: "whiteboard" } }, errors: null }, vi.fn()];
            }
            if (url === "editor/space/space-1/page/42") {
                return [{
                    isLoading: false,
                    errors: null,
                    data: {
                        data: {
                            pageId: 42,
                            spaceId: "space-1",
                            pageType: "whiteboard",
                            title: "Sprint board",
                            document: null,
                            breadcrumbs: [],
                            space: { name: "Product" },
                            capabilities: {
                                canEdit: true,
                                canDelete: true,
                                canComment: true,
                                canShare: true,
                            },
                            meta: {},
                            attachments: [],
                        },
                        status: "success",
                    },
                }, vi.fn()];
            }
            throw new Error(`Unexpected GET ${url}`);
        });
    });

    it("renders whiteboards inside the shared read-only shell with edit and delete actions", async () => {
        await act(async () => {
            render(
                <MemoryRouter initialEntries={["/space-1/42"]}>
                    <React.Suspense fallback={<div data-testid="loading" />}>
                        <Routes>
                            <Route path="/:spaceId/:page" element={<Page />} />
                        </Routes>
                    </React.Suspense>
                </MemoryRouter>
            );
        });

        await waitFor(() => expect(screen.getByTestId("readonly-shell")).not.toBeNull());
        expect(screen.getByText("Sprint board")).not.toBeNull();

        const whiteboard = screen.getByTestId("whiteboard-editor");
        expect(whiteboard.getAttribute("data-slug")).toBe("space-1/42");
        expect(whiteboard.getAttribute("data-readonly")).toBe("true");
        expect(whiteboard.getAttribute("data-fill-parent")).toBe("true");

        expect(screen.getByTestId("shell-capabilities").textContent).toContain("\"canComment\":false");

        fireEvent.click(screen.getByText("Edit page"));
        expect(push).toHaveBeenCalledWith("/edit/space-1/42");

        fireEvent.click(screen.getByText("Delete page"));
        expect(screen.getAllByText("Delete Page").length).toBeGreaterThan(0);
    });
});
