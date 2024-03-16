'use client'
import KeycloakProvider from "app/core/auth/KeycloakProvider";
import UserProvider from "app/core/auth/UserProvider";
import { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
    return (
        <>
            <KeycloakProvider>
                <UserProvider>
                    {children}
                </UserProvider>
            </KeycloakProvider>
        </>
    );
}
