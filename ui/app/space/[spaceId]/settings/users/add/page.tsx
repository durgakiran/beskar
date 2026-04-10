"use client";

import SettingsBreadcrumb from "@components/settings/SettingsBreadcrumb";
import SettingsPageHeader from "@components/settings/SettingsPageHeader";
import RoleChip from "@components/settings/RoleChip";
import RoleSelectMenu from "@components/settings/RoleSelectMenu";
import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet, usePost } from "@http/hooks";
import { Button, Spinner, TextField } from "@radix-ui/themes";
import { spaceSettingsPaths } from "../../../../../core/queries/space/settings";
import type { MemberCandidate, MemberCandidateSearchResponse } from "../../types";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FiChevronLeft } from "react-icons/fi";

const USER_URI = process.env.NEXT_PUBLIC_USER_SERVER_URL;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SpaceState = {
    archivedAt?: string | null;
};

function parseInput(value: string) {
    const entries = Array.from(
        new Set(
            value
                .split(/[\s,;\n]+/)
                .map((item) => item.trim().toLowerCase())
                .filter(Boolean)
        )
    );

    return entries.reduce<{ emails: string[]; invalidEmails: string[] }>(
        (acc, entry) => {
            if (entry.includes("@")) {
                if (EMAIL_REGEX.test(entry)) {
                    acc.emails.push(entry);
                } else {
                    acc.invalidEmails.push(entry);
                }
            }
            return acc;
        },
        { emails: [], invalidEmails: [] }
    );
}

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [role, setRole] = useState("viewer");
    const [selectedMatches, setSelectedMatches] = useState<MemberCandidate[]>([]);
    const [selectedUnknowns, setSelectedUnknowns] = useState<MemberCandidate[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "warning"; message: string } | null>(null);
    const parsedInput = useMemo(() => parseInput(query), [query]);
    const invalidEmails = parsedInput.invalidEmails;

    const [{ isLoading: searching, data: searchData, errors: searchErrors }, searchCandidates] = usePost<Response<MemberCandidateSearchResponse>, { query: string; emails: string[]; limit: number }>(
        spaceSettingsPaths.searchCandidates(spaceId)
    );
    const [{ data: spaceDetails }, fetchSpaceDetails] = useGet<Response<SpaceState>>(`space/${spaceId}/details`);
    const validUnknownEmails = useMemo(
        () => (searchData?.data?.unknownEmails ?? []).filter((candidate) => EMAIL_REGEX.test(candidate.email)),
        [searchData]
    );
    const archived = Boolean(spaceDetails?.data?.archivedAt);

    useEffect(() => {
        fetchSpaceDetails();
    }, [fetchSpaceDetails]);

    useEffect(() => {
        if (archived) {
            return;
        }
        if (!query.trim()) {
            return;
        }
        const timeout = setTimeout(() => {
            searchCandidates({ query: query.trim(), emails: parsedInput.emails, limit: 10 });
        }, 250);
        return () => clearTimeout(timeout);
    }, [archived, parsedInput.emails, query, searchCandidates]);

    useEffect(() => {
        const err = searchErrors;
        if (err) {
            setToast({ type: "warning", message: err.message || "Unable to complete request" });
        }
    }, [searchErrors]);

    const results = searchData?.data;
    const allSelected = useMemo(() => [...selectedMatches, ...selectedUnknowns], [selectedMatches, selectedUnknowns]);
    const fallbackHref = `/space/${spaceId}/settings/users`;

    const navigateBack = () => {
        if (typeof window !== "undefined" && window.history.length > 1) {
            router.back();
            return;
        }
        router.push(fallbackHref);
    };

    const toggleMatch = (candidate: MemberCandidate) => {
        setSelectedMatches((current) =>
            current.some((item) => item.email === candidate.email)
                ? current.filter((item) => item.email !== candidate.email)
                : [...current, candidate]
        );
    };

    const toggleUnknown = (candidate: MemberCandidate) => {
        setSelectedUnknowns((current) =>
            current.some((item) => item.email === candidate.email)
                ? current.filter((item) => item.email !== candidate.email)
                : [...current, candidate]
        );
    };

    const submit = async () => {
        if (!USER_URI) {
            setToast({ type: "warning", message: "Missing API base URL configuration" });
            return;
        }
        if (archived) {
            setToast({ type: "warning", message: "This space is archived and read-only" });
            return;
        }

        setSubmitting(true);
        let invitedCount = 0;
        const failures: string[] = [];

        try {
            for (const candidate of [...selectedMatches, ...selectedUnknowns]) {
                const response = await fetch(`${USER_URI}/${spaceSettingsPaths.createInvite()}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        userId: candidate.userId,
                        email: candidate.email,
                        role,
                        entityId: spaceId,
                        entity: "space",
                        token: "",
                        status: "",
                    }),
                });

                if (response.ok) {
                    invitedCount += 1;
                } else {
                    const body = await response.json().catch(() => null);
                    failures.push(body?.error?.detail || body?.error?.message || `Unable to invite ${candidate.email}`);
                }
            }
        } finally {
            setSubmitting(false);
        }

        if (failures.length > 0) {
            setToast({
                type: "warning",
                message:
                    invitedCount > 0
                        ? `Completed with issues: ${invitedCount} invites sent, ${failures.length} failed. ${failures[0]}`
                        : failures[0],
            });
            return;
        }

        setToast({ type: "success", message: "Invites sent successfully" });
        router.push(`/space/${spaceId}/settings/users`);
    };

    return (
        <div className="space-y-6">
            <SettingsBreadcrumb
                items={[
                    { label: "Settings", href: `/space/${spaceId}/settings/users` },
                    { label: "Users", href: `/space/${spaceId}/settings/users` },
                    { label: "Invite User" },
                ]}
            />

            <button
                type="button"
                onClick={navigateBack}
                className="inline-flex w-fit items-center gap-2 text-sm font-medium text-neutral-500 transition-colors hover:text-primary-700"
            >
                <FiChevronLeft className="h-4 w-4" />
                <span>Users</span>
            </button>

            <SettingsPageHeader
                title="Invite User"
                subtitle="Search for an existing member or paste one or more emails to invite people into this space."
            />

            {archived ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    This space is archived. Adding members and sending invites are disabled until the space is unarchived.
                </div>
            ) : null}

            <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-5">
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-neutral-700">Search people or paste emails</label>
                    <TextField.Root value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by email or paste multiple emails" disabled={archived} />
                    {invalidEmails.length > 0 ? (
                        <div className="text-sm text-amber-700">
                            Invalid emails will be ignored: {invalidEmails.join(", ")}
                        </div>
                    ) : null}
                </div>

                <div className="space-y-2">
                    <label className="block text-sm font-medium text-neutral-700">Role for this batch</label>
                    <RoleSelectMenu value={role} onChange={setRole} disabled={archived} />
                </div>

                {searching ? (
                    <div className="flex items-center gap-2 text-sm text-neutral-500">
                        <Spinner size="1" /> Searching
                    </div>
                ) : null}

                {results ? (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <h2 className="text-sm font-semibold text-neutral-700">Directory matches</h2>
                            <div className="space-y-2">
                                {results.matches.map((candidate) => {
                                    const selected = selectedMatches.some((item) => item.email === candidate.email);
                                    return (
                                        <button
                                            key={candidate.email}
                                            type="button"
                                            onClick={() => toggleMatch(candidate)}
                                            className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left ${
                                                selected ? "border-primary-300 bg-primary-50" : "border-neutral-200 bg-white"
                                            }`}
                                        >
                                            <div>
                                                <div className="font-medium text-neutral-900">{candidate.name || candidate.email}</div>
                                                <div className="text-sm text-neutral-500">{candidate.email}</div>
                                            </div>
                                            <span className="text-sm font-medium text-primary-700">{selected ? "Selected" : "Select"}</span>
                                        </button>
                                    );
                                })}
                                {results.matches.length === 0 ? <div className="text-sm text-neutral-500">No directory matches found.</div> : null}
                            </div>
                        </div>

                        {results.existingMembers.length > 0 ? (
                            <div className="space-y-2">
                                <h2 className="text-sm font-semibold text-neutral-700">Already in this space</h2>
                                <div className="space-y-2">
                                    {results.existingMembers.map((candidate) => (
                                        <div key={candidate.email} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                                            <div>
                                                <div className="font-medium text-neutral-900">{candidate.name || candidate.email}</div>
                                                <div className="text-sm text-neutral-500">{candidate.email}</div>
                                            </div>
                                            <RoleChip role={(candidate.currentRole as any) || "viewer"} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {results.pendingInvites.length > 0 ? (
                            <div className="space-y-2">
                                <h2 className="text-sm font-semibold text-neutral-700">Already invited</h2>
                                <div className="space-y-2">
                                    {results.pendingInvites.map((candidate) => (
                                        <div key={candidate.email} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                                            <div>
                                                <div className="font-medium text-neutral-900">{candidate.email}</div>
                                                <div className="text-sm text-neutral-500">Pending invite</div>
                                            </div>
                                            <RoleChip role={(candidate.currentRole as any) || "viewer"} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {validUnknownEmails.length > 0 ? (
                            <div className="space-y-2">
                                <h2 className="text-sm font-semibold text-neutral-700">Email invites</h2>
                                <div className="space-y-2">
                                    {validUnknownEmails.map((candidate) => {
                                        const selected = selectedUnknowns.some((item) => item.email === candidate.email);
                                        return (
                                            <button
                                                key={candidate.email}
                                                type="button"
                                                onClick={() => toggleUnknown(candidate)}
                                                className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left ${
                                                    selected ? "border-primary-300 bg-primary-50" : "border-neutral-200 bg-white"
                                                }`}
                                            >
                                                <div>
                                                    <div className="font-medium text-neutral-900">{candidate.email}</div>
                                                    <div className="text-sm text-neutral-500">Will be invited by email</div>
                                                </div>
                                                <span className="text-sm font-medium text-primary-700">{selected ? "Selected" : "Invite"}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                    <div className="text-sm font-medium text-neutral-900">Selected</div>
                    <div className="mt-1 text-sm text-neutral-500">
                        {allSelected.length === 0 ? "No users selected yet." : `${allSelected.length} users will receive an invite to join this space.`}
                    </div>
                </div>

                <Button disabled={archived || allSelected.length === 0 || submitting} onClick={submit}>
                    {submitting ? "Sending invites..." : "Send invites"}
                </Button>
            </div>

            {toast ? (
                <ToastComponent
                    icon={toast.type === "success" ? "Check" : "AlertTriangle"}
                    message={toast.message}
                    toggle
                    type={toast.type}
                />
            ) : null}
        </div>
    );
}
