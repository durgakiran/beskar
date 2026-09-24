import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

let contentApiVersion: number | undefined;
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

vi.mock("@components/WhiteboardPreviewV2", () => ({ default: () => <div data-testid="v2-preview" /> }));

vi.mock("@editor", () => ({
    TipTap: () => <div data-testid="tiptap" />,
    AttachmentPanel: () => <div data-testid="attachments" />,
}));

describe("whiteboard view page", () => {
    afterEach(() => vi.unstubAllGlobals());
    beforeEach(() => {
        contentApiVersion = undefined;
        vi.clearAllMocks();
        useDelete.mockReturnValue([{ isLoading: false, data: null, errors: null }, vi.fn()]);
        useGet.mockImplementation((url: string) => {
            if (url === "editor/space/space-1/page/42/metadata") {
                return [{ isLoading: false, data: { data: { type: "whiteboard", contentApiVersion } }, errors: null }, vi.fn()];
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
    it("routes v2 deletion through the v2 API and exposes version history", async () => {
        contentApiVersion = 2;
        const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetcher);
        render(<MemoryRouter initialEntries={["/space-1/42"]}><Routes><Route path="/:spaceId/:page" element={<Page />} /></Routes></MemoryRouter>);
        await screen.findByTestId('v2-preview');
        expect(screen.getByText('Version history')).toBeTruthy();
        fireEvent.click(screen.getByText('Delete page'));
        fireEvent.click(await screen.findByRole('button', { name: 'Delete whiteboard' }));
        await waitFor(() => expect(push).toHaveBeenCalledWith('/space/space-1'));
        expect(fetcher.mock.calls[0][0]).toContain('/api/v2/editor/space/space-1/whiteboard/42');
        expect(useDelete.mock.results[0].value[1]).not.toHaveBeenCalled();
    });

});
