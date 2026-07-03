package project

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const projectManagementIntegrationEnv = "PROJECT_MANAGEMENT_INTEGRATION_TESTS"

type projectFixture struct {
	AccountID  uuid.UUID
	UserID     uuid.UUID
	OwnerID    uuid.UUID
	SpaceID    uuid.UUID
	PageID     int64
	ProjectID  uuid.UUID
	ProjectKey string
}

func TestIntegrationCreateAndListProjectTickets(t *testing.T) {
	pool := projectIntegrationPool(t)
	ctx := context.Background()
	assertProjectSchemaReady(t, ctx, pool)
	fixture := createProjectFixture(t, ctx, pool)

	reporterID := uuid.New()
	reporterName := "Asha Patel"

	epic, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:    "Launch roadmap",
		Type:     TicketTypeEpic,
		Status:   TicketStatusBacklog,
		Priority: TicketPriorityHigh,
	})
	if err != nil {
		t.Fatalf("create epic: %v", err)
	}
	if epic.Identifier != fixture.ProjectKey+"-1" {
		t.Fatalf("expected epic identifier %s-1, got %s", fixture.ProjectKey, epic.Identifier)
	}
	if epic.Depth != 0 {
		t.Fatalf("expected epic depth 0, got %d", epic.Depth)
	}
	if epic.OwnerInitials != "AP" {
		t.Fatalf("expected owner initials AP, got %q", epic.OwnerInitials)
	}

	story, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:          "QA review flow",
		Type:           TicketTypeStory,
		Status:         TicketStatusInReview,
		Priority:       TicketPriorityMedium,
		ParentTicketID: &epic.ID,
	})
	if err != nil {
		t.Fatalf("create story: %v", err)
	}
	if story.Identifier != fixture.ProjectKey+"-2" {
		t.Fatalf("expected story identifier %s-2, got %s", fixture.ProjectKey, story.Identifier)
	}
	if story.Depth != 1 {
		t.Fatalf("expected story depth 1, got %d", story.Depth)
	}
	if story.ParentTicketID == nil || *story.ParentTicketID != epic.ID {
		t.Fatalf("expected story parent %s, got %#v", epic.ID, story.ParentTicketID)
	}
	if story.RootTicketID == nil || *story.RootTicketID != epic.ID {
		t.Fatalf("expected story root %s, got %#v", epic.ID, story.RootTicketID)
	}

	doneBug, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:    "Resolve release blocker",
		Type:     TicketTypeBug,
		Status:   TicketStatusDone,
		Priority: TicketPriorityUrgent,
	})
	if err != nil {
		t.Fatalf("create done bug: %v", err)
	}
	if doneBug.Identifier != fixture.ProjectKey+"-3" {
		t.Fatalf("expected bug identifier %s-3, got %s", fixture.ProjectKey, doneBug.Identifier)
	}

	allTickets, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{})
	if err != nil {
		t.Fatalf("list tickets: %v", err)
	}
	if allTickets.Total != 3 {
		t.Fatalf("expected 3 tickets, got %d", allTickets.Total)
	}
	if len(allTickets.Tickets) != 3 {
		t.Fatalf("expected 3 ticket rows, got %d", len(allTickets.Tickets))
	}

	foundParentContext := false
	foundEpicRollup := false
	for _, ticket := range allTickets.Tickets {
		if ticket.ID == story.ID {
			if ticket.ParentIdentifier == nil || *ticket.ParentIdentifier != epic.Identifier {
				t.Fatalf("expected story parent identifier %s, got %#v", epic.Identifier, ticket.ParentIdentifier)
			}
			if ticket.ParentTitle == nil || *ticket.ParentTitle != epic.Title {
				t.Fatalf("expected story parent title %q, got %#v", epic.Title, ticket.ParentTitle)
			}
			foundParentContext = true
		}
		if ticket.ID == epic.ID {
			if ticket.ChildCount != 1 || ticket.OpenChildCount != 1 || ticket.DoneChildCount != 0 {
				t.Fatalf("expected epic rollup 1/1/0, got child=%d open=%d done=%d", ticket.ChildCount, ticket.OpenChildCount, ticket.DoneChildCount)
			}
			foundEpicRollup = true
		}
	}
	if !foundParentContext {
		t.Fatal("expected story row with parent context")
	}
	if !foundEpicRollup {
		t.Fatal("expected epic row with child rollup")
	}

	doneOnly, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{Status: TicketStatusDone})
	if err != nil {
		t.Fatalf("list done tickets: %v", err)
	}
	if doneOnly.Total != 1 || doneOnly.Tickets[0].ID != doneBug.ID {
		t.Fatalf("expected only the done bug in filtered view, got %#v", doneOnly.Tickets)
	}

	searchResults, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{Search: "QA"})
	if err != nil {
		t.Fatalf("search tickets: %v", err)
	}
	if searchResults.Total != 1 || searchResults.Tickets[0].ID != story.ID {
		t.Fatalf("expected QA search to match story, got %#v", searchResults.Tickets)
	}

	mine, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{Mine: true})
	if err != nil {
		t.Fatalf("list my work tickets: %v", err)
	}
	if mine.Total != 3 {
		t.Fatalf("expected my work filter to keep all three tickets, got %d", mine.Total)
	}
}

func TestIntegrationGetProjectPageView(t *testing.T) {
	pool := projectIntegrationPool(t)
	ctx := context.Background()
	assertProjectSchemaReady(t, ctx, pool)
	fixture := createProjectFixture(t, ctx, pool)

	reporterID := uuid.New()
	reporterName := "Priya Menon"

	if _, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:    "Prepare release epic",
		Type:     TicketTypeEpic,
		Status:   TicketStatusBacklog,
		Priority: TicketPriorityHigh,
	}); err != nil {
		t.Fatalf("create open ticket: %v", err)
	}
	if _, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:    "Close remaining blocker",
		Type:     TicketTypeBug,
		Status:   TicketStatusDone,
		Priority: TicketPriorityUrgent,
	}); err != nil {
		t.Fatalf("create done ticket: %v", err)
	}

	view, err := GetProjectPageView(ctx, fixture.PageID, fixture.SpaceID, reporterID)
	if err != nil {
		t.Fatalf("get project page view: %v", err)
	}
	if view.ProjectID != fixture.ProjectID {
		t.Fatalf("expected project id %s, got %s", fixture.ProjectID, view.ProjectID)
	}
	if view.ProjectKey != fixture.ProjectKey {
		t.Fatalf("expected project key %q, got %q", fixture.ProjectKey, view.ProjectKey)
	}
	if view.Title != "Website Launch" {
		t.Fatalf("unexpected project title %q", view.Title)
	}
	if view.Summary.TicketCount != 2 {
		t.Fatalf("expected 2 total tickets, got %d", view.Summary.TicketCount)
	}
	if view.Summary.OpenCount != 1 {
		t.Fatalf("expected 1 open ticket, got %d", view.Summary.OpenCount)
	}
	if view.Summary.DoneCount != 1 {
		t.Fatalf("expected 1 done ticket, got %d", view.Summary.DoneCount)
	}
	if len(view.Breadcrumbs) == 0 {
		t.Fatal("expected at least one breadcrumb")
	}
}

func TestIntegrationGetAndUpdateProjectTicket(t *testing.T) {
	pool := projectIntegrationPool(t)
	ctx := context.Background()
	assertProjectSchemaReady(t, ctx, pool)
	fixture := createProjectFixture(t, ctx, pool)

	reporterID := uuid.New()
	reporterName := "Nina Jacobs"
	initialAssigneeID := uuid.New()
	initialAssigneeName := "Asha Patel"
	initialDueAt := time.Date(2026, 6, 2, 0, 0, 0, 0, time.UTC)
	created, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:          "Draft launch checklist",
		Description:    "Collect the final release criteria",
		Type:           TicketTypeTask,
		Status:         TicketStatusTodo,
		Priority:       TicketPriorityMedium,
		AssigneeUserID: &initialAssigneeID,
		AssigneeName:   stringPtr(initialAssigneeName),
		LabelNames:     []string{"launch"},
		DueAt:          &initialDueAt,
	})
	if err != nil {
		t.Fatalf("create ticket: %v", err)
	}

	detail, err := GetProjectTicket(ctx, fixture.PageID, fixture.SpaceID, created.ID)
	if err != nil {
		t.Fatalf("get ticket detail: %v", err)
	}
	if detail.ID != created.ID {
		t.Fatalf("expected detail id %s, got %s", created.ID, detail.ID)
	}
	if detail.Description != "Collect the final release criteria" {
		t.Fatalf("unexpected description %q", detail.Description)
	}
	if detail.AssigneeUserID == nil || *detail.AssigneeUserID != initialAssigneeID {
		t.Fatalf("expected detail assignee %s, got %#v", initialAssigneeID, detail.AssigneeUserID)
	}
	if detail.AssigneeName == nil || *detail.AssigneeName != initialAssigneeName {
		t.Fatalf("expected detail assignee name %q, got %#v", initialAssigneeName, detail.AssigneeName)
	}
	if detail.DueAt == nil || !detail.DueAt.Equal(initialDueAt) {
		t.Fatalf("expected detail due date %s, got %#v", initialDueAt, detail.DueAt)
	}

	title := "Finalize launch checklist"
	description := "Collect the final release criteria and signoff owners"
	status := TicketStatusDone
	priority := TicketPriorityUrgent
	updatedAssigneeID := uuid.New()
	updatedAssigneeName := "Mina Shah"
	labels := []string{"launch", "signoff"}
	updatedDueAt := time.Date(2026, 6, 4, 12, 30, 0, 0, time.UTC)
	updated, err := UpdateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, created.ID, reporterID, reporterName, UpdateTicketRequest{
		Title:          &title,
		Description:    &description,
		Status:         &status,
		Priority:       &priority,
		AssigneeUserID: &updatedAssigneeID,
		AssigneeName:   stringPtr(updatedAssigneeName),
		AssigneeSet:    true,
		LabelNames:     &labels,
		DueAt:          &updatedDueAt,
		DueAtSet:       true,
	})
	if err != nil {
		t.Fatalf("update ticket: %v", err)
	}
	if updated.Title != title {
		t.Fatalf("expected updated title %q, got %q", title, updated.Title)
	}
	if updated.Description != description {
		t.Fatalf("expected updated description %q, got %q", description, updated.Description)
	}
	if updated.Status != status {
		t.Fatalf("expected updated status %q, got %q", status, updated.Status)
	}
	if updated.Priority != priority {
		t.Fatalf("expected updated priority %q, got %q", priority, updated.Priority)
	}
	if updated.AssigneeUserID == nil || *updated.AssigneeUserID != updatedAssigneeID {
		t.Fatalf("expected updated assignee %s, got %#v", updatedAssigneeID, updated.AssigneeUserID)
	}
	if updated.AssigneeName == nil || *updated.AssigneeName != updatedAssigneeName {
		t.Fatalf("expected updated assignee name %q, got %#v", updatedAssigneeName, updated.AssigneeName)
	}
	if updated.DueAt == nil || !updated.DueAt.Equal(updatedDueAt) {
		t.Fatalf("expected updated due date %s, got %#v", updatedDueAt, updated.DueAt)
	}
	if len(updated.LabelNames) != 2 || updated.LabelNames[0] != "launch" || updated.LabelNames[1] != "signoff" {
		t.Fatalf("unexpected updated labels %#v", updated.LabelNames)
	}
	if len(updated.Activity) < 2 {
		t.Fatalf("expected create and update activity, got %#v", updated.Activity)
	}

	doneOnly, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{Status: TicketStatusDone})
	if err != nil {
		t.Fatalf("list done tickets after update: %v", err)
	}
	if doneOnly.Total != 1 || doneOnly.Tickets[0].ID != created.ID {
		t.Fatalf("expected updated ticket in done filter, got %#v", doneOnly.Tickets)
	}
}

func TestIntegrationTicketDetailIncludesCommentsAttachmentsLinksAndChildren(t *testing.T) {
	pool := projectIntegrationPool(t)
	ctx := context.Background()
	assertProjectSchemaReady(t, ctx, pool)
	fixture := createProjectFixture(t, ctx, pool)

	reporterID := uuid.New()
	reporterName := "Leah Wong"

	parent, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:    "Launch epic",
		Type:     TicketTypeEpic,
		Status:   TicketStatusBacklog,
		Priority: TicketPriorityHigh,
	})
	if err != nil {
		t.Fatalf("create parent ticket: %v", err)
	}

	child, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:          "Verify launch checklist",
		Description:    "Track progress at https://example.com/checklist and update https://app.durgakiran.com/tasks/launch.",
		Type:           TicketTypeStory,
		Status:         TicketStatusInReview,
		Priority:       TicketPriorityMedium,
		ParentTicketID: &parent.ID,
	})
	if err != nil {
		t.Fatalf("create child ticket: %v", err)
	}

	comment, err := CreateProjectTicketComment(ctx, fixture.PageID, fixture.SpaceID, child.ID, reporterID, reporterName, "Waiting on product approval")
	if err != nil {
		t.Fatalf("create comment: %v", err)
	}
	if comment.Body != "Waiting on product approval" {
		t.Fatalf("unexpected comment body %q", comment.Body)
	}

	var attachmentID string
	if err := pool.QueryRow(ctx, `
INSERT INTO core.attachment (page_id, storage_path, file_name, file_size, mime_type, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id::text`,
		fixture.PageID,
		"attachments/launch-plan.pdf",
		"launch-plan.pdf",
		int64(4096),
		"application/pdf",
		reporterID.String(),
	).Scan(&attachmentID); err != nil {
		t.Fatalf("insert attachment: %v", err)
	}

	attachments, err := AttachProjectTicketAttachment(ctx, fixture.PageID, fixture.SpaceID, child.ID, attachmentID, reporterID, reporterName)
	if err != nil {
		t.Fatalf("attach ticket attachment: %v", err)
	}
	if len(attachments) != 1 || attachments[0].AttachmentID != attachmentID {
		t.Fatalf("unexpected attachments %#v", attachments)
	}

	parentDetail, err := GetProjectTicket(ctx, fixture.PageID, fixture.SpaceID, parent.ID)
	if err != nil {
		t.Fatalf("get parent detail: %v", err)
	}
	if len(parentDetail.Children) != 1 || parentDetail.Children[0].ID != child.ID {
		t.Fatalf("expected parent to include child context, got %#v", parentDetail.Children)
	}

	detail, err := GetProjectTicket(ctx, fixture.PageID, fixture.SpaceID, child.ID)
	if err != nil {
		t.Fatalf("get child detail: %v", err)
	}
	if len(detail.Links) != 2 {
		t.Fatalf("expected 2 extracted links, got %#v", detail.Links)
	}
	if len(detail.Comments) != 1 || detail.Comments[0].Body != "Waiting on product approval" {
		t.Fatalf("unexpected comments %#v", detail.Comments)
	}
	if len(detail.Attachments) != 1 || detail.Attachments[0].FileName != "launch-plan.pdf" {
		t.Fatalf("unexpected attachments %#v", detail.Attachments)
	}
	if len(detail.Activity) < 3 {
		t.Fatalf("expected activity entries for create, comment, and attachment, got %#v", detail.Activity)
	}
	activityTypes := make(map[string]bool, len(detail.Activity))
	for _, entry := range detail.Activity {
		activityTypes[entry.ActivityType] = true
	}
	if !activityTypes["ticket_created"] || !activityTypes["comment_added"] || !activityTypes["attachment_added"] {
		t.Fatalf("unexpected activity feed %#v", detail.Activity)
	}
}

func TestIntegrationProjectTicketExports(t *testing.T) {
	pool := projectIntegrationPool(t)
	ctx := context.Background()
	assertProjectSchemaReady(t, ctx, pool)
	fixture := createProjectFixture(t, ctx, pool)

	reporterID := uuid.New()
	reporterName := "Mina Shah"

	_, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:       "Prepare stakeholder review",
		Description: "Summarize launch blockers",
		Type:        TicketTypeTask,
		Status:      TicketStatusTodo,
		Priority:    TicketPriorityHigh,
		LabelNames:  []string{"stakeholder", "launch"},
	})
	if err != nil {
		t.Fatalf("create ticket: %v", err)
	}

	csvBytes, err := ExportProjectTicketsCSV(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{})
	if err != nil {
		t.Fatalf("export csv: %v", err)
	}
	csvText := string(csvBytes)
	if !strings.Contains(csvText, "identifier,title,type,status,priority") {
		t.Fatalf("expected csv header, got %q", csvText)
	}
	if !strings.Contains(csvText, "Prepare stakeholder review") {
		t.Fatalf("expected ticket title in csv, got %q", csvText)
	}

	jsonBytes, err := ExportProjectTicketsJSON(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{})
	if err != nil {
		t.Fatalf("export json: %v", err)
	}
	var payload ProjectExportPayload
	if err := json.Unmarshal(jsonBytes, &payload); err != nil {
		t.Fatalf("unmarshal json export: %v", err)
	}
	if payload.Project.ProjectKey != fixture.ProjectKey {
		t.Fatalf("expected project key %q, got %q", fixture.ProjectKey, payload.Project.ProjectKey)
	}
	if len(payload.Tickets) != 1 || payload.Tickets[0].Title != "Prepare stakeholder review" {
		t.Fatalf("unexpected exported tickets %#v", payload.Tickets)
	}
}

func TestIntegrationBulkUpdateFiltersAndLeafReparent(t *testing.T) {
	pool := projectIntegrationPool(t)
	ctx := context.Background()
	assertProjectSchemaReady(t, ctx, pool)
	fixture := createProjectFixture(t, ctx, pool)

	reporterID := uuid.New()
	reporterName := "Mina Shah"
	epicA, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:    "Website launch",
		Type:     TicketTypeEpic,
		Status:   TicketStatusBacklog,
		Priority: TicketPriorityHigh,
	})
	if err != nil {
		t.Fatalf("create epic A: %v", err)
	}
	epicB, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:    "Post-launch follow-up",
		Type:     TicketTypeEpic,
		Status:   TicketStatusBacklog,
		Priority: TicketPriorityMedium,
	})
	if err != nil {
		t.Fatalf("create epic B: %v", err)
	}
	story, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:          "QA review flow",
		Type:           TicketTypeStory,
		Status:         TicketStatusTodo,
		Priority:       TicketPriorityMedium,
		ParentTicketID: &epicA.ID,
	})
	if err != nil {
		t.Fatalf("create story: %v", err)
	}
	task, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:    "Draft launch note",
		Type:     TicketTypeTask,
		Status:   TicketStatusTodo,
		Priority: TicketPriorityLow,
	})
	if err != nil {
		t.Fatalf("create task: %v", err)
	}

	done := TicketStatusDone
	urgent := TicketPriorityUrgent
	bulkDueAt := time.Date(2026, 6, 7, 0, 0, 0, 0, time.UTC)
	labels := []string{"launch", "qa"}
	bulkResult, err := BulkUpdateProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, BulkUpdateTicketRequest{
		TicketIDs:  []uuid.UUID{story.ID, task.ID},
		Status:     &done,
		Priority:   &urgent,
		LabelNames: &labels,
		DueAt:      &bulkDueAt,
		DueAtSet:   true,
	})
	if err != nil {
		t.Fatalf("bulk update tickets: %v", err)
	}
	if len(bulkResult.Updated) != 2 || len(bulkResult.Failed) != 0 {
		t.Fatalf("unexpected bulk update result %#v", bulkResult)
	}

	reparented, err := UpdateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, task.ID, reporterID, reporterName, UpdateTicketRequest{
		Type:           stringPtr(TicketTypeStory),
		ParentTicketID: &epicB.ID,
		ParentSet:      true,
	})
	if err != nil {
		t.Fatalf("reparent leaf ticket: %v", err)
	}
	if reparented.Type != TicketTypeStory {
		t.Fatalf("expected reparented type %q, got %q", TicketTypeStory, reparented.Type)
	}
	if reparented.ParentTicketID == nil || *reparented.ParentTicketID != epicB.ID {
		t.Fatalf("expected reparented parent %s, got %#v", epicB.ID, reparented.ParentTicketID)
	}
	if reparented.RootTicketID == nil || *reparented.RootTicketID != epicB.ID {
		t.Fatalf("expected reparented root %s, got %#v", epicB.ID, reparented.RootTicketID)
	}
	if reparented.Depth != 1 {
		t.Fatalf("expected reparented depth 1, got %d", reparented.Depth)
	}

	leafOnly, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{LeafOnly: true, Sort: "rank_asc"})
	if err != nil {
		t.Fatalf("list leaf tickets: %v", err)
	}
	if leafOnly.Total != 2 {
		t.Fatalf("expected 2 leaf tickets, got %#v", leafOnly.Tickets)
	}

	labelFiltered, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{Label: "launch", Sort: "due_asc"})
	if err != nil {
		t.Fatalf("list label-filtered tickets: %v", err)
	}
	if labelFiltered.Total != 2 {
		t.Fatalf("expected 2 launch-labeled tickets, got %#v", labelFiltered.Tickets)
	}
	if labelFiltered.Tickets[0].ID != story.ID && labelFiltered.Tickets[0].ID != task.ID {
		t.Fatalf("unexpected label-filtered tickets %#v", labelFiltered.Tickets)
	}

	rootFiltered, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{RootTicketID: &epicB.ID})
	if err != nil {
		t.Fatalf("list root-filtered tickets: %v", err)
	}
	if rootFiltered.Total != 1 || rootFiltered.Tickets[0].ID != task.ID {
		t.Fatalf("expected only reparented task under epic B, got %#v", rootFiltered.Tickets)
	}

	reporterFiltered, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{ReporterUserID: &reporterID})
	if err != nil {
		t.Fatalf("list reporter-filtered tickets: %v", err)
	}
	if reporterFiltered.Total != 4 {
		t.Fatalf("expected 4 reporter-filtered tickets, got %#v", reporterFiltered.Tickets)
	}

	updatedSince := time.Now().Add(-1 * time.Hour)
	updatedFiltered, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{UpdatedAfter: &updatedSince})
	if err != nil {
		t.Fatalf("list updated-after tickets: %v", err)
	}
	if updatedFiltered.Total != 4 {
		t.Fatalf("expected 4 updated-after tickets, got %#v", updatedFiltered.Tickets)
	}

	dueBefore := time.Date(2026, 6, 8, 0, 0, 0, 0, time.UTC)
	dueFiltered, err := ListProjectTickets(ctx, fixture.PageID, fixture.SpaceID, reporterID, TicketFilter{DueBefore: &dueBefore, Sort: "due_asc"})
	if err != nil {
		t.Fatalf("list due-before tickets: %v", err)
	}
	if dueFiltered.Total != 2 {
		t.Fatalf("expected 2 due-filtered tickets, got %#v", dueFiltered.Tickets)
	}

	rejectParentType, err := UpdateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, epicA.ID, reporterID, reporterName, UpdateTicketRequest{
		Type: stringPtr(TicketTypeTask),
	})
	if err == nil || !strings.Contains(err.Error(), "leaf tickets") {
		t.Fatalf("expected parent ticket type change to be rejected, got ticket=%#v err=%v", rejectParentType, err)
	}
}

func TestIntegrationProjectActivityAndEvents(t *testing.T) {
	pool := projectIntegrationPool(t)
	ctx := context.Background()
	assertProjectSchemaReady(t, ctx, pool)
	fixture := createProjectFixture(t, ctx, pool)

	reporterID := uuid.New()
	reporterName := "Devika Rao"
	created, err := CreateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, reporterID, reporterName, CreateTicketRequest{
		Title:    "Instrument launch metrics",
		Type:     TicketTypeTask,
		Status:   TicketStatusTodo,
		Priority: TicketPriorityMedium,
	})
	if err != nil {
		t.Fatalf("create ticket: %v", err)
	}

	time.Sleep(10 * time.Millisecond)
	updatedStatus := TicketStatusInProgress
	updatedPriority := TicketPriorityHigh
	if _, err := UpdateProjectTicket(ctx, fixture.PageID, fixture.SpaceID, created.ID, reporterID, reporterName, UpdateTicketRequest{
		Status:   &updatedStatus,
		Priority: &updatedPriority,
	}); err != nil {
		t.Fatalf("update ticket: %v", err)
	}

	activity, err := ListProjectActivity(ctx, fixture.PageID, fixture.SpaceID, nil, 20)
	if err != nil {
		t.Fatalf("list project activity: %v", err)
	}
	if activity.Total < 3 {
		t.Fatalf("expected at least 3 activity rows, got %#v", activity.Activity)
	}
	if activity.LatestAt == nil {
		t.Fatal("expected activity latestAt")
	}

	after := activity.Activity[1].CreatedAt
	incremental, err := ListProjectActivity(ctx, fixture.PageID, fixture.SpaceID, &after, 20)
	if err != nil {
		t.Fatalf("list incremental activity: %v", err)
	}
	if incremental.Total < 1 {
		t.Fatalf("expected incremental activity rows, got %#v", incremental.Activity)
	}

	events, err := ListProjectEvents(ctx, fixture.PageID, fixture.SpaceID, nil, 20)
	if err != nil {
		t.Fatalf("list project events: %v", err)
	}
	if events.Total != activity.Total {
		t.Fatalf("expected events to mirror activity count, got activity=%d events=%d", activity.Total, events.Total)
	}
	foundUpdateEvent := false
	for _, event := range events.Events {
		if event.EventType == "ticket.updated" && event.ActivityType == "ticket_field_updated" {
			foundUpdateEvent = true
			break
		}
	}
	if !foundUpdateEvent {
		t.Fatalf("expected ticket.updated event, got %#v", events.Events)
	}
}

func projectIntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if strings.ToLower(strings.TrimSpace(os.Getenv(projectManagementIntegrationEnv))) != "true" {
		t.Skipf("set %s=true to run project-management DB integration tests", projectManagementIntegrationEnv)
	}
	return core.GetPool()
}

func assertProjectSchemaReady(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()

	var projectsTable *string
	var ticketsTable *string
	var ticketCommentsTable *string
	var ticketLinksTable *string
	var ticketAttachmentsTable *string
	var ticketActivityTable *string
	var cycleTracksTable *string
	var cyclesTable *string
	var ticketCycleAssignmentsTable *string
	if err := pool.QueryRow(ctx, `
SELECT
	to_regclass('project.projects')::text,
	to_regclass('project.tickets')::text,
	to_regclass('project.ticket_comments')::text,
	to_regclass('project.ticket_links')::text,
	to_regclass('project.ticket_attachments')::text,
	to_regclass('project.ticket_activity')::text,
	to_regclass('project.cycle_tracks')::text,
	to_regclass('project.cycles')::text,
	to_regclass('project.ticket_cycle_assignments')::text`).Scan(
		&projectsTable,
		&ticketsTable,
		&ticketCommentsTable,
		&ticketLinksTable,
		&ticketAttachmentsTable,
		&ticketActivityTable,
		&cycleTracksTable,
		&cyclesTable,
		&ticketCycleAssignmentsTable,
	); err != nil {
		t.Fatalf("check project schema: %v", err)
	}
	if projectsTable == nil || ticketsTable == nil || ticketCommentsTable == nil || ticketLinksTable == nil || ticketAttachmentsTable == nil || ticketActivityTable == nil || cycleTracksTable == nil || cyclesTable == nil || ticketCycleAssignmentsTable == nil {
		t.Fatal("project-management tables are missing; apply the project-management migration before running integration tests")
	}

	var constraintDef string
	if err := pool.QueryRow(ctx, `
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'core.page'::regclass
  AND contype = 'c'
  AND conname = 'chk_page_type'`).Scan(&constraintDef); err != nil {
		t.Fatalf("load page type constraint: %v", err)
	}
	if !strings.Contains(constraintDef, "project") {
		t.Fatalf("core.page type constraint is not migrated for project pages: %s", constraintDef)
	}
}

func createProjectFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) projectFixture {
	t.Helper()

	fixture := projectFixture{
		AccountID:  uuid.New(),
		UserID:     uuid.New(),
		OwnerID:    uuid.New(),
		ProjectKey: "WEB",
	}

	_, err := pool.Exec(ctx, `INSERT INTO billing.account (id, user_id, status) VALUES ($1, $2, 'active')`, fixture.AccountID, fixture.UserID)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}

	err = pool.QueryRow(ctx, `
INSERT INTO core.space (name, user_id, account_id)
VALUES ($1, $2, $3)
RETURNING id`,
		"Website Launch",
		fixture.UserID,
		fixture.AccountID,
	).Scan(&fixture.SpaceID)
	if err != nil {
		t.Fatalf("insert space: %v", err)
	}

	err = pool.QueryRow(ctx, `
INSERT INTO core.page (draft, space_id, owner_id, status, type, date_created)
VALUES (0, $1, $2, 0, 'project', now())
RETURNING id`,
		fixture.SpaceID,
		fixture.OwnerID,
	).Scan(&fixture.PageID)
	if err != nil {
		t.Fatalf("insert project page: %v", err)
	}

	err = pool.QueryRow(ctx, `
INSERT INTO project.projects (page_id, space_id, key, title, description, default_view, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, 'list', $6, $6)
RETURNING id`,
		fixture.PageID,
		fixture.SpaceID,
		fixture.ProjectKey,
		"Website Launch",
		"Track launch readiness work",
		fixture.OwnerID,
	).Scan(&fixture.ProjectID)
	if err != nil {
		t.Fatalf("insert project record: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM core.space WHERE id = $1`, fixture.SpaceID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM billing.account WHERE id = $1`, fixture.AccountID)
	})

	return fixture
}
