"use client";

import ProjectPageView from "@components/project-management/ProjectPageView";
import { use } from "react";

export default function Page({ params }: { params: Promise<{ spaceId: string; page: string; ticketId: string }> }) {
    const { spaceId, page, ticketId } = use(params);

    return <ProjectPageView spaceId={spaceId} pageId={page} initialTicketId={ticketId} detailMode="page" />;
}
