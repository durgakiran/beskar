"use client";
import InvitedUserRow from "@components/settings/invitedUserRow";
import User from "@components/settings/User";
import { Icon } from "@components/ui/Icon";
import { Response, useGet, usePost } from "@http/hooks";
import { useDelete } from "app/core/http/hooks/useDelete";
import { Breadcrumb, Button, Spinner, Table } from "flowbite-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface User {
    id: string;
    name: string;
    role: string;
    email: string;
}

interface Invite {
    entity: string;
    entityId: string;
    email: string;
    role: string;
    senderId: string;
}

export default function Page({ params }: { params: { spaceId: string } }) {
    const [{ isLoading, data, errors }, fetchData] = useGet<Response<Invite[]>>(`invite/space/${params.spaceId}/list`);
    const [{ data: profileData, errors: profileErrors, isLoading: profileLoading }, getProfile] = useGet<Response<User[]>>(`profile/details`);

    const refresh = () => {
        fetchData();
    };

    useEffect(() => {
        fetchData();
        getProfile();
    }, []);

    if (isLoading || profileLoading) {
        return (
            <div>
                <Spinner />
            </div>
        );
    }

    return (
        <div>
            <Breadcrumb aria-label="Settings navigation breadcrumb">
                <Breadcrumb.Item href="#">Settings</Breadcrumb.Item>
                <Breadcrumb.Item href="#">Invites</Breadcrumb.Item>
            </Breadcrumb>
            <div className="mt-4 flex flex-row justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Invited Users</h2>
            </div>
            <div className="overflow-x-auto mt-4">
                <Table>
                    <Table.Head>
                        <Table.HeadCell>Name</Table.HeadCell>
                        <Table.HeadCell>Role</Table.HeadCell>
                        <Table.HeadCell></Table.HeadCell>
                    </Table.Head>
                    <Table.Body className="divide-y">
                        {data && data.data
                            ? data.data.map((user: Invite) => {
                                  return <InvitedUserRow key={user.email} user={user} refresh={refresh} />;
                              })
                            : null}
                    </Table.Body>
                </Table>
                {data && data.data && data.data.length === 0 ? <div className="text-center mt-4 mb-4 text-lg text-gray-700">No invites</div> : null}
            </div>
        </div>
    );
}
