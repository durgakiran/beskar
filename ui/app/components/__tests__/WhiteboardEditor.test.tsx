import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WhiteboardEditor from "../WhiteboardEditor";

const useGet = vi.fn();
const usePUT = vi.fn();
const push = vi.fn();
const providerInstances: Array<{ room: string; options: unknown }> = [];

vi.mock("@http/hooks", () => ({
    useGet: (...args: unknown[]) => useGet(...args),
}));

vi.mock("app/core/http/hooks/usePut", () => ({
    usePUT: (...args: unknown[]) => usePUT(...args),
}));

vi.mock("@durgakiran/glideboard", () => ({
    Glideboard: ({ readOnly, collaboration }: any) => React.createElement("div", {
            "data-testid": "glideboard",
            "data-readonly": String(readOnly),
            "data-has-provider": String(Boolean(collaboration?.provider)),
        }),
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push }),
}));

vi.mock("y-webrtc", () => ({
    WebrtcProvider: class MockWebrtcProvider {
        public awareness = {
            setLocalStateField: vi.fn(),
        };

        constructor(room: string, _doc: unknown, options: unknown) {
            providerInstances.push({ room, options });
        }

        disconnect() {}
        destroy() {}
    },
}));

describe("WhiteboardEditor", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        providerInstances.length = 0;
        usePUT.mockReturnValue([{ isLoading: false }, vi.fn()]);
    });

    it("uses the read-only fetch path in view mode", async () => {
        useGet.mockImplementation((url: string) => {
            if (url === "editor/space/space-1/whiteboard/page-2") {
                return [
                    {
                        data: { data: { title: "Board", data: null } },
                        isLoading: false,
                        errors: null,
                    },
                    vi.fn(),
                ];
            }
            if (url === "profile/details") {
                return [
                    {
                        data: { data: { id: "user-1", name: "Asha", email: "asha@example.com" } },
                        isLoading: false,
                        errors: null,
                    },
                    vi.fn(),
                ];
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        render(React.createElement(WhiteboardEditor, { slug: ["space-1", "page-2"], readOnly: true }));

        await waitFor(() => expect(screen.getByTestId("glideboard")).not.toBeNull());
        expect(screen.getByTestId("glideboard").getAttribute("data-readonly")).toBe("true");
        expect(useGet).toHaveBeenCalledWith("editor/space/space-1/whiteboard/page-2");
    });

    it("uses the edit fetch path and creates a collaboration provider in edit mode", async () => {
        useGet.mockImplementation((url: string) => {
            if (url === "editor/space/space-1/whiteboard/page-2/edit") {
                return [
                    {
                        data: { data: { title: "Board", data: null } },
                        isLoading: false,
                        errors: null,
                    },
                    vi.fn(),
                ];
            }
            if (url === "profile/details") {
                return [
                    {
                        data: { data: { id: "user-1", name: "Asha", email: "asha@example.com" } },
                        isLoading: false,
                        errors: null,
                    },
                    vi.fn(),
                ];
            }
            throw new Error(`Unexpected GET ${url}`);
        });

        render(React.createElement(WhiteboardEditor, { slug: ["space-1", "page-2"] }));

        await waitFor(() => expect(screen.getByTestId("glideboard")).not.toBeNull());
        expect(screen.getByTestId("glideboard").getAttribute("data-readonly")).toBe("false");
        expect(screen.getByTestId("glideboard").getAttribute("data-has-provider")).toBe("true");
        expect(useGet).toHaveBeenCalledWith("editor/space/space-1/whiteboard/page-2/edit");
        expect(providerInstances[0]?.room).toBe("page-2-space-space-1");
    });
});
