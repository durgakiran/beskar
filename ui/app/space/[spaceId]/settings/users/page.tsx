"use client";

import SettingsBreadcrumb from "@components/settings/SettingsBreadcrumb";
import SettingsPageHeader from "@components/settings/SettingsPageHeader";
import User from "@components/settings/User";
import RoleChip from "@components/settings/RoleChip";
import RoleSelectMenu from "@components/settings/RoleSelectMenu";
import MemberActions from "@components/settings/MemberActions";
import ToastComponent from "@components/ui/ToastComponent";
import { Response, useDelete, useGet, usePut } from "@http/hooks";
import { Button, Spinner } from "@radix-ui/themes";
import { spaceSettingsPaths } from "../../../../core/queries/space/settings";
import type { SpaceMember } from "../types";
import { use, useEffect, useState } from "react";
import { FiPlus } from "react-icons/fi";
import { useRouter } from "next/navigation";

type Profile = {
    id: string;
    email: string;
    name?: string;
};

type SpaceState = {
    archivedAt?: string | null;
};

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const router = useRouter();
    const [{ isLoading, data, errors }, fetchUsers] = useGet<Response<SpaceMember[]>>(spaceSettingsPaths.users(spaceId));
    const [{ data: profileData, isLoading: profileLoading }, getProfile] = useGet<Response<Profile>>("profile/details");
    const [{ data: spaceDetails }, fetchSpaceDetails] = useGet<Response<SpaceState>>(`space/${spaceId}/details`);
    const [{ data: roleData, errors: roleErrors, isLoading: roleLoading }, changeRole] = usePut<Response<SpaceMember>, { userId: string; role: string }>(
        spaceSettingsPaths.changeMemberRole(spaceId)
    );
    const [{ data: removedData, errors: removeErrors, isLoading: removeLoading }, removeMember] = useDelete<Response<{ removed: boolean }>, { userId: string }>(
        spaceSettingsPaths.removeMember(spaceId)
    );
    const [toast, setToast] = useState<{ type: "success" | "warning"; message: string } | null>(null);

    useEffect(() => {
        fetchUsers();
        getProfile();
        fetchSpaceDetails();
    }, [fetchUsers, getProfile, fetchSpaceDetails]);

    useEffect(() => {
        if (roleData?.data) {
            setToast({ type: "success", message: "Member role updated" });
            fetchUsers();
        }
    }, [roleData, fetchUsers]);

    useEffect(() => {
        if (removedData?.data?.removed) {
            setToast({ type: "success", message: "Member removed from space" });
            fetchUsers();
        }
    }, [removedData, fetchUsers]);

    useEffect(() => {
        if (roleErrors) {
            setToast({ type: "warning", message: roleErrors.message || "Unable to update role" });
        }
    }, [roleErrors]);

    useEffect(() => {
        if (removeErrors) {
            setToast({ type: "warning", message: removeErrors.message || "Unable to remove member" });
        }
    }, [removeErrors]);

    if (isLoading || profileLoading) {
        return (
            <div className="flex min-h-[240px] items-center justify-center">
                <Spinner size="3" />
            </div>
        );
    }

    const members = data?.data ?? [];
    const profileId = profileData?.data?.id;
    const currentUser = members.find((member) => member.id === profileId);
    const archived = Boolean(spaceDetails?.data?.archivedAt);
    const canManage = (currentUser?.role === "owner" || currentUser?.role === "admin") && !archived;

    return (
        <div className="space-y-6">
            <SettingsBreadcrumb
                items={[
                    { label: "Settings", href: `/space/${spaceId}/settings/users` },
                    { label: "Users" },
                ]}
            />

            <SettingsPageHeader
                title="Active Users"
                subtitle="Review active members in this space and adjust roles or membership where permitted."
                action={
                    currentUser?.role === "owner" || currentUser?.role === "admin" ? (
                        <Button disabled={archived} onClick={() => router.push(`/space/${spaceId}/settings/users/add`)}>
                            <span className="inline-flex items-center">
                                <FiPlus className="mr-2 h-4 w-4" /> Invite User
                            </span>
                        </Button>
                    ) : null
                }
            />

            {errors ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errors.message}</div> : null}
            {archived ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    This space is archived. Member roles can be reviewed, but adding or removing users is disabled until the space is unarchived.
                </div>
            ) : null}

            <div className="hidden overflow-hidden rounded-xl border border-neutral-200 bg-white md:block">
                <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_160px_170px] gap-4 bg-neutral-50 px-4 py-3 text-sm font-semibold text-neutral-600">
                    <span>Name</span>
                    <span>Email</span>
                    <span>Role</span>
                    <span>Actions</span>
                </div>
                {members.map((member) => {
                    const canEditMember = canManage && !member.isOwner;
                    return (
                        <div key={member.id} className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_160px_170px] items-center gap-4 border-t border-neutral-200 px-4 py-3">
                            <User id={member.id} name={member.name} subtitle={member.joinedAt ? `Joined ${new Date(member.joinedAt).toLocaleDateString()}` : null} />
                            <div className="truncate text-sm text-neutral-600">{member.email}</div>
                            <div>
                                {canEditMember ? (
                                    <RoleSelectMenu
                                        value={member.role}
                                        disabled={roleLoading}
                                        onChange={(role) => changeRole({ userId: member.id, role })}
                                    />
                                ) : (
                                    <RoleChip role={member.role} />
                                )}
                            </div>
                            <div>
                                <MemberActions
                                    locked={member.isOwner}
                                    disabled={!canEditMember || removeLoading}
                                    onRemove={canEditMember ? () => removeMember({ userId: member.id }) : undefined}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="space-y-3 md:hidden">
                {members.map((member) => {
                    const canEditMember = canManage && !member.isOwner;
                    return (
                        <div key={member.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                            <div className="space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <User id={member.id} name={member.name} subtitle={member.email} />
                                    <MemberActions
                                        locked={member.isOwner}
                                        disabled={!canEditMember || removeLoading}
                                        onRemove={canEditMember ? () => removeMember({ userId: member.id }) : undefined}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm text-neutral-500">Role</span>
                                    {canEditMember ? (
                                        <RoleSelectMenu
                                            value={member.role}
                                            disabled={roleLoading}
                                            onChange={(role) => changeRole({ userId: member.id, role })}
                                        />
                                    ) : (
                                        <RoleChip role={member.role} />
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
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
