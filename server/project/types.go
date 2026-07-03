package project

import (
	"time"

	"github.com/google/uuid"
)

const (
	DefaultProjectViewList   = "list"
	DefaultProjectViewBoard  = "board"
	DefaultProjectViewMyWork = "my_work"
	DefaultProjectViewCycles = "cycles"

	TicketTypeEpic    = "epic"
	TicketTypeStory   = "story"
	TicketTypeTask    = "task"
	TicketTypeSubtask = "subtask"
	TicketTypeBug     = "bug"

	TicketStatusBacklog    = "backlog"
	TicketStatusTodo       = "todo"
	TicketStatusInProgress = "in_progress"
	TicketStatusInReview   = "in_review"
	TicketStatusDone       = "done"
	TicketStatusCanceled   = "canceled"

	TicketPriorityNone   = "none"
	TicketPriorityLow    = "low"
	TicketPriorityMedium = "medium"
	TicketPriorityHigh   = "high"
	TicketPriorityUrgent = "urgent"
)

type CreateProjectPageRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Key         string `json:"key"`
	ParentID    int64  `json:"parentId"`
}

type CreateProjectPageResponse struct {
	Page int64 `json:"page"`
}

type CreateTicketRequest struct {
	Title            string                       `json:"title"`
	Description      string                       `json:"description"`
	Type             string                       `json:"type"`
	Status           string                       `json:"status"`
	Priority         string                       `json:"priority"`
	ParentTicketID   *uuid.UUID                   `json:"parentTicketId,omitempty"`
	AssigneeUserID   *uuid.UUID                   `json:"assigneeUserId,omitempty"`
	AssigneeName     *string                      `json:"assigneeName,omitempty"`
	LabelNames       []string                     `json:"labelNames"`
	DueAt            *time.Time                   `json:"dueAt,omitempty"`
	CycleAssignments []TicketCycleAssignmentInput `json:"cycleAssignments,omitempty"`
}

type UpdateTicketRequest struct {
	Title               *string
	Description         *string
	Type                *string
	Status              *string
	Priority            *string
	ParentTicketID      *uuid.UUID
	ParentSet           bool
	AssigneeUserID      *uuid.UUID
	AssigneeName        *string
	AssigneeSet         bool
	LabelNames          *[]string
	DueAt               *time.Time
	DueAtSet            bool
	CycleAssignments    []TicketCycleAssignmentInput
	CycleAssignmentsSet bool
}

type BulkUpdateTicketRequest struct {
	TicketIDs      []uuid.UUID
	Type           *string
	Status         *string
	Priority       *string
	ParentTicketID *uuid.UUID
	ParentSet      bool
	AssigneeUserID *uuid.UUID
	AssigneeName   *string
	AssigneeSet    bool
	LabelNames     *[]string
	DueAt          *time.Time
	DueAtSet       bool
}

type BulkUpdateTicketFailure struct {
	TicketID string `json:"ticketId"`
	Message  string `json:"message"`
}

type BulkUpdateTicketResponse struct {
	Updated []TicketSummary           `json:"updated"`
	Failed  []BulkUpdateTicketFailure `json:"failed"`
}

type CreateTicketCommentRequest struct {
	Body string `json:"body"`
}

type AttachTicketAttachmentRequest struct {
	AttachmentID string `json:"attachmentId"`
}

type ProjectRecord struct {
	ID          uuid.UUID
	PageID      int64
	SpaceID     uuid.UUID
	Key         string
	Title       string
	Description string
	DefaultView string
	CreatedBy   uuid.UUID
	UpdatedBy   *uuid.UUID
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ArchivedAt  *time.Time
}

type ProjectViewBreadcrumb struct {
	ID    int64   `json:"id"`
	Title string  `json:"title"`
	Href  *string `json:"href"`
}

type ProjectViewSpace struct {
	Name       string     `json:"name"`
	ArchivedAt *time.Time `json:"archivedAt"`
}

type ProjectViewCapabilities struct {
	CanEdit         bool `json:"canEdit"`
	CanDelete       bool `json:"canDelete"`
	CanCreateTicket bool `json:"canCreateTicket"`
}

type ProjectSummaryCounts struct {
	TicketCount int `json:"ticketCount"`
	OpenCount   int `json:"openCount"`
	DoneCount   int `json:"doneCount"`
}

type ProjectPageView struct {
	PageID       int64                      `json:"pageId"`
	SpaceID      uuid.UUID                  `json:"spaceId"`
	ProjectID    uuid.UUID                  `json:"projectId"`
	ProjectKey   string                     `json:"projectKey"`
	Title        string                     `json:"title"`
	Description  string                     `json:"description"`
	DefaultView  string                     `json:"defaultView"`
	Breadcrumbs  []ProjectViewBreadcrumb    `json:"breadcrumbs"`
	Space        ProjectViewSpace           `json:"space"`
	Capabilities ProjectViewCapabilities    `json:"capabilities"`
	Summary      ProjectSummaryCounts       `json:"summary"`
	CycleTracks  []ProjectCycleTrackSummary `json:"cycleTracks,omitempty"`
}

type TicketFilter struct {
	Search            string
	Status            string
	Type              string
	Sort              string
	Label             string
	Mine              bool
	LeafOnly          bool
	AssigneeUserID    *uuid.UUID
	ReporterUserID    *uuid.UUID
	ParentTicketID    *uuid.UUID
	RootTicketID      *uuid.UUID
	UpdatedAfter      *time.Time
	DueBefore         *time.Time
	CycleTrackFilters map[uuid.UUID]uuid.UUID
	UnplannedTrackIDs []uuid.UUID
	Unplanned         bool
}

type TicketSummary struct {
	ID               uuid.UUID               `json:"id"`
	ProjectID        uuid.UUID               `json:"projectId"`
	SequenceNo       int                     `json:"sequenceNo"`
	Identifier       string                  `json:"identifier"`
	Type             string                  `json:"type"`
	ParentTicketID   *uuid.UUID              `json:"parentTicketId,omitempty"`
	RootTicketID     *uuid.UUID              `json:"rootTicketId,omitempty"`
	Depth            int16                   `json:"depth"`
	Title            string                  `json:"title"`
	Description      string                  `json:"description"`
	Status           string                  `json:"status"`
	Priority         string                  `json:"priority"`
	AssigneeUserID   *uuid.UUID              `json:"assigneeUserId,omitempty"`
	AssigneeName     *string                 `json:"assigneeName,omitempty"`
	ReporterUserID   uuid.UUID               `json:"reporterUserId"`
	ReporterName     string                  `json:"reporterName"`
	LabelNames       []string                `json:"labelNames"`
	DueAt            *time.Time              `json:"dueAt,omitempty"`
	Rank             *string                 `json:"rank,omitempty"`
	CreatedAt        time.Time               `json:"createdAt"`
	UpdatedAt        time.Time               `json:"updatedAt"`
	ParentIdentifier *string                 `json:"parentIdentifier,omitempty"`
	ParentTitle      *string                 `json:"parentTitle,omitempty"`
	OwnerInitials    string                  `json:"ownerInitials"`
	Links            []TicketLink            `json:"links,omitempty"`
	Attachments      []TicketAttachment      `json:"attachments,omitempty"`
	Comments         []TicketComment         `json:"comments,omitempty"`
	Activity         []TicketActivity        `json:"activity,omitempty"`
	Children         []TicketSummary         `json:"children,omitempty"`
	CycleAssignments []TicketCycleAssignment `json:"cycleAssignments,omitempty"`
	ChildCount       int                     `json:"childCount"`
	OpenChildCount   int                     `json:"openChildCount"`
	DoneChildCount   int                     `json:"doneChildCount"`
}

type TicketListResponse struct {
	Tickets []TicketSummary `json:"tickets"`
	Total   int             `json:"total"`
}

type ProjectActivityListResponse struct {
	Activity []TicketActivity `json:"activity"`
	Total    int              `json:"total"`
	LatestAt *time.Time       `json:"latestAt,omitempty"`
}

type TicketLink struct {
	ID        uuid.UUID `json:"id"`
	TicketID  uuid.UUID `json:"ticketId"`
	URL       string    `json:"url"`
	Title     string    `json:"title"`
	Source    string    `json:"source"`
	CreatedAt time.Time `json:"createdAt"`
}

type TicketAttachment struct {
	AttachmentID string    `json:"attachmentId"`
	FileName     string    `json:"fileName"`
	FileSize     int64     `json:"fileSize"`
	MimeType     string    `json:"mimeType"`
	URL          string    `json:"url"`
	AttachedAt   time.Time `json:"attachedAt"`
}

type TicketComment struct {
	ID            uuid.UUID  `json:"id"`
	TicketID      uuid.UUID  `json:"ticketId"`
	Body          string     `json:"body"`
	CreatedBy     uuid.UUID  `json:"createdBy"`
	CreatedByName string     `json:"createdByName"`
	UpdatedBy     *uuid.UUID `json:"updatedBy,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type TicketActivity struct {
	ID           uuid.UUID `json:"id"`
	TicketID     uuid.UUID `json:"ticketId"`
	ProjectID    uuid.UUID `json:"projectId"`
	ActivityType string    `json:"activityType"`
	FieldName    *string   `json:"fieldName,omitempty"`
	OldValue     *string   `json:"oldValue,omitempty"`
	NewValue     *string   `json:"newValue,omitempty"`
	ActorID      uuid.UUID `json:"actorId"`
	ActorName    string    `json:"actorName"`
	CreatedAt    time.Time `json:"createdAt"`
}

type ProjectEvent struct {
	ID           uuid.UUID `json:"id"`
	TicketID     uuid.UUID `json:"ticketId"`
	ProjectID    uuid.UUID `json:"projectId"`
	EventType    string    `json:"eventType"`
	ActivityType string    `json:"activityType"`
	FieldName    *string   `json:"fieldName,omitempty"`
	OldValue     *string   `json:"oldValue,omitempty"`
	NewValue     *string   `json:"newValue,omitempty"`
	ActorID      uuid.UUID `json:"actorId"`
	ActorName    string    `json:"actorName"`
	OccurredAt   time.Time `json:"occurredAt"`
}

type ProjectEventListResponse struct {
	Events   []ProjectEvent `json:"events"`
	Total    int            `json:"total"`
	LatestAt *time.Time     `json:"latestAt,omitempty"`
}

type ProjectExportPayload struct {
	Project    ProjectPageView `json:"project"`
	Tickets    []TicketSummary `json:"tickets"`
	ExportedAt time.Time       `json:"exportedAt"`
}

type projectViewRow struct {
	ProjectID     uuid.UUID  `db:"id"`
	PageID        int64      `db:"page_id"`
	SpaceID       uuid.UUID  `db:"space_id"`
	ProjectKey    string     `db:"key"`
	Title         string     `db:"title"`
	Description   string     `db:"description"`
	DefaultView   string     `db:"default_view"`
	CreatedBy     uuid.UUID  `db:"created_by"`
	UpdatedBy     *uuid.UUID `db:"updated_by"`
	CreatedAt     time.Time  `db:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at"`
	ArchivedAt    *time.Time `db:"archived_at"`
	SpaceName     string     `db:"name"`
	SpaceArchived *time.Time `db:"space_archived_at"`
	TicketCount   int        `db:"ticket_count"`
	OpenCount     int        `db:"open_count"`
	DoneCount     int        `db:"done_count"`
}

type ticketInsertRow struct {
	ID             uuid.UUID  `db:"id"`
	ProjectID      uuid.UUID  `db:"project_id"`
	SequenceNo     int        `db:"sequence_no"`
	Identifier     string     `db:"identifier"`
	Type           string     `db:"type"`
	ParentTicketID *uuid.UUID `db:"parent_ticket_id"`
	RootTicketID   *uuid.UUID `db:"root_ticket_id"`
	Depth          int16      `db:"depth"`
	Title          string     `db:"title"`
	Description    string     `db:"description"`
	Status         string     `db:"status"`
	Priority       string     `db:"priority"`
	AssigneeUserID *uuid.UUID `db:"assignee_user_id"`
	AssigneeName   *string    `db:"assignee_name"`
	ReporterUserID uuid.UUID  `db:"reporter_user_id"`
	ReporterName   string     `db:"reporter_name"`
	LabelNames     []string   `db:"label_names"`
	DueAt          *time.Time `db:"due_at"`
	Rank           *string    `db:"rank"`
	CreatedAt      time.Time  `db:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at"`
}
