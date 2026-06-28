import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import FixedMenu from "@editor/fixedMenu/FixedMenu";
import { Avatar, Box, Button, Flex, HoverCard, IconButton, Text } from "@radix-ui/themes";
import { FiCheck, FiFileText, FiShare2, FiStar } from "react-icons/fi";
import { copyTextToClipboard } from "../../../lib/clipboard";

interface Collaborator {
    id: string;
    name: string;
    /** From Yjs awareness when peers publish it (older clients may omit). */
    email?: string;
    color?: string;
}

interface EditorHeaderProps {
    isEditorReady: boolean;
    isUpdating: boolean;
    handleClose: () => void;
    handleUpdate: () => void;
    isSidePanelOpen: boolean;
    setIsSidePanelOpen: (open: boolean) => void;
    spaceId: string;
    pageId: string;
    spaceName: string;
    pageTitle: string;
    collaborators: Collaborator[];
    canComment: boolean;
    currentUserId?: string;
    isLeader: boolean;
    /** User id of the draft leader from awareness; preferred over isLeader for collaborator star. */
    leaderUserId?: string;
    /** Optional M6 notice (e.g. save leader heartbeat stale). */
    presenceNotice?: string | null;
}

export function Editorheader({
    isEditorReady,
    isUpdating,
    handleClose,
    handleUpdate,
    isSidePanelOpen,
    setIsSidePanelOpen,
    spaceId,
    pageId,
    spaceName,
    pageTitle,
    collaborators,
    canComment,
    currentUserId,
    isLeader,
    leaderUserId,
    presenceNotice,
}: EditorHeaderProps) {
    const visibleCollaborators = collaborators.slice(0, 3);

    const showLeaderStar = (collaboratorId: string) => {
        if (leaderUserId) {
            return collaboratorId === leaderUserId;
        }
        return isLeader && collaboratorId === currentUserId;
    };
    const [linkCopied, setLinkCopied] = useState(false);
    const resetCopiedTimer = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (resetCopiedTimer.current) {
                window.clearTimeout(resetCopiedTimer.current);
            }
        };
    }, []);

    const copyPageLink = async () => {
        const pageUrl = `${window.location.origin}/space/${spaceId}/view/${pageId}`;

        try {
            await copyTextToClipboard(pageUrl);
            setLinkCopied(true);
            if (resetCopiedTimer.current) {
                window.clearTimeout(resetCopiedTimer.current);
            }
            resetCopiedTimer.current = window.setTimeout(() => setLinkCopied(false), 1800);
        } catch (error) {
            console.error("Unable to copy page link", error);
        }
    };

    return (
        <Box
            style={{
                borderBottom: "1px solid #e3e1e7",
                backgroundColor: "#fbfafc",
            }}
        >
            <Flex
                align="center"
                justify="between"
                gap="4"
                px="4"
                py="3"
                wrap="wrap"
                style={{ borderBottom: "1px solid #ece9ef" }}
            >
                <Flex align="center" gap="2" wrap="wrap" style={{ minWidth: 0 }}>
                    <FiFileText size={15} color="#605c67" />
                    <Flex align="center" gap="2" wrap="wrap" style={{ minWidth: 0 }}>
                        <Link
                            to={`/space/${spaceId}`}
                            className="max-w-[220px] truncate text-[13px] font-medium text-[#898492] hover:text-[#605c67]"
                        >
                            {spaceName}
                        </Link>
                        <Text size="2" className="text-[#898492]">/</Text>
                        <Text size="2" weight="medium" className="max-w-[220px] truncate text-[#221f26]">
                            {pageTitle}
                        </Text>
                    </Flex>
                </Flex>

                <Flex align="center" gap="3" wrap="wrap">
                    <Flex align="center" gap="2">
                        {visibleCollaborators.length ? (
                            <Flex align="center" style={{ marginRight: "4px" }}>
                                {visibleCollaborators.map((collaborator, index) => (
                                    <HoverCard.Root key={collaborator.id} openDelay={120} closeDelay={100}>
                                        <HoverCard.Trigger>
                                            <span
                                                aria-label={`${collaborator.name} profile`}
                                                style={{
                                                    position: "relative",
                                                    marginLeft: index === 0 ? 0 : -6,
                                                    display: "inline-block",
                                                    lineHeight: 0,
                                                    cursor: "default",
                                                    verticalAlign: "middle",
                                                }}
                                            >
                                                <Avatar
                                                    fallback={collaborator.name.charAt(0).toUpperCase()}
                                                    radius="full"
                                                    size="2"
                                                    style={{
                                                        backgroundColor: collaborator.color || "#f1eff4",
                                                        color: "#221f26",
                                                        border: "2px solid white",
                                                    }}
                                                />
                                                {showLeaderStar(collaborator.id) ? (
                                                    <Box
                                                        style={{
                                                            position: "absolute",
                                                            right: -2,
                                                            bottom: -2,
                                                            width: 14,
                                                            height: 14,
                                                            borderRadius: "999px",
                                                            backgroundColor: "#7c5a96",
                                                            border: "2px solid white",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            boxSizing: "content-box",
                                                        }}
                                                    >
                                                        <FiStar size={8} color="white" />
                                                    </Box>
                                                ) : null}
                                            </span>
                                        </HoverCard.Trigger>
                                        <HoverCard.Content
                                            size="2"
                                            side="top"
                                            sideOffset={8}
                                            style={{ minWidth: 220, maxWidth: 280 }}
                                        >
                                            <Flex gap="3" align="start">
                                                <Avatar
                                                    fallback={collaborator.name.charAt(0).toUpperCase()}
                                                    radius="full"
                                                    size="2"
                                                    style={{
                                                        backgroundColor: collaborator.color || "#f1eff4",
                                                        color: "#221f26",
                                                        border: "2px solid white",
                                                        flexShrink: 0,
                                                    }}
                                                />
                                                <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                                                    <Text size="2" weight="medium" className="text-[#221f26]">
                                                        {collaborator.name}
                                                    </Text>
                                                    {collaborator.email ? (
                                                        <Text size="1" className="text-[#605c67] break-all">
                                                            {collaborator.email}
                                                        </Text>
                                                    ) : (
                                                        <Text size="1" className="text-[#898492]">
                                                            Email not shared
                                                        </Text>
                                                    )}
                                                </Flex>
                                            </Flex>
                                        </HoverCard.Content>
                                    </HoverCard.Root>
                                ))}
                            </Flex>
                        ) : null}
                        <Text size="2" className="text-[#898492]">
                            {collaborators.length > 0
                                ? `${collaborators.length} editing`
                                : "Solo editing"}
                        </Text>
                    </Flex>

                    <IconButton
                        type="button"
                        variant="soft"
                        color="gray"
                        radius="full"
                        size="2"
                        aria-label={linkCopied ? "Page link copied" : "Copy page link"}
                        title={linkCopied ? "Page link copied" : "Copy page link"}
                        onClick={copyPageLink}
                        className="!bg-[#f5f4f6] !text-[#605c67]"
                    >
                        {linkCopied ? <FiCheck size={15} /> : <FiShare2 size={15} />}
                    </IconButton>

                    <Button
                        size="2"
                        onClick={handleUpdate}
                        disabled={!isEditorReady || isUpdating}
                        loading={isUpdating}
                    >
                        Update
                    </Button>

                    <Button size="2" variant="soft" color="gray" onClick={handleClose}>
                        Close
                    </Button>
                </Flex>
            </Flex>

            {presenceNotice ? (
                <Box px="4" py="2" style={{ backgroundColor: "#fff7ed", borderBottom: "1px solid #fed7aa" }}>
                    <Text size="2" className="text-[#9a3412]">
                        {presenceNotice}
                    </Text>
                </Box>
            ) : null}

            <FixedMenu
                isEditorReady={isEditorReady}
                isSidePanelOpen={isSidePanelOpen}
                setIsSidePanelOpen={setIsSidePanelOpen}
                canComment={canComment}
            />
        </Box>
    )
}
