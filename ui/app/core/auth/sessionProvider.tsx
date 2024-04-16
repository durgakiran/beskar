// src/components/SessionGuard.tsx
"use client";
import { signIn, useSession } from "next-auth/react";
import { ReactNode, useEffect } from "react";

export default function SessionGuard({ children }: { children: ReactNode }) {
    const { data, status } = useSession();
    useEffect(() => {
        if (status !== "loading") {
            if (!data || (data as any)?.error === "RefreshAccessTokenError") {
                signIn("keycloak");
            } else {
                localStorage.setItem("access_token", data.accessToken)
            }
        }
    }, [data, status]);

    return <>{children}</>;
}
