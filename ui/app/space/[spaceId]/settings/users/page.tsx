"use client";
import InviteUser from "@components/settings/inviteUser";
import User from "@components/settings/User";
import { Icon } from "@components/ui/Icon";
import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet, usePost } from "@http/hooks";
import { Button, Spinner, Table, Flex, Box, Heading, Text } from "@radix-ui/themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { use, useEffect, useState } from "react";
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

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const router = usePathname();
    const [openModal, setOpenModal] = useState(false);
    const [{ isLoading, data, errors }, fetchData] = useGet<Response<User[]>>(`space/${spaceId}/users`);
    const [{ data: profileData, errors: profileErrors, isLoading: profileLoading }, getProfile] = useGet<Response<User>>(`profile/details`);
    const [{ isLoading: inviteLoading, data: inviteData, errors: inviteErrors }, sendInvite] = usePost<string, Invite>(`invite/user/create`);

    const handleInvite = (email: string, role: string) => {
        setOpenModal(false);
        const invite: Invite = {
            email: email,
            role: role,
            entityId: spaceId,
            entity: "space",
            senderId: profileData.data.id,
        };
        sendInvite(invite);
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
        <Box className="p-4 md:p-6 max-w-7xl mx-auto">
            {/* Breadcrumb */}
            <Flex align="center" gap="2" mb="4" className="text-sm">
                <Link href={`/space/${spaceId}/settings`}>
                    <Text size="2" className="text-neutral-500 hover:text-primary-600 transition-colors">Settings</Text>
                </Link>
                <Text className="text-neutral-300">/</Text>
                <Text size="2" className="text-neutral-700 font-medium">Users</Text>
            </Flex>

            {/* Header */}
            <Flex justify="between" align="center" mb="6" className="flex-col sm:flex-row gap-4">
                <Heading size="6" className="text-neutral-900">Active Users</Heading>
                {data && data.data
                    ? data.data
                          .filter((user: User) => user.id === profileData.data.id)
                          .map((user: User) => {
                              if (user.role === "owner" || user.role === "admin") {
                                  return (
                                      <Button 
                                          key={user.id} 
                                          size="2" 
                                          onClick={() => setOpenModal(true)} 
                                          className="bg-primary-500 hover:bg-primary-600 text-white"
                                      >
                                          <Icon name="Plus" className="mr-2 h-4 w-4" /> Add User
                                      </Button>
                                  );
                              }
                          })
                    : null}
            </Flex>

            {/* Desktop Table View */}
            <Box className="hidden md:block overflow-x-auto bg-white rounded-sm border border-neutral-200">
                <Table.Root>
                    <Table.Header>
                        <Table.Row className="bg-neutral-50">
                            <Table.ColumnHeaderCell className="text-neutral-700 font-semibold">Name</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell className="text-neutral-700 font-semibold">Email</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell className="text-neutral-700 font-semibold">Role</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell className="text-neutral-700 font-semibold">Actions</Table.ColumnHeaderCell>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {data && data.data
                            ? data.data.map((user: User) => {
                                  return (
                                      <Table.Row key={user.id} className="hover:bg-mauve-50 transition-colors">
                                          <Table.Cell>
                                              <User key={user.id} id={user.id} name={user.name} role={user.role} />
                                          </Table.Cell>
                                          <Table.Cell className="text-neutral-600">{user.email}</Table.Cell>
                                          <Table.Cell>
                                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-sm text-xs font-medium bg-mauve-100 text-mauve-800">
                                                  {user.role}
                                              </span>
                                          </Table.Cell>
                                          <Table.Cell>
                                              <Button variant="outline" color="red" size="1" disabled className="opacity-50">
                                                  <Icon className="color-red" name="BadgeX" />
                                              </Button>
                                          </Table.Cell>
                                      </Table.Row>
                                  );
                              })
                            : null}
                    </Table.Body>
                </Table.Root>
            </Box>

            {/* Mobile Card View */}
            <Box className="md:hidden space-y-3">
                {data && data.data
                    ? data.data.map((user: User) => {
                          return (
                              <Box 
                                  key={user.id} 
                                  className="bg-white border border-neutral-200 rounded-sm p-4 shadow-sm hover:shadow-md transition-shadow"
                              >
                                  <Flex direction="column" gap="3">
                                      <Flex align="start" justify="between">
                                          <User id={user.id} name={user.name} role={user.role} />
                                          <Button variant="outline" color="red" size="1" disabled className="opacity-50">
                                              <Icon className="color-red" name="BadgeX" />
                                          </Button>
                                      </Flex>
                                      <Flex direction="column" gap="2" className="text-sm">
                                          <Flex align="center" gap="2">
                                              <Text className="text-neutral-500 font-medium">Email:</Text>
                                              <Text className="text-neutral-700">{user.email}</Text>
                                          </Flex>
                                          <Flex align="center" gap="2">
                                              <Text className="text-neutral-500 font-medium">Role:</Text>
                                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-sm text-xs font-medium bg-mauve-100 text-mauve-800">
                                                  {user.role}
                                              </span>
                                          </Flex>
                                      </Flex>
                                  </Flex>
                              </Box>
                          );
                      })
                    : null}
            </Box>

            <InviteUser open={openModal} setOpen={setOpenModal} handleInvite={handleInvite} />
            {inviteErrors && <ToastComponent icon="AlertTriangle" message="Unable to invite user" toggle type="warning" />}
            {inviteData && <ToastComponent icon="Check" message="Successfully invited user to space" toggle type="success" />}
        </Box>
    );
}
