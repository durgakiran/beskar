import { describe, expect, it } from "vitest";
import { formatUpdatedAt } from "./formatUpdatedAt";

describe("view update time", () => {
    const now = new Date(2026, 9, 18, 14, 30);
    const today = (hours: number, minutes: number, seconds = 0) => new Date(2026, 9, 18, hours, minutes, seconds).toISOString();

    it("uses relative time for updates today", () => {
        expect(formatUpdatedAt(today(14, 29, 50), now)).toBe("just now");
        expect(formatUpdatedAt(today(14, 29), now)).toBe("1 minute ago");
        expect(formatUpdatedAt(today(14, 20), now)).toBe("10 minutes ago");
        expect(formatUpdatedAt(today(13, 30), now)).toBe("1 hour ago");
        expect(formatUpdatedAt(today(12, 30), now)).toBe("2 hours ago");
    });

    it("uses a calendar date even for a recent update before midnight", () => {
        const yesterday = new Date(2026, 9, 17, 23, 59);
        expect(formatUpdatedAt(yesterday.toISOString(), new Date(2026, 9, 18, 0, 1))).toBe(
            yesterday.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
        );
    });

    it("handles missing, invalid and future timestamps", () => {
        expect(formatUpdatedAt(null, now)).toBeNull();
        expect(formatUpdatedAt("invalid", now)).toBeNull();
        expect(formatUpdatedAt(today(15, 0), now)).not.toContain("ago");
    });
});
