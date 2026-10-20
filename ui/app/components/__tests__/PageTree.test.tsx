import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PageTree } from "../primitives/PageTree";

afterEach(() => {
    cleanup();
});

const orderNodes = [
    {
        id: "1",
        title: "First",
        href: "/1",
        canEdit: true,
        children: [
            { id: "11", title: "Child one", canEdit: true },
            { id: "12", title: "Child two", canEdit: true },
        ],
    },
    { id: "2", title: "Second", href: "/2", canEdit: true },
    { id: "3", title: "Third", href: "/3", canEdit: true },
];

function dragTransfer() {
    return { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
}

it("drops a page before or after a sibling without navigating", () => {
    const onReorder = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
        <MemoryRouter>
            <PageTree nodes={orderNodes} onReorder={onReorder} onSelect={onSelect} />
        </MemoryRouter>,
    );
    const row = container.querySelector('[data-page-id="2"]')!;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 0, height: 40 } as DOMRect);
    const transfer = dragTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Reorder Third" }), { dataTransfer: transfer });
    // jsdom does not expose DragEvent; supply clientY as an event property.
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(drop, { clientY: { value: 5 }, dataTransfer: { value: transfer } });
    fireEvent(row, drop);
    expect(onReorder).toHaveBeenCalledWith("3", "2", "before");
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.dragStart(screen.getByRole("button", { name: "Reorder First" }), { dataTransfer: transfer });
    const after = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(after, { clientY: { value: 35 }, dataTransfer: { value: transfer } });
    fireEvent(row, after);
    expect(onReorder).toHaveBeenLastCalledWith("1", "2", "after");
});

it("rejects drops across parents, self drops and external drags", () => {
    const onReorder = vi.fn();
    const { container } = render(
        <MemoryRouter>
            <PageTree nodes={orderNodes} expandedIds={["1"]} onReorder={onReorder} />
        </MemoryRouter>,
    );
    const transfer = dragTransfer();
    const root = container.querySelector('[data-page-id="2"]')!;
    fireEvent.drop(root, { dataTransfer: transfer });
    fireEvent.dragStart(screen.getByRole("button", { name: "Reorder Child one" }), { dataTransfer: transfer });
    fireEvent.drop(root, { dataTransfer: transfer });
    fireEvent.drop(container.querySelector('[data-page-id="11"]')!, { dataTransfer: transfer });
    expect(onReorder).not.toHaveBeenCalled();
});

it("supports keyboard ordering within siblings and disables it while saving", () => {
    const onReorder = vi.fn();
    const { rerender } = render(
        <MemoryRouter>
            <PageTree nodes={orderNodes} onReorder={onReorder} />
        </MemoryRouter>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Second" }), { altKey: true, key: "ArrowUp" });
    expect(onReorder).toHaveBeenLastCalledWith("2", "1", "before");
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Second" }), { altKey: true, key: "ArrowDown" });
    expect(onReorder).toHaveBeenLastCalledWith("2", "3", "after");
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder First" }), { altKey: true, key: "ArrowUp" });
    expect(onReorder).toHaveBeenCalledTimes(2);
    rerender(
        <MemoryRouter>
            <PageTree nodes={orderNodes} onReorder={onReorder} reorderPending />
        </MemoryRouter>,
    );
    const handle = screen.getByRole("button", { name: "Reorder Second" }) as HTMLButtonElement;
    expect(handle.disabled).toBe(true);
    expect(handle.draggable).toBe(false);
    fireEvent.keyDown(handle, { altKey: true, key: "ArrowDown" });
    expect(onReorder).toHaveBeenCalledTimes(2);
});

it("does not expose drag handles in read-only trees", () => {
    render(
        <MemoryRouter>
            <PageTree nodes={orderNodes} />
        </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Reorder First" })).toBeNull();
});

function dragAt(row: Element, type: "dragover" | "drop", clientY: number, transfer: ReturnType<typeof dragTransfer>) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { clientY: { value: clientY }, dataTransfer: { value: transfer } });
    fireEvent(row, event);
}

it("highlights a middle drop and moves the page under the target", () => {
    const onDropPage = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(
        <MemoryRouter>
            <PageTree nodes={orderNodes} onDropPage={onDropPage} onSelect={onSelect} />
        </MemoryRouter>,
    );
    const row = container.querySelector('[data-page-id="1"]')!;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 0, height: 40 } as DOMRect);
    const transfer = dragTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Reorder Third" }), { dataTransfer: transfer });
    dragAt(row, "dragover", 20, transfer);
    expect(row.getAttribute("data-drop-placement")).toBe("inside");
    expect(screen.getByRole("status").textContent).toBe("Move Third under First");
    dragAt(row, "drop", 20, transfer);
    expect(onDropPage).toHaveBeenCalledWith("3", "1", "inside");
    expect(onSelect).not.toHaveBeenCalled();
    expect(row.hasAttribute("data-drop-placement")).toBe(false);
});

it("uses edge drops to place pages as siblings across parents", () => {
    const onDropPage = vi.fn();
    const { container } = render(
        <MemoryRouter>
            <PageTree nodes={orderNodes} expandedIds={["1"]} onDropPage={onDropPage} />
        </MemoryRouter>,
    );
    const row = container.querySelector('[data-page-id="2"]')!;
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 0, height: 40 } as DOMRect);
    const transfer = dragTransfer();
    for (const [y, placement] of [
        [5, "before"],
        [35, "after"],
    ] as const) {
        fireEvent.dragStart(screen.getByRole("button", { name: "Reorder Child one" }), { dataTransfer: transfer });
        dragAt(row, "dragover", y, transfer);
        expect(row.getAttribute("data-drop-placement")).toBe(placement);
        dragAt(row, "drop", y, transfer);
        expect(onDropPage).toHaveBeenLastCalledWith("11", "2", placement);
    }
});

it("blocks every drop into the source subtree and ignores external drags", () => {
    const onDropPage = vi.fn();
    const { container } = render(
        <MemoryRouter>
            <PageTree nodes={orderNodes} expandedIds={["1"]} onDropPage={onDropPage} />
        </MemoryRouter>,
    );
    const transfer = dragTransfer();
    const parent = container.querySelector('[data-page-id="1"]')!;
    const child = container.querySelector('[data-page-id="11"]')!;
    for (const row of [parent, child]) vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 0, height: 40 } as DOMRect);
    dragAt(parent, "drop", 20, transfer);
    fireEvent.dragStart(screen.getByRole("button", { name: "Reorder First" }), { dataTransfer: transfer });
    for (const y of [5, 20, 35]) {
        dragAt(child, "dragover", y, transfer);
        expect(child.hasAttribute("data-drop-placement")).toBe(false);
        dragAt(child, "drop", y, transfer);
    }
    dragAt(parent, "drop", 20, transfer);
    expect(onDropPage).not.toHaveBeenCalled();
});

it("lets an only child be dragged out before its parent", () => {
    const onDropPage = vi.fn();
    const nodes = [{ ...orderNodes[0], children: [orderNodes[0].children![0]] }, orderNodes[1]];
    const { container } = render(
        <MemoryRouter>
            <PageTree nodes={nodes} expandedIds={["1"]} onDropPage={onDropPage} />
        </MemoryRouter>,
    );
    const parent = container.querySelector('[data-page-id="1"]')!;
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ top: 0, height: 40 } as DOMRect);
    const transfer = dragTransfer();
    fireEvent.dragStart(screen.getByRole("button", { name: "Reorder Child one" }), { dataTransfer: transfer });
    dragAt(parent, "drop", 5, transfer);
    expect(onDropPage).toHaveBeenCalledWith("11", "1", "before");
});
