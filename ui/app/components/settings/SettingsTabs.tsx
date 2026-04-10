"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HiMail, HiUsers } from "react-icons/hi";
import { FiSliders } from "react-icons/fi";

const items = [
    { key: "users", label: "Active Users", icon: HiUsers },
    { key: "invites", label: "Invited Users", icon: HiMail },
    { key: "general", label: "Space Settings", icon: FiSliders },
];

export default function SettingsTabs({ spaceId }: { spaceId: string }) {
    const pathname = usePathname();

    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-1">
            <div className="flex flex-wrap gap-1">
                {items.map((item) => {
                    const href = `/space/${spaceId}/settings/${item.key}`;
                    const active = pathname === href;
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.key}
                            href={href}
                            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                                active
                                    ? "bg-primary-100 text-primary-700"
                                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                            }`}
                        >
                            <Icon className="h-4 w-4" />
                            <span className="font-medium">{item.label}</span>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
