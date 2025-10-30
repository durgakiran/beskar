"use client";
import { useEffect, useState } from "react";
import AddSpace from "@components/addSpace";
import { useRouter } from "next/navigation";
import { Avatar, Button, Card, Spinner, Flex, Box, Heading, Text } from "@radix-ui/themes";
import Slate from "@components/slate";
import { signIn } from "next-auth/react";
import { Response, useGet } from "@http/hooks";
import Link from "next/link";


interface Data {
    name: string;
    id: string;
}

interface IData {
    id: string;
    name: string;
    dateCreated: Date;
    dateUpdated: Date;
    createdBy: string;
}

const BLANK_STATE_HEADING = "No Spaces, Please create one";
const BLANK_STATE_BTN_TEXT = "Create a space";

export default function Page() {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [tableData, setTableData] = useState([]);
    const [ { isLoading: loading, errors: error, data }, fetchData ] = useGet<Response<IData[]>>("space/list");

    useEffect(() => {
        fetchData()
    }, [fetchData])

    useEffect(() => {
        if (data && data.data && data.data.length) {
            const newData: Data[] = data.data.map((datum, i) => {
                return { id: datum.id, name: datum.name };
            });
            setTableData(newData);
        }
    }, [data]);

    useEffect(() => {
        if (error && error.message.includes("JWTExpired")) {
            signIn("keycloak")
        }
    }, [error]);

    return (
        <Box p="4" className="md:mx-8">
            <Flex justify="between" align="start" mb="6">
                <Box>
                    <Heading size="6" mb="1">
                        Your Spaces
                    </Heading>
                    <Text size="2" color="gray">Organize your content across spaces</Text>
                </Box>
                <Button size="2" onClick={() => setIsOpen(true)}>
                    Add Space +
                </Button>
            </Flex>
            
            {loading && (
                <Flex align="center" justify="center" py="8">
                    <Spinner size="3" />
                </Flex>
            )}
            
            <Flex wrap="wrap" gap="4">
                {!loading && tableData.length > 0 && tableData.map((item, i) => (
                    <Link href={`/space/${item.id}`} key={i}>
                        <Card style={{ width: '192px', cursor: 'pointer' }}>
                            <Flex direction="column" align="center" gap="3">
                                <Avatar 
                                    size="5" 
                                    fallback={item.name.charAt(0).toUpperCase()} 
                                    radius="full"
                                />
                                <Box style={{ textAlign: 'center' }}>
                                    <Text size="3" weight="bold" as="div" mb="1">
                                        {item.name}
                                    </Text>
                                    <Text size="2" color="gray">
                                        About the space
                                    </Text>
                                </Box>
                            </Flex>
                        </Card>
                    </Link>
                ))}
            </Flex>
            
            {!loading && !tableData.length && <Slate title={BLANK_STATE_HEADING} />}
            
            <AddSpace
                isOpen={isOpen}
                setIsOpen={(open: boolean) => {
                    setIsOpen(open);
                    fetchData();
                }}
            />
        </Box>
    );
}
