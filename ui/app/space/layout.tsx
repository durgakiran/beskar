"use client";
import Header from "@components/menuBar";
import { BaseStyles, ThemeProvider, theme } from "@primer/react";
import KeycloakProvider from "app/core/auth/KeycloakProvider";
import UserProvider from "app/core/auth/UserProvider";

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <KeycloakProvider>
            <UserProvider>
                <ThemeProvider>
                    <BaseStyles>
                        <Header />
                        {children}
                    </BaseStyles>
                </ThemeProvider>
            </UserProvider>
        </KeycloakProvider>
    );
}
