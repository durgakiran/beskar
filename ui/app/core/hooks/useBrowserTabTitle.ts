import { useEffect } from "react";
import { isDesktop } from "../desktop/isDesktop";

const appName = "Teddox";

export function useBrowserTabTitle(title: string | undefined, fallback?: string) {
    const pageTitle = title?.trim() || fallback;

    useEffect(() => {
        if (isDesktop || !pageTitle) return;

        document.title = `${pageTitle} | ${appName}`;
        return () => {
            document.title = appName;
        };
    }, [pageTitle]);
}
