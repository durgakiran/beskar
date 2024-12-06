"use client";
import InviteUser from "@components/settings/inviteUser";
import User from "@components/settings/User";
import { Icon } from "@components/ui/Icon";
import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet, usePost } from "@http/hooks";
import { Breadcrumb, Button, Spinner, Table, Toast } from "flowbite-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { HiExclamation } from "react-icons/hi";

interface User {
    id: string;
    name: string;
    role: string;
    email: string;
}

interface Invite {
    email: string;
    role: string;
    entityId: string;
    entity: string;
    senderId: string;
}

export default function Page({ params }: { params: { spaceId: string } }) {
    const router = usePathname();
    const [openModal, setOpenModal] = useState(false);
    const [{ isLoading, data, errors }, fetchData] = useGet<Response<User[]>>(`space/${params.spaceId}/users`);
    const [{ data: profileData, errors: profileErrors, isLoading: profileLoading }, getProfile] = useGet<Response<User>>(`profile/details`);
    const [{ isLoading: inviteLoading, data: inviteData, errors: inviteErrors }, sendInvite] = usePost<string, Invite>(`invite/user/create`);

    const handleInvite = (email: string, role: string) => {
        setOpenModal(false);
        const invite: Invite = {
            email: email,
            role: role,
            entityId: params.spaceId,
            entity: "space",
            senderId: profileData.data.id,
        };
        sendInvite(invite);
    };

    useEffect(() => {
        fetchData();
        getProfile();
    }, []);

    useEffect(() => {
        console.log(profileData);
    }, [profileData]);

    useEffect(() => {
        console.log(inviteData, inviteErrors);
    }, [inviteData, inviteErrors]);

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
                <Breadcrumb.Item href="#">Users</Breadcrumb.Item>
            </Breadcrumb>
            <div className="mt-4 flex flex-row justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Active Users</h2>
                {data && data.data
                    ? data.data
                          .filter((user: User) => user.id === profileData.data.id)
                          .map((user: User) => {
                              if (user.role === "owner" || user.role === "admin") {
                                  return (
                                      <Button key={user.id} size="xs" onClick={() => setOpenModal(true)} outline>
                                          <Icon name="Plus" className="mr-2 h-5 w-5" /> User
                                      </Button>
                                  );
                              }
                          })
                    : null}
            </div>
            <div className="overflow-x-auto mt-4">
                <Table>
                    <Table.Head>
                        <Table.HeadCell>Name</Table.HeadCell>
                        <Table.HeadCell>Email</Table.HeadCell>
                        <Table.HeadCell>Role</Table.HeadCell>
                        <Table.HeadCell></Table.HeadCell>
                    </Table.Head>
                    <Table.Body className="divide-y">
                        {data && data.data
                            ? data.data.map((user: User) => {
                                  return (
                                      <Table.Row key={user.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                                          <Table.Cell className="whitespace-nowrap font-medium text-gray-900 dark:text-white">
                                              <div className="flex">
                                                  <User key={user.id} id={user.id} name={user.name} role={user.role} />
                                              </div>
                                          </Table.Cell>
                                          <Table.Cell>{user.email}</Table.Cell>
                                          <Table.Cell>{user.role}</Table.Cell>
                                          <Table.Cell>
                                              <Button outline color="red" size={"xs"} disabled>
                                                  <Icon className="color-red" name="BadgeX" />
                                              </Button>
                                          </Table.Cell>
                                      </Table.Row>
                                  );
                              })
                            : null}
                    </Table.Body>
                </Table>
            </div>
            <InviteUser open={openModal} setOpen={setOpenModal} handleInvite={handleInvite} />
            {inviteErrors && <ToastComponent icon="AlertTriangle" message="Unable to invite user" toggle type="warning" />}
            {inviteData && <ToastComponent icon="Check" message="Successfully invited user to space" toggle type="success" />}
        </div>
    );
}
