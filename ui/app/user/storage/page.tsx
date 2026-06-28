
import { QuotaNotice, QuotaStatCard, QuotaUsageMeter } from "@components/quota/QuotaUI";
import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet } from "@http/hooks";
import { Flex, Heading, Spinner, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { AccountUsageSummary, formatBytes, formatPercent, formatPlanLabel, getUsageTone, quotaPaths } from "../../core/queries/quota";

export default function Page() {
    const [{ data, errors, isLoading, response }, fetchData] = useGet<Response<AccountUsageSummary>>(quotaPaths.account());
    const [toast, setToast] = useState<{ type: "warning"; message: string } | null>(null);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (errors) {
            setToast({ type: "warning", message: "Unable to load account storage right now." });
        }
    }, [errors]);

    const summary = data?.data;
    const usageTone = useMemo(() => getUsageTone(summary?.accountPercentConsumed), [summary?.accountPercentConsumed]);
    const hasDrift = Boolean(summary && Math.abs((summary.reconciledAccountStorageUsed ?? 0) - (summary.accountStorageUsed ?? 0)) > 0);

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Heading size="9" className="!text-[28px] md:!text-[40px] !font-bold !text-[#221f26]">
                    Storage
                </Heading>
                <Text size="4" className="max-w-3xl !text-[#605c67]">
                    Storage is pooled at your account level across every space you own. Collaborators uploading into your spaces also consume this same account budget.
                </Text>
            </div>

            {isLoading ? (
                <Flex align="center" justify="center" py="8">
                    <Spinner size="3" />
                </Flex>
            ) : null}

            {!isLoading && (!summary || (response && response >= 400)) ? (
                <div className="rounded-xl border border-[#d4d1da] bg-[#f8f7f9] p-4">
                    <Text size="3" className="!text-[#605c67]">
                        Unable to load storage usage right now.
                    </Text>
                </div>
            ) : null}

            {!isLoading && summary ? (
                <>
                    <QuotaUsageMeter
                        eyebrow={formatPlanLabel(summary.accountPlanCode, summary.accountSubscriptionStatus)}
                        title="Account storage pool"
                        summary="This is the storage budget enforced for uploads into spaces you own."
                        usedLabel={formatBytes(summary.accountStorageUsed)}
                        reservedLabel={formatBytes(summary.accountStorageReserved)}
                        limitLabel={summary.accountStorageLimit ? formatBytes(summary.accountStorageLimit) : "Not configured"}
                        progressPercent={summary.accountPercentConsumed}
                        progressLabel={summary.accountStorageLimit ? `${formatPercent(summary.accountPercentConsumed)} used` : "Limit not configured"}
                        tone={usageTone}
                        footnote={
                            summary.accountStorageLimit
                                ? `${formatBytes(summary.accountStorageUsed + summary.accountStorageReserved)} is currently committed or reserved across ${summary.spaceCount} owned spaces.`
                                : "No storage limit is configured yet, so uploads are not bounded by an account cap."
                        }
                    />

                    <div className="grid gap-4 md:grid-cols-3">
                        <QuotaStatCard label="Owned spaces" value={String(summary.spaceCount)} detail="Each owned space contributes to the same account storage pool." />
                        <QuotaStatCard label="Reserved bytes" value={formatBytes(summary.accountStorageReserved)} detail="Reserved bytes are uploads in progress that have not fully committed yet." />
                        <QuotaStatCard
                            label="Reconciled usage"
                            value={formatBytes(summary.reconciledAccountStorageUsed)}
                            detail="This is recomputed from attachment and image metadata for drift detection."
                        />
                    </div>

                    {summary.accountStorageLimit ? (
                        <QuotaNotice
                            tone={usageTone}
                            title={usageTone === "danger" ? "Storage limit reached" : usageTone === "warning" ? "Storage running high" : "Storage is healthy"}
                            copy={
                                usageTone === "danger"
                                    ? "New uploads into your owned spaces will be blocked until storage is released or the plan limit changes."
                                    : usageTone === "warning"
                                      ? "You are close to the current account limit. Large uploads in any owned space may start failing soon."
                                      : "Uploads are measured against this account total, not against each space independently."
                            }
                        />
                    ) : (
                        <QuotaNotice
                            title="No storage cap configured"
                            copy="This account currently has no storage limit record. The UI can still show usage totals, but uploads will not be blocked by a storage cap until a plan limit exists."
                        />
                    )}

                    {hasDrift ? (
                        <QuotaNotice
                            tone="warning"
                            title="Usage is still reconciling"
                            copy={`Stored usage is ${formatBytes(summary.accountStorageUsed)}, while the latest recomputed total is ${formatBytes(summary.reconciledAccountStorageUsed)}.`}
                        />
                    ) : null}
                </>
            ) : null}

            {toast ? <ToastComponent icon="AlertTriangle" message={toast.message} toggle type={toast.type} /> : null}
        </div>
    );
}
