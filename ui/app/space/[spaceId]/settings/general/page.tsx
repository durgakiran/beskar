"use client";

import SettingsBreadcrumb from "@components/settings/SettingsBreadcrumb";
import SettingsPageHeader from "@components/settings/SettingsPageHeader";
import TransferOwnershipModal from "@components/settings/TransferOwnershipModal";
import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet, usePost } from "@http/hooks";
import { Button, Spinner, TextField } from "@radix-ui/themes";
import { spaceSettingsPaths } from "../../../../core/queries/space/settings";
import type { SpaceMember, SpaceSettingsState } from "../types";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const router = useRouter();
    const [{ isLoading, data, errors }, fetchSettings] = useGet<Response<SpaceSettingsState>>(spaceSettingsPaths.settings(spaceId));
    const [{ data: usersData }, fetchUsers] = useGet<Response<SpaceMember[]>>(spaceSettingsPaths.users(spaceId));
    const [{ data: archiveData, errors: archiveErrors, isLoading: archiveLoading }, archiveSpace] = usePost<Response<SpaceSettingsState>, Record<string, never>>(
        spaceSettingsPaths.archive(spaceId)
    );
    const [{ data: unarchiveData, errors: unarchiveErrors, isLoading: unarchiveLoading }, unarchiveSpace] = usePost<Response<SpaceSettingsState>, Record<string, never>>(
        spaceSettingsPaths.unarchive(spaceId)
    );
    const [{ data: transferData, errors: transferErrors, isLoading: transferLoading }, transferOwnership] = usePost<Response<SpaceMember>, { newOwnerUserId: string }>(
        spaceSettingsPaths.transferOwnership(spaceId)
    );
    const [{ data: deleteData, errors: deleteErrors, isLoading: deleteLoading }, deleteSpace] = usePost<Response<{ deleted: boolean }>, { confirmName: string }>(
        spaceSettingsPaths.deleteSpace(spaceId)
    );
    const [transferOpen, setTransferOpen] = useState(false);
    const [confirmName, setConfirmName] = useState("");
    const [toast, setToast] = useState<{ type: "success" | "warning"; message: string } | null>(null);

    useEffect(() => {
        fetchSettings();
        fetchUsers();
    }, [fetchSettings, fetchUsers]);

    useEffect(() => {
        if (archiveData || unarchiveData || transferData) {
            fetchSettings();
            fetchUsers();
        }
        if (archiveData) setToast({ type: "success", message: "Space archived" });
        if (unarchiveData) setToast({ type: "success", message: "Space restored" });
        if (transferData) {
            setToast({ type: "success", message: "Ownership transferred" });
            setTransferOpen(false);
        }
    }, [archiveData, unarchiveData, transferData, fetchSettings, fetchUsers]);

    useEffect(() => {
        if (deleteData?.data?.deleted) {
            router.push("/space");
        }
    }, [deleteData, router]);

    useEffect(() => {
        const err = archiveErrors || unarchiveErrors || transferErrors || deleteErrors;
        if (err) {
            setToast({ type: "warning", message: err.message || "Unable to complete request" });
        }
    }, [archiveErrors, unarchiveErrors, transferErrors, deleteErrors]);

    const settings = data?.data;
    const members = useMemo(() => usersData?.data ?? [], [usersData]);
    const archived = Boolean(settings?.archivedAt);

    if (isLoading) {
        return (
            <div className="flex min-h-[240px] items-center justify-center">
                <Spinner size="3" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <SettingsBreadcrumb
                items={[
                    { label: "Settings", href: `/space/${spaceId}/settings/users` },
                    { label: "Space Settings" },
                ]}
            />

            <SettingsPageHeader
                title="Space Settings"
                subtitle="Manage ownership, archival, and deletion rules for this space. Archived spaces remain visible to members, but all content becomes read-only."
            />

            {errors ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errors.message}</div> : null}

            <div className="space-y-4">
                <div className="rounded-xl border border-neutral-200 bg-white p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                            <h2 className="text-lg font-semibold text-neutral-900">Transfer Ownership</h2>
                            <p className="max-w-3xl text-sm leading-6 text-neutral-600">
                                The current owner can transfer ownership to any active space member. After transfer, the previous owner becomes an admin.
                            </p>
                            <div className="text-sm text-neutral-500">
                                Current owner: <span className="font-medium text-neutral-800">{settings?.currentOwnerName || "Unknown"}</span>
                            </div>
                        </div>
                        <Button disabled={!settings?.canTransferOwnership || transferLoading || archived} onClick={() => setTransferOpen(true)}>
                            Transfer Ownership
                        </Button>
                    </div>
                </div>

                <div className="rounded-xl border border-neutral-200 bg-white p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                            <h2 className="text-lg font-semibold text-neutral-900">{archived ? "Unarchive Space" : "Archive Space"}</h2>
                            <p className="max-w-3xl text-sm leading-6 text-neutral-600">
                                {archived
                                    ? "Archived spaces remain visible until an admin restores them. Unarchive to re-enable edits and creation."
                                    : "Archived spaces remain visible to all existing members, but documents, whiteboards, and settings become read-only until an admin unarchives the space."}
                            </p>
                        </div>
                        <Button
                            variant={archived ? "solid" : "outline"}
                            disabled={!settings?.canArchive || archiveLoading || unarchiveLoading}
                            onClick={() => (archived ? unarchiveSpace({}) : archiveSpace({}))}
                        >
                            {archived ? "Unarchive Space" : "Archive Space"}
                        </Button>
                    </div>
                </div>

                <div className="rounded-xl border border-red-200 bg-red-50 p-5">
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <h2 className="text-lg font-semibold text-red-700">Delete Space</h2>
                            <p className="max-w-3xl text-sm leading-6 text-neutral-700">
                                Deleting a space removes it from active views immediately. The data is soft-deleted first and later permanently purged by a background cleanup job.
                            </p>
                        </div>
                        <div className="max-w-md">
                            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-neutral-500">Type the space name to confirm</label>
                            <TextField.Root value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={settings?.name || "Space name"} />
                        </div>
                        <Button
                            color="red"
                            disabled={!settings?.canDelete || deleteLoading || confirmName.trim() !== (settings?.name || "")}
                            onClick={() => deleteSpace({ confirmName })}
                        >
                            Delete Space
                        </Button>
                    </div>
                </div>
            </div>

            <TransferOwnershipModal
                open={transferOpen}
                onOpenChange={setTransferOpen}
                members={members}
                loading={transferLoading}
                onConfirm={(newOwnerUserId) => transferOwnership({ newOwnerUserId })}
            />

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
