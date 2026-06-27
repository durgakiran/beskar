import { useParams } from "react-router-dom";
"use client";

import {  } from "react";
"use client";

import {  } from "react";
import { Response, useGet } from "@http/hooks";
import { Spinner, Flex } from "@radix-ui/themes";
import DocumentEditor from "@components/DocumentEditor";
import WhiteboardEditor from "@components/WhiteboardEditor";
import { useEffect } from "react";

export default function Page() {
    const { spaceId, page } = useParams() as any;

    const [{ data: metaData, isLoading, errors }, fetchMeta] = useGet<Response<{ type: string }>>(`editor/space/${spaceId}/page/${page}/metadata`);

    useEffect(() => {
        fetchMeta();
    }, [spaceId, page]);

    if (isLoading || (!metaData && !errors)) {
        return (
            <Flex justify="center" style={{ marginTop: '20vh' }}>
                <Spinner size="3" />
            </Flex>
        );
    }

    if (errors || !metaData) {
        return <div>Error loading page metadata</div>;
    }

    const slug = [spaceId, page];

    if (metaData.data.type === "whiteboard") {
        return <WhiteboardEditor key={page} slug={slug} />;
    }

    return <DocumentEditor key={page} slug={slug} />;
}
