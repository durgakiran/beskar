import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InviteActionPage from "./InviteActionPage";
import { consumeInviteReturn, rememberInviteReturn } from "./inviteReturn";
const invite = { token: "one", entity: "space", entityId: "space-1", senderName: "Sender", name: "Project", role: "viewer", status: null };
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });
const request = vi.fn();
beforeEach(() => {
    vi.stubGlobal("fetch", request);
    request.mockReset();
    sessionStorage.clear();
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});
function SwitchLink() {
    const go = useNavigate();
    return <button onClick={() => go("/invite/action?token=two")}>Other invite</button>;
}
function open(query = "?token=one") {
    return render(
        <MemoryRouter initialEntries={["/invite/action" + query]}>
            <SwitchLink />
            <Routes>
                <Route path="/invite/action" element={<InviteActionPage />} />
            </Routes>
        </MemoryRouter>,
    );
}
describe("routed invitation journey with real HTTP hooks", () => {
    it("renders an email accept link and writes only after confirmation", async () => {
        request.mockResolvedValueOnce(json(invite)).mockResolvedValueOnce(json({ status: "accepted", entityId: "space-1" }));
        open("?token=one&decision=accept");
        const accept = await screen.findByRole("button", { name: "Accept invite" });
        expect(request).toHaveBeenCalledTimes(1);
        fireEvent.click(accept);
        expect((await screen.findByRole("link", { name: "Open space" })).getAttribute("href")).toBe("/space/space-1");
        expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ token: "one", decision: "accept" });
    });
    it("requires confirmation to decline and permits cancelling", async () => {
        request.mockResolvedValueOnce(json(invite)).mockResolvedValueOnce(json({ status: "rejected" }));
        open("?token=one&decision=reject");
        await screen.findByRole("button", { name: "Confirm decline" });
        expect(request).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        fireEvent.click(screen.getByRole("button", { name: "Decline" }));
        fireEvent.click(screen.getByRole("button", { name: "Confirm decline" }));
        await screen.findByRole("heading", { name: "Invitation declined" });
        expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ token: "one", decision: "reject" });
    });
    it.each([
        ["accepted", "You already accepted this invitation"],
        ["rejected", "You already declined this invitation"],
        ["expired", "This invitation has expired"],
        ["removed", "This invitation was revoked"],
    ])("handles terminal %s links without a write", async (status, heading) => {
        request.mockResolvedValue(json({ ...invite, status }));
        open();
        await screen.findByRole("heading", { name: heading });
        expect(request).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("button", { name: "Accept invite" })).toBeNull();
    });
    it("shows missing/invalid links", async () => {
        open("");
        await screen.findByRole("heading", { name: "This invitation link is invalid" });
        expect(request).not.toHaveBeenCalled();
        cleanup();
        request.mockResolvedValue(json(null, 404));
        open();
        await screen.findByRole("heading", { name: "This invitation link is invalid" });
    });
    it("uses real logout navigation and preserves the invitation", async () => {
        request.mockResolvedValue(json(null, 403));
        open();
        const link = await screen.findByRole("link", { name: "Switch account" });
        expect(link.getAttribute("href")).toBe("/auth/logout");
        link.addEventListener("click", (event) => event.preventDefault());
        fireEvent.click(link);
        expect(consumeInviteReturn()).toBe("/invite/action?token=one");
        expect(consumeInviteReturn()).toBeNull();
    });
    it("offers sign-in with the original URL after session expiry", async () => {
        request.mockResolvedValue(json(null, 401));
        open("?token=one&decision=reject");
        const link = await screen.findByRole("link", { name: "Sign in" });
        expect(link.getAttribute("href")).toBe("/auth/login?returnTo=%2Finvite%2Faction%3Ftoken%3Done%26decision%3Dreject");
    });
    it("retries a transient detail error", async () => {
        request.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(json(invite));
        open();
        fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
        await screen.findByRole("button", { name: "Accept invite" });
    });
    it("retries failed acceptance and shows server errors", async () => {
        request
            .mockResolvedValueOnce(json(invite))
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { detail: "Permission service unavailable" } }), { status: 502 }))
            .mockResolvedValueOnce(json({ status: "accepted", entityId: "space-1" }));
        open();
        fireEvent.click(await screen.findByRole("button", { name: "Accept invite" }));
        await screen.findByText("Permission service unavailable");
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await screen.findByRole("link", { name: "Open space" });
    });
    it("handles expiry between loading and accepting", async () => {
        request.mockResolvedValueOnce(json(invite)).mockResolvedValueOnce(json({ status: "expired" }));
        open();
        fireEvent.click(await screen.findByRole("button", { name: "Accept invite" }));
        await screen.findByRole("heading", { name: "This invitation has expired" });
    });
    it("does not carry a prior decision into another invitation", async () => {
        request
            .mockResolvedValueOnce(json(invite))
            .mockResolvedValueOnce(json({ status: "accepted", entityId: "space-1" }))
            .mockResolvedValueOnce(json({ ...invite, token: "two", name: "Other project" }));
        open();
        fireEvent.click(await screen.findByRole("button", { name: "Accept invite" }));
        await screen.findByRole("link", { name: "Open space" });
        fireEvent.click(screen.getByRole("button", { name: "Other invite" }));
        await screen.findByRole("heading", { name: "Sender invited you to join Other project" });
        expect(screen.queryByRole("link", { name: "Open space" })).toBeNull();
    });
    it("prevents duplicate decisions while pending", async () => {
        request.mockResolvedValueOnce(json(invite)).mockImplementationOnce(() => new Promise(() => {}));
        open();
        fireEvent.click(await screen.findByRole("button", { name: "Accept invite" }));
        await screen.findByRole("heading", { name: "Accepting invitation" });
        expect(screen.queryByRole("button", { name: "Accept invite" })).toBeNull();
        expect(request).toHaveBeenCalledTimes(2);
    });
    it("rejects unsafe or expired account-switch return URLs", () => {
        rememberInviteReturn("https://evil.example/invite/action?token=one");
        expect(consumeInviteReturn()).toBeNull();
        sessionStorage.setItem("teddox.inviteReturn", JSON.stringify({ path: "/invite/action?token=one", expires: 0 }));
        expect(consumeInviteReturn()).toBeNull();
    });
});
