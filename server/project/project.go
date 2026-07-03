package project

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func currentUserDisplayName(user core.UserInfo) string {
	reporterName := strings.TrimSpace(user.Name)
	if reporterName == "" {
		reporterName = strings.TrimSpace(user.Username)
	}
	if reporterName == "" {
		reporterName = strings.TrimSpace(user.Email)
	}
	return reporterName
}

func currentUser(ctx context.Context) (core.UserInfo, uuid.UUID, bool) {
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		return user, uuid.Nil, false
	}
	userID, err := uuid.Parse(user.AId)
	if err != nil {
		return user, uuid.Nil, false
	}
	return user, userID, true
}

func ensureMutableSpace(w http.ResponseWriter, r *http.Request, spaceID uuid.UUID) bool {
	err := core.ValidateSpaceMutable(spaceID)
	if err == nil {
		return true
	}
	if err.Error() == "space has been deleted" {
		core.SendFailedReponse(w, r, http.StatusNotFound, err.Error())
		return false
	}
	if err.Error() == "space is archived" {
		core.SendFailedReponse(w, r, http.StatusForbidden, "This space is archived and read-only")
		return false
	}
	core.SendFailedReponse(w, r, http.StatusInternalServerError, "Unable to validate space state")
	return false
}

func projectTicketFilterFromRequest(r *http.Request) TicketFilter {
	filter := TicketFilter{
		Search:            strings.TrimSpace(r.URL.Query().Get("search")),
		Status:            normalizeTicketStatus(r.URL.Query().Get("status")),
		Type:              normalizeTicketType(r.URL.Query().Get("type")),
		Sort:              normalizeTicketSort(r.URL.Query().Get("sort")),
		Label:             strings.TrimSpace(r.URL.Query().Get("label")),
		Mine:              strings.EqualFold(r.URL.Query().Get("mine"), "true"),
		LeafOnly:          strings.EqualFold(r.URL.Query().Get("leafOnly"), "true"),
		CycleTrackFilters: make(map[uuid.UUID]uuid.UUID),
		Unplanned:         strings.EqualFold(r.URL.Query().Get("unplanned"), "true"),
	}
	if assignee := strings.TrimSpace(r.URL.Query().Get("assignee")); assignee != "" {
		if assigneeID, err := uuid.Parse(assignee); err == nil {
			filter.AssigneeUserID = &assigneeID
		}
	}
	if reporter := strings.TrimSpace(r.URL.Query().Get("reporter")); reporter != "" {
		if reporterID, err := uuid.Parse(reporter); err == nil {
			filter.ReporterUserID = &reporterID
		}
	}
	if parent := strings.TrimSpace(r.URL.Query().Get("parent")); parent != "" {
		if parentID, err := uuid.Parse(parent); err == nil {
			filter.ParentTicketID = &parentID
		}
	}
	if root := strings.TrimSpace(r.URL.Query().Get("root")); root != "" {
		if rootID, err := uuid.Parse(root); err == nil {
			filter.RootTicketID = &rootID
		}
	}
	if updatedAfter := strings.TrimSpace(r.URL.Query().Get("updatedAfter")); updatedAfter != "" {
		if parsed, err := time.Parse(time.RFC3339, updatedAfter); err == nil {
			filter.UpdatedAfter = &parsed
		}
	}
	if dueBefore := strings.TrimSpace(r.URL.Query().Get("dueBefore")); dueBefore != "" {
		if parsed, err := time.Parse("2006-01-02", dueBefore); err == nil {
			normalized := parsed.UTC()
			filter.DueBefore = &normalized
		}
	}
	for key, values := range r.URL.Query() {
		if !strings.HasPrefix(key, "cycleTrack_") || len(values) == 0 {
			continue
		}
		trackID, err := uuid.Parse(strings.TrimPrefix(key, "cycleTrack_"))
		if err != nil {
			continue
		}
		cycleID, err := uuid.Parse(strings.TrimSpace(values[0]))
		if err != nil {
			continue
		}
		filter.CycleTrackFilters[trackID] = cycleID
	}
	for key, values := range r.URL.Query() {
		if !strings.HasPrefix(key, "unplannedTrack_") || len(values) == 0 {
			continue
		}
		if !strings.EqualFold(values[0], "true") {
			continue
		}
		trackID, err := uuid.Parse(strings.TrimPrefix(key, "unplannedTrack_"))
		if err != nil {
			continue
		}
		filter.UnplannedTrackIDs = append(filter.UnplannedTrackIDs, trackID)
	}
	return filter
}

func cycleFilterFromRequest(r *http.Request) CycleFilter {
	filter := CycleFilter{
		State:         strings.TrimSpace(r.URL.Query().Get("state")),
		IncludeCounts: !strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("includeCounts")), "false"),
	}
	if trackIDValue := strings.TrimSpace(r.URL.Query().Get("trackId")); trackIDValue != "" {
		if trackID, err := uuid.Parse(trackIDValue); err == nil {
			filter.TrackID = &trackID
		}
	}
	return filter
}

func activityRangeFromRequest(r *http.Request) (*time.Time, int, error) {
	var after *time.Time
	if rawAfter := strings.TrimSpace(r.URL.Query().Get("after")); rawAfter != "" {
		parsed, err := time.Parse(time.RFC3339, rawAfter)
		if err != nil {
			return nil, 0, err
		}
		after = &parsed
	}

	limit := 25
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, err := strconv.Atoi(rawLimit)
		if err != nil {
			return nil, 0, err
		}
		limit = parsedLimit
	}
	return after, limit, nil
}

func createProjectPageHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	if !core.ValidateUserSpacePermissions(spaceID, userID, core.SPACE_EDIT_PAGE) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Not enough permissions to add project to space")
		return
	}
	if !ensureMutableSpace(w, r, spaceID) {
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}
	defer r.Body.Close()

	req, err := validateCreateProjectPage(body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	pageID, err := CreateProjectPage(r.Context(), spaceID, userID, req)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not create project")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusCreated, CreateProjectPageResponse{Page: pageID})
}

func getProjectPageViewHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}

	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}

	view, err := GetProjectPageView(r.Context(), pageID, spaceID, userID)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Project not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not load project")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, view)
}

func listProjectTicketsHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}

	filter := projectTicketFilterFromRequest(r)
	tickets, err := ListProjectTickets(r.Context(), pageID, spaceID, userID, filter)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Project not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not load project tickets")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, tickets)
}

func listProjectActivityHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}
	after, limit, err := activityRangeFromRequest(r)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid activity query")
		return
	}

	activity, err := ListProjectActivity(r.Context(), pageID, spaceID, after, limit)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Project not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not load project activity")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, activity)
}

func listProjectCycleTracksHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}

	response, err := ListProjectCycleTracks(r.Context(), pageID, spaceID, userID)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Project not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not load project cycle tracks")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, response)
}

func listProjectCyclesHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}

	response, err := ListProjectCycles(r.Context(), pageID, spaceID, userID, cycleFilterFromRequest(r))
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Project not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not load project cycles")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, response)
}

func createProjectCycleHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_EDIT) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	if !ensureMutableSpace(w, r, spaceID) {
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}
	defer r.Body.Close()

	req, err := validateCreateCycle(body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	cycle, err := CreateProjectCycle(r.Context(), pageID, spaceID, userID, req)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Track or project not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusCreated, cycle)
}

func updateProjectCycleHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_EDIT) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	if !ensureMutableSpace(w, r, spaceID) {
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}
	cycleID, err := uuid.Parse(chi.URLParam(r, "cycleId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid cycle id")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}
	defer r.Body.Close()

	req, err := validateUpdateCycle(body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	cycle, err := UpdateProjectCycle(r.Context(), pageID, spaceID, cycleID, userID, req)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") || strings.Contains(err.Error(), "not found") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Cycle not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, cycle)
}

func listProjectEventsHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}
	after, limit, err := activityRangeFromRequest(r)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid event query")
		return
	}

	events, err := ListProjectEvents(r.Context(), pageID, spaceID, after, limit)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Project not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not load project events")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, events)
}

func bulkUpdateProjectTicketsHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_EDIT) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	if !ensureMutableSpace(w, r, spaceID) {
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}
	defer r.Body.Close()

	req, err := validateBulkUpdateTicket(body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	result, err := BulkUpdateProjectTickets(r.Context(), pageID, spaceID, userID, currentUserDisplayName(user), req)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func createProjectTicketHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_EDIT) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	if !ensureMutableSpace(w, r, spaceID) {
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}
	defer r.Body.Close()

	req, err := validateCreateTicket(body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	reporterName := currentUserDisplayName(user)
	ticket, err := CreateProjectTicket(r.Context(), pageID, spaceID, userID, reporterName, req)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Project or parent ticket not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	core.SendSuccessResponse(w, r, http.StatusCreated, ticket)
}

func getProjectTicketHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}
	ticketID, err := uuid.Parse(chi.URLParam(r, "ticketId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid ticket id")
		return
	}

	ticket, err := GetProjectTicket(r.Context(), pageID, spaceID, ticketID)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Ticket not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not load ticket")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, ticket)
}

func updateProjectTicketHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}
	_ = user

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_EDIT) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	if !ensureMutableSpace(w, r, spaceID) {
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}
	ticketID, err := uuid.Parse(chi.URLParam(r, "ticketId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid ticket id")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}
	defer r.Body.Close()

	req, err := validateUpdateTicket(body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	ticket, err := UpdateProjectTicket(r.Context(), pageID, spaceID, ticketID, userID, currentUserDisplayName(user), req)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Ticket not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, ticket)
}

func createProjectTicketCommentHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_ADD_COMMENT) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	if !ensureMutableSpace(w, r, spaceID) {
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}
	ticketID, err := uuid.Parse(chi.URLParam(r, "ticketId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid ticket id")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}
	defer r.Body.Close()

	req, err := validateCreateTicketComment(body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	comment, err := CreateProjectTicketComment(r.Context(), pageID, spaceID, ticketID, userID, currentUserDisplayName(user), req.Body)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Ticket not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusCreated, comment)
}

func attachProjectTicketAttachmentHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_EDIT) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	if !ensureMutableSpace(w, r, spaceID) {
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}
	ticketID, err := uuid.Parse(chi.URLParam(r, "ticketId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid ticket id")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Failed to read request body")
		return
	}
	defer r.Body.Close()

	req, err := validateAttachTicketAttachment(body)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}

	attachments, err := AttachProjectTicketAttachment(r.Context(), pageID, spaceID, ticketID, req.AttachmentID, userID, currentUserDisplayName(user))
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Ticket or attachment not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusCreated, attachments)
}

func deleteProjectTicketAttachmentHandler(w http.ResponseWriter, r *http.Request) {
	user, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_EDIT) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	if !ensureMutableSpace(w, r, spaceID) {
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}
	ticketID, err := uuid.Parse(chi.URLParam(r, "ticketId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid ticket id")
		return
	}

	attachments, err := RemoveProjectTicketAttachment(r.Context(), pageID, spaceID, ticketID, chi.URLParam(r, "attachmentId"), userID, currentUserDisplayName(user))
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Ticket not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, attachments)
}

func exportProjectTicketsCSVHandler(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}

	filter := projectTicketFilterFromRequest(r)
	data, err := ExportProjectTicketsCSV(r.Context(), pageID, spaceID, userID, filter)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not export project tickets")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"project-tickets.csv\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func exportProjectTicketsJSONHandler(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := currentUser(r.Context())
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid space id")
		return
	}
	pageIDStr := chi.URLParam(r, "pageId")
	if !core.ValidateUserPagePermission(pageIDStr, userID, core.PAGE_VIEW) {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Invalid space permissions")
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid page id")
		return
	}

	filter := projectTicketFilterFromRequest(r)
	data, err := ExportProjectTicketsJSON(r.Context(), pageID, spaceID, userID, filter)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Could not export project tickets")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"project-tickets.json\"")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Post("/space/{spaceId}/create", createProjectPageHandler)
	r.Get("/space/{spaceId}/page/{pageId}", getProjectPageViewHandler)
	r.Get("/space/{spaceId}/page/{pageId}/cycle-tracks", listProjectCycleTracksHandler)
	r.Get("/space/{spaceId}/page/{pageId}/cycles", listProjectCyclesHandler)
	r.Post("/space/{spaceId}/page/{pageId}/cycles", createProjectCycleHandler)
	r.Put("/space/{spaceId}/page/{pageId}/cycles/{cycleId}", updateProjectCycleHandler)
	r.Get("/space/{spaceId}/page/{pageId}/tickets", listProjectTicketsHandler)
	r.Get("/space/{spaceId}/page/{pageId}/activity", listProjectActivityHandler)
	r.Get("/space/{spaceId}/page/{pageId}/events", listProjectEventsHandler)
	r.Get("/space/{spaceId}/page/{pageId}/tickets/export.csv", exportProjectTicketsCSVHandler)
	r.Get("/space/{spaceId}/page/{pageId}/tickets/export.json", exportProjectTicketsJSONHandler)
	r.Post("/space/{spaceId}/page/{pageId}/tickets", createProjectTicketHandler)
	r.Post("/space/{spaceId}/page/{pageId}/tickets/bulk-update", bulkUpdateProjectTicketsHandler)
	r.Get("/space/{spaceId}/page/{pageId}/tickets/{ticketId}", getProjectTicketHandler)
	r.Put("/space/{spaceId}/page/{pageId}/tickets/{ticketId}", updateProjectTicketHandler)
	r.Post("/space/{spaceId}/page/{pageId}/tickets/{ticketId}/comments", createProjectTicketCommentHandler)
	r.Post("/space/{spaceId}/page/{pageId}/tickets/{ticketId}/attachments", attachProjectTicketAttachmentHandler)
	r.Delete("/space/{spaceId}/page/{pageId}/tickets/{ticketId}/attachments/{attachmentId}", deleteProjectTicketAttachmentHandler)
	return r
}
