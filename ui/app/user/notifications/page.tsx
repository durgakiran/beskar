"use client";
import Notification from "@components/settings/notification";
import { Response, useGet } from "@http/hooks";
import { Avatar, Breadcrumb, Button, Spinner, Table } from "flowbite-react";
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
        <div className="space-y-4">
            <Breadcrumb aria-label="Settings navigation breadcrumb">
                <Breadcrumb.Item href="#">User</Breadcrumb.Item>
                <Breadcrumb.Item href="#">Notifications</Breadcrumb.Item>
            </Breadcrumb>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Notifications</h2>
            <div className="dark:bg-gray-800">
                {isLoading ? (
                    <div className="m-auto">
                        <Spinner />
                    </div>
                ) : (
                    <div className="overflow-x-auto mt-4">
                        <Table>
                            <Table.Body className="divide-y">
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
                            </Table.Body>
                        </Table>
                        {data && data.data && data.data.invites && data.data.invites.length === 0 ? <div className="text-center mt-4 mb-4 text-lg text-gray-700">There are no invitations</div> : null}
                    </div>
                )}
            </div>
        </div>
    );
}
