'use client'
import Link from "next/link";
import FixedMenu from "@editor/fixedMenu/FixedMenu";
import { Avatar, Box, Button, Flex, IconButton, Text } from "@radix-ui/themes";
import { FiFileText, FiShare2, FiStar } from "react-icons/fi";

interface Collaborator {
    id: string;
    name: string;
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
    spaceName: string;
    pageTitle: string;
    collaborators: Collaborator[];
    canComment: boolean;
    currentUserId?: string;
    isLeader: boolean;
}

export function Editorheader({
    isEditorReady,
    isUpdating,
    handleClose,
    handleUpdate,
    isSidePanelOpen,
    setIsSidePanelOpen,
    spaceId,
    spaceName,
    pageTitle,
    collaborators,
    canComment,
    currentUserId,
    isLeader,
}: EditorHeaderProps) {
    const visibleCollaborators = collaborators.slice(0, 3);

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
                            href={`/space/${spaceId}`}
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
                                    <Box
                                        key={collaborator.id}
                                        style={{
                                            position: "relative",
                                            marginLeft: index === 0 ? 0 : -6,
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
                                        {isLeader && collaborator.id === currentUserId ? (
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
                                    </Box>
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
                        aria-label="Share"
                        title="Share flow is not implemented yet"
                        disabled
                        className="!bg-[#f5f4f6] !text-[#605c67]"
                    >
                        <FiShare2 size={15} />
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

            <FixedMenu
                isEditorReady={isEditorReady}
                isSidePanelOpen={isSidePanelOpen}
                setIsSidePanelOpen={setIsSidePanelOpen}
                canComment={canComment}
            />
        </Box>
    )
}
