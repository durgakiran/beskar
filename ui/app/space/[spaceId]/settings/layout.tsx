"use client";
import SettingsTabs from "@components/settings/SettingsTabs";
import { use } from "react";

export default function Layout({ children, params }: { children: React.ReactNode, params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:px-6">
            <SettingsTabs spaceId={spaceId} />
            <div className="min-h-0">
                {children}
            </div>
        </div>
    );
}
