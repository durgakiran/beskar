import { expect, it } from "vitest";
import { inviteDecisionNotice } from "./formatters";
it.each(["expired", "removed", undefined])("does not announce successful acceptance for %s", (status) => {
    expect(inviteDecisionNotice(status).type).toBe("warning");
});
it("announces the authoritative result of a repeated decision", () => {
    expect(inviteDecisionNotice("accepted").message).toBe("Invitation accepted.");
    expect(inviteDecisionNotice("rejected").message).toBe("Invitation declined.");
});
