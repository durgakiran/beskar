"use client";
import InvitedUserRow from "@components/settings/invitedUserRow";
import User from "@components/settings/User";
import { Icon } from "@components/ui/Icon";
import { Response, useGet, usePost } from "@http/hooks";
import { useDelete } from "app/core/http/hooks/useDelete";
import { Button, Spinner, Table, Flex, Box, Heading, Text } from "@radix-ui/themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { use, useEffect, useState } from "react";

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

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const [{ isLoading, data, errors }, fetchData] = useGet<Response<Invite[]>>(`invite/space/${spaceId}/list`);
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
        <Box className="p-4 md:p-6 max-w-7xl mx-auto">
            {/* Breadcrumb */}
            <Flex align="center" gap="2" mb="4" className="text-sm">
                <Link href={`/space/${spaceId}/settings`}>
                    <Text size="2" className="text-neutral-500 hover:text-primary-600 transition-colors">Settings</Text>
                </Link>
                <Text className="text-neutral-300">/</Text>
                <Text size="2" className="text-neutral-700 font-medium">Invites</Text>
            </Flex>

            {/* Header */}
            <Flex justify="between" align="center" mb="6" className="flex-col sm:flex-row gap-4">
                <Heading size="6" className="text-neutral-900">Invited Users</Heading>
            </Flex>

            {/* Desktop Table View */}
            <Box className="hidden md:block overflow-x-auto bg-white rounded-sm border border-neutral-200">
                <Table.Root>
                    <Table.Header>
                        <Table.Row className="bg-neutral-50">
                            <Table.ColumnHeaderCell className="text-neutral-700 font-semibold">Email</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell className="text-neutral-700 font-semibold">Role</Table.ColumnHeaderCell>
                            <Table.ColumnHeaderCell className="text-neutral-700 font-semibold">Actions</Table.ColumnHeaderCell>
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {data && data.data
                            ? data.data.map((user: Invite) => {
                                  return <InvitedUserRow key={user.email} user={user} refresh={refresh} />;
                              })
                            : null}
                    </Table.Body>
                </Table.Root>
                {data && data.data && data.data.length === 0 && (
                    <Flex align="center" justify="center" p="8">
                        <Text size="3" className="text-neutral-500">No pending invites</Text>
                    </Flex>
                )}
            </Box>

            {/* Mobile Card View */}
            <Box className="md:hidden space-y-3">
                {data && data.data && data.data.length > 0
                    ? data.data.map((invite: Invite) => {
                          return (
                              <Box 
                                  key={invite.email} 
                                  className="bg-white border border-neutral-200 rounded-sm p-4 shadow-sm hover:shadow-md transition-shadow"
                              >
                                  <Flex direction="column" gap="3">
                                      <Flex align="center" gap="2">
                                          <Text className="text-neutral-500 font-medium text-sm">Email:</Text>
                                          <Text className="text-neutral-700 font-medium">{invite.email}</Text>
                                      </Flex>
                                      <Flex align="center" gap="2">
                                          <Text className="text-neutral-500 font-medium text-sm">Role:</Text>
                                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-sm text-xs font-medium bg-mauve-100 text-mauve-800">
                                              {invite.role}
                                          </span>
                                      </Flex>
                                      <Flex gap="2" mt="2">
                                          <Button variant="outline" size="1" className="flex-1">
                                              View Details
                                          </Button>
                                          <Button variant="outline" color="red" size="1">
                                              Cancel
                                          </Button>
                                      </Flex>
                                  </Flex>
                              </Box>
                          );
                      })
                    : null}
                {data && data.data && data.data.length === 0 && (
                    <Flex align="center" justify="center" p="8" className="bg-neutral-50 rounded-sm border border-neutral-200">
                        <Text size="3" className="text-neutral-500">No pending invites</Text>
                    </Flex>
                )}
            </Box>
        </Box>
    );
}
