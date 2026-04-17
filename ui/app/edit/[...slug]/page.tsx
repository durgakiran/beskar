"use client";

import { use } from "react";
import { Response, useGet } from "@http/hooks";
import { Spinner, Flex } from "@radix-ui/themes";
import DocumentEditor from "@components/DocumentEditor";
import { useEffect } from "react";

export default function Page({ params }: { params: Promise<{ slug: string[] }> }) {
    const { slug } = use(params);

    const [{ data: metaData, isLoading, errors }, fetchMeta] = useGet<Response<{ type: string }>>(`editor/space/${slug[0]}/page/${slug[1]}/metadata`);

    useEffect(() => {
        fetchMeta();
    }, [slug[0], slug[1]]);

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

    if (metaData.data.type === "whiteboard") {
        return <div className="px-8 py-6 text-sm text-neutral-700">Whiteboards are temporarily unavailable.</div>;
    }

    return <DocumentEditor slug={slug} />;
}
