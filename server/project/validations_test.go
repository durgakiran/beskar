package project

import (
	"strings"
	"testing"
	"time"
)

func TestValidateCreateProjectPageRequiresTitle(t *testing.T) {
	_, err := validateCreateProjectPage([]byte(`{"title":"   "}`))
	if err == nil {
		t.Fatal("expected missing title validation error")
	}
}

func TestValidateCreateTicketNormalizesAndDefaults(t *testing.T) {
	req, err := validateCreateTicket([]byte(`{
		"title":"  Ship ticket list  ",
		"description":"  compact table view  ",
		"type":" TASK ",
		"status":" IN_PROGRESS ",
		"priority":" HIGH ",
		"assigneeUserId":"7f3a2ab8-c78d-4678-a92f-ef8f25bb48bf",
		"assigneeName":"  Asha Patel  ",
		"dueAt":"2026-05-30",
		"labelNames":[" ux ","backend","ux","","backend"]
	}`))
	if err != nil {
		t.Fatalf("expected request to validate: %v", err)
	}
	if req.Title != "Ship ticket list" {
		t.Fatalf("unexpected normalized title %q", req.Title)
	}
	if req.Description != "compact table view" {
		t.Fatalf("unexpected normalized description %q", req.Description)
	}
	if req.Type != TicketTypeTask {
		t.Fatalf("expected type %q, got %q", TicketTypeTask, req.Type)
	}
	if req.Status != TicketStatusInProgress {
		t.Fatalf("expected status %q, got %q", TicketStatusInProgress, req.Status)
	}
	if req.Priority != TicketPriorityHigh {
		t.Fatalf("expected priority %q, got %q", TicketPriorityHigh, req.Priority)
	}
	if req.AssigneeUserID == nil || req.AssigneeUserID.String() != "7f3a2ab8-c78d-4678-a92f-ef8f25bb48bf" {
		t.Fatalf("unexpected assignee user id %#v", req.AssigneeUserID)
	}
	if req.AssigneeName == nil || *req.AssigneeName != "Asha Patel" {
		t.Fatalf("unexpected assignee name %#v", req.AssigneeName)
	}
	if req.DueAt == nil || req.DueAt.Format("2006-01-02") != "2026-05-30" {
		t.Fatalf("unexpected due date %#v", req.DueAt)
	}
	if len(req.LabelNames) != 2 || req.LabelNames[0] != "ux" || req.LabelNames[1] != "backend" {
		t.Fatalf("unexpected labels %#v", req.LabelNames)
	}
}

func TestValidateCreateTicketAppliesDefaults(t *testing.T) {
	req, err := validateCreateTicket([]byte(`{"title":"Create baseline project"}`))
	if err != nil {
		t.Fatalf("expected request to validate: %v", err)
	}
	if req.Type != TicketTypeTask {
		t.Fatalf("expected default type %q, got %q", TicketTypeTask, req.Type)
	}
	if req.Status != TicketStatusTodo {
		t.Fatalf("expected default status %q, got %q", TicketStatusTodo, req.Status)
	}
	if req.Priority != TicketPriorityMedium {
		t.Fatalf("expected default priority %q, got %q", TicketPriorityMedium, req.Priority)
	}
}

func TestValidateUpdateTicketNormalizesEditableFields(t *testing.T) {
	req, err := validateUpdateTicket([]byte(`{
		"title":"  Ship board view  ",
		"description":"  Use status columns  ",
		"type":" STORY ",
		"status":" IN_REVIEW ",
		"priority":" HIGH ",
		"parentTicketId":"7f3a2ab8-c78d-4678-a92f-ef8f25bb48be",
		"assigneeUserId":"7f3a2ab8-c78d-4678-a92f-ef8f25bb48bf",
		"assigneeName":"  Asha Patel  ",
		"dueAt":"2026-06-01T10:30:00Z",
		"labelNames":[" ui ","board","","ui"]
	}`))
	if err != nil {
		t.Fatalf("expected update request to validate: %v", err)
	}
	if req.Title == nil || *req.Title != "Ship board view" {
		t.Fatalf("unexpected title %#v", req.Title)
	}
	if req.Description == nil || *req.Description != "Use status columns" {
		t.Fatalf("unexpected description %#v", req.Description)
	}
	if req.Type == nil || *req.Type != TicketTypeStory {
		t.Fatalf("unexpected type %#v", req.Type)
	}
	if req.Status == nil || *req.Status != TicketStatusInReview {
		t.Fatalf("unexpected status %#v", req.Status)
	}
	if req.Priority == nil || *req.Priority != TicketPriorityHigh {
		t.Fatalf("unexpected priority %#v", req.Priority)
	}
	if !req.ParentSet || req.ParentTicketID == nil || req.ParentTicketID.String() != "7f3a2ab8-c78d-4678-a92f-ef8f25bb48be" {
		t.Fatalf("unexpected parent update %#v", req.ParentTicketID)
	}
	if !req.AssigneeSet || req.AssigneeUserID == nil || req.AssigneeUserID.String() != "7f3a2ab8-c78d-4678-a92f-ef8f25bb48bf" {
		t.Fatalf("unexpected assignee update %#v", req.AssigneeUserID)
	}
	if req.AssigneeName == nil || *req.AssigneeName != "Asha Patel" {
		t.Fatalf("unexpected assignee name %#v", req.AssigneeName)
	}
	if !req.DueAtSet || req.DueAt == nil || !req.DueAt.Equal(time.Date(2026, 6, 1, 10, 30, 0, 0, time.UTC)) {
		t.Fatalf("unexpected due date %#v", req.DueAt)
	}
	if req.LabelNames == nil || len(*req.LabelNames) != 2 || (*req.LabelNames)[0] != "ui" || (*req.LabelNames)[1] != "board" {
		t.Fatalf("unexpected labels %#v", req.LabelNames)
	}
}

func TestValidateBulkUpdateTicketNormalizesEditableFields(t *testing.T) {
	req, err := validateBulkUpdateTicket([]byte(`{
		"ticketIds":["7f3a2ab8-c78d-4678-a92f-ef8f25bb48bf","7f3a2ab8-c78d-4678-a92f-ef8f25bb48be"],
		"status":" DONE ",
		"priority":" HIGH ",
		"assigneeUserId":"7f3a2ab8-c78d-4678-a92f-ef8f25bb48bd",
		"assigneeName":"  Mina Shah  ",
		"dueAt":"2026-06-04",
		"labelNames":[" launch ","qa","launch"]
	}`))
	if err != nil {
		t.Fatalf("expected bulk update request to validate: %v", err)
	}
	if len(req.TicketIDs) != 2 {
		t.Fatalf("unexpected ticket ids %#v", req.TicketIDs)
	}
	if req.Status == nil || *req.Status != TicketStatusDone {
		t.Fatalf("unexpected status %#v", req.Status)
	}
	if req.Priority == nil || *req.Priority != TicketPriorityHigh {
		t.Fatalf("unexpected priority %#v", req.Priority)
	}
	if !req.AssigneeSet || req.AssigneeUserID == nil || req.AssigneeUserID.String() != "7f3a2ab8-c78d-4678-a92f-ef8f25bb48bd" {
		t.Fatalf("unexpected assignee %#v", req.AssigneeUserID)
	}
	if req.AssigneeName == nil || *req.AssigneeName != "Mina Shah" {
		t.Fatalf("unexpected assignee name %#v", req.AssigneeName)
	}
	if !req.DueAtSet || req.DueAt == nil || req.DueAt.Format("2006-01-02") != "2026-06-04" {
		t.Fatalf("unexpected due date %#v", req.DueAt)
	}
	if req.LabelNames == nil || len(*req.LabelNames) != 2 || (*req.LabelNames)[0] != "launch" || (*req.LabelNames)[1] != "qa" {
		t.Fatalf("unexpected labels %#v", req.LabelNames)
	}
}

func TestValidateUpdateTicketAllowsClearingAssigneeAndDueDate(t *testing.T) {
	req, err := validateUpdateTicket([]byte(`{
		"assigneeUserId":"",
		"dueAt":""
	}`))
	if err != nil {
		t.Fatalf("expected update request to validate: %v", err)
	}
	if !req.AssigneeSet || req.AssigneeUserID != nil || req.AssigneeName != nil {
		t.Fatalf("unexpected assignee clear payload %#v %#v", req.AssigneeUserID, req.AssigneeName)
	}
	if !req.DueAtSet || req.DueAt != nil {
		t.Fatalf("unexpected due date clear payload %#v", req.DueAt)
	}
}

func TestValidateUpdateTicketRequiresEditableField(t *testing.T) {
	_, err := validateUpdateTicket([]byte(`{}`))
	if err == nil {
		t.Fatal("expected missing editable fields validation error")
	}
}

func TestValidateCreateTicketComment(t *testing.T) {
	req, err := validateCreateTicketComment([]byte(`{"body":"  Need approval from QA.  "}`))
	if err != nil {
		t.Fatalf("expected comment request to validate: %v", err)
	}
	if req.Body != "Need approval from QA." {
		t.Fatalf("unexpected normalized comment body %q", req.Body)
	}
}

func TestValidateAttachTicketAttachment(t *testing.T) {
	req, err := validateAttachTicketAttachment([]byte(`{"attachmentId":"  7f3a2ab8-c78d-4678-a92f-ef8f25bb48bf "}`))
	if err != nil {
		t.Fatalf("expected attachment request to validate: %v", err)
	}
	if req.AttachmentID != "7f3a2ab8-c78d-4678-a92f-ef8f25bb48bf" {
		t.Fatalf("unexpected attachment id %q", req.AttachmentID)
	}
}

func TestDeriveProjectKey(t *testing.T) {
	testCases := []struct {
		title string
		want  string
	}{
		{title: "Product Launch", want: "PL"},
		{title: "Design system overhaul", want: "DSO"},
		{title: "a", want: "AXX"},
		{title: "core-platform-roadmap", want: "COREPL"},
		{title: "   ", want: "PRJ"},
	}

	for _, tc := range testCases {
		t.Run(strings.ReplaceAll(tc.title, " ", "_"), func(t *testing.T) {
			if got := deriveProjectKey(tc.title); got != tc.want {
				t.Fatalf("deriveProjectKey(%q) = %q, want %q", tc.title, got, tc.want)
			}
		})
	}
}

func TestNormalizeRequestedProjectKey(t *testing.T) {
	got := normalizeRequestedProjectKey("  qa! board 2026 ", "Ignored Title")
	if got != "QABOARD2026" {
		t.Fatalf("unexpected normalized key %q", got)
	}

	fallback := normalizeRequestedProjectKey("x", "Support Inbox")
	if fallback != "SI" {
		t.Fatalf("expected title-derived key, got %q", fallback)
	}
}

func TestInitialsForName(t *testing.T) {
	testCases := []struct {
		name string
		want string
	}{
		{name: "Asha Patel", want: "AP"},
		{name: "kevin", want: "KE"},
		{name: "!", want: "NA"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if got := initialsForName(tc.name); got != tc.want {
				t.Fatalf("initialsForName(%q) = %q, want %q", tc.name, got, tc.want)
			}
		})
	}
}

func TestValidateHierarchyForCreate(t *testing.T) {
	testCases := []struct {
		name       string
		ticketType string
		parentType *string
		wantErr    bool
	}{
		{name: "epic root", ticketType: TicketTypeEpic, parentType: nil, wantErr: false},
		{name: "epic with parent", ticketType: TicketTypeEpic, parentType: stringPtr(TicketTypeStory), wantErr: true},
		{name: "story under epic", ticketType: TicketTypeStory, parentType: stringPtr(TicketTypeEpic), wantErr: false},
		{name: "task under story rejected", ticketType: TicketTypeTask, parentType: stringPtr(TicketTypeStory), wantErr: true},
		{name: "subtask under task", ticketType: TicketTypeSubtask, parentType: stringPtr(TicketTypeTask), wantErr: false},
		{name: "subtask without parent", ticketType: TicketTypeSubtask, parentType: nil, wantErr: true},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateHierarchyForCreate(tc.ticketType, tc.parentType)
			if tc.wantErr && err == nil {
				t.Fatal("expected hierarchy validation error")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected hierarchy validation to pass: %v", err)
			}
		})
	}
}

func TestExtractDescriptionLinks(t *testing.T) {
	links := extractDescriptionLinks("Review https://example.com/spec and https://example.com/spec, then open https://app.durgakiran.com/tasks/42.")
	if len(links) != 2 {
		t.Fatalf("expected 2 unique links, got %#v", links)
	}
	if links[0] != "https://example.com/spec" {
		t.Fatalf("unexpected first link %q", links[0])
	}
	if links[1] != "https://app.durgakiran.com/tasks/42" {
		t.Fatalf("unexpected second link %q", links[1])
	}
}

func TestNormalizeTicketSort(t *testing.T) {
	testCases := []struct {
		input string
		want  string
	}{
		{input: "", want: "rank_asc"},
		{input: " updated_desc ", want: "updated_desc"},
		{input: "priority_desc", want: "priority_desc"},
		{input: "unknown", want: ""},
	}

	for _, tc := range testCases {
		t.Run(tc.input, func(t *testing.T) {
			if got := normalizeTicketSort(tc.input); got != tc.want {
				t.Fatalf("normalizeTicketSort(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}
