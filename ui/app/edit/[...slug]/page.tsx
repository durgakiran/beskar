import { useParams } from "react-router-dom";
"use client";

import {  } from "react";
"use client";

import {  } from "react";
import { Response, useGet } from "@http/hooks";
import { Spinner, Flex } from "@radix-ui/themes";
import DocumentEditor from "@components/DocumentEditor";
import { lazy, Suspense } from "react";
import type { PageNavigation } from "app/core/whiteboard/v2/api";
const WhiteboardEditor = lazy(() => import("@components/WhiteboardEditor"));
const WhiteboardEditorV2 = lazy(() => import("@components/WhiteboardEditorV2"));
import { useEffect } from "react";

export default function Page() {
    const { spaceId, page } = useParams() as any;

    const [{ data: metaData, isLoading, errors }, fetchMeta] = useGet<Response<PageNavigation>>(`editor/space/${spaceId}/page/${page}/metadata`);

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
        return <Suspense fallback={<Spinner />} >{metaData.data.contentApiVersion === 2 ? <WhiteboardEditorV2 key={`${spaceId}:${page}`} slug={slug} /> : <WhiteboardEditor key={page} slug={slug} />}</Suspense>;
    }

    return (
        <div className="h-full w-full overflow-y-auto relative">
            <DocumentEditor key={page} slug={slug} />
        </div>
    );
}
