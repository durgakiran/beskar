import { useEffect, useMemo, useState } from "react";
import { YKeyValue } from "y-utility/y-keyvalue";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import {
    computed,
    createPresenceStateDerivation,
    createTLStore,
    transact,
    react,
    defaultShapeUtils,
    InstancePresenceRecordType,
    TLAnyShapeUtilConstructor,
    TLInstancePresence,
    TLRecord,
    TLStoreWithStatus,
} from "tldraw";

const randomName = () => ["Anonymous Mouse", "Secret Badger", "Hidden Tiger", "Stealthy Fox"][Math.floor(Math.random() * 4)];
const randomColor = () => "#" + Math.floor(Math.random() * 16777215).toString(16).padEnd(6, '0');

export function useYjsStore({
    yDoc,
    yProvider,
    shapeUtils = [],
}: {
    yDoc: Y.Doc;
    yProvider: any;
    shapeUtils?: TLAnyShapeUtilConstructor[];
}) {
    // Generate an ephemeral random user for UI cursor colors
    const user = useMemo(() => ({
        id: Math.random().toString(36).substring(2, 9),
        color: randomColor(),
        name: randomName(),
    }), []);

    // Set up the YKeyValue store from the provided Y.Doc
    const yStore = useMemo(() => {
        const yArr = yDoc.getArray<{ key: string; val: TLRecord }>("tl_records");
        return new YKeyValue(yArr);
    }, [yDoc]);

    // Set up tldraw store and status
    const [store] = useState(() => {
        return createTLStore({
            shapeUtils: [...defaultShapeUtils, ...shapeUtils],
        });
    });

    const [storeWithStatus, setStoreWithStatus] = useState<TLStoreWithStatus>({
        status: "loading",
    });

    useEffect(() => {
        setStoreWithStatus({ status: "loading" });

        const unsubs: (() => void)[] = [];

        function handleSync() {
            console.log('[useYjsStore] handleSync initialized. yStore length:', yStore.yarray.length);
            // === DOCUMENT SYNC ==========================================================

            if (yStore.yarray.length) {
                console.log('[useYjsStore] Found existing Yjs records, hydrating Tldraw store...');
                transact(() => {
                    store.clear();
                    const records = yStore.yarray.toJSON().map(({ val }: any) => val);
                    store.put(records);
                });
            } else {
                console.log('[useYjsStore] yStore empty, seeding Yjs from Tldraw store...');
                yDoc.transact(() => {
                    for (const record of store.allRecords()) {
                        yStore.set(record.id, record);
                    }
                });
            }

            // [1] TLStore -> Yjs changes
            unsubs.push(
                store.listen(
                    function syncStoreChangesToYjsDoc({ changes }) {
                        console.log('[useYjsStore] TLStore local change detected, syncing to Yjs...', Object.keys(changes.added).length, 'added');
                        yDoc.transact(() => {
                            Object.values(changes.added).forEach((record) => {
                                yStore.set(record.id, record);
                            });

                            Object.values(changes.updated).forEach(([_, record]) => {
                                yStore.set(record.id, record);
                            });

                            Object.values(changes.removed).forEach((record) => {
                                yStore.delete(record.id);
                            });
                        });
                    },
                    { source: "user", scope: "document" }
                )
            );

            // [2] Yjs -> TLStore changes
            const handleChange = (
                changes: Map<
                    string,
                    | { action: "delete"; oldValue: TLRecord }
                    | { action: "update"; oldValue: TLRecord; newValue: TLRecord }
                    | { action: "add"; newValue: TLRecord }
                >,
                transaction: Y.Transaction
            ) => {
                if (transaction.local) return;

                console.log('[useYjsStore] Remote Yjs change received, merging into TLStore...', changes.size, 'changes');

                const toRemove: TLRecord["id"][] = [];
                const toPut: TLRecord[] = [];

                changes.forEach((change, id) => {
                    switch (change.action) {
                        case "add":
                        case "update": {
                            const record = yStore.get(id)!;
                            toPut.push(record);
                            break;
                        }
                        case "delete": {
                            toRemove.push(id as TLRecord["id"]);
                            break;
                        }
                    }
                });

                store.mergeRemoteChanges(() => {
                    if (toRemove.length) store.remove(toRemove);
                    if (toPut.length) store.put(toPut);
                });
            };

            yStore.on("change", handleChange);
            unsubs.push(() => yStore.off("change", handleChange));

            // === AWARENESS (CURSORS) SYNC ==========================================================

            const userPreferences = computed<{
                id: string;
                color: string;
                name: string;
            }>("userPreferences", () => {
                return {
                    id: user.id,
                    color: user.color,
                    name: user.name,
                };
            });

            // Get unique Yjs connection ID
            const presenceId = InstancePresenceRecordType.createId(yDoc.clientID.toString());

            const presenceDerivation = createPresenceStateDerivation(
                userPreferences,
                presenceId
            )(store);

            yProvider.awareness.setLocalStateField(
                "presence",
                presenceDerivation.get() ?? null
            );

            // Update Yjs when tldraw presence changes
            unsubs.push(
                react("when presence changes", () => {
                    const presence = presenceDerivation.get() ?? null;
                    requestAnimationFrame(() => {
                        yProvider.awareness.setLocalStateField("presence", presence);
                    });
                })
            );

            // Sync WebRTC remote awareness with tldraw
            const handleUpdate = (update: {
                added: number[];
                updated: number[];
                removed: number[];
            }) => {
                const states = yProvider.awareness.getStates() as Map<
                    number,
                    { presence: TLInstancePresence }
                >;

                const toRemove: TLInstancePresence["id"][] = [];
                const toPut: TLInstancePresence[] = [];

                for (const clientId of update.added) {
                    const state = states.get(clientId);
                    if (state?.presence && state.presence.id !== presenceId) {
                        toPut.push(state.presence);
                    }
                }

                for (const clientId of update.updated) {
                    const state = states.get(clientId);
                    if (state?.presence && state.presence.id !== presenceId) {
                        toPut.push(state.presence);
                    }
                }

                for (const clientId of update.removed) {
                    toRemove.push(
                        InstancePresenceRecordType.createId(clientId.toString())
                    );
                }

                store.mergeRemoteChanges(() => {
                    if (toRemove.length > 0) store.remove(toRemove);
                    if (toPut.length > 0) store.put(toPut);
                });
            };

            yProvider.awareness.on("change", handleUpdate);
            unsubs.push(() => yProvider.awareness.off("change", handleUpdate));

            setStoreWithStatus({
                store,
                status: "synced-remote",
                connectionStatus: "online",
            });
        }

        // 3) Initialize immediately.
        // WebRTC is fundamentally Peer-to-Peer. Unlike WebSockets where there is a central server
        // holding the document to wait for a "synced" baseline, in WebRTC the local client
        // is its own source of truth until peers connect. So we don't wait for "synced".
        handleSync();

        return () => {
            unsubs.forEach((fn) => fn());
            unsubs.length = 0;
            // The creator (the consumer) is responsible for destroying yProvider and yDoc.
        };
    }, [yProvider, yDoc, store, yStore, user]);

    return storeWithStatus;
}