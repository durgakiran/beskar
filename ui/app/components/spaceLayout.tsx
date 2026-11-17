import type { ReactNode } from "react";
import WorkspaceRail from "./WorkspaceRail";

export default function SpaceLayout({ children, railActions }: { children: ReactNode; railActions?: ReactNode }) {
    return (
        <div className="isolate flex h-dvh w-full overflow-hidden bg-[var(--background)]">
            <WorkspaceRail actions={railActions} />
            <div className="relative z-0 min-h-0 min-w-0 flex-1 overflow-auto">
                {children}
            </div>
        </div>
    );
}
