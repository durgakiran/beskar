"use client";
import Notification from "@components/settings/notification";
import { Response, useGet } from "@http/hooks";
import { Spinner, Flex, Box, Heading, Text, Table } from "@radix-ui/themes";
import Link from "next/link";
import { useEffect } from "react";

interface Invite {
    entity: string;
    entityId: string;
    senderId: string;
    name: string;
    senderName: string;
    role: string;
    token: string;
}

interface Notifications {
    invites: Invite[];
}

export default function Page() {
    const [{ data, errors, isLoading, response }, fetchData] = useGet<Response<Notifications>>(`invite/user/invites`);

    useEffect(() => {
        fetchData();
    }, []);

    return (
        <Box className="space-y-4">
            <Flex align="center" gap="2" mb="4">
                <Link href="#"><Text size="2" color="gray">User</Text></Link>
                <Text color="gray">/</Text>
                <Text size="2">Notifications</Text>
            </Flex>
            <Heading size="6" mb="4">Notifications</Heading>
            {isLoading ? (
                <Flex align="center" justify="center" py="8">
                    <Spinner size="3" />
                </Flex>
            ) : (
                <Box className="overflow-x-auto" mt="4">
                    <table className="w-full">
                        <tbody>
                            {data && data.data && data.data.invites
                                ? data.data.invites.map((invite) => {
                                      return (
                                          <Notification
                                              key={invite.entityId}
                                              token={invite.token}
                                              entityId={invite.entityId}
                                              senderName={invite.senderName}
                                              name={invite.name}
                                              role={invite.role}
                                          />
                                      );
                                  })
                                : null}
                        </tbody>
                    </table>
                    {data && data.data && data.data.invites && data.data.invites.length === 0 && (
                        <Text align="center" size="3" color="gray" mt="4">There are no invitations</Text>
                    )}
                </Box>
            )}
        </Box>
    );
}
