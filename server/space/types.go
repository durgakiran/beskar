package space

import (
	"time"

	"github.com/google/uuid"
)

type Space struct {
	Id              uuid.UUID  `json:"id" db:"id"`
	Name            string     `json:"name" db:"name"`
	Description     string     `json:"description" db:"description"`
	DateCreated     time.Time  `json:"dateCreated" db:"date_created"`
	DateUpdated     time.Time  `json:"dateUpdated" db:"date_updated"`
	CreatedBy       uuid.UUID  `json:"createdBy" db:"user_id"`
	ArchivedAt      *time.Time `json:"archivedAt,omitempty" db:"archived_at"`
	ArchivedBy      *uuid.UUID `json:"archivedBy,omitempty" db:"archived_by"`
	DeletedAt       *time.Time `json:"deletedAt,omitempty" db:"deleted_at"`
	DeletedBy       *uuid.UUID `json:"deletedBy,omitempty" db:"deleted_by"`
	CurrentOwnerId  uuid.UUID  `json:"currentOwnerId,omitempty"`
	MemberCount     int        `json:"memberCount"`
	DocCount        int        `json:"docCount"`
	WhiteboardCount int        `json:"whiteboardCount"`
	UserRole        string     `json:"userRole"`
}

type SpaceListItem struct {
	Id              uuid.UUID  `json:"id" db:"id"`
	Name            string     `json:"name" db:"name"`
	Description     string     `json:"description" db:"description"`
	DateUpdated     time.Time  `json:"dateUpdated" db:"date_updated"`
	CreatedBy       uuid.UUID  `json:"createdBy" db:"user_id"`
	ArchivedAt      *time.Time `json:"archivedAt,omitempty" db:"archived_at"`
	MemberCount     int        `json:"memberCount"`
	DocCount        int        `json:"docCount"`
	WhiteboardCount int        `json:"whiteboardCount"`
	UserRole        string     `json:"userRole"`
}

type PageList struct {
	PageId   int64     `json:"pageId" db:"id"`
	OwnerId  uuid.UUID `json:"ownerId" db:"owner_id"`
	Title    string    `json:"title" db:"title"`
	ParentId int64     `json:"parentId" db:"parent_id"`
	Draft    int8      `json:"draft" db:"draft"`
	Type     string    `json:"type" db:"type"`
}

type User struct {
	Id       uuid.UUID  `json:"id" db:"id"`
	Name     string     `json:"name" db:"name"`
	Role     string     `json:"role" db:"role"`
	Email    string     `json:"email" db:"email"`
	IsOwner  bool       `json:"isOwner"`
	JoinedAt *time.Time `json:"joinedAt,omitempty" db:"joined_at"`
}

type SpaceSettingsState struct {
	Id                   uuid.UUID  `json:"id"`
	Name                 string     `json:"name"`
	Description          string     `json:"description"`
	CreatedBy            uuid.UUID  `json:"createdBy"`
	CurrentOwnerId       uuid.UUID  `json:"currentOwnerId"`
	CurrentOwnerName     string     `json:"currentOwnerName"`
	CurrentOwnerEmail    string     `json:"currentOwnerEmail"`
	ArchivedAt           *time.Time `json:"archivedAt,omitempty"`
	ArchivedBy           *uuid.UUID `json:"archivedBy,omitempty"`
	DeletedAt            *time.Time `json:"deletedAt,omitempty"`
	MemberCount          int        `json:"memberCount"`
	DocCount             int        `json:"docCount"`
	WhiteboardCount      int        `json:"whiteboardCount"`
	UserRole             string     `json:"userRole"`
	CanManageMembers     bool       `json:"canManageMembers"`
	CanTransferOwnership bool       `json:"canTransferOwnership"`
	CanArchive           bool       `json:"canArchive"`
	CanDelete            bool       `json:"canDelete"`
}

type AddSpaceMemberItem struct {
	UserId string `json:"userId"`
	Role   string `json:"role"`
}

type AddSpaceMembersRequest struct {
	Members []AddSpaceMemberItem `json:"members"`
}

type ChangeSpaceMemberRoleRequest struct {
	UserId string `json:"userId"`
	Role   string `json:"role"`
}

type RemoveSpaceMemberRequest struct {
	UserId string `json:"userId"`
}

type MemberCandidateSearchRequest struct {
	Query  string   `json:"query"`
	Emails []string `json:"emails"`
	Limit  uint32   `json:"limit"`
	Offset uint64   `json:"offset"`
}

type MemberCandidate struct {
	UserId         string `json:"userId,omitempty"`
	Name           string `json:"name"`
	Email          string `json:"email"`
	AlreadyMember  bool   `json:"alreadyMember"`
	AlreadyInvited bool   `json:"alreadyInvited"`
	CurrentRole    string `json:"currentRole,omitempty"`
}

type MemberCandidateSearchResponse struct {
	Matches         []MemberCandidate `json:"matches"`
	ExistingMembers []MemberCandidate `json:"existingMembers"`
	PendingInvites  []MemberCandidate `json:"pendingInvites"`
	UnknownEmails   []MemberCandidate `json:"unknownEmails"`
}

type TransferOwnershipRequest struct {
	NewOwnerUserId string `json:"newOwnerUserId"`
}

type DeleteSpaceRequest struct {
	ConfirmName string `json:"confirmName"`
}
