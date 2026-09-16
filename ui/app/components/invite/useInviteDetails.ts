import { useEffect, useState } from "react";
import type { Response } from "@http/hooks";
import type { InviteDetails } from "./types";

export function useInviteDetails(token: string) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<{ data?: Response<InviteDetails>; errors?: Error; isLoading: boolean; response?: number }>({ isLoading: !!token });
    useEffect(() => {
        if (!token) return;
        const controller = new AbortController();
        setState({ isLoading: true });
        void (async () => {
            try {
                const response = await fetch(`${import.meta.env.VITE_USER_SERVER_URL}/invite/user/details?${new URLSearchParams({ token })}`, {
                    credentials: "include",
                    signal: controller.signal,
                });
                const data = await response.json();
                if (!controller.signal.aborted) setState({ data, response: response.status, isLoading: false });
            } catch (error) {
                if (!controller.signal.aborted) setState({ errors: error instanceof Error ? error : new Error("Unable to load invitation"), isLoading: false });
            }
        })();
        return () => controller.abort();
    }, [token, attempt]);
    return { ...state, retry: () => setAttempt((value) => value + 1) };
}
