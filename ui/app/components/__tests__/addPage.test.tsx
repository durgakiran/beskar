import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AddPage from "../addPage";

const createDoc = vi.fn();
const createWhiteboard = vi.fn();
const usePost = vi.fn();

vi.mock("@http/hooks", () => ({
    usePost: (...args: unknown[]) => usePost(...args),
}));

describe("AddPage", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        usePost.mockImplementation((url: string) => {
            if (url.includes("/whiteboard/create")) {
                return [{ data: null, isLoading: false, errors: null }, createWhiteboard];
            }
            return [{ data: null, isLoading: false, errors: null }, createDoc];
        });
    });

    it("submits whiteboard creation through the whiteboard endpoint", () => {
        render(
            React.createElement(AddPage, {
                isOpen: true,
                setIsOpen: () => {},
                spaceId: "space-1",
                editPage: () => {},
            }),
        );

        fireEvent.click(screen.getByRole("button", { name: "Whiteboard" }));
        fireEvent.change(screen.getByPlaceholderText("Untitled whiteboard"), {
            target: { value: "Roadmap" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create" }));

        expect(createWhiteboard).toHaveBeenCalledWith({
            title: "Roadmap",
            spaceId: "space-1",
            parentId: undefined,
        });
        expect(createDoc).not.toHaveBeenCalled();
    });
});
