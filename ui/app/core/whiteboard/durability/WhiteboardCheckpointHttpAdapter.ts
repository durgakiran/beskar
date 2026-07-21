import { uint8ArrayToBase64 } from "app/core/utils/base64";
import type { YjsPersistenceAdapter, YjsSaveRequest, YjsSaveResult } from "./types";
import { DurabilityConflictError } from "./types";

interface HttpAdapterOptions {
    baseUrl: string;
    spaceId: string;
    pageId: string;
}

interface ApiEnvelope<T> {
    data: T;
}

export class WhiteboardCheckpointHttpAdapter implements YjsPersistenceAdapter {
    private readonly url: string;

    constructor(options: HttpAdapterOptions) {
        const baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.url = `${baseUrl}/editor/space/${options.spaceId}/whiteboard/${options.pageId}/checkpoint`;
    }

    async save(request: YjsSaveRequest): Promise<YjsSaveResult> {
        const response = await fetch(this.url, {
            method: "PUT",
            credentials: "include",
            signal: request.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                draftId: Number(request.draftId),
                data: uint8ArrayToBase64(request.encodedState),
                transactionSequence: request.target.yjs.transactionSequence,
                stateDigest: request.target.yjs.stateDigest,
                expectedRevision: request.expectedDurableRevision,
                clientId: request.clientId,
                requestId: request.requestId,
            }),
        });

        if (response.status === 409) {
            const body = await response.json() as ApiEnvelope<{
                revision: string;
                data?: string;
            }>;
            throw new DurabilityConflictError(
                body.data.revision,
                body.data.data ? decodeBase64(body.data.data) : undefined,
            );
        }
        if (!response.ok) {
            throw new Error(`Failed to save whiteboard checkpoint (${response.status})`);
        }
        const body = await response.json() as ApiEnvelope<{
            draftId: string | number;
            revision: string;
            acknowledgedCheckpoint: YjsSaveResult["acknowledgedCheckpoint"];
        }>;
        return {
            draftId: String(body.data.draftId),
            durableRevision: body.data.revision,
            acknowledgedCheckpoint: body.data.acknowledgedCheckpoint,
        };
    }
}

function decodeBase64(value: string): Uint8Array {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}
