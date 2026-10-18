import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ReadOnlyPageInfo from "./ReadOnlyPageInfo";
import { Theme } from "@radix-ui/themes";

afterEach(cleanup);

it("omits unavailable or invalid metadata instead of showing empty rows", () => {
    const { container } = render(<ReadOnlyPageInfo meta={{ createdAt: "invalid", updatedAt: "invalid" }} />);
    expect(container.textContent).toBe("");
});

it("supports older responses without creation dates and falls back to publication time", () => {
    render(<Theme><ReadOnlyPageInfo meta={{ createdByName: "Alice", updatedAt: "invalid", publishedAt: "2020-01-02T12:00:00Z" }} /></Theme>);
    const expected = new Date("2020-01-02T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    expect(screen.getByText(`Updated ${expected}`)).toBeTruthy();
    expect(screen.queryByText("Created on")).toBeNull();
    expect(screen.queryByText("Last edited by")).toBeNull();
});
