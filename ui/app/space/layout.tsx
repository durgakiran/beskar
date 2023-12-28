'use client'
import Header from "@components/menuBar";
import { BaseStyles, ThemeProvider } from "@primer/react";
import { SessionProvider, useSession } from "next-auth/react";

export default function Layout({children}: {children: React.ReactNode}) {

    return (
        <SessionProvider>
            <ThemeProvider>
                <BaseStyles>
                    <Header />
                    {children}
                </BaseStyles>
            </ThemeProvider>
        </SessionProvider>
    )
    
}