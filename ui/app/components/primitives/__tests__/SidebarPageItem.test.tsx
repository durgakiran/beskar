import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SidebarPageItem } from "../SidebarPageItem";

describe("SidebarPageItem", () => {
    it("renders a delete action for deletable project pages", () => {
        const onDelete = vi.fn();

        render(
            <SidebarPageItem
                id="42"
                title="Website Launch"
                type="project"
                canDelete
                onDelete={onDelete}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Delete project Website Launch" }));
        expect(onDelete).toHaveBeenCalledWith("42");
    });
});
