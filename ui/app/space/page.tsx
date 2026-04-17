"use client";
import { CreateSpaceModal, SpaceCard, SpacesHeader } from "@components/primitives";
import { Button } from "@components/ui/Button";
import { Icon } from "@components/ui/Icon";
import ToastComponent from "@components/ui/ToastComponent";
import { Response, useGet, usePost } from "@http/hooks";
import { Flex, Spinner } from "@radix-ui/themes";
import { useEffect, useState } from "react";

interface SpaceListItem {
    id: string;
    name: string;
    description: string;
    dateUpdated: string;
    createdBy: string;
    memberCount: number;
    docCount: number;
    userRole: "owner" | "admin" | "editor" | "commenter" | "viewer";
}

interface CreateSpacePayload {
    name: string;
    description: string;
}

type ToastState = {
    tone: "success" | "error";
    message: string;
} | null;

const PAGE_TITLE = "Spaces";
const PAGE_SUBTITLE = "Select a space to open documents and settings.";

function pluralize(count: number, singular: string, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

function formatRole(role: SpaceListItem["userRole"]) {
    switch (role) {
        case "owner":
            return "Owner";
        case "admin":
            return "Admin";
        case "editor":
            return "Editor";
        case "commenter":
            return "Commenter";
        default:
            return "Viewer";
    }
}

function formatRelative(dateValue: string) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
        return "recently";
    }

    const diffMs = date.getTime() - Date.now();
    const diffMinutes = Math.round(diffMs / (1000 * 60));
    const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

    if (Math.abs(diffMinutes) < 60) {
        return formatter.format(diffMinutes, "minute");
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) {
        return formatter.format(diffHours, "hour");
    }

    const diffDays = Math.round(diffHours / 24);
    if (Math.abs(diffDays) < 30) {
        return formatter.format(diffDays, "day");
    }

    const diffMonths = Math.round(diffDays / 30);
    if (Math.abs(diffMonths) < 12) {
        return formatter.format(diffMonths, "month");
    }

    return formatter.format(Math.round(diffMonths / 12), "year");
}

function getErrorMessage(payload: unknown, fallback: string) {
    if (payload instanceof Error && payload.message) {
        return payload.message;
    }
    if (payload && typeof payload === "object") {
        const error = (payload as { error?: { detail?: string; message?: string } }).error;
        if (error?.detail) {
            return error.detail;
        }
        if (error?.message) {
            return error.message;
        }
    }
    return fallback;
}

export default function Page() {
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [createName, setCreateName] = useState("");
    const [createDescription, setCreateDescription] = useState("");
    const [createErrorMessage, setCreateErrorMessage] = useState("");
    const [toast, setToast] = useState<ToastState>(null);
    const [didSubmitCreate, setDidSubmitCreate] = useState(false);

    const [{ isLoading: listLoading, errors: listErrors, data, response }, fetchData] = useGet<Response<SpaceListItem[]>>("space/list");
    const [{ isLoading: createLoading, data: createData, errors: createError }, createSpace] = usePost<Response<string>, CreateSpacePayload>("space/create");

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (!didSubmitCreate || createLoading) {
            return;
        }

        if (createData?.status === "success") {
            setDidSubmitCreate(false);
            setCreateErrorMessage("");
            setCreateName("");
            setCreateDescription("");
            setIsCreateOpen(false);
            setToast({ tone: "success", message: "Space created successfully." });
            fetchData();
            return;
        }

        if (createError) {
            const message = getErrorMessage(createError, "Couldn’t create space. Please try again.");
            setDidSubmitCreate(false);
            setCreateErrorMessage(message);
            setToast({ tone: "error", message });
        }
    }, [createData, createError, createLoading, didSubmitCreate, fetchData]);

    useEffect(() => {
        if (!toast) {
            return;
        }

        const timeoutId = window.setTimeout(() => setToast(null), 4000);
        return () => window.clearTimeout(timeoutId);
    }, [toast]);

    const spaces = data?.data ?? [];
    const hasErrorState = Boolean(listErrors) || (response !== undefined && response >= 400);
    const errorMessage = getErrorMessage(listErrors || data, "Unable to load spaces right now.");

    const handleCreateOpenChange = (open: boolean) => {
        setIsCreateOpen(open);
        if (!open && !createLoading) {
            setCreateErrorMessage("");
        }
    };

    const handleCreateSubmit = () => {
        const name = createName.trim();
        const description = createDescription.trim();
        if (!name || !description) {
            setCreateErrorMessage("Add both a space name and description.");
            return;
        }

        setCreateErrorMessage("");
        setDidSubmitCreate(true);
        createSpace({ name, description });
    };

    return (
        <>
            <div className="flex w-full flex-col gap-6 px-8 py-6">
                <SpacesHeader
                    title={PAGE_TITLE}
                    subtitle={PAGE_SUBTITLE}
                    actionLabel="Create New Space"
                    onAction={() => setIsCreateOpen(true)}
                />

                {listLoading ? (
                    <Flex align="center" justify="center" className="min-h-[320px] rounded-[14px] border border-neutral-200 bg-white">
                        <Spinner size="3" />
                    </Flex>
                ) : null}

                {!listLoading && hasErrorState ? (
                    <div className="rounded-[14px] border border-red-200 bg-white px-6 py-8 text-sm text-red-700">
                        {errorMessage}
                    </div>
                ) : null}

                {!listLoading && !hasErrorState && spaces.length > 0 ? (
                    <div className="grid w-full items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {spaces.map((space) => (
                            <SpaceCard
                                key={space.id}
                                title={space.name}
                                description={space.description || "Describe the purpose of this space."}
                                badge={pluralize(space.memberCount, "member")}
                                badges={[pluralize(space.docCount, "doc")]}
                                meta={`${formatRole(space.userRole)} • Updated ${formatRelative(space.dateUpdated)}`}
                                leadingLabel={space.name.charAt(0).toUpperCase()}
                                href={`/space/${space.id}`}
                            />
                        ))}
                    </div>
                ) : null}

                {!listLoading && !hasErrorState && spaces.length === 0 ? (
                    <div className="flex min-h-[320px] w-full flex-col items-center justify-center rounded-[14px] border border-neutral-200 bg-white px-6 py-10 text-center">
                        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-xl font-semibold text-primary-800">
                            S
                        </div>
                        <h2 className="text-xl font-semibold text-neutral-900">No spaces yet</h2>
                        <p className="mt-2 max-w-[420px] text-sm leading-6 text-neutral-800">
                            Create your first space to organize documents and team collaboration in one place.
                        </p>
                        <Button
                            type="button"
                            onClick={() => setIsCreateOpen(true)}
                            className="mt-6 rounded-md px-4 py-2 text-base font-semibold"
                        >
                            <Icon name="Plus" className="h-4 w-4" strokeWidth={2.25} />
                            Create New Space
                        </Button>
                    </div>
                ) : null}
            </div>

            <CreateSpaceModal
                open={isCreateOpen}
                onOpenChange={handleCreateOpenChange}
                value={createName}
                onValueChange={setCreateName}
                descriptionValue={createDescription}
                onDescriptionChange={setCreateDescription}
                onSubmit={handleCreateSubmit}
                loading={createLoading}
                title="Create a new space"
                description="Add a name and short description so people understand what belongs in this space."
                label="Space name"
                placeholder="Product Design"
                descriptionLabel="Description"
                descriptionPlaceholder="Roadmaps, sprint docs, and planning notes for product delivery."
                submitLabel="Create space"
                errorMessage={createErrorMessage}
            />

            {toast ? (
                <ToastComponent
                    key={`${toast.tone}-${toast.message}`}
                    className="fixed right-6 top-24 z-50"
                    icon={toast.tone === "success" ? "Check" : "AlertTriangle"}
                    type={toast.tone}
                    toggle={true}
                    message={toast.message}
                />
            ) : null}
        </>
    );
}
