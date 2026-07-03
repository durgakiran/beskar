package project

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/google/uuid"
)

func normalizeCycleState(state string) string {
	switch strings.TrimSpace(strings.ToLower(state)) {
	case "":
		return ""
	case CycleStatePlanned, CycleStateActive, CycleStateCompleted, CycleStateCanceled:
		return strings.TrimSpace(strings.ToLower(state))
	default:
		return ""
	}
}

func normalizeCycleTrackDisplayStyle(style string) string {
	switch strings.TrimSpace(strings.ToLower(style)) {
	case CycleTrackDisplayStyleRange, CycleTrackDisplayStyleMarker, CycleTrackDisplayStyleAuto:
		return strings.TrimSpace(strings.ToLower(style))
	default:
		return ""
	}
}

func normalizeCycleTrackActivationPolicy(policy string) string {
	switch strings.TrimSpace(strings.ToLower(policy)) {
	case CycleTrackActivationNone, CycleTrackActivationSingleActive, CycleTrackActivationMultiActive:
		return strings.TrimSpace(strings.ToLower(policy))
	default:
		return ""
	}
}

func parseTicketCycleAssignments(payloads []ticketCycleAssignmentPayload, prefix string) ([]TicketCycleAssignmentInput, error) {
	if len(payloads) == 0 {
		return []TicketCycleAssignmentInput{}, nil
	}

	assignments := make([]TicketCycleAssignmentInput, 0, len(payloads))
	seenTracks := make(map[uuid.UUID]struct{}, len(payloads))
	for _, payload := range payloads {
		trackID, err := uuid.Parse(strings.TrimSpace(payload.TrackID))
		if err != nil {
			return nil, errors.New(prefix + ": cycleAssignments.trackId must be a valid uuid")
		}
		cycleID, err := uuid.Parse(strings.TrimSpace(payload.CycleID))
		if err != nil {
			return nil, errors.New(prefix + ": cycleAssignments.cycleId must be a valid uuid")
		}
		if _, exists := seenTracks[trackID]; exists {
			return nil, errors.New(prefix + ": only one cycle assignment per track is allowed")
		}
		seenTracks[trackID] = struct{}{}
		assignments = append(assignments, TicketCycleAssignmentInput{
			TrackID: trackID,
			CycleID: cycleID,
		})
	}
	return assignments, nil
}

func validateCreateCycle(data []byte) (CreateCycleRequest, error) {
	type createCyclePayload struct {
		TrackID     string  `json:"trackId"`
		Name        string  `json:"name"`
		Goal        string  `json:"goal"`
		Description string  `json:"description"`
		State       string  `json:"state"`
		StartsAt    *string `json:"startsAt,omitempty"`
		EndsAt      *string `json:"endsAt,omitempty"`
	}

	var payload createCyclePayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return CreateCycleRequest{}, err
	}

	trackID, err := uuid.Parse(strings.TrimSpace(payload.TrackID))
	if err != nil {
		return CreateCycleRequest{}, errors.New("invalid cycle: trackId must be a valid uuid")
	}

	req := CreateCycleRequest{
		TrackID:     trackID,
		Name:        strings.TrimSpace(payload.Name),
		Goal:        strings.TrimSpace(payload.Goal),
		Description: strings.TrimSpace(payload.Description),
		State:       normalizeCycleState(payload.State),
	}
	if req.Name == "" {
		return CreateCycleRequest{}, errors.New("invalid cycle: name is required")
	}
	if req.State == "" {
		req.State = CycleStatePlanned
	}
	if payload.StartsAt != nil && strings.TrimSpace(*payload.StartsAt) != "" {
		value, err := parseDueAtValue(strings.TrimSpace(*payload.StartsAt))
		if err != nil {
			return CreateCycleRequest{}, errors.New("invalid cycle: startsAt must be an RFC3339 or YYYY-MM-DD date")
		}
		req.StartsAt = &value
	}
	if payload.EndsAt != nil && strings.TrimSpace(*payload.EndsAt) != "" {
		value, err := parseDueAtValue(strings.TrimSpace(*payload.EndsAt))
		if err != nil {
			return CreateCycleRequest{}, errors.New("invalid cycle: endsAt must be an RFC3339 or YYYY-MM-DD date")
		}
		req.EndsAt = &value
	}
	if req.EndsAt == nil {
		return CreateCycleRequest{}, errors.New("invalid cycle: endsAt is required")
	}
	if req.StartsAt != nil && req.StartsAt.After(*req.EndsAt) {
		return CreateCycleRequest{}, errors.New("invalid cycle: startsAt must be before or equal to endsAt")
	}

	return req, nil
}

func validateUpdateCycle(data []byte) (UpdateCycleRequest, error) {
	type updateCyclePayload struct {
		Name        *string `json:"name,omitempty"`
		Goal        *string `json:"goal,omitempty"`
		Description *string `json:"description,omitempty"`
		State       *string `json:"state,omitempty"`
		StartsAt    *string `json:"startsAt,omitempty"`
		EndsAt      *string `json:"endsAt,omitempty"`
		Position    *int    `json:"position,omitempty"`
	}

	var payload updateCyclePayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return UpdateCycleRequest{}, err
	}

	var req UpdateCycleRequest
	if payload.Name != nil {
		trimmed := strings.TrimSpace(*payload.Name)
		if trimmed == "" {
			return UpdateCycleRequest{}, errors.New("invalid cycle update: name is required")
		}
		req.Name = &trimmed
	}
	if payload.Goal != nil {
		trimmed := strings.TrimSpace(*payload.Goal)
		req.Goal = &trimmed
	}
	if payload.Description != nil {
		trimmed := strings.TrimSpace(*payload.Description)
		req.Description = &trimmed
	}
	if payload.State != nil {
		normalized := normalizeCycleState(*payload.State)
		if normalized == "" {
			return UpdateCycleRequest{}, errors.New("invalid cycle update: unsupported state")
		}
		req.State = &normalized
	}
	if payload.StartsAt != nil {
		req.StartsAtSet = true
		trimmed := strings.TrimSpace(*payload.StartsAt)
		if trimmed != "" {
			value, err := parseDueAtValue(trimmed)
			if err != nil {
				return UpdateCycleRequest{}, errors.New("invalid cycle update: startsAt must be an RFC3339 or YYYY-MM-DD date")
			}
			req.StartsAt = &value
		}
	}
	if payload.EndsAt != nil {
		req.EndsAtSet = true
		trimmed := strings.TrimSpace(*payload.EndsAt)
		if trimmed != "" {
			value, err := parseDueAtValue(trimmed)
			if err != nil {
				return UpdateCycleRequest{}, errors.New("invalid cycle update: endsAt must be an RFC3339 or YYYY-MM-DD date")
			}
			req.EndsAt = &value
		}
	}
	if payload.Position != nil {
		req.Position = payload.Position
	}

	if req.Name == nil && req.Goal == nil && req.Description == nil && req.State == nil && !req.StartsAtSet && !req.EndsAtSet && req.Position == nil {
		return UpdateCycleRequest{}, errors.New("invalid cycle update: at least one editable field is required")
	}
	if req.StartsAt != nil && req.EndsAt != nil && req.StartsAt.After(*req.EndsAt) {
		return UpdateCycleRequest{}, errors.New("invalid cycle update: startsAt must be before or equal to endsAt")
	}
	return req, nil
}
