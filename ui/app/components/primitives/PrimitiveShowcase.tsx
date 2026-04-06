"use client";

import { useState } from "react";
import { Box, Button, Text, IconButton } from "@radix-ui/themes";
import { Icon } from "@components/ui/Icon";
import {
    CreateSpaceModal,
    ModalScrim,
    PageTree,
    PageTreeNode,
    SpaceCard,
    SpacesHeader,
    StatusNotice,
    Topbar,
    UserRowData,
    UserTableRow,
} from "./index";

const pageTreeData: PageTreeNode[] = [
    { id: "overview", title: "Overview", type: "document", href: "#" },
    {
        id: "roadmap",
        title: "Roadmap",
        type: "document",
        href: "#",
        children: [
            { id: "q2-plan", title: "Q2 Plan", type: "document", href: "#" },
            { id: "sprint-board", title: "Sprint Board", type: "whiteboard", href: "#" },
        ],
    },
    { id: "retro-board", title: "Retro Board", type: "whiteboard", href: "#" },
];

const users: UserRowData[] = [
    { id: "1", name: "Asha Reddy", email: "asha@tededox.dev", role: "owner" },
    { id: "2", name: "Jordan Kim", email: "jordan@tededox.dev", role: "editor" },
    { id: "3", name: "Sam Patel", email: "sam@tededox.dev", role: "viewer" },
];

export function PrimitiveShowcase() {
    const [expandedIds, setExpandedIds] = useState<string[]>(["roadmap"]);
    const [activeId, setActiveId] = useState<string>("sprint-board");
    const [modalOpen, setModalOpen] = useState<boolean>(false);
    const [spaceName, setSpaceName] = useState<string>("");
    const [noticeVisible, setNoticeVisible] = useState<boolean>(true);
    const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

    const toggleNode = (id: string) => {
        setExpandedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    };

    const submitSpace = () => {
        setIsSubmitting(true);
        window.setTimeout(() => {
            setIsSubmitting(false);
            setModalOpen(false);
            setSpaceName("");
        }, 800);
    };

    return (
        <Box className="min-h-screen bg-neutral-100 p-6 md:p-8">
            <div className="mx-auto max-w-7xl space-y-8">
                <div className="space-y-2">
                    <Text size="6" weight="bold" className="text-neutral-900">
                        TedEDox Primitives
                    </Text>
                    <Text size="3" className="text-neutral-600">
                        Internal reference surface for `.pen` primitive parity.
                    </Text>
                </div>

                <section className="overflow-hidden border border-neutral-200 bg-white">
                    <Topbar
                        brand="Tededox"
                        navItems={[
                            { id: "spaces", label: "Spaces", href: "#", active: true },
                            { id: "contact", label: "Contact", href: "#" },
                        ]}
                        user={{
                            name: "Diana Miller",
                            email: "diana@tededox.dev",
                            initials: "D",
                        }}
                        userMenuItems={[
                            { id: "profile", label: "Profile", icon: "User", href: "#" },
                            { id: "settings", label: "Settings", icon: "Settings", href: "#" },
                            { id: "notifications", label: "Notifications", icon: "Bell", href: "#" },
                            { id: "signout", label: "Sign out", icon: "LogOut", href: "#", tone: "danger" },
                        ]}
                    />
                </section>

                <div className="grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]">
                    <section className="space-y-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                        <div className="flex items-center justify-between px-2">
                            <Text size="1" weight="bold" className="uppercase tracking-wide text-neutral-500">
                                Pages
                            </Text>
                            <IconButton variant="ghost" className="text-primary-700 hover:bg-primary-100">
                                <Icon name="Plus" />
                            </IconButton>
                        </div>
                        <PageTree
                            nodes={pageTreeData}
                            expandedIds={expandedIds}
                            activeId={activeId}
                            onToggle={toggleNode}
                            onSelect={setActiveId}
                            onAddChild={() => undefined}
                        />
                    </section>

                    <section className="space-y-8">
                        <div className="rounded-xl border border-neutral-200 bg-white p-6">
                            <SpacesHeader
                                title="Spaces"
                                subtitle="Select a space to open documents, whiteboards, and settings."
                                actionLabel="Create New Space"
                                onAction={() => setModalOpen(true)}
                            />
                        </div>

                        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                            <SpaceCard
                                title="Product Design"
                                description="Roadmap, sprint docs, and planning boards for product delivery."
                                badge="24 members"
                                badges={["12 docs", "5 whiteboards"]}
                                meta="Owner • Updated 2h ago"
                                leadingLabel="P"
                                href="#"
                            />
                            <SpaceCard
                                title="Growth Team"
                                description="Campaign planning, launch notes, and analytics experiments."
                                badge="18 members"
                                badges={["8 docs", "3 whiteboards"]}
                                meta="Admin • Updated yesterday"
                                leadingLabel="G"
                                href="#"
                            />
                            <SpaceCard
                                title="Customer Ops"
                                description="Support playbooks, escalation notes, and weekly reporting."
                                badge="12 members"
                                badges={["9 docs", "2 whiteboards"]}
                                meta="Editor • Updated 4h ago"
                                leadingLabel="C"
                                onClick={() => undefined}
                            />
                        </div>

                        <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6">
                            <Text size="4" weight="bold" className="text-neutral-900">
                                UserTableRow
                            </Text>
                            <div className="overflow-hidden rounded-lg border border-neutral-200">
                                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px_88px] gap-3 bg-neutral-100 px-4 py-3 text-sm font-semibold text-neutral-700">
                                    <span>Name</span>
                                    <span>Email</span>
                                    <span>Role</span>
                                    <span className="text-right">Actions</span>
                                </div>
                                {users.map((user) => (
                                    <UserTableRow
                                        key={user.id}
                                        user={user}
                                        actionSlot={
                                            <Button variant="outline" size="1" color={user.role === "owner" ? "gray" : "red"} disabled={user.role === "owner"}>
                                                {user.role === "owner" ? "Locked" : "Remove"}
                                            </Button>
                                        }
                                    />
                                ))}
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                {users.map((user) => (
                                    <UserTableRow
                                        key={`${user.id}-compact`}
                                        user={user}
                                        compact
                                        actionSlot={<Button variant="outline" size="1">Manage</Button>}
                                    />
                                ))}
                            </div>
                        </div>

                        <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6">
                            <Text size="4" weight="bold" className="text-neutral-900">
                                StatusNotice
                            </Text>
                            {noticeVisible ? (
                                <StatusNotice
                                    tone="success"
                                    message="Space created successfully."
                                    onDismiss={() => setNoticeVisible(false)}
                                />
                            ) : (
                                <Button variant="soft" color="gray" onClick={() => setNoticeVisible(true)}>
                                    Reset success notice
                                </Button>
                            )}
                            <StatusNotice tone="warning" title="Pending invite" message="Jordan has not accepted the invitation yet." />
                            <StatusNotice tone="error" message="Unable to archive this space right now." actionLabel="Retry" />
                            <StatusNotice tone="info" message="Pages sync automatically every few seconds." />
                        </div>

                        <div className="space-y-4">
                            <Text size="4" weight="bold" className="text-neutral-900">
                                ModalScrim
                            </Text>
                            <ModalScrim>
                                <div className="w-full max-w-[472px] rounded-xl border border-neutral-200 bg-white p-6 shadow-lg">
                                    <Text as="div" size="5" weight="bold" className="text-neutral-900">
                                        Create New Space
                                    </Text>
                                    <Text as="div" size="2" className="mt-2 text-neutral-600">
                                        Give your new space a clear title.
                                    </Text>
                                    <div className="mt-5 flex justify-end">
                                        <Button onClick={() => setModalOpen(true)}>Open live modal</Button>
                                    </div>
                                </div>
                            </ModalScrim>
                        </div>
                    </section>
                </div>
            </div>

            <CreateSpaceModal
                open={modalOpen}
                onOpenChange={setModalOpen}
                value={spaceName}
                onValueChange={setSpaceName}
                onSubmit={submitSpace}
                loading={isSubmitting}
                errorMessage={spaceName.trim() === "" && isSubmitting ? "Space name is required." : undefined}
            />
        </Box>
    );
}
