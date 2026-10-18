import { useEffect, useState } from "react";
import { Tooltip } from "@radix-ui/themes";
import { FiCalendar, FiChevronRight, FiClock, FiEdit3, FiUser } from "react-icons/fi";
import { formatUpdatedAt } from "../lib/formatUpdatedAt";
import type { ReadOnlyMeta } from "./ReadOnlyContentMain";

function validDate(timestamp?: string | null) {
    if (!timestamp) return null;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
}

function Person({ name }: { name: string }) {
    const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
    return (
        <span className="flex min-w-0 items-start gap-2">
            <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-[10px] font-semibold text-primary-700">
                {initials}
            </span>
            <span className="min-w-0 break-words pt-0.5">{name}</span>
        </span>
    );
}

function Timestamp({ timestamp, label }: { timestamp: string; label: string }) {
    const exactTime = new Date(timestamp).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
    return (
        <Tooltip content={exactTime}>
            <time dateTime={timestamp} tabIndex={0} aria-label={`${label}, ${exactTime}`} className="rounded-sm outline-offset-4">
                {label}
            </time>
        </Tooltip>
    );
}

export default function ReadOnlyPageInfo({ meta }: { meta: ReadOnlyMeta }) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const updatedTimestamp = validDate(meta.updatedAt) ? meta.updatedAt : meta.publishedAt;
    const updatedLabel = formatUpdatedAt(updatedTimestamp, now);
    const createdDate = validDate(meta.createdAt);
    const createdLabel = createdDate?.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    if (!meta.createdByName && !meta.updatedByName && !updatedLabel && !createdLabel) return null;

    const labelClass = "flex items-center gap-2 text-[#898492] [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0";

    return (
        <details className="group min-w-0 text-[13px]">
            <summary className="-ml-2 flex w-fit max-w-full cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-[#898492] transition-colors hover:bg-primary-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 [&::-webkit-details-marker]:hidden">
                <FiChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                <span className="font-medium text-primary-700">Info</span>
                {updatedLabel ? (
                    <>
                        <span aria-hidden="true" className="mx-0.5">·</span>
                        <span>Updated {updatedLabel}</span>
                    </>
                ) : null}
            </summary>
            <dl className="mt-3 grid grid-cols-[minmax(0,125px)_minmax(0,1fr)] items-center gap-x-3 gap-y-4 border-y border-[#e3e1e7] py-4 text-[#605c67] sm:grid-cols-[150px_minmax(0,1fr)]">
                {meta.createdByName ? <><dt className={labelClass}><FiUser aria-hidden="true" />Created by</dt><dd className="min-w-0"><Person name={meta.createdByName} /></dd></> : null}
                {createdLabel && meta.createdAt ? <><dt className={labelClass}><FiCalendar aria-hidden="true" />Created on</dt><dd><Timestamp timestamp={meta.createdAt} label={createdLabel} /></dd></> : null}
                {meta.updatedByName ? <><dt className={labelClass}><FiEdit3 aria-hidden="true" />Last edited by</dt><dd className="min-w-0"><Person name={meta.updatedByName} /></dd></> : null}
                {updatedLabel && updatedTimestamp ? <><dt className={labelClass}><FiClock aria-hidden="true" />Last updated</dt><dd><Timestamp timestamp={updatedTimestamp} label={updatedLabel} /></dd></> : null}
            </dl>
        </details>
    );
}
