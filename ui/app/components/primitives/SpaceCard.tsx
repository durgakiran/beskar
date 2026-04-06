"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { SpaceCardProps } from "./types";

function CardBody({ title, description, badge, badges = [], meta, leadingLabel, className }: Omit<SpaceCardProps, "href" | "onClick">) {
    const iconText = leadingLabel || title.charAt(0).toUpperCase();

    return (
        <div className={cn("flex h-[208px] w-full min-w-0 flex-col gap-4 rounded-[10px] border border-neutral-200 bg-white p-4", className)}>
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-primary-100 text-[20px] font-bold leading-none text-primary-800">
                        {iconText}
                    </div>
                    <h3 className="truncate text-base font-semibold leading-6 text-neutral-900">{title}</h3>
                </div>
                {badge ? (
                    <div className="shrink-0 rounded-full bg-primary-100 p-2 text-xs font-semibold text-primary-800">{badge}</div>
                ) : null}
            </div>
            <p className="line-clamp-2 text-sm font-normal leading-[1.6] text-neutral-800">{description}</p>
            <div className="flex flex-wrap gap-2">
                {badges.map((chip) => (
                    <span key={chip} className="rounded-full bg-neutral-100 p-2 text-xs font-normal leading-none text-neutral-800">
                        {chip}
                    </span>
                ))}
            </div>
            <div className="mt-auto text-xs font-normal leading-none text-neutral-700">{meta}</div>
        </div>
    );
}

export function SpaceCard(props: SpaceCardProps) {
    if (props.href) {
        return (
            <Link href={props.href} className="block transition-transform hover:-translate-y-0.5">
                <CardBody {...props} />
            </Link>
        );
    }

    if (props.onClick) {
        return (
            <button type="button" onClick={props.onClick} className="block w-full text-left transition-transform hover:-translate-y-0.5">
                <CardBody {...props} />
            </button>
        );
    }

    return <CardBody {...props} />;
}
