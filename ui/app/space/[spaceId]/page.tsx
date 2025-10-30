'use client'

import { Response, useGet } from "@http/hooks"
import { Spinner, Box, Heading, Text, Flex } from "@radix-ui/themes";
import { use, useEffect } from "react";

interface space {
    name: string;
    id: string;
}

export default function Page({ params }: { params: Promise<{ spaceId: string }> }) {
    const { spaceId } = use(params);
    const [ { isLoading, data, errors }, fetchData ] = useGet<Response<space>>(`space/${spaceId}/details`);

    useEffect(() => {
        fetchData();
    }, []);

    if (errors) {
        return (
            <Box p="4">
                <Text color="red">{errors.message}</Text>
            </Box>
        )
    }

    if (isLoading) {
        return (
            <Flex align="center" justify="center" p="4">
                <Spinner size="3" />
            </Flex>
        )
    }
    
    return (
        <Box p="4">
            {data && data.data && <Heading size="6">{data.data.name}</Heading>}
        </Box>
    )
}
