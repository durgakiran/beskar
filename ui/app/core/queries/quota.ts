export type AccountUsageSummary = {
    accountId: string;
    userId: string;
    accountPlanCode?: string;
    accountSubscriptionStatus?: string;
    accountStorageUsed: number;
    accountStorageReserved: number;
    accountStorageLimit?: number | null;
    accountPercentConsumed?: number | null;
    reconciledAccountStorageUsed: number;
    spaceCount: number;
};

export type SpaceUsageSummary = {
    spaceId: string;
    accountId: string;
    accountPlanCode?: string;
    accountSubscriptionStatus?: string;
    spaceStorageUsed: number;
    spaceStorageReserved: number;
    reconciledSpaceStorageUsed: number;
    collaboratorLimitPerSpace?: number | null;
    currentCollaboratorCount: number;
    collaboratorPercentConsumed?: number | null;
};

export const quotaPaths = {
    account: () => "quota/account",
    space: (spaceId: string) => `quota/space/${spaceId}`,
};

export function formatBytes(value?: number | null) {
    if (!Number.isFinite(value ?? NaN)) {
        return "0 B";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = Math.max(0, value ?? 0);
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const fractionDigits = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
    return `${size.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export function formatPercent(value?: number | null) {
    if (!Number.isFinite(value ?? NaN)) {
        return "Not tracked";
    }
    return `${Math.round(value ?? 0)}%`;
}

export function getUsageTone(percent?: number | null): "good" | "warning" | "danger" | "neutral" {
    if (!Number.isFinite(percent ?? NaN)) {
        return "neutral";
    }
    if ((percent ?? 0) >= 100) {
        return "danger";
    }
    if ((percent ?? 0) >= 85) {
        return "warning";
    }
    return "good";
}

export function formatPlanLabel(planCode?: string, subscriptionStatus?: string) {
    const plan = planCode ? planCode.replace(/[_-]+/g, " ") : "No plan";
    const status = subscriptionStatus ? subscriptionStatus.replace(/[_-]+/g, " ") : "No subscription";
    return `${titleCase(plan)} · ${titleCase(status)}`;
}

export function mapQuotaErrorMessage(message?: string | null) {
    const value = (message || "").toLowerCase();
    if (!value) {
        return "This action could not be completed right now.";
    }
    if (value.includes("account storage limit exceeded")) {
        return "This upload would exceed the storage limit for the account that owns this space.";
    }
    if (value.includes("space collaborator limit reached")) {
        return "This space has reached its collaborator limit. Remove a member or clear a pending invite before adding someone else.";
    }
    return message || "This action could not be completed right now.";
}

export function mapUploadErrorMessage(message?: string | null) {
    const value = (message || "").toLowerCase();
    if (!value) {
        return "Upload failed. Please try again.";
    }
    if (value.includes("account storage limit exceeded")) {
        return "This upload would exceed the storage limit for the account that owns this space.";
    }
    if (value.includes("file too large") || value.includes("too large")) {
        return "This file is too large to upload.";
    }
    if (value.includes("mime type not allowed")) {
        return "This file type is not supported.";
    }
    if (value.includes("supported image type") || value.includes("decode image")) {
        return "This image format is not supported.";
    }
    return message || "Upload failed. Please try again.";
}

function titleCase(value: string) {
    return value.replace(/\b\w/g, (match) => match.toUpperCase());
}
