"use client";

import User from "@components/settings/User";
import { Response, useGet } from "@http/hooks";
import { Spinner, Table } from "flowbite-react";
import { use, useEffect } from "react";

interface User {
    id: string;
    name: string;
    role: string;
}

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const [{ isLoading, data, errors }, fetchData] = useGet<Response<User[]>>(`space/${spaceId}/users`);

    useEffect(() => {
        fetchData();
    }, []);

    if (isLoading) {
        return (
            <div>
                <Spinner />
            </div>
        );
    }

    return (
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
                                      <Table.Cell>email@email1.com</Table.Cell>
                                      <Table.Cell>Admin</Table.Cell>
                                      <Table.Cell>edit</Table.Cell>
                                  </Table.Row>
                              );
                          })
                        : null}
                </Table.Body>
            </Table>
        </div>
    );
}
