"use client";

import SettingsBreadcrumb from "@components/settings/SettingsBreadcrumb";
import SettingsPageHeader from "@components/settings/SettingsPageHeader";
import RoleChip from "@components/settings/RoleChip";
import ToastComponent from "@components/ui/ToastComponent";
import { Response, useDelete, useGet } from "@http/hooks";
import { Button, Spinner } from "@radix-ui/themes";
import { spaceSettingsPaths } from "../../../../core/queries/space/settings";
import type { PendingInvite } from "../types";
import { use, useEffect, useState } from "react";

type SpaceState = {
    archivedAt?: string | null;
};

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const [{ isLoading, data, errors }, fetchInvites] = useGet<Response<PendingInvite[]>>(spaceSettingsPaths.invites(spaceId));
    const [{ data: spaceDetails }, fetchSpaceDetails] = useGet<Response<SpaceState>>(`space/${spaceId}/details`);
    const [{ data: removedData, errors: removeErrors, isLoading: removing }, removeInvite] = useDelete<Response<string>, PendingInvite>(
        spaceSettingsPaths.removeInvite()
    );
    const [toast, setToast] = useState<{ type: "success" | "warning"; message: string } | null>(null);

    useEffect(() => {
        fetchInvites();
        fetchSpaceDetails();
    }, [fetchInvites, fetchSpaceDetails]);

    useEffect(() => {
        if (removedData) {
            setToast({ type: "success", message: "Invite cancelled" });
            fetchInvites();
        }
    }, [removedData, fetchInvites]);

    useEffect(() => {
        if (removeErrors) {
            setToast({ type: "warning", message: removeErrors.message || "Unable to cancel invite" });
        }
    }, [removeErrors]);

    const invites = data?.data ?? [];
    const archived = Boolean(spaceDetails?.data?.archivedAt);

    return (
        <div className="space-y-6">
            <SettingsBreadcrumb
                items={[
                    { label: "Settings", href: `/space/${spaceId}/settings/users` },
                    { label: "Invited Users" },
                ]}
            />

            <SettingsPageHeader
                title="Invited Users"
                subtitle="Pending invitations stay here until someone joins or the invite is cancelled."
            />

            {isLoading ? (
                <div className="flex min-h-[240px] items-center justify-center">
                    <Spinner size="3" />
                </div>
            ) : null}

            {errors ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errors.message}</div> : null}
            {archived ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    This space is archived. Existing pending invites remain visible, but sending new invites is disabled until the space is unarchived.
                </div>
            ) : null}

            {!isLoading && invites.length === 0 ? (
                <div className="rounded-xl border border-neutral-200 bg-white px-6 py-10 text-center text-sm text-neutral-500">
                    No pending invites
                </div>
            ) : null}

            {invites.length > 0 ? (
                <>
                    <div className="hidden overflow-hidden rounded-xl border border-neutral-200 bg-white md:block">
                        <div className="grid grid-cols-[minmax(0,1.4fr)_140px_140px_120px] gap-4 bg-neutral-50 px-4 py-3 text-sm font-semibold text-neutral-600">
                            <span>Email</span>
                            <span>Role</span>
                            <span>Created</span>
                            <span>Actions</span>
                        </div>
                        {invites.map((invite) => (
                            <div key={`${invite.email}-${invite.role}`} className="grid grid-cols-[minmax(0,1.4fr)_140px_140px_120px] items-center gap-4 border-t border-neutral-200 px-4 py-3">
                                <span className="truncate text-sm text-neutral-800">{invite.email}</span>
                                <div className="justify-self-start">
                                    <RoleChip role={invite.role} />
                                </div>
                                <span className="text-sm text-neutral-500">{invite.createdAt ? new Date(invite.createdAt).toLocaleDateString() : "Pending"}</span>
                                <Button size="2" variant="outline" color="red" disabled={removing || archived} onClick={() => removeInvite(invite)}>
                                    Cancel
                                </Button>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-3 md:hidden">
                        {invites.map((invite) => (
                            <div key={`${invite.email}-${invite.role}`} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                                <div className="space-y-3">
                                    <div className="text-sm font-medium text-neutral-900">{invite.email}</div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-sm text-neutral-500">Role</span>
                                        <RoleChip role={invite.role} />
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-sm text-neutral-500">Created</span>
                                        <span className="text-sm text-neutral-600">{invite.createdAt ? new Date(invite.createdAt).toLocaleDateString() : "Pending"}</span>
                                    </div>
                                    <Button variant="outline" color="red" disabled={removing || archived} onClick={() => removeInvite(invite)}>
                                        Cancel invite
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : null}

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
