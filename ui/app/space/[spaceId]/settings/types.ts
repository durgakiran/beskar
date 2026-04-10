export type UserRole = "owner" | "admin" | "editor" | "commenter" | "viewer";

export type SpaceMember = {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    isOwner?: boolean;
    joinedAt?: string | null;
};

export type PendingInvite = {
    entity: string;
    entityId: string;
    email: string;
    role: UserRole;
    senderId: string;
    createdAt?: string | null;
    updatedAt?: string | null;
};

export type SpaceSettingsState = {
    id: string;
    name: string;
    description: string;
    createdBy: string;
    currentOwnerId: string;
    currentOwnerName: string;
    currentOwnerEmail: string;
    archivedAt?: string | null;
    archivedBy?: string | null;
    deletedAt?: string | null;
    memberCount: number;
    docCount: number;
    whiteboardCount: number;
    userRole: UserRole;
    canManageMembers: boolean;
    canTransferOwnership: boolean;
    canArchive: boolean;
    canDelete: boolean;
};

export type MemberCandidate = {
    userId?: string;
    name: string;
    email: string;
    alreadyMember?: boolean;
    alreadyInvited?: boolean;
    currentRole?: string;
};

export type MemberCandidateSearchResponse = {
    matches: MemberCandidate[];
    existingMembers: MemberCandidate[];
    pendingInvites: MemberCandidate[];
    unknownEmails: MemberCandidate[];
};
