"use client";

import { useGet, Response } from "@http/hooks";
import { usePUT } from "app/core/http/hooks/usePut";
import { useEffect, useMemo, useState, useRef } from "react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { Whiteboard, useYjsStore } from "@durgakiran/whiteboard";
import { Spinner, Flex, Button, IconButton } from "@radix-ui/themes";
import { Buffer } from "buffer";
import "@durgakiran/whiteboard/styles.css";
import { useRouter } from "next/navigation";
import { HiHome } from "react-icons/hi";
import { getSignalingUrl } from "app/core/signaling";

export default function WhiteboardEditor({ slug, readOnly = false }: { slug: string[]; readOnly?: boolean }) {
    const spaceId = slug[0];
    const pageId = slug[1];
    const router = useRouter();

    // Fetch initial state
    const [{ data: fetchRes, isLoading: fetching, errors: fetchErr }, fetchWhiteboard] = useGet<Response<any>>(`editor/space/${spaceId}/whiteboard/${pageId}`);
    // Update state API
    const [{ isLoading: updating }, updateWhiteboard] = usePUT<Response<any>, { data: string }>(`editor/space/${spaceId}/whiteboard/${pageId}`);
    // Fetch current user profile (for collaboration display name)
    const [{ data: profileData }, getProfile] = useGet<Response<{ id: string; name: string; email: string }>>(`profile/details`);

    const [isDbLoaded, setIsDbLoaded] = useState(false);
    // Only create a provider in edit mode; view mode doesn't need real-time collaboration
    const [provider, setProvider] = useState<WebrtcProvider | null>(null);
    const dirtyRef = useRef(false);

    // Derive user object from profile for collaboration awareness
    const collaborationUser = useMemo(() => {
        if (!profileData?.data) return null;
        const r = Math.floor(Math.random() * 106) + 150;
        const g = Math.floor(Math.random() * 106) + 150;
        const b = Math.floor(Math.random() * 106) + 150;
        const color = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
        return { id: profileData.data.id, name: profileData.data.name, color };
    }, [profileData]);

    // 1. Initialize Yjs document
    const yDoc = useMemo(() => new Y.Doc(), []);

    // 2. Connect to WebRTC — only in edit mode
    useEffect(() => {
        if (readOnly) return; // no collaboration in view mode
        const _provider = new WebrtcProvider(pageId + "-space-" + spaceId, yDoc, {
            signaling: [getSignalingUrl()],
            filterBcConns: false
        });
        setProvider(_provider);
        return () => {
            _provider.destroy();
            setProvider(null);
        };
    }, [yDoc, spaceId, pageId, readOnly]);

    // 3. Fetch initial data and profile
    useEffect(() => {
        fetchWhiteboard();
        getProfile();
    }, []);

    // 4. Merge initial data into YDoc
    useEffect(() => {
        if (!fetchRes) return;

        // Data structure from FetchWhiteboard
        const dbData = fetchRes.data?.data;
        if (dbData) {
            try {
                // If it is a fresh uninitialized page, data might be empty.
                const update = Buffer.from(dbData, 'base64');
                Y.applyUpdate(yDoc, update);
            } catch (err) {
                console.error("Error applying init dbData to yDoc", err);
            }
        }
        setIsDbLoaded(true);
    }, [fetchRes, yDoc]);

    useEffect(() => {
        if (readOnly) return;

        const handleUpdate = (update: Uint8Array, origin: any) => {
            dirtyRef.current = true;
        };
        yDoc.on('update', handleUpdate);

        const syncInterval = setInterval(() => {
            if (dirtyRef.current && isDbLoaded) {
                dirtyRef.current = false;
                const encoded = Y.encodeStateAsUpdate(yDoc);
                if (!encoded || encoded.length === 0) return; // skip empty state
                const state = Buffer.from(encoded).toString('base64');
                if (!state) return; // skip if base64 serialization failed
                updateWhiteboard({ data: state });
            }
        }, 5000);

        return () => {
            yDoc.off('update', handleUpdate);
            clearInterval(syncInterval);
        };
    }, [yDoc, isDbLoaded, readOnly]);

    // 5. Set awareness user from profile (edit mode only)
    useEffect(() => {
        if (!provider || !collaborationUser) return;
        provider.awareness.setLocalStateField('user', {
            id: collaborationUser.id,
            name: collaborationUser.name,
            color: collaborationUser.color,
        });
    }, [provider, collaborationUser]);

    if (fetching || !isDbLoaded || (!readOnly && !provider)) {
        return (
            <Flex justify="center" style={{ marginTop: '20vh' }}>
                <Spinner size="3" />
            </Flex>
        );
    }

    const handleClose = () => {
        router.push(`/space/${spaceId}/view/${pageId}`);
    };

    const pageTitle = fetchRes?.data?.title || 'Untitled Whiteboard';

    // Edit mode: pull flush under the fixed navbar, with our own sub-header.
    // View mode: the page already has a header, so render canvas directly.
    if (!readOnly) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 57px)', marginTop: '-17px', marginLeft: '-1rem', marginRight: '-1rem' }}>
                {/* Header — same visual language as FixedMenu in the document editor */}
                <Flex
                    align="center"
                    justify="between"
                    py="3"
                    px="4"
                    gap="4"
                    style={{
                        width: '100%',
                        borderBottom: '1px solid var(--gray-6)',
                        minHeight: '52px',
                        backgroundColor: 'white',
                        position: 'sticky',
                        top: 0,
                        zIndex: 10,
                    }}
                >
                    {/* Left: Home icon */}
                    <Flex align="center" gap="2" pr="4" style={{ borderRight: '1px solid var(--gray-6)', height: '32px' }}>
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
                    <Flex style={{ flex: 1 }} align="center">
                        <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--gray-11)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pageTitle}
                        </span>
                    </Flex>

                    {/* Right: Close button */}
                    <Button size="2" variant="ghost" color="gray" onClick={handleClose}>
                        Close
                    </Button>
                </Flex>

                {/* Canvas */}
                <div style={{ flex: 1, position: 'relative' }}>
                    <WhiteboardCanvas yDoc={yDoc} provider={provider} fetchErr={fetchErr} readOnly={readOnly} userName={collaborationUser?.name} />
                </div>
            </div>
        );
    }

    // View mode: render canvas directly, no sub-header
    return (
        <div style={{ width: '100%', height: 'calc(100vh - 120px)' }}>
            <WhiteboardCanvas yDoc={yDoc} provider={provider} fetchErr={fetchErr} readOnly={readOnly} userName={collaborationUser?.name} />
        </div>
    );
}

function WhiteboardCanvas({ yDoc, provider, fetchErr, readOnly, userName }: { yDoc: Y.Doc, provider: WebrtcProvider | null, fetchErr: any, readOnly: boolean, userName?: string }) {
    const storeWithStatus = useYjsStore({
        yDoc: yDoc as any,
        yProvider: provider as any,
        userName,
    });

    if (storeWithStatus.status === "loading") {
        return (
            <Flex justify="center" style={{ marginTop: '20vh' }}>
                <Spinner size="3" />
            </Flex>
        );
    }

    if (fetchErr) {
        return <Flex>Error loading whiteboard.</Flex>;
    }

    return (
        <div style={{ width: "100%", height: "100%", position: "relative" }}>
            <Whiteboard
                store={storeWithStatus.store}
                readOnly={readOnly}
            />
        </div>
    );
}
