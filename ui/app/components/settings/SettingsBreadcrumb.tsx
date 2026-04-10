import Link from "next/link";

type BreadcrumbItem = {
    label: string;
    href?: string;
};

export default function SettingsBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
    return (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
            {items.map((item, index) => (
                <div key={`${item.label}-${index}`} className="flex items-center gap-2">
                    {item.href ? (
                        <Link href={item.href} className="hover:text-primary-700">
                            {item.label}
                        </Link>
                    ) : (
                        <span className="font-medium text-neutral-700">{item.label}</span>
                    )}
                    {index < items.length - 1 ? <span className="text-neutral-300">/</span> : null}
                </div>
            ))}
        </div>
    );
}
