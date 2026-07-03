package project

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	pagepkg "github.com/durgakiran/beskar/page"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func stringPtr(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func stringPtrValue(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func derefString(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return strings.TrimSpace(*value)
}

func timeValueString(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}

func scanTicketSummary(scan func(dest ...any) error) (TicketSummary, error) {
	var (
		ticket           TicketSummary
		parentIdentifier *string
		parentTitle      *string
	)

	if err := scan(
		&ticket.ID,
		&ticket.ProjectID,
		&ticket.SequenceNo,
		&ticket.Identifier,
		&ticket.Type,
		&ticket.ParentTicketID,
		&ticket.RootTicketID,
		&ticket.Depth,
		&ticket.Title,
		&ticket.Description,
		&ticket.Status,
		&ticket.Priority,
		&ticket.AssigneeUserID,
		&ticket.AssigneeName,
		&ticket.ReporterUserID,
		&ticket.ReporterName,
		&ticket.LabelNames,
		&ticket.DueAt,
		&ticket.Rank,
		&ticket.CreatedAt,
		&ticket.UpdatedAt,
		&parentIdentifier,
		&parentTitle,
		&ticket.ChildCount,
		&ticket.OpenChildCount,
		&ticket.DoneChildCount,
	); err != nil {
		return TicketSummary{}, err
	}

	ticket.ParentIdentifier = parentIdentifier
	ticket.ParentTitle = parentTitle
	if ticket.AssigneeName != nil {
		ticket.OwnerInitials = initialsForName(*ticket.AssigneeName)
	} else {
		ticket.OwnerInitials = initialsForName(ticket.ReporterName)
	}
	return ticket, nil
}

func ensureUniqueProjectKeyTx(ctx context.Context, tx pgx.Tx, spaceID uuid.UUID, candidate string) (string, error) {
	rows, err := tx.Query(ctx, getProjectKeyConflicts, spaceID, candidate+"%")
	if err != nil {
		return "", err
	}
	defer rows.Close()

	used := make(map[string]struct{})
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return "", err
		}
		used[strings.ToUpper(key)] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}

	normalized := strings.ToUpper(candidate)
	if _, exists := used[normalized]; !exists {
		return normalized, nil
	}
	for idx := 2; idx < 1000; idx++ {
		next := normalized + strconv.Itoa(idx)
		if _, exists := used[next]; !exists {
			return next, nil
		}
	}
	return "", errors.New("unable to derive unique project key")
}

func CreateProjectPage(ctx context.Context, spaceID uuid.UUID, ownerID uuid.UUID, req CreateProjectPageRequest) (int64, error) {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	projectKey, err := ensureUniqueProjectKeyTx(ctx, tx, spaceID, normalizeRequestedProjectKey(req.Key, req.Title))
	if err != nil {
		return 0, err
	}

	var pageID int64
	err = tx.QueryRow(ctx, insertProjectPage, spaceID, ownerID, normalizeProjectParentID(req.ParentID)).Scan(&pageID)
	if err != nil {
		return 0, err
	}

	var projectID uuid.UUID
	err = tx.QueryRow(ctx, insertProject, pageID, spaceID, projectKey, req.Title, req.Description, DefaultProjectViewList, ownerID).Scan(&projectID)
	if err != nil {
		return 0, err
	}
	if err := ensureDefaultCycleTracks(ctx, tx, projectID, ownerID); err != nil {
		return 0, err
	}

	if _, err := core.CreateSubjectPermissions("page", strconv.FormatInt(pageID, 10), "space", spaceID.String(), "space"); err != nil {
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	_ = projectID
	return pageID, nil
}

func GetProjectPageView(ctx context.Context, pageID int64, spaceID uuid.UUID, ownerID uuid.UUID) (ProjectPageView, error) {
	var output ProjectPageView

	row := core.GetPool().QueryRow(ctx, getProjectView, pageID, spaceID)

	var (
		projectID     uuid.UUID
		projectPageID int64
		projectSpace  uuid.UUID
		projectKey    string
		title         string
		description   string
		defaultView   string
		createdBy     uuid.UUID
		updatedBy     *uuid.UUID
		createdAt     time.Time
		updatedAt     time.Time
		projectArch   *time.Time
		spaceName     string
		spaceArch     *time.Time
		ticketCount   int
		openCount     int
		doneCount     int
	)
	err := row.Scan(
		&projectID,
		&projectPageID,
		&projectSpace,
		&projectKey,
		&title,
		&description,
		&defaultView,
		&createdBy,
		&updatedBy,
		&createdAt,
		&updatedAt,
		&projectArch,
		&spaceName,
		&spaceArch,
		&ticketCount,
		&openCount,
		&doneCount,
	)
	if err != nil {
		return output, err
	}

	crumbs, err := pagepkg.GetPageBreadCrumbs(pageID)
	if err != nil {
		return output, err
	}
	breadcrumbs := make([]ProjectViewBreadcrumb, 0, len(crumbs))
	for _, crumb := range crumbs {
		href := fmt.Sprintf("/space/%s/view/%d", spaceID.String(), crumb.Id)
		breadcrumbs = append(breadcrumbs, ProjectViewBreadcrumb{
			ID:    crumb.Id,
			Title: crumb.Name,
			Href:  &href,
		})
	}

	pageEntityID := strconv.FormatInt(pageID, 10)
	canEdit, _ := core.CheckPermission("page", pageEntityID, "user", ownerID.String(), core.PAGE_EDIT)
	canDelete, _ := core.CheckPermission("page", pageEntityID, "user", ownerID.String(), core.PAGE_DELETE)

	output = ProjectPageView{
		PageID:      projectPageID,
		SpaceID:     projectSpace,
		ProjectID:   projectID,
		ProjectKey:  projectKey,
		Title:       title,
		Description: description,
		DefaultView: defaultView,
		Breadcrumbs: breadcrumbs,
		Space: ProjectViewSpace{
			Name:       spaceName,
			ArchivedAt: spaceArch,
		},
		Capabilities: ProjectViewCapabilities{
			CanEdit:         canEdit && spaceArch == nil && projectArch == nil,
			CanDelete:       canDelete && spaceArch == nil && projectArch == nil,
			CanCreateTicket: canEdit && spaceArch == nil && projectArch == nil,
		},
		Summary: ProjectSummaryCounts{
			TicketCount: ticketCount,
			OpenCount:   openCount,
			DoneCount:   doneCount,
		},
	}
	if err := ensureDefaultCycleTracks(ctx, core.GetPool(), projectID, ownerID); err != nil {
		return output, err
	}
	cycleTracks, err := loadProjectCycleTrackSummaries(ctx, core.GetPool(), projectID)
	if err != nil {
		return output, err
	}
	output.CycleTracks = cycleTracks
	return output, nil
}

func getProjectIdentity(ctx context.Context, q queryRower, pageID int64, spaceID uuid.UUID) (uuid.UUID, string, string, error) {
	var (
		projectID  uuid.UUID
		projectKey string
		title      string
	)
	err := q.QueryRow(ctx, getProjectIdentityForCreate, pageID, spaceID).Scan(&projectID, &projectKey, &title)
	if err != nil {
		return uuid.Nil, "", "", err
	}
	return projectID, projectKey, title, nil
}

func ticketOrderByClause(sort string) string {
	switch normalizeTicketSort(sort) {
	case "updated_desc":
		return "t.updated_at DESC, t.sequence_no ASC"
	case "created_desc":
		return "t.created_at DESC, t.sequence_no ASC"
	case "due_asc":
		return "CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END ASC, t.due_at ASC, t.sequence_no ASC"
	case "priority_desc":
		return `CASE t.priority
			WHEN 'urgent' THEN 5
			WHEN 'high' THEN 4
			WHEN 'medium' THEN 3
			WHEN 'low' THEN 2
			WHEN 'none' THEN 1
			ELSE 0
		END DESC, t.sequence_no ASC`
	default:
		return "COALESCE(t.rank, LPAD(t.sequence_no::text, 6, '0')) ASC, t.sequence_no ASC"
	}
}

func ListProjectTickets(ctx context.Context, pageID int64, spaceID uuid.UUID, currentUserID uuid.UUID, filter TicketFilter) (TicketListResponse, error) {
	var response TicketListResponse

	projectID, _, _, err := getProjectIdentity(ctx, core.GetPool(), pageID, spaceID)
	if err != nil {
		return response, err
	}

	args := make([]interface{}, 0, 8)
	args = append(args, projectID)

	var builder strings.Builder
	builder.WriteString("SELECT\n\t\t")
	builder.WriteString(ticketSummarySelect)
	builder.WriteString("\n\t\t")
	builder.WriteString(ticketSummaryFrom)
	builder.WriteString("\n\t\tWHERE t.project_id = $1 AND t.archived_at IS NULL")

	nextArg := 2
	if filter.Search != "" {
		builder.WriteString(fmt.Sprintf(" AND (t.title ILIKE $%d OR t.description ILIKE $%d OR t.identifier ILIKE $%d)", nextArg, nextArg, nextArg))
		args = append(args, "%"+filter.Search+"%")
		nextArg++
	}
	if filter.Status != "" {
		builder.WriteString(fmt.Sprintf(" AND t.status = $%d", nextArg))
		args = append(args, filter.Status)
		nextArg++
	}
	if filter.Type != "" {
		builder.WriteString(fmt.Sprintf(" AND t.type = $%d", nextArg))
		args = append(args, filter.Type)
		nextArg++
	}
	if filter.AssigneeUserID != nil {
		builder.WriteString(fmt.Sprintf(" AND t.assignee_user_id = $%d", nextArg))
		args = append(args, *filter.AssigneeUserID)
		nextArg++
	}
	if filter.ReporterUserID != nil {
		builder.WriteString(fmt.Sprintf(" AND t.reporter_user_id = $%d", nextArg))
		args = append(args, *filter.ReporterUserID)
		nextArg++
	}
	if filter.Label != "" {
		builder.WriteString(fmt.Sprintf(" AND $%d = ANY(t.label_names)", nextArg))
		args = append(args, filter.Label)
		nextArg++
	}
	if filter.ParentTicketID != nil {
		builder.WriteString(fmt.Sprintf(" AND t.parent_ticket_id = $%d", nextArg))
		args = append(args, *filter.ParentTicketID)
		nextArg++
	}
	if filter.RootTicketID != nil {
		builder.WriteString(fmt.Sprintf(" AND t.root_ticket_id = $%d", nextArg))
		args = append(args, *filter.RootTicketID)
		nextArg++
	}
	if filter.Mine {
		builder.WriteString(fmt.Sprintf(" AND t.assignee_user_id = $%d", nextArg))
		args = append(args, currentUserID)
		nextArg++
	}
	if filter.UpdatedAfter != nil {
		builder.WriteString(fmt.Sprintf(" AND t.updated_at > $%d", nextArg))
		args = append(args, *filter.UpdatedAfter)
		nextArg++
	}
	if filter.DueBefore != nil {
		builder.WriteString(fmt.Sprintf(" AND t.due_at IS NOT NULL AND t.due_at <= $%d", nextArg))
		args = append(args, *filter.DueBefore)
		nextArg++
	}
	for trackID, cycleID := range filter.CycleTrackFilters {
		builder.WriteString(fmt.Sprintf(" AND EXISTS (SELECT 1 FROM project.ticket_cycle_assignments tca WHERE tca.ticket_id = t.id AND tca.track_id = $%d AND tca.cycle_id = $%d)", nextArg, nextArg+1))
		args = append(args, trackID, cycleID)
		nextArg += 2
	}
	for _, trackID := range filter.UnplannedTrackIDs {
		builder.WriteString(fmt.Sprintf(" AND NOT EXISTS (SELECT 1 FROM project.ticket_cycle_assignments tca WHERE tca.ticket_id = t.id AND tca.track_id = $%d)", nextArg))
		args = append(args, trackID)
		nextArg++
	}
	if filter.Unplanned {
		builder.WriteString(" AND NOT EXISTS (SELECT 1 FROM project.ticket_cycle_assignments tca WHERE tca.ticket_id = t.id)")
	}
	if filter.LeafOnly {
		builder.WriteString(" AND NOT EXISTS (SELECT 1 FROM project.tickets child WHERE child.parent_ticket_id = t.id AND child.archived_at IS NULL)")
	}
	builder.WriteString(" ORDER BY ")
	builder.WriteString(ticketOrderByClause(filter.Sort))

	rows, err := core.GetPool().Query(ctx, builder.String(), args...)
	if err != nil {
		return response, err
	}
	defer rows.Close()

	tickets := make([]TicketSummary, 0)
	for rows.Next() {
		ticket, err := scanTicketSummary(rows.Scan)
		if err != nil {
			return response, err
		}
		tickets = append(tickets, ticket)
	}
	if err := rows.Err(); err != nil {
		return response, err
	}
	ticketIDs := make([]uuid.UUID, 0, len(tickets))
	for _, ticket := range tickets {
		ticketIDs = append(ticketIDs, ticket.ID)
	}
	assignments, err := loadTicketCycleAssignmentsByTicket(ctx, core.GetPool(), projectID, ticketIDs)
	if err != nil {
		return response, err
	}

	response.Tickets = applyTicketCycleAssignments(tickets, assignments)
	response.Total = len(tickets)
	return response, nil
}

func CreateProjectTicket(ctx context.Context, pageID int64, spaceID uuid.UUID, currentUserID uuid.UUID, currentUserName string, req CreateTicketRequest) (TicketSummary, error) {
	var output TicketSummary

	req.Title = strings.TrimSpace(req.Title)
	req.Description = strings.TrimSpace(req.Description)
	req.Type = normalizeTicketType(req.Type)
	req.Status = normalizeTicketStatus(req.Status)
	req.Priority = normalizeTicketPriority(req.Priority)
	req.LabelNames = normalizeLabels(req.LabelNames)
	if req.Title == "" {
		return output, errors.New("invalid ticket: title is required")
	}
	if req.Type == "" {
		req.Type = TicketTypeTask
	}
	if req.Status == "" {
		req.Status = TicketStatusTodo
	}
	if req.Priority == "" {
		req.Priority = TicketPriorityMedium
	}

	assigneeUserID := &currentUserID
	assigneeName := stringPtr(strings.TrimSpace(currentUserName))
	if req.AssigneeUserID != nil {
		assigneeUserID = req.AssigneeUserID
		assigneeName = stringPtrValue(req.AssigneeName)
	}

	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return output, err
	}
	defer tx.Rollback(ctx)

	projectID, projectKey, _, err := getProjectIdentity(ctx, tx, pageID, spaceID)
	if err != nil {
		return output, err
	}

	var parentType *string
	var parentTicketID *uuid.UUID
	var rootTicketID *uuid.UUID
	var depth int16
	var parentIdentifier *string
	var parentTitle *string
	if req.ParentTicketID != nil {
		var (
			parentID        uuid.UUID
			parentProjectID uuid.UUID
			parentIdent     string
			parentName      string
			parentTypeValue string
			parentParentID  *uuid.UUID
			parentRootID    *uuid.UUID
			parentDepth     int16
		)
		err = tx.QueryRow(ctx, getParentTicketForCreate, *req.ParentTicketID, projectID).Scan(
			&parentID,
			&parentProjectID,
			&parentIdent,
			&parentName,
			&parentTypeValue,
			&parentParentID,
			&parentRootID,
			&parentDepth,
		)
		if err != nil {
			return output, err
		}
		_ = parentProjectID
		parentType = &parentTypeValue
		parentTicketID = &parentID
		parentIdentifier = &parentIdent
		parentTitle = &parentName
		if parentRootID != nil {
			rootTicketID = parentRootID
		} else {
			rootTicketID = &parentID
		}
		depth = parentDepth + 1
	}

	if err := validateHierarchyForCreate(req.Type, parentType); err != nil {
		return output, err
	}

	if err := tx.QueryRow(ctx, lockProjectForTicketSequence, projectID).Scan(&projectKey); err != nil {
		return output, err
	}

	var nextSequence int
	if err := tx.QueryRow(ctx, getNextTicketSequence, projectID).Scan(&nextSequence); err != nil {
		return output, err
	}

	identifier := fmt.Sprintf("%s-%d", projectKey, nextSequence)
	rank := fmt.Sprintf("%06d", nextSequence)

	inserted := ticketInsertRow{}
	err = tx.QueryRow(
		ctx,
		insertTicket,
		projectID,
		nextSequence,
		identifier,
		req.Type,
		parentTicketID,
		rootTicketID,
		depth,
		req.Title,
		req.Description,
		req.Status,
		req.Priority,
		assigneeUserID,
		assigneeName,
		currentUserID,
		currentUserName,
		req.LabelNames,
		req.DueAt,
		rank,
	).Scan(
		&inserted.ID,
		&inserted.ProjectID,
		&inserted.SequenceNo,
		&inserted.Identifier,
		&inserted.Type,
		&inserted.ParentTicketID,
		&inserted.RootTicketID,
		&inserted.Depth,
		&inserted.Title,
		&inserted.Description,
		&inserted.Status,
		&inserted.Priority,
		&inserted.AssigneeUserID,
		&inserted.AssigneeName,
		&inserted.ReporterUserID,
		&inserted.ReporterName,
		&inserted.LabelNames,
		&inserted.DueAt,
		&inserted.Rank,
		&inserted.CreatedAt,
		&inserted.UpdatedAt,
	)
	if err != nil {
		return output, err
	}

	if err := syncDescriptionLinksTx(ctx, tx, inserted.ID, inserted.Description, currentUserID); err != nil {
		return output, err
	}
	if _, err := recordTicketActivityTx(ctx, tx, inserted.ID, projectID, "ticket_created", nil, nil, stringPtr(inserted.Title), currentUserID, currentUserName); err != nil {
		return output, err
	}
	if err := replaceTicketCycleAssignments(ctx, tx, projectID, inserted.ID, req.CycleAssignments, currentUserID, currentUserName); err != nil {
		return output, err
	}

	if err := tx.Commit(ctx); err != nil {
		return output, err
	}

	output = TicketSummary{
		ID:               inserted.ID,
		ProjectID:        inserted.ProjectID,
		SequenceNo:       inserted.SequenceNo,
		Identifier:       inserted.Identifier,
		Type:             inserted.Type,
		ParentTicketID:   inserted.ParentTicketID,
		RootTicketID:     inserted.RootTicketID,
		Depth:            inserted.Depth,
		Title:            inserted.Title,
		Description:      inserted.Description,
		Status:           inserted.Status,
		Priority:         inserted.Priority,
		AssigneeUserID:   inserted.AssigneeUserID,
		AssigneeName:     inserted.AssigneeName,
		ReporterUserID:   inserted.ReporterUserID,
		ReporterName:     inserted.ReporterName,
		LabelNames:       inserted.LabelNames,
		DueAt:            inserted.DueAt,
		Rank:             inserted.Rank,
		CreatedAt:        inserted.CreatedAt,
		UpdatedAt:        inserted.UpdatedAt,
		ParentIdentifier: parentIdentifier,
		ParentTitle:      parentTitle,
		OwnerInitials:    initialsForName(derefString(inserted.AssigneeName, currentUserName)),
	}
	return output, nil
}

func getProjectTicketByProjectID(ctx context.Context, q queryRower, projectID uuid.UUID, ticketID uuid.UUID) (TicketSummary, error) {
	return scanTicketSummary(q.QueryRow(ctx, getProjectTicket, ticketID, projectID).Scan)
}

func GetProjectTicket(ctx context.Context, pageID int64, spaceID uuid.UUID, ticketID uuid.UUID) (TicketSummary, error) {
	projectID, _, _, err := getProjectIdentity(ctx, core.GetPool(), pageID, spaceID)
	if err != nil {
		return TicketSummary{}, err
	}
	ticket, err := getProjectTicketByProjectID(ctx, core.GetPool(), projectID, ticketID)
	if err != nil {
		return TicketSummary{}, err
	}
	return hydrateTicketDetail(ctx, core.GetPool(), ticket)
}

func normalizeActivityLimit(limit int) int {
	if limit <= 0 {
		return 25
	}
	if limit > 100 {
		return 100
	}
	return limit
}

func ListProjectActivity(ctx context.Context, pageID int64, spaceID uuid.UUID, after *time.Time, limit int) (ProjectActivityListResponse, error) {
	projectID, _, _, err := getProjectIdentity(ctx, core.GetPool(), pageID, spaceID)
	if err != nil {
		return ProjectActivityListResponse{}, err
	}
	activity, err := loadProjectActivity(ctx, core.GetPool(), projectID, after, normalizeActivityLimit(limit))
	if err != nil {
		return ProjectActivityListResponse{}, err
	}

	response := ProjectActivityListResponse{
		Activity: activity,
		Total:    len(activity),
	}
	if len(activity) > 0 {
		latestAt := activity[0].CreatedAt
		response.LatestAt = &latestAt
	}
	return response, nil
}

func ListProjectEvents(ctx context.Context, pageID int64, spaceID uuid.UUID, after *time.Time, limit int) (ProjectEventListResponse, error) {
	activityResponse, err := ListProjectActivity(ctx, pageID, spaceID, after, limit)
	if err != nil {
		return ProjectEventListResponse{}, err
	}

	events := make([]ProjectEvent, 0, len(activityResponse.Activity))
	for _, activity := range activityResponse.Activity {
		events = append(events, ProjectEvent{
			ID:           activity.ID,
			TicketID:     activity.TicketID,
			ProjectID:    activity.ProjectID,
			EventType:    projectEventTypeForActivity(activity.ActivityType),
			ActivityType: activity.ActivityType,
			FieldName:    activity.FieldName,
			OldValue:     activity.OldValue,
			NewValue:     activity.NewValue,
			ActorID:      activity.ActorID,
			ActorName:    activity.ActorName,
			OccurredAt:   activity.CreatedAt,
		})
	}

	return ProjectEventListResponse{
		Events:   events,
		Total:    len(events),
		LatestAt: activityResponse.LatestAt,
	}, nil
}

func nextParentHierarchy(ctx context.Context, tx pgx.Tx, projectID uuid.UUID, current TicketSummary, req UpdateTicketRequest) (*uuid.UUID, *uuid.UUID, int16, *string, *string, *string, error) {
	if !req.ParentSet {
		var currentParentType *string
		if current.ParentTicketID != nil {
			var (
				parentID         uuid.UUID
				parentProjectID  uuid.UUID
				parentIdentifier string
				parentTitle      string
				parentType       string
				parentParentID   *uuid.UUID
				parentRootID     *uuid.UUID
				parentDepth      int16
			)
			err := tx.QueryRow(ctx, getParentTicketForCreate, *current.ParentTicketID, projectID).Scan(
				&parentID,
				&parentProjectID,
				&parentIdentifier,
				&parentTitle,
				&parentType,
				&parentParentID,
				&parentRootID,
				&parentDepth,
			)
			if err != nil {
				return nil, nil, 0, nil, nil, nil, err
			}
			_ = parentID
			_ = parentProjectID
			_ = parentParentID
			_ = parentRootID
			_ = parentDepth
			currentParentType = &parentType
		}
		return current.ParentTicketID, current.RootTicketID, current.Depth, current.ParentIdentifier, current.ParentTitle, currentParentType, nil
	}
	if req.ParentTicketID == nil {
		return nil, nil, 0, nil, nil, nil, nil
	}
	if *req.ParentTicketID == current.ID {
		return nil, nil, 0, nil, nil, nil, errors.New("a ticket cannot be its own parent")
	}

	var (
		parentID         uuid.UUID
		parentProjectID  uuid.UUID
		parentIdentifier string
		parentTitle      string
		parentType       string
		parentParentID   *uuid.UUID
		parentRootID     *uuid.UUID
		parentDepth      int16
	)
	err := tx.QueryRow(ctx, getParentTicketForCreate, *req.ParentTicketID, projectID).Scan(
		&parentID,
		&parentProjectID,
		&parentIdentifier,
		&parentTitle,
		&parentType,
		&parentParentID,
		&parentRootID,
		&parentDepth,
	)
	if err != nil {
		return nil, nil, 0, nil, nil, nil, err
	}
	_ = parentProjectID

	rootTicketID := &parentID
	if parentRootID != nil {
		rootTicketID = parentRootID
	}
	return &parentID, rootTicketID, parentDepth + 1, &parentIdentifier, &parentTitle, &parentType, nil
}

func UpdateProjectTicket(ctx context.Context, pageID int64, spaceID uuid.UUID, ticketID uuid.UUID, currentUserID uuid.UUID, currentUserName string, req UpdateTicketRequest) (TicketSummary, error) {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return TicketSummary{}, err
	}
	defer tx.Rollback(ctx)

	projectID, _, _, err := getProjectIdentity(ctx, tx, pageID, spaceID)
	if err != nil {
		return TicketSummary{}, err
	}
	current, err := getProjectTicketByProjectID(ctx, tx, projectID, ticketID)
	if err != nil {
		return TicketSummary{}, err
	}
	currentChildren, err := loadChildTickets(ctx, tx, current.ID)
	if err != nil {
		return TicketSummary{}, err
	}

	titleSet := req.Title != nil
	titleValue := ""
	if titleSet {
		titleValue = *req.Title
	}
	descriptionSet := req.Description != nil
	descriptionValue := ""
	if descriptionSet {
		descriptionValue = *req.Description
	}
	typeSet := req.Type != nil
	typeValue := current.Type
	if typeSet {
		typeValue = *req.Type
	}
	statusSet := req.Status != nil
	statusValue := ""
	if statusSet {
		statusValue = *req.Status
	}
	prioritySet := req.Priority != nil
	priorityValue := ""
	if prioritySet {
		priorityValue = *req.Priority
	}
	assigneeSet := req.AssigneeSet
	var assigneeUserID any
	var assigneeName any
	if assigneeSet {
		if req.AssigneeUserID != nil {
			assigneeUserID = req.AssigneeUserID.String()
			assigneeName = derefString(req.AssigneeName, "")
		} else {
			assigneeUserID = nil
			assigneeName = nil
		}
	}
	labelsSet := req.LabelNames != nil
	labelValues := []string{}
	if labelsSet {
		labelValues = *req.LabelNames
	}
	dueAtSet := req.DueAtSet
	var dueAtValue any
	if dueAtSet {
		dueAtValue = req.DueAt
	}
	parentSet := req.ParentSet
	parentTicketIDValue, rootTicketIDValue, depthValue, nextParentIdentifier, nextParentTitle, nextParentType, err := nextParentHierarchy(ctx, tx, projectID, current, req)
	if err != nil {
		return TicketSummary{}, err
	}
	if (typeSet || parentSet) && len(currentChildren) > 0 {
		return TicketSummary{}, errors.New("changing type or parent is only supported for leaf tickets in v1")
	}
	if err := validateHierarchyForCreate(typeValue, nextParentType); err != nil {
		return TicketSummary{}, err
	}
	var parentTicketArg any
	if parentTicketIDValue != nil {
		parentTicketArg = parentTicketIDValue.String()
	}
	var rootTicketArg any
	if rootTicketIDValue != nil {
		rootTicketArg = rootTicketIDValue.String()
	}

	commandTag, err := tx.Exec(
		ctx,
		updateTicket,
		ticketID,
		currentUserID,
		titleSet,
		titleValue,
		descriptionSet,
		descriptionValue,
		typeSet,
		typeValue,
		statusSet,
		statusValue,
		prioritySet,
		priorityValue,
		parentSet,
		parentTicketArg,
		rootTicketArg,
		depthValue,
		labelsSet,
		labelValues,
		assigneeSet,
		assigneeUserID,
		assigneeName,
		dueAtSet,
		dueAtValue,
		projectID,
	)
	if err != nil {
		return TicketSummary{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return TicketSummary{}, pgx.ErrNoRows
	}

	if descriptionSet {
		if err := syncDescriptionLinksTx(ctx, tx, ticketID, descriptionValue, currentUserID); err != nil {
			return TicketSummary{}, err
		}
	}
	if titleSet && titleValue != current.Title {
		if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "ticket_field_updated", stringPtr("title"), stringPtr(current.Title), stringPtr(titleValue), currentUserID, currentUserName); err != nil {
			return TicketSummary{}, err
		}
	}
	if descriptionSet && descriptionValue != current.Description {
		if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "ticket_field_updated", stringPtr("description"), stringPtr(current.Description), stringPtr(descriptionValue), currentUserID, currentUserName); err != nil {
			return TicketSummary{}, err
		}
	}
	if typeSet && typeValue != current.Type {
		if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "ticket_field_updated", stringPtr("type"), stringPtr(current.Type), stringPtr(typeValue), currentUserID, currentUserName); err != nil {
			return TicketSummary{}, err
		}
	}
	if statusSet && statusValue != current.Status {
		if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "ticket_field_updated", stringPtr("status"), stringPtr(current.Status), stringPtr(statusValue), currentUserID, currentUserName); err != nil {
			return TicketSummary{}, err
		}
	}
	if prioritySet && priorityValue != current.Priority {
		if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "ticket_field_updated", stringPtr("priority"), stringPtr(current.Priority), stringPtr(priorityValue), currentUserID, currentUserName); err != nil {
			return TicketSummary{}, err
		}
	}
	if labelsSet {
		oldLabels := strings.Join(current.LabelNames, ", ")
		newLabels := strings.Join(labelValues, ", ")
		if oldLabels != newLabels {
			if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "ticket_field_updated", stringPtr("labels"), stringPtr(oldLabels), stringPtr(newLabels), currentUserID, currentUserName); err != nil {
				return TicketSummary{}, err
			}
		}
	}
	if assigneeSet {
		oldAssignee := derefString(current.AssigneeName, "")
		newAssignee := derefString(req.AssigneeName, "")
		if oldAssignee != newAssignee || (current.AssigneeUserID == nil) != (req.AssigneeUserID == nil) {
			if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "ticket_field_updated", stringPtr("assignee"), stringPtr(oldAssignee), stringPtr(newAssignee), currentUserID, currentUserName); err != nil {
				return TicketSummary{}, err
			}
		}
	}
	if dueAtSet {
		oldDueAt := timeValueString(current.DueAt)
		newDueAt := timeValueString(req.DueAt)
		oldDueAtValue := ""
		newDueAtValue := ""
		if oldDueAt != nil {
			oldDueAtValue = *oldDueAt
		}
		if newDueAt != nil {
			newDueAtValue = *newDueAt
		}
		if oldDueAtValue != newDueAtValue {
			if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "ticket_field_updated", stringPtr("due_at"), oldDueAt, newDueAt, currentUserID, currentUserName); err != nil {
				return TicketSummary{}, err
			}
		}
	}
	if parentSet {
		oldParent := ""
		newParent := ""
		if current.ParentIdentifier != nil {
			oldParent = *current.ParentIdentifier
			if current.ParentTitle != nil && strings.TrimSpace(*current.ParentTitle) != "" {
				oldParent = oldParent + " " + *current.ParentTitle
			}
		}
		if nextParentIdentifier != nil {
			newParent = *nextParentIdentifier
			if nextParentTitle != nil && strings.TrimSpace(*nextParentTitle) != "" {
				newParent = newParent + " " + *nextParentTitle
			}
		}
		oldParentID := ""
		newParentID := ""
		if current.ParentTicketID != nil {
			oldParentID = current.ParentTicketID.String()
		}
		if parentTicketIDValue != nil {
			newParentID = parentTicketIDValue.String()
		}
		if oldParentID != newParentID {
			if _, err := recordTicketActivityTx(ctx, tx, ticketID, projectID, "ticket_field_updated", stringPtr("parent_ticket"), stringPtr(oldParent), stringPtr(newParent), currentUserID, currentUserName); err != nil {
				return TicketSummary{}, err
			}
		}
	}
	if req.CycleAssignmentsSet {
		if err := replaceTicketCycleAssignments(ctx, tx, projectID, ticketID, req.CycleAssignments, currentUserID, currentUserName); err != nil {
			return TicketSummary{}, err
		}
	}

	ticket, err := getProjectTicketByProjectID(ctx, tx, projectID, ticketID)
	if err != nil {
		return TicketSummary{}, err
	}
	ticket, err = hydrateTicketDetail(ctx, tx, ticket)
	if err != nil {
		return TicketSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TicketSummary{}, err
	}
	return ticket, nil
}

func BulkUpdateProjectTickets(ctx context.Context, pageID int64, spaceID uuid.UUID, currentUserID uuid.UUID, currentUserName string, req BulkUpdateTicketRequest) (BulkUpdateTicketResponse, error) {
	response := BulkUpdateTicketResponse{
		Updated: make([]TicketSummary, 0, len(req.TicketIDs)),
		Failed:  make([]BulkUpdateTicketFailure, 0),
	}
	updateReq := UpdateTicketRequest{
		Type:           req.Type,
		Status:         req.Status,
		Priority:       req.Priority,
		ParentTicketID: req.ParentTicketID,
		ParentSet:      req.ParentSet,
		AssigneeUserID: req.AssigneeUserID,
		AssigneeName:   req.AssigneeName,
		AssigneeSet:    req.AssigneeSet,
		LabelNames:     req.LabelNames,
		DueAt:          req.DueAt,
		DueAtSet:       req.DueAtSet,
	}

	for _, ticketID := range req.TicketIDs {
		updated, err := UpdateProjectTicket(ctx, pageID, spaceID, ticketID, currentUserID, currentUserName, updateReq)
		if err != nil {
			response.Failed = append(response.Failed, BulkUpdateTicketFailure{
				TicketID: ticketID.String(),
				Message:  err.Error(),
			})
			continue
		}
		response.Updated = append(response.Updated, updated)
	}
	return response, nil
}
