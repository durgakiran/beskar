'use client'
import { BaseStyles, ThemeProvider } from "@primer/react";
import KeycloakProvider from "app/core/auth/KeycloakProvider";
import UserProvider from "app/core/auth/UserProvider";
import { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
    return (
        <>
            <KeycloakProvider>
                <UserProvider>
                    <ThemeProvider colorMode="day" dayScheme="light_high_contrast" >
                        <BaseStyles>{children}</BaseStyles>
                    </ThemeProvider>
                </UserProvider>
            </KeycloakProvider>
        </>
    );
}
