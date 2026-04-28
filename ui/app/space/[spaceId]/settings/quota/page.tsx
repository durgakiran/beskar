"use client";

import { QuotaNotice, QuotaStatCard, QuotaUsageMeter } from "@components/quota/QuotaUI";
import SettingsBreadcrumb from "@components/settings/SettingsBreadcrumb";
import SettingsPageHeader from "@components/settings/SettingsPageHeader";
import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet } from "@http/hooks";
import { Spinner } from "@radix-ui/themes";
import { use, useEffect, useMemo, useState } from "react";
import { SpaceUsageSummary, formatBytes, formatPercent, formatPlanLabel, getUsageTone, quotaPaths } from "../../../../core/queries/quota";

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const [{ isLoading, data, errors, response }, fetchQuota] = useGet<Response<SpaceUsageSummary>>(quotaPaths.space(spaceId));
    const [toast, setToast] = useState<{ type: "warning"; message: string } | null>(null);

    useEffect(() => {
        fetchQuota();
    }, [fetchQuota]);

    useEffect(() => {
        if (errors) {
            setToast({ type: "warning", message: "Unable to load storage and collaborator limits right now." });
        }
    }, [errors]);

    const summary = data?.data;
    const collaboratorTone = useMemo(() => getUsageTone(summary?.collaboratorPercentConsumed), [summary?.collaboratorPercentConsumed]);
    const hasStorageDrift = Boolean(summary && Math.abs((summary.reconciledSpaceStorageUsed ?? 0) - (summary.spaceStorageUsed ?? 0)) > 0);

    if (isLoading) {
        return (
            <div className="flex min-h-[240px] items-center justify-center">
                <Spinner size="3" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <SettingsBreadcrumb items={[{ label: "Settings", href: `/space/${spaceId}/settings/users` }, { label: "Storage & Limits" }]} />

            <SettingsPageHeader
                title="Storage & Limits"
                subtitle="Uploads in this space count against the storage pool of the account that owns the space. Collaborator limits are enforced at the space level."
            />

            {!summary || (response && response >= 400) ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Unable to load quota details for this space.</div>
            ) : (
                <>
                    <QuotaUsageMeter
                        eyebrow={formatPlanLabel(summary.accountPlanCode, summary.accountSubscriptionStatus)}
                        title="Space storage usage"
                        summary="This is the storage currently inside this space. The total is charged to the owning account, not split into a separate per-space budget."
                        usedLabel={formatBytes(summary.spaceStorageUsed)}
                        reservedLabel={formatBytes(summary.spaceStorageReserved)}
                        limitLabel="Account-wide"
                        progressPercent={undefined}
                        progressLabel="Measured per space, enforced per account"
                        tone="neutral"
                        footnote="Reserved bytes represent uploads that have started but have not fully committed yet."
                    />

                    <div className="grid gap-4 md:grid-cols-3">
                        <QuotaStatCard label="Committed storage" value={formatBytes(summary.spaceStorageUsed)} detail="Active attachments and image assets currently counted inside this space." />
                        <QuotaStatCard label="Reserved storage" value={formatBytes(summary.spaceStorageReserved)} detail="Upload reservations held while writes are still finishing." />
                        <QuotaStatCard label="Reconciled storage" value={formatBytes(summary.reconciledSpaceStorageUsed)} detail="Recomputed from canonical asset metadata for drift detection." />
                    </div>

                    <QuotaUsageMeter
                        eyebrow="Membership"
                        title="Collaborator limit"
                        summary="Active members count toward this limit. Pending invites are also considered when new invites are created."
                        usedTitle="Active members"
                        usedLabel={String(summary.currentCollaboratorCount)}
                        reservedTitle="Enforcement"
                        reservedLabel="Per space"
                        limitLabel={summary.collaboratorLimitPerSpace ? String(summary.collaboratorLimitPerSpace) : "Not configured"}
                        progressPercent={summary.collaboratorPercentConsumed}
                        progressLabel={summary.collaboratorLimitPerSpace ? `${formatPercent(summary.collaboratorPercentConsumed)} used` : "Limit not configured"}
                        tone={collaboratorTone}
                        footnote={
                            summary.collaboratorLimitPerSpace
                                ? "Invite creation and acceptance are blocked once the per-space collaborator cap is exceeded."
                                : "No collaborator cap is configured for this plan right now."
                        }
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                        <QuotaStatCard label="Current members" value={String(summary.currentCollaboratorCount)} detail="This count comes from active space membership records." />
                        <QuotaStatCard
                            label="Configured cap"
                            value={summary.collaboratorLimitPerSpace ? String(summary.collaboratorLimitPerSpace) : "Not configured"}
                            detail="Pending invites are checked at invite time even though they are not shown in the active member count above."
                        />
                    </div>

                    {summary.collaboratorLimitPerSpace ? (
                        <QuotaNotice
                            tone={collaboratorTone}
                            title={collaboratorTone === "danger" ? "Collaborator cap reached" : collaboratorTone === "warning" ? "Collaborator cap running high" : "Collaborator capacity is healthy"}
                            copy={
                                collaboratorTone === "danger"
                                    ? "New invites and membership additions will be blocked until someone is removed or a pending invite is cleared."
                                    : collaboratorTone === "warning"
                                      ? "This space is close to its collaborator cap. Pending invites may cause the next invite to fail even before the active member count reaches the number shown above."
                                      : "Collaborator enforcement is local to this space. Activity in other spaces does not affect this cap."
                            }
                        />
                    ) : null}

                    {hasStorageDrift ? (
                        <QuotaNotice
                            tone="warning"
                            title="Storage totals are still reconciling"
                            copy={`Stored usage is ${formatBytes(summary.spaceStorageUsed)}, while the recomputed total is ${formatBytes(summary.reconciledSpaceStorageUsed)}.`}
                        />
                    ) : null}
                </>
            )}

            {toast ? <ToastComponent icon="AlertTriangle" message={toast.message} toggle type={toast.type} /> : null}
        </div>
    );
}
