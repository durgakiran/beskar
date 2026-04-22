const API_V1_SUFFIX = /\/api\/v1\/?$/;

export function normalizeApiV1Base(base?: string | null): string {
    const value = (base || "").trim().replace(/\/+$/, "");
    if (!value) {
        return "/api/v1";
    }
    return API_V1_SUFFIX.test(value) ? value : `${value}/api/v1`;
}

export function getApiV1Base(options?: { fallbackBase?: string | null }): string {
    return normalizeApiV1Base(
        process.env.NEXT_PUBLIC_API_BASE_URL ||
            process.env.NEXT_PUBLIC_API_URL ||
            options?.fallbackBase ||
            "",
    );
}

export function getApiOrigin(options?: { fallbackBase?: string | null }): string {
    return getApiV1Base(options).replace(API_V1_SUFFIX, "");
}
