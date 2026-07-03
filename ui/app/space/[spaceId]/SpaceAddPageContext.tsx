
import { createContext, useContext, type ReactNode } from "react";

export type OpenAddPageFn = (parentPageId?: string) => void;
export type RefreshSpacePagesFn = () => void;

type SpacePageActions = {
    openAddPage: OpenAddPageFn;
    refreshPages: RefreshSpacePagesFn;
};

const SpaceAddPageContext = createContext<SpacePageActions | null>(null);

export function SpaceAddPageProvider({
    children,
    openAddPage,
    refreshPages,
}: {
    children: ReactNode;
    openAddPage: OpenAddPageFn;
    refreshPages: RefreshSpacePagesFn;
}) {
    return <SpaceAddPageContext.Provider value={{ openAddPage, refreshPages }}>{children}</SpaceAddPageContext.Provider>;
}

export function useSpaceAddPage(): OpenAddPageFn {
    const ctx = useContext(SpaceAddPageContext);
    if (!ctx) {
        throw new Error("useSpaceAddPage must be used within SpaceAddPageProvider");
    }
    return ctx.openAddPage;
}

export function useOptionalSpacePagesRefresh(): RefreshSpacePagesFn | null {
    return useContext(SpaceAddPageContext)?.refreshPages ?? null;
}
