import { ReactNode } from "react";

export default function SettingsPageHeader({
    title,
    subtitle,
    action,
}: {
    title: string;
    subtitle?: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-neutral-900 md:text-4xl">{title}</h1>
                {subtitle ? <p className="max-w-3xl text-sm leading-6 text-neutral-600">{subtitle}</p> : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}
