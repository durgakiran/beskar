
import { useGet, Response } from "@http/hooks";
import { usePut as usePUT } from "@http/hooks";
import { useEffect, useMemo, useState, useRef } from "react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { Spinner, Flex, Button, IconButton, Avatar, HoverCard, Box, Text } from "@radix-ui/themes";
import { base64ToUint8Array, uint8ArrayToBase64 } from "app/core/utils/base64";
import { useNavigate } from "react-router-dom";
import { HiHome } from "react-icons/hi";
import { FiStar } from "react-icons/fi";
import { getSignalingUrl } from "app/core/signaling";
import { wbEditor, Glideboard } from "@durgakiran/glideboard";

export default function WhiteboardEditor({
    slug,
    readOnly = false,
    fillParent = false,
}: {
    slug: string[];
    readOnly?: boolean;
    fillParent?: boolean;
}) {
    const spaceId = slug[0];
    const pageId = slug[1];
    const navigate = useNavigate();
    const fetchPath = readOnly
        ? `editor/space/${spaceId}/whiteboard/${pageId}`
        : `editor/space/${spaceId}/whiteboard/${pageId}/edit`;

    const [{ data: fetchRes, isLoading: fetching, errors: fetchErr }, fetchWhiteboard] = useGet<Response<{
        id: number;
        docId: number;
        data?: string | null;
        title: string;
        pageId: number;
        spaceId: string;
    }>>(fetchPath);
    const [{ isLoading: updating }, updateWhiteboard] = usePUT<Response<any>, { data: string }>(`editor/space/${spaceId}/whiteboard/${pageId}`);
    const [{ data: profileData }, getProfile] = useGet<Response<{ id: string; name: string; email: string }>>(`profile/details`);

    const [isDbLoaded, setIsDbLoaded] = useState(false);
    const [provider, setProvider] = useState<WebrtcProvider | null>(null);
    const dirtyRef = useRef(false);
    const didApplyInitialDataRef = useRef(false);
    const documentSessionKey = `${spaceId}:${pageId}`;

    const collaborationUser = useMemo(() => {
        if (!profileData?.data) return null;
        const r = Math.floor(Math.random() * 106) + 150;
        const g = Math.floor(Math.random() * 106) + 150;
        const b = Math.floor(Math.random() * 106) + 150;
        const color = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
        return { id: profileData.data.id, name: profileData.data.name, color };
    }, [profileData]);

    const yDoc = useMemo(() => {
        void documentSessionKey;
        return new Y.Doc();
    }, [documentSessionKey]);

    useEffect(() => {
        if (readOnly) return; // no collaboration in view mode
        const _provider = new WebrtcProvider(pageId + "-space-" + spaceId, yDoc, {
            signaling: [getSignalingUrl()],
            filterBcConns: false
        });
        setProvider(_provider);
        return () => {
            _provider.disconnect();
            _provider.destroy();
            setProvider(null);
        };
    }, [yDoc, spaceId, pageId, readOnly]);

    useEffect(() => {
        didApplyInitialDataRef.current = false;
        setIsDbLoaded(false);
        fetchWhiteboard();
        getProfile();
        return () => {
            yDoc.destroy();
        };
    }, [fetchWhiteboard, getProfile, yDoc]);

    useEffect(() => {
        if (!fetchRes || didApplyInitialDataRef.current) return;
        didApplyInitialDataRef.current = true;
        const encodedData = fetchRes.data?.data;
        if (encodedData) {
            try {
                const update = base64ToUint8Array(encodedData);
                Y.applyUpdate(yDoc, update);
            } catch (err) {
                console.error("Error applying init dbData to yDoc", err);
            }
        }
        setIsDbLoaded(true);
    }, [fetchRes, yDoc]);

    useEffect(() => {
        if (readOnly) return;

        const handleUpdate = () => {
            dirtyRef.current = true;
        };
        yDoc.on('update', handleUpdate);

        const syncInterval = setInterval(() => {
            if (dirtyRef.current && isDbLoaded) {
                dirtyRef.current = false;
                const encoded = Y.encodeStateAsUpdate(yDoc);
                if (!encoded || encoded.length === 0) return; // skip empty state
                const state = uint8ArrayToBase64(encoded);
                if (!state) return; // skip if base64 serialization failed
                updateWhiteboard({ data: state });
            }
        }, 5000);

        return () => {
            yDoc.off('update', handleUpdate);
            clearInterval(syncInterval);
        };
    }, [isDbLoaded, readOnly, updateWhiteboard, yDoc]);

    // 5. Set awareness user from profile (edit mode only)
    useEffect(() => {
        if (!provider || !collaborationUser) return;
        provider.awareness.setLocalStateField('user', {
            id: collaborationUser.id,
            name: collaborationUser.name,
            color: collaborationUser.color,
        });
    }, [provider, collaborationUser]);

    const [isPublishing, setIsPublishing] = useState(false);
    const [activeCollaborators, setActiveCollaborators] = useState<
        Array<{ id: string; name: string; email?: string; color?: string }>
    >([]);

    useEffect(() => {
        if (!provider) return;

        const syncCollaborators = () => {
            const states = Array.from(provider.awareness.getStates().values());
            const nextCollaborators = states
                .map((state) => state?.user as { id?: string; name?: string; email?: string; color?: string } | undefined)
                .filter((candidate): candidate is { id: string; name: string; email?: string; color?: string } => Boolean(candidate?.id && candidate?.name));

            const deduped = Array.from(
                new Map(nextCollaborators.map((candidate) => [candidate.id, candidate])).values(),
            );

            setActiveCollaborators(deduped);
        };

        syncCollaborators();
        provider.awareness.on("change", syncCollaborators);
        return () => {
            provider.awareness.off("change", syncCollaborators);
        };
    }, [provider]);

    const visibleCollaborators = activeCollaborators.slice(0, 3);

    if (fetching || !isDbLoaded || (!readOnly && !provider)) {
        return (
            <Flex justify="center" style={{ marginTop: '20vh' }}>
                <Spinner size="3" />
            </Flex>
        );
    }

    const handleClose = () => {
        navigate(`/space/${spaceId}/view/${pageId}`);
    };

    const handlePublish = async () => {
        setIsPublishing(true);
        try {
            // 1. SVG snapshot
            const shapeIds = wbEditor.serialize().records
                .filter((r) => 'x' in r && 'y' in r)
                .map(s => s.id);
            
            let previewAssetName = '';
            if (shapeIds.length > 0) {
                const svgString = wbEditor.exportToSvg(shapeIds as any);
                const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
                
                const formData = new FormData();
                formData.append('file', svgBlob, 'whiteboard-preview.svg');
                formData.append('pageId', pageId);
                
                const uploadRes = await fetch('/api/v1/media/upload', {
                    method: 'POST',
                    body: formData,
                });
                
                if (uploadRes.ok) {
                    const uploadJson = await uploadRes.json();
                    previewAssetName = uploadJson.data?.name ?? '';
                }
            }

            // 2. Yjs state
            const encoded = uint8ArrayToBase64(Y.encodeStateAsUpdate(yDoc));

            // 3. Publish
            const publishRes = await fetch(
                `/api/v1/editor/space/${spaceId}/whiteboard/${pageId}/publish`,
                {
                    method: 'PUT', // Route in editorController.go is PUT
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: encoded, previewAssetName }),
                }
            );

            if (!publishRes.ok) throw new Error('Publish failed');
            
        } catch (e: any) {
            console.error(e);
            alert(e.message ?? 'Publish failed');
        } finally {
            setIsPublishing(false);
        }
    };

    const pageTitle = fetchRes?.data?.title || 'Untitled Whiteboard';

    // Edit mode: pull flush under the fixed navbar, with our own sub-header.
    // View mode: the page already has a header, so render canvas directly.
    if (!readOnly) {
        return (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: 'calc(100vh - 57px)',
                    marginTop: '-17px',
                    width: '100%',
                    maxWidth: '100%',
                    minWidth: 0,
                    overflow: 'hidden',
                }}
            >
                {/* Header — same visual language as FixedMenu in the document editor */}
                <Flex
                    align="center"
                    justify="between"
                    py="3"
                    px="4"
                    gap="4"
                    style={{
                        width: '100%',
                        maxWidth: '100%',
                        minWidth: 0,
                        borderBottom: '1px solid var(--gray-6)',
                        minHeight: '52px',
                        backgroundColor: 'white',
                        position: 'sticky',
                        top: 0,
                        zIndex: 10,
                    }}
                >
                    {/* Left: Home icon */}
                    <Flex align="center" gap="2" pr="4" style={{ borderRight: '1px solid var(--gray-6)', height: '32px', flexShrink: 0 }}>
                        <IconButton
                            variant="ghost"
                            size="2"
                            aria-label="home"
                            onClick={handleClose}
                            style={{ height: '32px', width: '32px' }}
                        >
                            <HiHome size={18} />
                        </IconButton>
                    </Flex>

                    {/* Center: Page title */}
                    <Flex style={{ flex: 1, minWidth: 0 }} align="center">
                        <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--gray-11)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pageTitle}
                        </span>
                    </Flex>

                    {/* Right: Publish & Close button */}
                    <Flex align="center" gap="3" style={{ flexShrink: 0 }}>
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
                                {activeCollaborators.length > 0
                                    ? `${activeCollaborators.length} editing`
                                    : "Solo editing"}
                            </Text>
                        </Flex>

                        <Flex align="center" gap="2">
                            <Button 
                                size="2" 
                                variant="solid" 
                                color="blue" 
                                onClick={handlePublish}
                                disabled={isPublishing}
                                loading={isPublishing}
                            >
                                Publish
                            </Button>
                            <Button size="2" variant="ghost" color="gray" onClick={handleClose}>
                                Close
                            </Button>
                        </Flex>
                    </Flex>
                </Flex>

                {/* Canvas */}
                <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                    <WhiteboardCanvas yDoc={yDoc} provider={provider} fetchErr={fetchErr} readOnly={readOnly} collaborationUser={collaborationUser} />
                </div>
            </div>
        );
    }

    // View mode: render canvas directly, no sub-header
    return (
        <div style={{ width: '100%', height: fillParent ? '100%' : 'calc(100vh - 120px)' }}>
            <WhiteboardCanvas yDoc={yDoc} provider={provider} fetchErr={fetchErr} readOnly={readOnly} collaborationUser={collaborationUser} />
        </div>
    );
}

function WhiteboardCanvas({
    yDoc,
    provider,
    fetchErr,
    readOnly,
    collaborationUser,
}: {
    yDoc: Y.Doc;
    provider: WebrtcProvider | null;
    fetchErr: any;
    readOnly: boolean;
    collaborationUser: { id: string; name: string; color: string } | null;
}) {
    if (fetchErr) {
        return <Flex>Error loading whiteboard.</Flex>;
    }

    const collaborationProps = useMemo(() => ({
        doc: yDoc,
        provider: provider as any,
        user: collaborationUser,
    }), [yDoc, provider, collaborationUser]);

    return (
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <Glideboard
                collaboration={collaborationProps}
                readOnly={readOnly}
            />
        </div>
    );
}
