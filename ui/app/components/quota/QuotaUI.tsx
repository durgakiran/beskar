
import { cn } from "@/lib/utils";
import { Text } from "@radix-ui/themes";

type UsageTone = "good" | "warning" | "danger" | "neutral";

const toneClasses: Record<UsageTone, { bar: string; pill: string; track: string }> = {
    good: {
        bar: "bg-emerald-500",
        pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
        track: "bg-emerald-100",
    },
    warning: {
        bar: "bg-amber-500",
        pill: "bg-amber-50 text-amber-800 border-amber-200",
        track: "bg-amber-100",
    },
    danger: {
        bar: "bg-rose-500",
        pill: "bg-rose-50 text-rose-700 border-rose-200",
        track: "bg-rose-100",
    },
    neutral: {
        bar: "bg-primary-500",
        pill: "bg-primary-50 text-primary-700 border-primary-200",
        track: "bg-primary-100",
    },
};

export function QuotaStatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
            <Text size="1" weight="medium" className="uppercase tracking-[0.08em] !text-neutral-500">
                {label}
            </Text>
            <div className="mt-3 text-2xl font-semibold text-neutral-900">{value}</div>
            {detail ? (
                <Text size="2" className="mt-2 block !text-neutral-600">
                    {detail}
                </Text>
            ) : null}
        </div>
    );
}

export function QuotaNotice({ title, copy, tone = "neutral" }: { title: string; copy: string; tone?: UsageTone }) {
    const styles = toneClasses[tone];

    return (
        <div className={cn("rounded-xl border px-4 py-3", styles.pill)}>
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 text-sm leading-6">{copy}</div>
        </div>
    );
}

export function QuotaUsageMeter({
    eyebrow,
    title,
    summary,
    usedTitle = "Used",
    usedLabel,
    reservedTitle = "Reserved",
    reservedLabel,
    limitTitle = "Limit",
    limitLabel,
    progressPercent,
    progressLabel,
    tone = "neutral",
    footnote,
}: {
    eyebrow: string;
    title: string;
    summary: string;
    usedTitle?: string;
    usedLabel: string;
    reservedTitle?: string;
    reservedLabel?: string;
    limitTitle?: string;
    limitLabel?: string;
    progressPercent?: number | null;
    progressLabel: string;
    tone?: UsageTone;
    footnote?: string;
}) {
    const styles = toneClasses[tone];
    const clampedPercent = Number.isFinite(progressPercent ?? NaN) ? Math.min(Math.max(progressPercent ?? 0, 0), 100) : 0;

    return (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                    <Text size="1" weight="medium" className="uppercase tracking-[0.08em] !text-neutral-500">
                        {eyebrow}
                    </Text>
                    <h2 className="text-2xl font-semibold text-neutral-900">{title}</h2>
                    <p className="max-w-3xl text-sm leading-6 text-neutral-600">{summary}</p>
                </div>
                <div className={cn("inline-flex w-fit items-center rounded-full border px-3 py-1 text-sm font-semibold", styles.pill)}>{progressLabel}</div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">{usedTitle}</div>
                    <div className="mt-2 text-xl font-semibold text-neutral-900">{usedLabel}</div>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">{reservedTitle}</div>
                    <div className="mt-2 text-xl font-semibold text-neutral-900">{reservedLabel || "0 B"}</div>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-500">{limitTitle}</div>
                    <div className="mt-2 text-xl font-semibold text-neutral-900">{limitLabel || "Not configured"}</div>
                </div>
            </div>

            <div className="mt-6">
                <div className={cn("h-3 overflow-hidden rounded-full", styles.track)}>
                    <div className={cn("h-full rounded-full transition-[width] duration-300", styles.bar)} style={{ width: `${clampedPercent}%` }} />
                </div>
                {footnote ? <p className="mt-3 text-sm leading-6 text-neutral-600">{footnote}</p> : null}
            </div>
        </div>
    );
}
