export type InviteDecision = "accept" | "reject";
export type InviteStatus = "accepted" | "rejected" | "removed";

export interface InviteDetails {
    entity: string;
    entityId: string;
    senderId: string;
    senderName: string;
    name: string;
    role: string;
    token: string;
    status?: InviteStatus | string | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface InviteDecisionResult {
    status: InviteStatus | string;
    entity: string;
    entityId: string;
}

export interface InviteDecisionPayload {
    token: string;
    decision: InviteDecision;
}
