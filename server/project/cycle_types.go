package project

import (
	"time"

	"github.com/google/uuid"
)

const (
	CycleTrackKeySprint    = "sprint"
	CycleTrackKeyMilestone = "milestone"
	CycleTrackKeyQuarter   = "quarter"

	CycleTrackDisplayStyleRange  = "range"
	CycleTrackDisplayStyleMarker = "marker"
	CycleTrackDisplayStyleAuto   = "auto"

	CycleTrackActivationNone         = "none"
	CycleTrackActivationSingleActive = "single_active"
	CycleTrackActivationMultiActive  = "multi_active"

	CycleStatePlanned   = "planned"
	CycleStateActive    = "active"
	CycleStateCompleted = "completed"
	CycleStateCanceled  = "canceled"
)

type TicketCycleAssignmentInput struct {
	TrackID uuid.UUID `json:"trackId"`
	CycleID uuid.UUID `json:"cycleId"`
}

type ProjectCycleTrackRef struct {
	ID               uuid.UUID `json:"id"`
	Key              string    `json:"key"`
	Name             string    `json:"name"`
	Position         int       `json:"position"`
	DisplayStyle     string    `json:"displayStyle"`
	ActivationPolicy string    `json:"activationPolicy,omitempty"`
}

type ProjectCycleSummaryCounts struct {
	TicketCount int `json:"ticketCount"`
	OpenCount   int `json:"openCount"`
	DoneCount   int `json:"doneCount"`
}

type ProjectCycleSummary struct {
	ID          uuid.UUID                 `json:"id"`
	ProjectID   uuid.UUID                 `json:"projectId"`
	TrackID     uuid.UUID                 `json:"trackId"`
	Name        string                    `json:"name"`
	Goal        string                    `json:"goal"`
	Description string                    `json:"description"`
	State       string                    `json:"state"`
	StartsAt    *time.Time                `json:"startsAt,omitempty"`
	EndsAt      *time.Time                `json:"endsAt,omitempty"`
	Position    int                       `json:"position"`
	CompletedAt *time.Time                `json:"completedAt,omitempty"`
	Track       *ProjectCycleTrackRef     `json:"track,omitempty"`
	Summary     ProjectCycleSummaryCounts `json:"summary,omitempty"`
}

type ProjectCycleTrackSummary struct {
	ID                      uuid.UUID            `json:"id"`
	ProjectID               uuid.UUID            `json:"projectId"`
	Key                     string               `json:"key"`
	Name                    string               `json:"name"`
	Position                int                  `json:"position"`
	DisplayStyle            string               `json:"displayStyle"`
	ActivationPolicy        string               `json:"activationPolicy"`
	MaxAssignmentsPerTicket int16                `json:"maxAssignmentsPerTicket"`
	ColorToken              *string              `json:"colorToken,omitempty"`
	CurrentCycle            *ProjectCycleSummary `json:"currentCycle,omitempty"`
	UnplannedTicketCount    int                  `json:"unplannedTicketCount"`
}

type TicketCycleAssignment struct {
	Track ProjectCycleTrackRef `json:"track"`
	Cycle ProjectCycleSummary  `json:"cycle"`
}

type CycleTrackListResponse struct {
	Tracks []ProjectCycleTrackSummary `json:"tracks"`
}

type CycleListResponse struct {
	Cycles []ProjectCycleSummary `json:"cycles"`
}

type CycleFilter struct {
	TrackID       *uuid.UUID
	State         string
	IncludeCounts bool
}

type CreateCycleRequest struct {
	TrackID     uuid.UUID  `json:"trackId"`
	Name        string     `json:"name"`
	Goal        string     `json:"goal"`
	Description string     `json:"description"`
	State       string     `json:"state"`
	StartsAt    *time.Time `json:"startsAt,omitempty"`
	EndsAt      *time.Time `json:"endsAt,omitempty"`
}

type UpdateCycleRequest struct {
	Name        *string
	Goal        *string
	Description *string
	State       *string
	StartsAt    *time.Time
	StartsAtSet bool
	EndsAt      *time.Time
	EndsAtSet   bool
	Position    *int
}
