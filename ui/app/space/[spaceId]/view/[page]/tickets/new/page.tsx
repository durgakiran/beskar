"use client";

import ProjectTicketCreatePage from "@components/project-management/ProjectTicketCreatePage";
import { use } from "react";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

export default function Page({ params, searchParams }: { params: Promise<{ spaceId: string; page: string }>; searchParams: SearchParams }) {
    const { spaceId, page } = use(params);
    const query = use(searchParams);

    const labels = firstValue(query.labels)
        ?.split(",")
        .map((label) => label.trim())
        .filter(Boolean);

    return (
        <ProjectTicketCreatePage
            spaceId={spaceId}
            pageId={page}
            returnTo={firstValue(query.returnTo)}
            prefill={{
                title: firstValue(query.title),
                description: firstValue(query.description),
                type: firstValue(query.type),
                status: firstValue(query.status),
                priority: firstValue(query.priority),
                parentTicketId: firstValue(query.parentTicketId),
                assigneeUserId: firstValue(query.assigneeUserId),
                dueAt: firstValue(query.dueAt),
                labelNames: labels,
            }}
        />
    );
}
