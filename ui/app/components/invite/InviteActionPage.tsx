"use client";

import { Icon } from "@components/ui/Icon";
import { Response, useGet } from "@http/hooks";
import { Spinner } from "@radix-ui/themes";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInviteRole, formatInviteTime, normalizeInviteStatus } from "./formatters";
import type { InviteDecision, InviteDetails } from "./types";
import { useInviteDecision } from "./useInviteDecision";

function BrandMark() {
    return (
        <div className="relative h-9 w-9 shrink-0 rounded-lg bg-primary-700">
            <span className="absolute left-[10px] top-2 h-[5px] w-[15px] rounded-full bg-white" />
            <span className="absolute left-[11px] top-3 h-[15px] w-[5px] rounded-full bg-white" />
            <span className="absolute left-[23px] top-[23px] h-[7px] w-[7px] rounded-full bg-primary-100" />
        </div>
    );
}

function InviteHeader() {
    return (
        <header className="border-b border-neutral-200 bg-white">
            <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-4 py-[18px] sm:px-8 lg:px-10">
                <Link href="/" className="flex items-center gap-2.5">
                    <BrandMark />
                    <span className="text-[22px] font-bold leading-none text-neutral-900">Teddox</span>
                </Link>
                <Link
                    href="/user/notifications"
                    className="inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3.5 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-100"
                >
                    <Icon name="Bell" className="h-[15px] w-[15px]" strokeWidth={2} />
                    Notifications
                </Link>
            </div>
        </header>
    );
}

function ActionButton({
    children,
    tone = "primary",
    disabled,
    onClick,
    href,
}: {
    children: React.ReactNode;
    tone?: "primary" | "secondary" | "danger" | "disabled";
    disabled?: boolean;
    onClick?: () => void;
    href?: string;
}) {
    const className = [
        "inline-flex min-h-11 items-center justify-center rounded-md px-[18px] py-3 text-sm font-semibold transition-colors",
        tone === "primary" && "bg-primary-700 text-white hover:bg-primary-800",
        tone === "secondary" && "border border-neutral-400 bg-white text-neutral-800 hover:bg-neutral-100",
        tone === "danger" && "bg-[#b42318] text-white hover:bg-[#971d13]",
        tone === "disabled" && "bg-neutral-400 text-white",
        disabled && "cursor-not-allowed opacity-60 hover:bg-current",
    ]
        .filter(Boolean)
        .join(" ");

    if (href && !disabled) {
        return (
            <Link href={href} className={className}>
                {children}
            </Link>
        );
    }

    return (
        <button type="button" className={className} disabled={disabled} onClick={onClick}>
            {children}
        </button>
    );
}

function StateCard({
    icon,
    iconTone = "primary",
    eyebrow,
    title,
    copy,
    actions,
}: {
    icon: React.ComponentProps<typeof Icon>["name"];
    iconTone?: "primary" | "success" | "danger";
    eyebrow: string;
    title: string;
    copy: string;
    actions: React.ReactNode;
}) {
    const iconClass = iconTone === "success" ? "bg-success-100 text-success-700" : iconTone === "danger" ? "bg-error-50 text-[#b42318]" : "bg-primary-200 text-primary-700";

    return (
        <main className="mx-auto flex min-h-[calc(100vh-77px)] w-full max-w-[1200px] px-4 py-10 sm:px-8 lg:px-[248px] lg:py-24">
            <section className="w-full rounded-xl border border-neutral-400 bg-white p-6 sm:p-9">
                <div className={`flex h-11 w-11 items-center justify-center rounded-md ${iconClass}`}>
                    <Icon name={icon} className="h-5 w-5" strokeWidth={2} />
                </div>
                <div className="mt-5 text-xs font-semibold uppercase text-neutral-600">{eyebrow}</div>
                <h1 className="mt-3 text-[28px] font-bold leading-tight text-neutral-900 sm:text-[34px]">{title}</h1>
                <p className="mt-4 max-w-[620px] text-base leading-6 text-neutral-800">{copy}</p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">{actions}</div>
            </section>
        </main>
    );
}

function DetailsPanel({ invite }: { invite: InviteDetails }) {
    const rows = [
        ["Space", invite.name || "Space"],
        ["Role", formatInviteRole(invite.role)],
        ["Created", formatInviteTime(invite.createdAt)],
    ];

    return (
        <aside className="w-full rounded-xl border border-neutral-400 bg-white p-5 lg:w-80">
            <div className="text-xs font-semibold uppercase text-neutral-600">Invite details</div>
            <div className="mt-[18px] flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-200 text-sm font-bold text-primary-700">
                    {(invite.senderName || "S").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-neutral-900">{invite.senderName || "Someone"}</div>
                    <div className="text-xs text-neutral-800">Sent this invitation</div>
                </div>
            </div>
            <div className="my-[18px] h-px bg-neutral-200" />
            <div className="space-y-3.5">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-[13px] font-medium text-neutral-600">{label}</span>
                        <span className="truncate font-semibold text-neutral-900">{value}</span>
                    </div>
                ))}
            </div>
        </aside>
    );
}

function PendingInvite({
    invite,
    onAccept,
    onDecline,
    loadingDecision,
}: {
    invite: InviteDetails;
    onAccept: () => void;
    onDecline: () => void;
    loadingDecision: InviteDecision | null;
}) {
    const roleLabel = formatInviteRole(invite.role);

    return (
        <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-4 py-8 sm:px-8 lg:flex-row lg:px-[72px] lg:py-12">
            <section className="min-w-0 flex-1 rounded-xl border border-neutral-400 bg-white">
                <div className="border-b border-neutral-400 px-5 py-6 sm:px-[30px] sm:py-7">
                    <div className="text-xs font-semibold uppercase text-neutral-600">Action required</div>
                    <h1 className="mt-3 text-[26px] font-bold leading-tight text-neutral-900 sm:text-[30px]">
                        {invite.senderName || "Someone"} invited you to join {invite.name || "this space"}
                    </h1>
                    <p className="mt-3 text-[15px] leading-6 text-neutral-800">
                        Review the invite details before choosing. Opening this page does not change invite status.
                    </p>
                </div>
                <div className="space-y-5 px-5 py-6 sm:px-[30px]">
                    <div className="flex gap-3 rounded-md border border-primary-600 bg-primary-100 px-[18px] py-4">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-200 text-primary-700">
                            <Icon name="Users" className="h-4 w-4" strokeWidth={2} />
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm font-semibold text-neutral-900">Access level: {roleLabel}</div>
                            <p className="mt-1 text-sm leading-5 text-neutral-800">
                                Accepting adds this space to your workspace list. Declining removes it from pending notifications.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <ActionButton tone="secondary" disabled={!!loadingDecision} onClick={onDecline}>
                            Decline
                        </ActionButton>
                        <ActionButton tone="primary" disabled={!!loadingDecision} onClick={onAccept}>
                            {loadingDecision === "accept" ? "Accepting..." : "Accept invite"}
                        </ActionButton>
                    </div>
                </div>
            </section>
            <DetailsPanel invite={invite} />
        </main>
    );
}

function DeclineConfirmation({
    invite,
    onCancel,
    onAccept,
    onConfirm,
    loadingDecision,
}: {
    invite: InviteDetails;
    onCancel: () => void;
    onAccept: () => void;
    onConfirm: () => void;
    loadingDecision: InviteDecision | null;
}) {
    return (
        <main className="mx-auto flex min-h-[calc(100vh-77px)] w-full max-w-[1200px] px-4 py-10 sm:px-8 lg:px-[248px] lg:py-[72px]">
            <section className="w-full rounded-xl border border-neutral-400 bg-white p-6 sm:p-8">
                <div className="text-xs font-semibold uppercase text-neutral-600">Confirm decline</div>
                <h1 className="mt-5 text-[28px] font-bold leading-tight text-neutral-900 sm:text-[34px]">
                    Decline invitation to {invite.name || "this space"}?
                </h1>
                <div className="mt-5 flex gap-3 rounded-md border border-primary-600 bg-primary-100 px-4 py-3.5">
                    <Icon name="TriangleAlert" className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" strokeWidth={2} />
                    <p className="text-sm font-medium leading-5 text-neutral-900">
                        Declining is final for this invite. {invite.senderName || "The sender"} can invite you again later.
                    </p>
                </div>
                <p className="mt-5 text-base leading-6 text-neutral-800">
                    Declining removes this invite from your notifications. You will not gain access to {invite.name || "this space"}.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <ActionButton tone="secondary" disabled={!!loadingDecision} onClick={onCancel}>
                        Cancel
                    </ActionButton>
                    <ActionButton tone="secondary" disabled={!!loadingDecision} onClick={onAccept}>
                        Accept instead
                    </ActionButton>
                    <ActionButton tone="danger" disabled={!!loadingDecision} onClick={onConfirm}>
                        {loadingDecision === "reject" ? "Declining..." : "Confirm decline"}
                    </ActionButton>
                </div>
            </section>
        </main>
    );
}

function LoadingState() {
    return (
        <StateCard
            icon="Loader"
            eyebrow="Loading invite"
            title="Loading invitation details"
            copy="Checking the invite and your account before any action is taken."
            actions={
                <>
                    <ActionButton tone="disabled" disabled>
                        <span className="inline-flex items-center gap-2">
                            <Spinner size="1" />
                            Loading...
                        </span>
                    </ActionButton>
                    <ActionButton tone="secondary" href="/user/notifications">
                        Back to notifications
                    </ActionButton>
                </>
            }
        />
    );
}

export default function InviteActionPage() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token") || "";
    const initialDecision = searchParams.get("decision") === "reject" ? "reject" : searchParams.get("decision") === "accept" ? "accept" : null;
    const [{ data, errors, isLoading, response }, fetchInvite] = useGet<Response<InviteDetails>>("invite/user/details");
    const { data: decisionData, errors: decisionErrors, isLoading: isDeciding, response: decisionResponse, pendingDecision, submitDecision } = useInviteDecision();
    const [selectedDecision, setSelectedDecision] = useState<InviteDecision | null>(initialDecision);
    const [localError, setLocalError] = useState(false);

    useEffect(() => {
        setSelectedDecision(initialDecision);
    }, [initialDecision]);

    useEffect(() => {
        if (token) {
            fetchInvite({ token });
        }
    }, [fetchInvite, token]);

    useEffect(() => {
        if (decisionErrors || (decisionResponse && decisionResponse >= 400)) {
            setLocalError(true);
        }
    }, [decisionErrors, decisionResponse]);

    const invite = data?.data;
    const inviteStatus = normalizeInviteStatus(invite?.status);
    const decisionStatus = normalizeInviteStatus(decisionData?.data?.status);
    const loadingDecision = isDeciding ? pendingDecision : null;

    const submit = useCallback((decision: InviteDecision) => {
        setLocalError(false);
        setSelectedDecision(decision);
        submitDecision(token, decision);
    }, [submitDecision, token]);

    const resultActions = useCallback((status: "accepted" | "rejected") => {
        if (status === "accepted") {
            const spaceHref = decisionData?.data?.entityId || invite?.entityId ? `/space/${decisionData?.data?.entityId || invite?.entityId}` : "/space";
            return (
                <>
                    <ActionButton tone="primary" href={spaceHref}>
                        Open space
                    </ActionButton>
                    <ActionButton tone="secondary" href="/user/notifications">
                        Back to notifications
                    </ActionButton>
                </>
            );
        }
        return (
            <>
                <ActionButton tone="primary" href="/user/notifications">
                    Back to notifications
                </ActionButton>
                <ActionButton tone="secondary" href="/space">
                    Open workspace
                </ActionButton>
            </>
        );
    }, [decisionData?.data?.entityId, invite?.entityId]);

    const content = useMemo(() => {
        if (!token) {
            return (
                <StateCard
                    icon="Link2Off"
                    iconTone="danger"
                    eyebrow="Invite link"
                    title="This invitation link is invalid"
                    copy="The link may be missing a token, expired, or no longer available."
                    actions={
                        <>
                            <ActionButton tone="primary" href="/user/notifications">
                                Back to notifications
                            </ActionButton>
                            <ActionButton tone="secondary" href="/space">
                                Open workspace
                            </ActionButton>
                        </>
                    }
                />
            );
        }

        if (isLoading || (!response && !invite && !errors)) {
            return <LoadingState />;
        }

        if (response === 403) {
            return (
                <StateCard
                    icon="UserX"
                    eyebrow="Account check"
                    title="This invite belongs to another account"
                    copy="Sign out, then sign in with the email address that received this invitation."
                    actions={
                        <>
                            <ActionButton tone="primary" href="/auth/logout">
                                Switch account
                            </ActionButton>
                            <ActionButton tone="secondary" href="/user/notifications">
                                Open notifications
                            </ActionButton>
                        </>
                    }
                />
            );
        }

        if (errors || (response && response >= 400 && response !== 403) || !invite) {
            return (
                <StateCard
                    icon="Link2Off"
                    iconTone="danger"
                    eyebrow="Invite link"
                    title="This invitation link is invalid"
                    copy="The link may be missing a token, expired, or no longer available."
                    actions={
                        <>
                            <ActionButton tone="primary" href="/user/notifications">
                                Back to notifications
                            </ActionButton>
                            <ActionButton tone="secondary" href="/space">
                                Open workspace
                            </ActionButton>
                        </>
                    }
                />
            );
        }

        if (localError) {
            return (
                <StateCard
                    icon="TriangleAlert"
                    iconTone="danger"
                    eyebrow="Action failed"
                    title="Could not update invitation"
                    copy="The invite could not be updated. Check your connection and try again."
                    actions={
                        <>
                            <ActionButton tone="primary" onClick={() => submit(selectedDecision || "accept")}>
                                Try again
                            </ActionButton>
                            <ActionButton tone="secondary" href="/user/notifications">
                                Back to notifications
                            </ActionButton>
                        </>
                    }
                />
            );
        }

        const resolvedStatus = decisionStatus || inviteStatus;
        if (resolvedStatus === "accepted") {
            const already = !decisionStatus;
            return (
                <StateCard
                    icon="CircleCheck"
                    iconTone="success"
                    eyebrow={already ? "Already accepted" : "Invitation accepted"}
                    title={already ? "You already accepted this invitation" : "Invitation accepted"}
                    copy={`${invite.name || "This space"} is ${already ? "already " : ""}available from your workspace list.`}
                    actions={resultActions("accepted")}
                />
            );
        }

        if (resolvedStatus === "rejected" || resolvedStatus === "removed") {
            const already = !decisionStatus;
            return (
                <StateCard
                    icon="CircleX"
                    iconTone="danger"
                    eyebrow={already ? "Already declined" : "Invitation declined"}
                    title={already ? "You already declined this invitation" : "Invitation declined"}
                    copy={
                        already
                            ? `This invite is no longer pending. Ask ${invite.senderName || "the sender"} to send another invite if you need access.`
                            : `The invite was removed from notifications. ${invite.senderName || "The sender"} can invite you again later.`
                    }
                    actions={resultActions("rejected")}
                />
            );
        }

        if (isDeciding) {
            const actionWord = pendingDecision === "reject" ? "Declining" : "Accepting";
            return (
                <StateCard
                    icon="Loader"
                    eyebrow="Updating invite"
                    title={`${actionWord} invitation`}
                    copy={`Keep this page open while Beskar updates your access to ${invite.name || "this space"}.`}
                    actions={
                        <>
                            <ActionButton tone="disabled" disabled>
                                <span className="inline-flex items-center gap-2">
                                    <Spinner size="1" />
                                    {actionWord}...
                                </span>
                            </ActionButton>
                            <ActionButton tone="secondary" href="/user/notifications">
                                Back to notifications
                            </ActionButton>
                        </>
                    }
                />
            );
        }

        if (selectedDecision === "reject") {
            return (
                <DeclineConfirmation
                    invite={invite}
                    loadingDecision={loadingDecision}
                    onCancel={() => setSelectedDecision("accept")}
                    onAccept={() => submit("accept")}
                    onConfirm={() => submit("reject")}
                />
            );
        }

        return (
            <PendingInvite
                invite={invite}
                loadingDecision={loadingDecision}
                onAccept={() => submit("accept")}
                onDecline={() => setSelectedDecision("reject")}
            />
        );
    }, [
        decisionStatus,
        errors,
        invite,
        inviteStatus,
        isDeciding,
        isLoading,
        loadingDecision,
        localError,
        pendingDecision,
        response,
        resultActions,
        selectedDecision,
        submit,
        token,
    ]);

    return (
        <div className="min-h-screen bg-[#fbfafc] text-neutral-900">
            <InviteHeader />
            {content}
        </div>
    );
}
