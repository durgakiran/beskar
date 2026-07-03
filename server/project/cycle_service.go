package project

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
)

type cycleTrackTemplate struct {
	Key                     string
	Name                    string
	Position                int
	DisplayStyle            string
	ActivationPolicy        string
	MaxAssignmentsPerTicket int16
	ColorToken              *string
}

type cycleTrackRow struct {
	ID                      uuid.UUID
	ProjectID               uuid.UUID
	Key                     string
	Name                    string
	Position                int
	DisplayStyle            string
	ActivationPolicy        string
	MaxAssignmentsPerTicket int16
	ColorToken              *string
}

type cycleValidationRow struct {
	Cycle ProjectCycleSummary
	Track ProjectCycleTrackSummary
}

func defaultCycleTrackTemplates() []cycleTrackTemplate {
	return []cycleTrackTemplate{
		{
			Key:                     CycleTrackKeySprint,
			Name:                    "Sprint",
			Position:                10,
			DisplayStyle:            CycleTrackDisplayStyleRange,
			ActivationPolicy:        CycleTrackActivationSingleActive,
			MaxAssignmentsPerTicket: 1,
		},
		{
			Key:                     CycleTrackKeyMilestone,
			Name:                    "Milestone",
			Position:                20,
			DisplayStyle:            CycleTrackDisplayStyleMarker,
			ActivationPolicy:        CycleTrackActivationMultiActive,
			MaxAssignmentsPerTicket: 1,
		},
		{
			Key:                     CycleTrackKeyQuarter,
			Name:                    "Quarter",
			Position:                30,
			DisplayStyle:            CycleTrackDisplayStyleRange,
			ActivationPolicy:        CycleTrackActivationSingleActive,
			MaxAssignmentsPerTicket: 1,
		},
	}
}

func ensureDefaultCycleTracks(ctx context.Context, q execer, projectID uuid.UUID, actorID uuid.UUID) error {
	for _, template := range defaultCycleTrackTemplates() {
		if _, err := q.Exec(
			ctx,
			insertCycleTrack,
			projectID,
			template.Key,
			template.Name,
			template.Position,
			template.DisplayStyle,
			template.ActivationPolicy,
			template.MaxAssignmentsPerTicket,
			template.ColorToken,
			actorID,
		); err != nil {
			return err
		}
	}
	return nil
}

func loadCycleTracks(ctx context.Context, q queryer, projectID uuid.UUID) ([]ProjectCycleTrackSummary, error) {
	rows, err := q.Query(ctx, listCycleTracks, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tracks := make([]ProjectCycleTrackSummary, 0)
	for rows.Next() {
		var row cycleTrackRow
		if err := rows.Scan(
			&row.ID,
			&row.ProjectID,
			&row.Key,
			&row.Name,
			&row.Position,
			&row.DisplayStyle,
			&row.ActivationPolicy,
			&row.MaxAssignmentsPerTicket,
			&row.ColorToken,
		); err != nil {
			return nil, err
		}
		tracks = append(tracks, ProjectCycleTrackSummary{
			ID:                      row.ID,
			ProjectID:               row.ProjectID,
			Key:                     row.Key,
			Name:                    row.Name,
			Position:                row.Position,
			DisplayStyle:            row.DisplayStyle,
			ActivationPolicy:        row.ActivationPolicy,
			MaxAssignmentsPerTicket: row.MaxAssignmentsPerTicket,
			ColorToken:              row.ColorToken,
		})
	}
	return tracks, rows.Err()
}

func scanCycleSummary(rows scanner) (ProjectCycleSummary, error) {
	var (
		cycle       ProjectCycleSummary
		trackID     uuid.UUID
		trackKey    string
		trackName   string
		trackPos    int
		trackStyle  string
		trackPolicy string
	)
	if err := rows.Scan(
		&cycle.ID,
		&cycle.ProjectID,
		&cycle.TrackID,
		&cycle.Name,
		&cycle.Goal,
		&cycle.Description,
		&cycle.State,
		&cycle.StartsAt,
		&cycle.EndsAt,
		&cycle.Position,
		&cycle.CompletedAt,
		&trackID,
		&trackKey,
		&trackName,
		&trackPos,
		&trackStyle,
		&trackPolicy,
		&cycle.Summary.TicketCount,
		&cycle.Summary.OpenCount,
		&cycle.Summary.DoneCount,
	); err != nil {
		return ProjectCycleSummary{}, err
	}
	cycle.Track = &ProjectCycleTrackRef{
		ID:               trackID,
		Key:              trackKey,
		Name:             trackName,
		Position:         trackPos,
		DisplayStyle:     trackStyle,
		ActivationPolicy: trackPolicy,
	}
	return cycle, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func loadProjectCycles(ctx context.Context, q queryer, projectID uuid.UUID, filter CycleFilter) ([]ProjectCycleSummary, error) {
	rows, err := q.Query(ctx, listCycles, projectID, filter.TrackID, stringPtr(filter.State))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cycles := make([]ProjectCycleSummary, 0)
	for rows.Next() {
		cycle, err := scanCycleSummary(rows)
		if err != nil {
			return nil, err
		}
		cycles = append(cycles, cycle)
	}
	return cycles, rows.Err()
}

func loadUnplannedTicketCountsByTrack(ctx context.Context, q queryer, projectID uuid.UUID) (map[uuid.UUID]int, error) {
	rows, err := q.Query(ctx, listUnplannedTicketCountsByTrack, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := make(map[uuid.UUID]int)
	for rows.Next() {
		var trackID uuid.UUID
		var count int
		if err := rows.Scan(&trackID, &count); err != nil {
			return nil, err
		}
		counts[trackID] = count
	}
	return counts, rows.Err()
}

func pickCurrentCycle(now time.Time, cycles []ProjectCycleSummary) *ProjectCycleSummary {
	var active *ProjectCycleSummary
	var nextPlanned *ProjectCycleSummary
	var latest *ProjectCycleSummary

	for idx := range cycles {
		cycle := cycles[idx]
		switch cycle.State {
		case CycleStateActive:
			if active == nil || cycle.Position < active.Position {
				copy := cycle
				active = &copy
			}
		case CycleStatePlanned:
			if nextPlanned == nil {
				copy := cycle
				nextPlanned = &copy
				continue
			}
			cycleAt := cycle.EndsAt
			nextAt := nextPlanned.EndsAt
			if cycleAt != nil && nextAt != nil && cycleAt.Before(*nextAt) {
				copy := cycle
				nextPlanned = &copy
			}
		}

		if latest == nil {
			copy := cycle
			latest = &copy
			continue
		}
		if cycle.EndsAt != nil && latest.EndsAt != nil && cycle.EndsAt.After(*latest.EndsAt) {
			copy := cycle
			latest = &copy
		}
	}

	if active != nil {
		return active
	}
	if nextPlanned != nil {
		return nextPlanned
	}
	_ = now
	return latest
}

func loadProjectCycleTrackSummaries(ctx context.Context, q queryer, projectID uuid.UUID) ([]ProjectCycleTrackSummary, error) {
	tracks, err := loadCycleTracks(ctx, q, projectID)
	if err != nil {
		return nil, err
	}
	cycles, err := loadProjectCycles(ctx, q, projectID, CycleFilter{})
	if err != nil {
		return nil, err
	}
	unplannedCounts, err := loadUnplannedTicketCountsByTrack(ctx, q, projectID)
	if err != nil {
		return nil, err
	}

	cyclesByTrack := make(map[uuid.UUID][]ProjectCycleSummary)
	for _, cycle := range cycles {
		cyclesByTrack[cycle.TrackID] = append(cyclesByTrack[cycle.TrackID], cycle)
	}

	now := time.Now().UTC()
	for idx := range tracks {
		trackCycles := cyclesByTrack[tracks[idx].ID]
		tracks[idx].CurrentCycle = pickCurrentCycle(now, trackCycles)
		tracks[idx].UnplannedTicketCount = unplannedCounts[tracks[idx].ID]
	}
	return tracks, nil
}

func ListProjectCycleTracks(ctx context.Context, pageID int64, spaceID uuid.UUID, currentUserID uuid.UUID) (CycleTrackListResponse, error) {
	projectID, _, _, err := getProjectIdentity(ctx, core.GetPool(), pageID, spaceID)
	if err != nil {
		return CycleTrackListResponse{}, err
	}
	if err := ensureDefaultCycleTracks(ctx, core.GetPool(), projectID, currentUserID); err != nil {
		return CycleTrackListResponse{}, err
	}
	tracks, err := loadProjectCycleTrackSummaries(ctx, core.GetPool(), projectID)
	if err != nil {
		return CycleTrackListResponse{}, err
	}
	return CycleTrackListResponse{Tracks: tracks}, nil
}

func ListProjectCycles(ctx context.Context, pageID int64, spaceID uuid.UUID, currentUserID uuid.UUID, filter CycleFilter) (CycleListResponse, error) {
	projectID, _, _, err := getProjectIdentity(ctx, core.GetPool(), pageID, spaceID)
	if err != nil {
		return CycleListResponse{}, err
	}
	if err := ensureDefaultCycleTracks(ctx, core.GetPool(), projectID, currentUserID); err != nil {
		return CycleListResponse{}, err
	}
	cycles, err := loadProjectCycles(ctx, core.GetPool(), projectID, filter)
	if err != nil {
		return CycleListResponse{}, err
	}
	return CycleListResponse{Cycles: cycles}, nil
}

func getCycleTrack(ctx context.Context, q queryer, projectID uuid.UUID, trackID uuid.UUID) (ProjectCycleTrackSummary, error) {
	var row cycleTrackRow
	if err := q.QueryRow(ctx, getCycleTrackByID, trackID, projectID).Scan(
		&row.ID,
		&row.ProjectID,
		&row.Key,
		&row.Name,
		&row.Position,
		&row.DisplayStyle,
		&row.ActivationPolicy,
		&row.MaxAssignmentsPerTicket,
		&row.ColorToken,
	); err != nil {
		return ProjectCycleTrackSummary{}, err
	}
	return ProjectCycleTrackSummary{
		ID:                      row.ID,
		ProjectID:               row.ProjectID,
		Key:                     row.Key,
		Name:                    row.Name,
		Position:                row.Position,
		DisplayStyle:            row.DisplayStyle,
		ActivationPolicy:        row.ActivationPolicy,
		MaxAssignmentsPerTicket: row.MaxAssignmentsPerTicket,
		ColorToken:              row.ColorToken,
	}, nil
}

func validateCycleStateForTrack(ctx context.Context, q queryer, projectID uuid.UUID, track ProjectCycleTrackSummary, nextState string, ignoreCycleID *uuid.UUID) error {
	if nextState != CycleStateActive {
		return nil
	}
	switch track.ActivationPolicy {
	case CycleTrackActivationNone:
		return errors.New("this track does not support active cycles")
	case CycleTrackActivationSingleActive:
		var count int
		var ignore any
		if ignoreCycleID != nil {
			ignore = ignoreCycleID.String()
		}
		if err := q.QueryRow(ctx, countActiveCyclesForTrack, projectID, track.ID, ignore).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("track %s already has an active cycle", track.Name)
		}
	}
	return nil
}

func CreateProjectCycle(ctx context.Context, pageID int64, spaceID uuid.UUID, currentUserID uuid.UUID, req CreateCycleRequest) (ProjectCycleSummary, error) {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return ProjectCycleSummary{}, err
	}
	defer tx.Rollback(ctx)

	projectID, _, _, err := getProjectIdentity(ctx, tx, pageID, spaceID)
	if err != nil {
		return ProjectCycleSummary{}, err
	}
	if err := ensureDefaultCycleTracks(ctx, tx, projectID, currentUserID); err != nil {
		return ProjectCycleSummary{}, err
	}
	track, err := getCycleTrack(ctx, tx, projectID, req.TrackID)
	if err != nil {
		return ProjectCycleSummary{}, err
	}
	if err := validateCycleStateForTrack(ctx, tx, projectID, track, req.State, nil); err != nil {
		return ProjectCycleSummary{}, err
	}

	var cycleID uuid.UUID
	if err := tx.QueryRow(
		ctx,
		insertCycle,
		projectID,
		track.ID,
		req.Name,
		req.Goal,
		req.Description,
		req.State,
		req.StartsAt,
		req.EndsAt,
		currentUserID,
	).Scan(&cycleID); err != nil {
		return ProjectCycleSummary{}, err
	}

	cycle, err := getProjectCycleByID(ctx, tx, projectID, cycleID)
	if err != nil {
		return ProjectCycleSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ProjectCycleSummary{}, err
	}
	return cycle, nil
}

func getProjectCycleByID(ctx context.Context, q queryer, projectID uuid.UUID, cycleID uuid.UUID) (ProjectCycleSummary, error) {
	return scanCycleSummary(q.QueryRow(ctx, getCycleByID, cycleID, projectID))
}

func UpdateProjectCycle(ctx context.Context, pageID int64, spaceID uuid.UUID, cycleID uuid.UUID, currentUserID uuid.UUID, req UpdateCycleRequest) (ProjectCycleSummary, error) {
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return ProjectCycleSummary{}, err
	}
	defer tx.Rollback(ctx)

	projectID, _, _, err := getProjectIdentity(ctx, tx, pageID, spaceID)
	if err != nil {
		return ProjectCycleSummary{}, err
	}
	currentCycle, err := getProjectCycleByID(ctx, tx, projectID, cycleID)
	if err != nil {
		return ProjectCycleSummary{}, err
	}

	nextState := currentCycle.State
	if req.State != nil {
		nextState = *req.State
	}
	track, err := getCycleTrack(ctx, tx, projectID, currentCycle.TrackID)
	if err != nil {
		return ProjectCycleSummary{}, err
	}
	if err := validateCycleStateForTrack(ctx, tx, projectID, track, nextState, &cycleID); err != nil {
		return ProjectCycleSummary{}, err
	}

	nameSet := req.Name != nil
	nameValue := ""
	if nameSet {
		nameValue = *req.Name
	}
	goalSet := req.Goal != nil
	goalValue := ""
	if goalSet {
		goalValue = *req.Goal
	}
	descriptionSet := req.Description != nil
	descriptionValue := ""
	if descriptionSet {
		descriptionValue = *req.Description
	}
	stateSet := req.State != nil
	stateValue := ""
	if stateSet {
		stateValue = *req.State
	}
	startsAtSet := req.StartsAtSet
	var startsAtValue any
	if startsAtSet {
		startsAtValue = req.StartsAt
	}
	endsAtSet := req.EndsAtSet
	var endsAtValue any
	if endsAtSet {
		endsAtValue = req.EndsAt
	}
	positionSet := req.Position != nil
	positionValue := 0
	if positionSet {
		positionValue = *req.Position
	}

	commandTag, err := tx.Exec(
		ctx,
		updateCycle,
		cycleID,
		currentUserID,
		nameSet,
		nameValue,
		goalSet,
		goalValue,
		descriptionSet,
		descriptionValue,
		stateSet,
		stateValue,
		startsAtSet,
		startsAtValue,
		endsAtSet,
		endsAtValue,
		positionSet,
		positionValue,
		projectID,
	)
	if err != nil {
		return ProjectCycleSummary{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return ProjectCycleSummary{}, errors.New("cycle not found")
	}

	updated, err := getProjectCycleByID(ctx, tx, projectID, cycleID)
	if err != nil {
		return ProjectCycleSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ProjectCycleSummary{}, err
	}
	return updated, nil
}

func loadTicketCycleAssignmentsByTicket(ctx context.Context, q queryer, projectID uuid.UUID, ticketIDs []uuid.UUID) (map[uuid.UUID][]TicketCycleAssignment, error) {
	assignments := make(map[uuid.UUID][]TicketCycleAssignment, len(ticketIDs))
	if len(ticketIDs) == 0 {
		return assignments, nil
	}

	rows, err := q.Query(ctx, listTicketCycleAssignments, projectID, ticketIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			ticketID uuid.UUID
			track    ProjectCycleTrackRef
			cycle    ProjectCycleSummary
		)
		if err := rows.Scan(
			&ticketID,
			&track.ID,
			&track.Key,
			&track.Name,
			&track.Position,
			&track.DisplayStyle,
			&track.ActivationPolicy,
			&cycle.ID,
			&cycle.ProjectID,
			&cycle.TrackID,
			&cycle.Name,
			&cycle.Goal,
			&cycle.Description,
			&cycle.State,
			&cycle.StartsAt,
			&cycle.EndsAt,
			&cycle.Position,
			&cycle.CompletedAt,
		); err != nil {
			return nil, err
		}
		cycle.Track = &track
		assignments[ticketID] = append(assignments[ticketID], TicketCycleAssignment{
			Track: track,
			Cycle: cycle,
		})
	}
	return assignments, rows.Err()
}

func applyTicketCycleAssignments(tickets []TicketSummary, assignments map[uuid.UUID][]TicketCycleAssignment) []TicketSummary {
	if len(tickets) == 0 {
		return tickets
	}
	out := make([]TicketSummary, 0, len(tickets))
	for _, ticket := range tickets {
		ticket.CycleAssignments = assignments[ticket.ID]
		out = append(out, ticket)
	}
	return out
}

func validateCycleAssignments(ctx context.Context, q queryer, projectID uuid.UUID, assignments []TicketCycleAssignmentInput) ([]TicketCycleAssignment, error) {
	if len(assignments) == 0 {
		return []TicketCycleAssignment{}, nil
	}
	cycleIDs := make([]uuid.UUID, 0, len(assignments))
	for _, assignment := range assignments {
		cycleIDs = append(cycleIDs, assignment.CycleID)
	}

	rows, err := q.Query(ctx, listCycleAssignmentsForCycleValidation, projectID, cycleIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	validatedByCycleID := make(map[uuid.UUID]cycleValidationRow, len(assignments))
	for rows.Next() {
		var row cycleValidationRow
		if err := rows.Scan(
			&row.Cycle.ID,
			&row.Cycle.ProjectID,
			&row.Cycle.TrackID,
			&row.Cycle.Name,
			&row.Cycle.Goal,
			&row.Cycle.Description,
			&row.Cycle.State,
			&row.Cycle.StartsAt,
			&row.Cycle.EndsAt,
			&row.Cycle.Position,
			&row.Cycle.CompletedAt,
			&row.Track.ID,
			&row.Track.Key,
			&row.Track.Name,
			&row.Track.Position,
			&row.Track.DisplayStyle,
			&row.Track.ActivationPolicy,
			&row.Track.MaxAssignmentsPerTicket,
			&row.Track.ColorToken,
		); err != nil {
			return nil, err
		}
		row.Cycle.Track = &ProjectCycleTrackRef{
			ID:               row.Track.ID,
			Key:              row.Track.Key,
			Name:             row.Track.Name,
			Position:         row.Track.Position,
			DisplayStyle:     row.Track.DisplayStyle,
			ActivationPolicy: row.Track.ActivationPolicy,
		}
		validatedByCycleID[row.Cycle.ID] = row
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	validated := make([]TicketCycleAssignment, 0, len(assignments))
	seenTracks := make(map[uuid.UUID]struct{}, len(assignments))
	for _, assignment := range assignments {
		row, ok := validatedByCycleID[assignment.CycleID]
		if !ok {
			return nil, fmt.Errorf("cycle %s not found", assignment.CycleID)
		}
		if row.Track.ID != assignment.TrackID {
			return nil, fmt.Errorf("cycle %s does not belong to the selected track", row.Cycle.Name)
		}
		if row.Cycle.State == CycleStateCompleted || row.Cycle.State == CycleStateCanceled {
			return nil, fmt.Errorf("cycle %s is not assignable", row.Cycle.Name)
		}
		if _, exists := seenTracks[assignment.TrackID]; exists {
			return nil, errors.New("only one cycle assignment per track is allowed")
		}
		seenTracks[assignment.TrackID] = struct{}{}
		validated = append(validated, TicketCycleAssignment{
			Track: ProjectCycleTrackRef{
				ID:               row.Track.ID,
				Key:              row.Track.Key,
				Name:             row.Track.Name,
				Position:         row.Track.Position,
				DisplayStyle:     row.Track.DisplayStyle,
				ActivationPolicy: row.Track.ActivationPolicy,
			},
			Cycle: row.Cycle,
		})
	}
	return validated, nil
}

func replaceTicketCycleAssignments(ctx context.Context, tx execer, projectID uuid.UUID, ticketID uuid.UUID, nextInputs []TicketCycleAssignmentInput, currentUserID uuid.UUID, currentUserName string) error {
	currentAssignmentsMap, err := loadTicketCycleAssignmentsByTicket(ctx, tx, projectID, []uuid.UUID{ticketID})
	if err != nil {
		return err
	}
	currentAssignments := currentAssignmentsMap[ticketID]
	nextAssignments, err := validateCycleAssignments(ctx, tx, projectID, nextInputs)
	if err != nil {
		return err
	}

	currentByTrack := make(map[uuid.UUID]TicketCycleAssignment, len(currentAssignments))
	for _, assignment := range currentAssignments {
		currentByTrack[assignment.Track.ID] = assignment
	}
	nextByTrack := make(map[uuid.UUID]TicketCycleAssignment, len(nextAssignments))
	for _, assignment := range nextAssignments {
		nextByTrack[assignment.Track.ID] = assignment
	}

	if _, err := tx.Exec(ctx, deleteTicketCycleAssignments, ticketID); err != nil {
		return err
	}
	for _, assignment := range nextAssignments {
		if _, err := tx.Exec(ctx, insertTicketCycleAssignment, projectID, ticketID, assignment.Track.ID, assignment.Cycle.ID, currentUserID); err != nil {
			return err
		}
	}

	trackIDs := make(map[uuid.UUID]struct{}, len(currentByTrack)+len(nextByTrack))
	for trackID := range currentByTrack {
		trackIDs[trackID] = struct{}{}
	}
	for trackID := range nextByTrack {
		trackIDs[trackID] = struct{}{}
	}
	for trackID := range trackIDs {
		oldAssignment, hadOld := currentByTrack[trackID]
		newAssignment, hasNew := nextByTrack[trackID]
		oldName := ""
		newName := ""
		fieldName := "cycle_track"
		if hadOld {
			oldName = oldAssignment.Track.Name + ": " + oldAssignment.Cycle.Name
			fieldName = "cycle_" + oldAssignment.Track.Key
		}
		if hasNew {
			newName = newAssignment.Track.Name + ": " + newAssignment.Cycle.Name
			fieldName = "cycle_" + newAssignment.Track.Key
		}
		if oldName == newName {
			continue
		}
		if _, err := recordTicketActivityTx(
			ctx,
			tx,
			ticketID,
			projectID,
			"ticket_field_updated",
			stringPtr(fieldName),
			stringPtr(oldName),
			stringPtr(newName),
			currentUserID,
			currentUserName,
		); err != nil {
			return err
		}
	}
	return nil
}
