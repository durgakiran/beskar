import axios from "axios";

export function extractRequestErrorMessage(error: unknown, fallback: string) {
    if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.error?.detail;
        const message = error.response?.data?.error?.message;
        return detail || message || error.message || fallback;
    }
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (error && typeof error === "object") {
        const detail = (error as { error?: { detail?: string; message?: string } }).error?.detail;
        const message = (error as { error?: { detail?: string; message?: string } }).error?.message;
        return detail || message || fallback;
    }
    return fallback;
}
