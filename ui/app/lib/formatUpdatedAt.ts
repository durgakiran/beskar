export function formatUpdatedAt(timestamp?: string | null, now = new Date()): string | null {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;

    if (date.toDateString() === now.toDateString() && date <= now) {
        const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
        if (seconds < 60) return "just now";
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
        const hours = Math.floor(minutes / 60);
        return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    }

    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
