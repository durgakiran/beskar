package project

import (
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

var nonAlphaNumeric = regexp.MustCompile(`[^A-Za-z0-9]+`)
var urlMatcher = regexp.MustCompile(`https?://[^\s<>()]+`)

type ticketCycleAssignmentPayload struct {
	TrackID string `json:"trackId"`
	CycleID string `json:"cycleId"`
}

func validateCreateProjectPage(data []byte) (CreateProjectPageRequest, error) {
	var req CreateProjectPageRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return CreateProjectPageRequest{}, err
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	req.Key = strings.TrimSpace(req.Key)
	if req.Title == "" {
		return CreateProjectPageRequest{}, errors.New("invalid project: title is required")
	}
	return req, nil
}

func validateCreateTicket(data []byte) (CreateTicketRequest, error) {
	type createTicketPayload struct {
		Title            string                         `json:"title"`
		Description      string                         `json:"description"`
		Type             string                         `json:"type"`
		Status           string                         `json:"status"`
		Priority         string                         `json:"priority"`
		ParentTicketID   *string                        `json:"parentTicketId,omitempty"`
		AssigneeUserID   *string                        `json:"assigneeUserId,omitempty"`
		AssigneeName     *string                        `json:"assigneeName,omitempty"`
		LabelNames       []string                       `json:"labelNames"`
		DueAt            *string                        `json:"dueAt,omitempty"`
		CycleAssignments []ticketCycleAssignmentPayload `json:"cycleAssignments,omitempty"`
	}

	var payload createTicketPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return CreateTicketRequest{}, err
	}
	req := CreateTicketRequest{
		Title:       strings.TrimSpace(payload.Title),
		Description: strings.TrimSpace(payload.Description),
		Type:        normalizeTicketType(payload.Type),
		Status:      normalizeTicketStatus(payload.Status),
		Priority:    normalizeTicketPriority(payload.Priority),
		LabelNames:  normalizeLabels(payload.LabelNames),
	}
	if req.Title == "" {
		return CreateTicketRequest{}, errors.New("invalid ticket: title is required")
	}
	if payload.ParentTicketID != nil && strings.TrimSpace(*payload.ParentTicketID) != "" {
		parsedParentID, err := uuid.Parse(strings.TrimSpace(*payload.ParentTicketID))
		if err != nil {
			return CreateTicketRequest{}, errors.New("invalid ticket: parentTicketId must be a valid uuid")
		}
		req.ParentTicketID = &parsedParentID
	}
	if payload.AssigneeUserID != nil && strings.TrimSpace(*payload.AssigneeUserID) != "" {
		parsedAssigneeID, err := uuid.Parse(strings.TrimSpace(*payload.AssigneeUserID))
		if err != nil {
			return CreateTicketRequest{}, errors.New("invalid ticket: assigneeUserId must be a valid uuid")
		}
		req.AssigneeUserID = &parsedAssigneeID
		if payload.AssigneeName == nil || strings.TrimSpace(*payload.AssigneeName) == "" {
			return CreateTicketRequest{}, errors.New("invalid ticket: assigneeName is required when assigneeUserId is set")
		}
		assigneeName := strings.TrimSpace(*payload.AssigneeName)
		req.AssigneeName = &assigneeName
	}
	if payload.DueAt != nil && strings.TrimSpace(*payload.DueAt) != "" {
		dueAt, err := parseDueAtValue(strings.TrimSpace(*payload.DueAt))
		if err != nil {
			return CreateTicketRequest{}, errors.New("invalid ticket: dueAt must be an RFC3339 or YYYY-MM-DD date")
		}
		req.DueAt = &dueAt
	}
	cycleAssignments, err := parseTicketCycleAssignments(payload.CycleAssignments, "invalid ticket")
	if err != nil {
		return CreateTicketRequest{}, err
	}
	req.CycleAssignments = cycleAssignments
	if req.Type == "" {
		req.Type = TicketTypeTask
	}
	if req.Status == "" {
		req.Status = TicketStatusTodo
	}
	if req.Priority == "" {
		req.Priority = TicketPriorityMedium
	}
	return req, nil
}

func validateUpdateTicket(data []byte) (UpdateTicketRequest, error) {
	type updateTicketPayload struct {
		Title            *string                         `json:"title,omitempty"`
		Description      *string                         `json:"description,omitempty"`
		Type             *string                         `json:"type,omitempty"`
		Status           *string                         `json:"status,omitempty"`
		Priority         *string                         `json:"priority,omitempty"`
		ParentTicketID   *string                         `json:"parentTicketId,omitempty"`
		AssigneeUserID   *string                         `json:"assigneeUserId,omitempty"`
		AssigneeName     *string                         `json:"assigneeName,omitempty"`
		LabelNames       *[]string                       `json:"labelNames,omitempty"`
		DueAt            *string                         `json:"dueAt,omitempty"`
		CycleAssignments *[]ticketCycleAssignmentPayload `json:"cycleAssignments,omitempty"`
	}

	var payload updateTicketPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return UpdateTicketRequest{}, err
	}
	var req UpdateTicketRequest

	if payload.Title != nil {
		trimmed := strings.TrimSpace(*payload.Title)
		if trimmed == "" {
			return UpdateTicketRequest{}, errors.New("invalid ticket update: title is required")
		}
		req.Title = &trimmed
	}
	if payload.Description != nil {
		trimmed := strings.TrimSpace(*payload.Description)
		req.Description = &trimmed
	}
	if payload.Type != nil {
		normalized := normalizeTicketType(*payload.Type)
		if normalized == "" {
			return UpdateTicketRequest{}, errors.New("invalid ticket update: unsupported type")
		}
		req.Type = &normalized
	}
	if payload.Status != nil {
		normalized := normalizeTicketStatus(*payload.Status)
		if normalized == "" {
			return UpdateTicketRequest{}, errors.New("invalid ticket update: unsupported status")
		}
		req.Status = &normalized
	}
	if payload.Priority != nil {
		normalized := normalizeTicketPriority(*payload.Priority)
		if normalized == "" {
			return UpdateTicketRequest{}, errors.New("invalid ticket update: unsupported priority")
		}
		req.Priority = &normalized
	}
	if payload.ParentTicketID != nil {
		req.ParentSet = true
		trimmed := strings.TrimSpace(*payload.ParentTicketID)
		if trimmed != "" {
			parsedParentID, err := uuid.Parse(trimmed)
			if err != nil {
				return UpdateTicketRequest{}, errors.New("invalid ticket update: parentTicketId must be a valid uuid")
			}
			req.ParentTicketID = &parsedParentID
		}
	}
	if payload.AssigneeUserID != nil {
		req.AssigneeSet = true
		trimmed := strings.TrimSpace(*payload.AssigneeUserID)
		if trimmed != "" {
			parsedAssigneeID, err := uuid.Parse(trimmed)
			if err != nil {
				return UpdateTicketRequest{}, errors.New("invalid ticket update: assigneeUserId must be a valid uuid")
			}
			req.AssigneeUserID = &parsedAssigneeID
			if payload.AssigneeName == nil || strings.TrimSpace(*payload.AssigneeName) == "" {
				return UpdateTicketRequest{}, errors.New("invalid ticket update: assigneeName is required when assigneeUserId is set")
			}
			assigneeName := strings.TrimSpace(*payload.AssigneeName)
			req.AssigneeName = &assigneeName
		}
	}
	if payload.LabelNames != nil {
		normalized := normalizeLabels(*payload.LabelNames)
		req.LabelNames = &normalized
	}
	if payload.DueAt != nil {
		req.DueAtSet = true
		trimmed := strings.TrimSpace(*payload.DueAt)
		if trimmed != "" {
			dueAt, err := parseDueAtValue(trimmed)
			if err != nil {
				return UpdateTicketRequest{}, errors.New("invalid ticket update: dueAt must be an RFC3339 or YYYY-MM-DD date")
			}
			req.DueAt = &dueAt
		}
	}
	if payload.CycleAssignments != nil {
		cycleAssignments, err := parseTicketCycleAssignments(*payload.CycleAssignments, "invalid ticket update")
		if err != nil {
			return UpdateTicketRequest{}, err
		}
		req.CycleAssignments = cycleAssignments
		req.CycleAssignmentsSet = true
	}

	if req.Title == nil && req.Description == nil && req.Type == nil && req.Status == nil && req.Priority == nil && !req.ParentSet && !req.AssigneeSet && req.LabelNames == nil && !req.DueAtSet && !req.CycleAssignmentsSet {
		return UpdateTicketRequest{}, errors.New("invalid ticket update: at least one editable field is required")
	}
	return req, nil
}

func validateBulkUpdateTicket(data []byte) (BulkUpdateTicketRequest, error) {
	type bulkUpdateTicketPayload struct {
		TicketIDs      []string  `json:"ticketIds"`
		Type           *string   `json:"type,omitempty"`
		Status         *string   `json:"status,omitempty"`
		Priority       *string   `json:"priority,omitempty"`
		ParentTicketID *string   `json:"parentTicketId,omitempty"`
		AssigneeUserID *string   `json:"assigneeUserId,omitempty"`
		AssigneeName   *string   `json:"assigneeName,omitempty"`
		LabelNames     *[]string `json:"labelNames,omitempty"`
		DueAt          *string   `json:"dueAt,omitempty"`
	}

	var payload bulkUpdateTicketPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return BulkUpdateTicketRequest{}, err
	}

	req := BulkUpdateTicketRequest{
		TicketIDs: make([]uuid.UUID, 0, len(payload.TicketIDs)),
	}
	for _, raw := range payload.TicketIDs {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		id, err := uuid.Parse(trimmed)
		if err != nil {
			return BulkUpdateTicketRequest{}, errors.New("invalid ticket bulk update: ticketIds must contain valid uuids")
		}
		req.TicketIDs = append(req.TicketIDs, id)
	}
	if len(req.TicketIDs) == 0 {
		return BulkUpdateTicketRequest{}, errors.New("invalid ticket bulk update: ticketIds is required")
	}

	if payload.Type != nil {
		normalized := normalizeTicketType(*payload.Type)
		if normalized == "" {
			return BulkUpdateTicketRequest{}, errors.New("invalid ticket bulk update: unsupported type")
		}
		req.Type = &normalized
	}
	if payload.Status != nil {
		normalized := normalizeTicketStatus(*payload.Status)
		if normalized == "" {
			return BulkUpdateTicketRequest{}, errors.New("invalid ticket bulk update: unsupported status")
		}
		req.Status = &normalized
	}
	if payload.Priority != nil {
		normalized := normalizeTicketPriority(*payload.Priority)
		if normalized == "" {
			return BulkUpdateTicketRequest{}, errors.New("invalid ticket bulk update: unsupported priority")
		}
		req.Priority = &normalized
	}
	if payload.ParentTicketID != nil {
		req.ParentSet = true
		trimmed := strings.TrimSpace(*payload.ParentTicketID)
		if trimmed != "" {
			parentID, err := uuid.Parse(trimmed)
			if err != nil {
				return BulkUpdateTicketRequest{}, errors.New("invalid ticket bulk update: parentTicketId must be a valid uuid")
			}
			req.ParentTicketID = &parentID
		}
	}
	if payload.AssigneeUserID != nil {
		req.AssigneeSet = true
		trimmed := strings.TrimSpace(*payload.AssigneeUserID)
		if trimmed != "" {
			assigneeID, err := uuid.Parse(trimmed)
			if err != nil {
				return BulkUpdateTicketRequest{}, errors.New("invalid ticket bulk update: assigneeUserId must be a valid uuid")
			}
			req.AssigneeUserID = &assigneeID
			if payload.AssigneeName == nil || strings.TrimSpace(*payload.AssigneeName) == "" {
				return BulkUpdateTicketRequest{}, errors.New("invalid ticket bulk update: assigneeName is required when assigneeUserId is set")
			}
			assigneeName := strings.TrimSpace(*payload.AssigneeName)
			req.AssigneeName = &assigneeName
		}
	}
	if payload.LabelNames != nil {
		normalized := normalizeLabels(*payload.LabelNames)
		req.LabelNames = &normalized
	}
	if payload.DueAt != nil {
		req.DueAtSet = true
		trimmed := strings.TrimSpace(*payload.DueAt)
		if trimmed != "" {
			dueAt, err := parseDueAtValue(trimmed)
			if err != nil {
				return BulkUpdateTicketRequest{}, errors.New("invalid ticket bulk update: dueAt must be an RFC3339 or YYYY-MM-DD date")
			}
			req.DueAt = &dueAt
		}
	}

	if req.Type == nil && req.Status == nil && req.Priority == nil && !req.ParentSet && !req.AssigneeSet && req.LabelNames == nil && !req.DueAtSet {
		return BulkUpdateTicketRequest{}, errors.New("invalid ticket bulk update: at least one editable field is required")
	}
	return req, nil
}

func validateCreateTicketComment(data []byte) (CreateTicketCommentRequest, error) {
	var req CreateTicketCommentRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return CreateTicketCommentRequest{}, err
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		return CreateTicketCommentRequest{}, errors.New("invalid comment: body is required")
	}
	return req, nil
}

func validateAttachTicketAttachment(data []byte) (AttachTicketAttachmentRequest, error) {
	var req AttachTicketAttachmentRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return AttachTicketAttachmentRequest{}, err
	}
	req.AttachmentID = strings.TrimSpace(req.AttachmentID)
	if req.AttachmentID == "" {
		return AttachTicketAttachmentRequest{}, errors.New("invalid attachment: attachmentId is required")
	}
	return req, nil
}

func normalizeProjectParentID(parentID int64) int64 {
	if parentID <= 0 {
		return -1
	}
	return parentID
}

func normalizeTicketType(ticketType string) string {
	switch strings.TrimSpace(strings.ToLower(ticketType)) {
	case TicketTypeEpic, TicketTypeStory, TicketTypeTask, TicketTypeSubtask, TicketTypeBug:
		return strings.TrimSpace(strings.ToLower(ticketType))
	default:
		return ""
	}
}

func normalizeTicketStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case TicketStatusBacklog, TicketStatusTodo, TicketStatusInProgress, TicketStatusInReview, TicketStatusDone, TicketStatusCanceled:
		return strings.TrimSpace(strings.ToLower(status))
	default:
		return ""
	}
}

func normalizeTicketPriority(priority string) string {
	switch strings.TrimSpace(strings.ToLower(priority)) {
	case TicketPriorityNone, TicketPriorityLow, TicketPriorityMedium, TicketPriorityHigh, TicketPriorityUrgent:
		return strings.TrimSpace(strings.ToLower(priority))
	default:
		return ""
	}
}

func normalizeTicketSort(sort string) string {
	switch strings.TrimSpace(strings.ToLower(sort)) {
	case "", "rank_asc":
		return "rank_asc"
	case "updated_desc", "created_desc", "due_asc", "priority_desc":
		return strings.TrimSpace(strings.ToLower(sort))
	default:
		return ""
	}
}

func normalizeLabels(labels []string) []string {
	if len(labels) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(labels))
	output := make([]string, 0, len(labels))
	for _, label := range labels {
		trimmed := strings.TrimSpace(label)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		output = append(output, trimmed)
	}
	return output
}

func deriveProjectKey(title string) string {
	parts := strings.Fields(strings.TrimSpace(title))
	if len(parts) >= 2 {
		var initials strings.Builder
		for _, part := range parts {
			cleaned := nonAlphaNumeric.ReplaceAllString(part, "")
			if cleaned == "" {
				continue
			}
			initials.WriteString(strings.ToUpper(cleaned[:1]))
			if initials.Len() >= 4 {
				break
			}
		}
		if initials.Len() >= 2 {
			return initials.String()
		}
	}

	cleaned := strings.ToUpper(nonAlphaNumeric.ReplaceAllString(title, ""))
	if cleaned == "" {
		return "PRJ"
	}
	if len(cleaned) > 6 {
		return cleaned[:6]
	}
	if len(cleaned) < 3 {
		return cleaned + strings.Repeat("X", 3-len(cleaned))
	}
	return cleaned
}

func normalizeRequestedProjectKey(key string, title string) string {
	candidate := strings.ToUpper(nonAlphaNumeric.ReplaceAllString(strings.TrimSpace(key), ""))
	if candidate == "" {
		candidate = deriveProjectKey(title)
	}
	if len(candidate) < 2 {
		return deriveProjectKey(title)
	}
	if len(candidate) > 12 {
		return candidate[:12]
	}
	return candidate
}

func initialsForName(name string) string {
	parts := strings.Fields(strings.TrimSpace(name))
	if len(parts) == 0 {
		return "NA"
	}
	if len(parts) == 1 {
		value := strings.ToUpper(nonAlphaNumeric.ReplaceAllString(parts[0], ""))
		if len(value) >= 2 {
			return value[:2]
		}
		if len(value) == 1 {
			return value + "A"
		}
		return "NA"
	}
	first := nonAlphaNumeric.ReplaceAllString(parts[0], "")
	last := nonAlphaNumeric.ReplaceAllString(parts[len(parts)-1], "")
	if first == "" || last == "" {
		return "NA"
	}
	return strings.ToUpper(first[:1] + last[:1])
}

func validateHierarchyForCreate(ticketType string, parentType *string) error {
	switch ticketType {
	case TicketTypeEpic:
		if parentType != nil {
			return errors.New("epics cannot have a parent ticket in v1")
		}
	case TicketTypeStory, TicketTypeTask, TicketTypeBug:
		if parentType == nil {
			return nil
		}
		if *parentType != TicketTypeEpic {
			return errors.New("stories, tasks, and bugs can only be parented under epics in v1")
		}
	case TicketTypeSubtask:
		if parentType == nil {
			return errors.New("subtasks must have a parent ticket")
		}
		switch *parentType {
		case TicketTypeStory, TicketTypeTask, TicketTypeBug:
			return nil
		default:
			return errors.New("subtasks can only be parented under stories, tasks, or bugs")
		}
	default:
		return errors.New("invalid ticket type")
	}
	return nil
}

func parseDueAtValue(value string) (time.Time, error) {
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed.UTC(), nil
	}

	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return time.Time{}, err
	}
	return time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, time.UTC), nil
}

func extractDescriptionLinks(description string) []string {
	matches := urlMatcher.FindAllString(description, -1)
	if len(matches) == 0 {
		return []string{}
	}

	seen := make(map[string]struct{}, len(matches))
	links := make([]string, 0, len(matches))
	for _, raw := range matches {
		candidate := strings.TrimRight(strings.TrimSpace(raw), ".,;:!?)")
		parsed, err := url.Parse(candidate)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			continue
		}
		normalized := parsed.String()
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		links = append(links, normalized)
	}
	return links
}

func uuidPtr(value uuid.UUID) *uuid.UUID {
	return &value
}
