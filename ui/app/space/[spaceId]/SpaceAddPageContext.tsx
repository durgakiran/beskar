"use client";

import { createContext, useContext, type ReactNode } from "react";

export type OpenAddPageFn = (parentPageId?: string) => void;

const SpaceAddPageContext = createContext<OpenAddPageFn | null>(null);

export function SpaceAddPageProvider({ children, openAddPage }: { children: ReactNode; openAddPage: OpenAddPageFn }) {
    return <SpaceAddPageContext.Provider value={openAddPage}>{children}</SpaceAddPageContext.Provider>;
}

export function useSpaceAddPage(): OpenAddPageFn {
    const ctx = useContext(SpaceAddPageContext);
    if (!ctx) {
        throw new Error("useSpaceAddPage must be used within SpaceAddPageProvider");
    }
    return ctx;
}
