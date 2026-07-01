import { useParams } from "react-router-dom";
"use client";
import { useGet } from "@http/hooks";
import WhiteboardEditor from "@components/WhiteboardEditor";
import DocumentEditor from "@components/DocumentEditor";
import { useEffect } from "react";
import { Flex, Spinner, Text } from "@radix-ui/themes";

export default function Page() {
    const { page, spaceId } = useParams() as any;
    const [{ isLoading: loadingMeta, data: metaData, errors: metaErrors }, fetchMeta] = useGet<{ data: { type: string }; status: string }>(`editor/space/${spaceId}/page/${page}/metadata`);

    useEffect(() => {
        fetchMeta();
    }, [fetchMeta]);

    if (loadingMeta) {
        return (
            <Flex align="center" justify="center" p="4" className="h-full w-full">
                <Spinner size="3" />
            </Flex>
        );
    }

    if (metaErrors || !metaData?.data?.type) {
        return (
            <Flex align="center" justify="center" className="min-h-[40vh] px-6 h-full w-full">
                <Text size="3" className="text-neutral-700">
                    Something went wrong...
                </Text>
            </Flex>
        );
    }

    if (metaData.data.type === "whiteboard") {
        return <WhiteboardEditor key={page} slug={[spaceId, page]} />;
    }

    return <DocumentEditor key={page} slug={[spaceId, page]} />;
}
