"use client";
import Header from "@components/menuBar";
import { BaseStyles, ThemeProvider, theme } from "@primer/react";

export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider>
            <BaseStyles>
                <Header />
                {children}
            </BaseStyles>
        </ThemeProvider>
    );
}
