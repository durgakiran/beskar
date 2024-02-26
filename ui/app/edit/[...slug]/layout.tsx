'use client'
import { BaseStyles, ThemeProvider } from "@primer/react";
import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
    return (
        <>
            <SessionProvider>
                <ThemeProvider colorMode="day" dayScheme="light_high_contrast" >
                    <BaseStyles>{children}</BaseStyles>
                </ThemeProvider>
            </SessionProvider>
        </>
    );
}
