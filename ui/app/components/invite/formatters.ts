export function normalizeInviteRole(role: string) {
    if (role === "commentor") {
        return "commenter";
    }
    return role;
}

export function formatInviteRole(role: string) {
    const normalized = normalizeInviteRole(role || "member");
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function normalizeInviteStatus(status?: string | null) {
    const value = status?.trim().toLowerCase();
    if (!value) {
        return null;
    }
    if (value === "accepted") {
        return "accepted";
    }
    if (value === "rejected" || value === "declined") {
        return "rejected";
    }
    if (value === "removed") {
        return "removed";
    }
    return value;
}

export function formatInviteTime(value?: string) {
    if (!value) {
        return "Pending";
    }

    const createdAt = new Date(value);
    if (Number.isNaN(createdAt.getTime())) {
        return "Pending";
    }

    const diffMs = Date.now() - createdAt.getTime();
    const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
        return `${diffDays}d ago`;
    }

    return createdAt.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}
