"use client";

import User from "@components/settings/User";
import { Response, useGet } from "@http/hooks";
import { Spinner, Flex, Box, Table, Heading, Text, Button } from "@radix-ui/themes";
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
            <Flex align="center" justify="center" p="4">
                <Spinner size="3" />
            </Flex>
        );
    }

    return (
        <Box className="p-4 md:p-6 max-w-7xl mx-auto">
            {/* Header */}
            <Heading size="6" className="text-neutral-900 mb-6">Space Settings</Heading>

            {/* Desktop Table View */}
            <Box className="hidden md:block overflow-x-auto bg-white rounded-sm border border-neutral-200 shadow-sm">
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
                                          <Table.Cell className="text-neutral-600">email@email1.com</Table.Cell>
                                          <Table.Cell>
                                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-sm text-xs font-medium bg-mauve-100 text-mauve-800">
                                                  Admin
                                              </span>
                                          </Table.Cell>
                                          <Table.Cell>
                                              <Button variant="outline" size="1" className="text-primary-600 hover:bg-primary-50">
                                                  Edit
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
                                      <User id={user.id} name={user.name} role={user.role} />
                                      <Flex direction="column" gap="2" className="text-sm">
                                          <Flex align="center" gap="2">
                                              <Text className="text-neutral-500 font-medium">Email:</Text>
                                              <Text className="text-neutral-700">email@email1.com</Text>
                                          </Flex>
                                          <Flex align="center" gap="2">
                                              <Text className="text-neutral-500 font-medium">Role:</Text>
                                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-sm text-xs font-medium bg-mauve-100 text-mauve-800">
                                                  Admin
                                              </span>
                                          </Flex>
                                      </Flex>
                                      <Button variant="outline" size="1" className="text-primary-600 hover:bg-primary-50 w-full">
                                          Edit User
                                      </Button>
                                  </Flex>
                              </Box>
                          );
                      })
                    : null}
            </Box>
        </Box>
    );
}
