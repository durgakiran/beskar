
import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { HiMail, HiUsers } from "react-icons/hi";
import { FiHardDrive, FiSliders } from "react-icons/fi";

const items = [
    { key: "users", label: "Active Users", icon: HiUsers },
    { key: "invites", label: "Invited Users", icon: HiMail },
    { key: "quota", label: "Storage & Limits", icon: FiHardDrive },
    { key: "general", label: "Space Settings", icon: FiSliders },
];

export default function SettingsTabs({ spaceId }: { spaceId: string }) {
    const pathname = useLocation().pathname;

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
                            to={href}
                            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                                active ? "bg-primary-100 text-primary-700" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
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
