package project

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type execer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func syncDescriptionLinksTx(ctx context.Context, tx execer, ticketID uuid.UUID, description string, actorID uuid.UUID) error {
	if _, err := tx.Exec(ctx, deleteDescriptionTicketLinks, ticketID); err != nil {
		return err
	}

	for _, link := range extractDescriptionLinks(description) {
		if _, err := tx.Exec(ctx, insertDescriptionTicketLink, ticketID, link, link, actorID); err != nil {
			return err
		}
	}
	return nil
}

func loadTicketLinks(ctx context.Context, q queryer, ticketID uuid.UUID) ([]TicketLink, error) {
	rows, err := q.Query(ctx, listTicketLinks, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	links := make([]TicketLink, 0)
	for rows.Next() {
		var link TicketLink
		if err := rows.Scan(&link.ID, &link.TicketID, &link.URL, &link.Title, &link.Source, &link.CreatedAt); err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	return links, rows.Err()
}

func loadTicketAttachments(ctx context.Context, q queryer, ticketID uuid.UUID) ([]TicketAttachment, error) {
	rows, err := q.Query(ctx, listTicketAttachments, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	attachments := make([]TicketAttachment, 0)
	for rows.Next() {
		var attachment TicketAttachment
		if err := rows.Scan(
			&attachment.AttachmentID,
			&attachment.FileName,
			&attachment.FileSize,
			&attachment.MimeType,
			&attachment.URL,
			&attachment.AttachedAt,
		); err != nil {
			return nil, err
		}
		attachments = append(attachments, attachment)
	}
	return attachments, rows.Err()
}

func loadTicketComments(ctx context.Context, q queryer, ticketID uuid.UUID) ([]TicketComment, error) {
	rows, err := q.Query(ctx, listTicketComments, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	comments := make([]TicketComment, 0)
	for rows.Next() {
		var comment TicketComment
		if err := rows.Scan(
			&comment.ID,
			&comment.TicketID,
			&comment.Body,
			&comment.CreatedBy,
			&comment.CreatedByName,
			&comment.UpdatedBy,
			&comment.CreatedAt,
			&comment.UpdatedAt,
		); err != nil {
			return nil, err
		}
		comments = append(comments, comment)
	}
	return comments, rows.Err()
}

func loadTicketActivity(ctx context.Context, q queryer, ticketID uuid.UUID) ([]TicketActivity, error) {
	rows, err := q.Query(ctx, listTicketActivity, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	activity := make([]TicketActivity, 0)
	for rows.Next() {
		var entry TicketActivity
		if err := rows.Scan(
			&entry.ID,
			&entry.TicketID,
			&entry.ProjectID,
			&entry.ActivityType,
			&entry.FieldName,
			&entry.OldValue,
			&entry.NewValue,
			&entry.ActorID,
			&entry.ActorName,
			&entry.CreatedAt,
		); err != nil {
			return nil, err
		}
		activity = append(activity, entry)
	}
	return activity, rows.Err()
}

func loadProjectActivity(ctx context.Context, q queryer, projectID uuid.UUID, after *time.Time, limit int) ([]TicketActivity, error) {
	rows, err := q.Query(ctx, listProjectActivity, projectID, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	activity := make([]TicketActivity, 0)
	for rows.Next() {
		var entry TicketActivity
		if err := rows.Scan(
			&entry.ID,
			&entry.TicketID,
			&entry.ProjectID,
			&entry.ActivityType,
			&entry.FieldName,
			&entry.OldValue,
			&entry.NewValue,
			&entry.ActorID,
			&entry.ActorName,
			&entry.CreatedAt,
		); err != nil {
			return nil, err
		}
		activity = append(activity, entry)
	}
	return activity, rows.Err()
}

func projectEventTypeForActivity(activityType string) string {
	switch activityType {
	case "ticket_created":
		return "ticket.created"
	case "ticket_field_updated":
		return "ticket.updated"
	case "comment_added":
		return "ticket.comment_added"
	case "attachment_added":
		return "ticket.attachment_added"
	case "attachment_removed":
		return "ticket.attachment_removed"
	default:
		return "ticket.activity"
	}
}

func recordTicketActivityTx(
	ctx context.Context,
	tx queryRower,
	ticketID uuid.UUID,
	projectID uuid.UUID,
	activityType string,
	fieldName *string,
	oldValue *string,
	newValue *string,
	actorID uuid.UUID,
	actorName string,
) (TicketActivity, error) {
	var entry TicketActivity
	err := tx.QueryRow(
		ctx,
		insertTicketActivity,
		ticketID,
		projectID,
		activityType,
		fieldName,
		oldValue,
		newValue,
		actorID,
		actorName,
	).Scan(
		&entry.ID,
		&entry.TicketID,
		&entry.ProjectID,
		&entry.ActivityType,
		&entry.FieldName,
		&entry.OldValue,
		&entry.NewValue,
		&entry.ActorID,
		&entry.ActorName,
		&entry.CreatedAt,
	)
	return entry, err
}

func loadChildTickets(ctx context.Context, q queryer, ticketID uuid.UUID) ([]TicketSummary, error) {
	rows, err := q.Query(ctx, listChildTickets, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	children := make([]TicketSummary, 0)
	for rows.Next() {
		ticket, err := scanTicketSummary(rows.Scan)
		if err != nil {
			return nil, err
		}
		children = append(children, ticket)
	}
	return children, rows.Err()
}

func hydrateTicketDetail(ctx context.Context, q queryer, ticket TicketSummary) (TicketSummary, error) {
	links, err := loadTicketLinks(ctx, q, ticket.ID)
	if err != nil {
		return TicketSummary{}, err
	}
	attachments, err := loadTicketAttachments(ctx, q, ticket.ID)
	if err != nil {
		return TicketSummary{}, err
	}
	comments, err := loadTicketComments(ctx, q, ticket.ID)
	if err != nil {
		return TicketSummary{}, err
	}
	activity, err := loadTicketActivity(ctx, q, ticket.ID)
	if err != nil {
		return TicketSummary{}, err
	}
	children, err := loadChildTickets(ctx, q, ticket.ID)
	if err != nil {
		return TicketSummary{}, err
	}
	assignmentTicketIDs := make([]uuid.UUID, 0, 1+len(children))
	assignmentTicketIDs = append(assignmentTicketIDs, ticket.ID)
	for _, child := range children {
		assignmentTicketIDs = append(assignmentTicketIDs, child.ID)
	}
	assignments, err := loadTicketCycleAssignmentsByTicket(ctx, q, ticket.ProjectID, assignmentTicketIDs)
	if err != nil {
		return TicketSummary{}, err
	}

	ticket.Links = links
	ticket.Attachments = attachments
	ticket.Comments = comments
	ticket.Activity = activity
	ticket.CycleAssignments = assignments[ticket.ID]
	ticket.Children = applyTicketCycleAssignments(children, assignments)
	return ticket, nil
}

func CreateProjectTicketComment(ctx context.Context, pageID int64, spaceID uuid.UUID, ticketID uuid.UUID, currentUserID uuid.UUID, currentUserName string, body string) (TicketComment, error) {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return TicketComment{}, err
	}
	defer tx.Rollback(ctx)

	projectID, _, _, err := getProjectIdentity(ctx, tx, pageID, spaceID)
	if err != nil {
		return TicketComment{}, err
	}

	if _, err := getProjectTicketByProjectID(ctx, tx, projectID, ticketID); err != nil {
		return TicketComment{}, err
	}

	var comment TicketComment
	err = tx.QueryRow(ctx, insertTicketComment, ticketID, strings.TrimSpace(body), currentUserID, currentUserName).Scan(
		&comment.ID,
		&comment.TicketID,
		&comment.Body,
		&comment.CreatedBy,
		&comment.CreatedByName,
		&comment.UpdatedBy,
		&comment.CreatedAt,
		&comment.UpdatedAt,
	)
	if err != nil {
		return TicketComment{}, err
	}
	if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "comment_added", nil, nil, stringPtr(comment.Body), currentUserID, currentUserName); err != nil {
		return TicketComment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TicketComment{}, err
	}
	return comment, nil
}

func AttachProjectTicketAttachment(ctx context.Context, pageID int64, spaceID uuid.UUID, ticketID uuid.UUID, attachmentID string, currentUserID uuid.UUID, currentUserName string) ([]TicketAttachment, error) {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	projectID, _, _, err := getProjectIdentity(ctx, tx, pageID, spaceID)
	if err != nil {
		return nil, err
	}
	if _, err := getProjectTicketByProjectID(ctx, tx, projectID, ticketID); err != nil {
		return nil, err
	}

	var resolvedAttachmentID string
	if err := tx.QueryRow(ctx, resolvePageAttachmentForTicket, attachmentID, pageID).Scan(&resolvedAttachmentID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, insertTicketAttachment, ticketID, resolvedAttachmentID, currentUserID); err != nil {
		return nil, err
	}
	if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "attachment_added", nil, nil, stringPtr(resolvedAttachmentID), currentUserID, currentUserName); err != nil {
		return nil, err
	}
	attachments, err := loadTicketAttachments(ctx, tx, ticketID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return attachments, nil
}

func RemoveProjectTicketAttachment(ctx context.Context, pageID int64, spaceID uuid.UUID, ticketID uuid.UUID, attachmentID string, currentUserID uuid.UUID, currentUserName string) ([]TicketAttachment, error) {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	projectID, _, _, err := getProjectIdentity(ctx, tx, pageID, spaceID)
	if err != nil {
		return nil, err
	}
	if _, err := getProjectTicketByProjectID(ctx, tx, projectID, ticketID); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, deleteTicketAttachment, ticketID, attachmentID); err != nil {
		return nil, err
	}
	if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "attachment_removed", nil, stringPtr(attachmentID), nil, currentUserID, currentUserName); err != nil {
		return nil, err
	}
	attachments, err := loadTicketAttachments(ctx, tx, ticketID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return attachments, nil
}

func ExportProjectTicketsCSV(ctx context.Context, pageID int64, spaceID uuid.UUID, currentUserID uuid.UUID, filter TicketFilter) ([]byte, error) {
	list, err := ListProjectTickets(ctx, pageID, spaceID, currentUserID, filter)
	if err != nil {
		return nil, err
	}

	var buffer bytes.Buffer
	writer := csv.NewWriter(&buffer)
	if err := writer.Write([]string{
		"identifier",
		"title",
		"type",
		"status",
		"priority",
		"planning",
		"assignee",
		"reporter",
		"labels",
		"parent_identifier",
		"due_at",
		"updated_at",
		"description",
	}); err != nil {
		return nil, err
	}

	for _, ticket := range list.Tickets {
		assignee := ""
		if ticket.AssigneeName != nil {
			assignee = *ticket.AssigneeName
		}
		parentIdentifier := ""
		if ticket.ParentIdentifier != nil {
			parentIdentifier = *ticket.ParentIdentifier
		}
		planning := ""
		if len(ticket.CycleAssignments) > 0 {
			chips := make([]string, 0, len(ticket.CycleAssignments))
			for _, assignment := range ticket.CycleAssignments {
				chips = append(chips, assignment.Track.Name+": "+assignment.Cycle.Name)
			}
			planning = strings.Join(chips, " | ")
		}
		dueAt := ""
		if ticket.DueAt != nil {
			dueAt = ticket.DueAt.UTC().Format(time.RFC3339)
		}
		if err := writer.Write([]string{
			ticket.Identifier,
			ticket.Title,
			ticket.Type,
			ticket.Status,
			ticket.Priority,
			planning,
			assignee,
			ticket.ReporterName,
			strings.Join(ticket.LabelNames, ", "),
			parentIdentifier,
			dueAt,
			ticket.UpdatedAt.UTC().Format(time.RFC3339),
			ticket.Description,
		}); err != nil {
			return nil, err
		}
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func ExportProjectTicketsJSON(ctx context.Context, pageID int64, spaceID uuid.UUID, currentUserID uuid.UUID, filter TicketFilter) ([]byte, error) {
	projectView, err := GetProjectPageView(ctx, pageID, spaceID, currentUserID)
	if err != nil {
		return nil, err
	}
	list, err := ListProjectTickets(ctx, pageID, spaceID, currentUserID, filter)
	if err != nil {
		return nil, err
	}

	payload := ProjectExportPayload{
		Project:    projectView,
		Tickets:    list.Tickets,
		ExportedAt: time.Now().UTC(),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal project export: %w", err)
	}
	return data, nil
}
