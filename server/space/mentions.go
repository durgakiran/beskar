package space

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	payload "buf.build/gen/go/permifyco/permify/protocolbuffers/go/base/v1"
	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

var (
	errMentionForbidden     = errors.New("mention directory access denied")
	errMentionNotFound      = errors.New("mention user unavailable")
	errMentionSpaceNotFound = errors.New("mention space unavailable")
)

type MentionUser struct {
	ID        string  `json:"id"`
	Label     string  `json:"label"`
	Email     string  `json:"email"`
	AvatarURL *string `json:"avatarUrl"`
}

type MentionUserDetails struct {
	MentionUser
	SpaceRole string `json:"spaceRole"`
}

type MentionUserSearchResponse struct {
	Users   []MentionUser `json:"users"`
	HasMore bool          `json:"hasMore"`
}

type mentionSearch struct {
	query  string
	limit  int
	offset uint64
}

func parseMentionSearch(values url.Values) (mentionSearch, error) {
	req := mentionSearch{query: strings.TrimSpace(values.Get("query")), limit: 10}
	if !utf8.ValidString(req.query) || utf8.RuneCountInString(req.query) > 200 {
		return req, errors.New("invalid query")
	}
	for _, key := range []string{"query", "limit", "offset"} {
		if len(values[key]) > 1 {
			return req, errors.New("duplicate query parameter")
		}
	}
	if values.Has("limit") {
		limit, err := strconv.ParseUint(values.Get("limit"), 10, 32)
		if err != nil || limit == 0 {
			return req, errors.New("invalid limit")
		}
		if limit > 50 {
			limit = 50
		}
		req.limit = int(limit)
	}
	if values.Has("offset") {
		offset, err := strconv.ParseUint(values.Get("offset"), 10, 64)
		if err != nil {
			return req, errors.New("invalid offset")
		}
		req.offset = offset
	}
	return req, nil
}

// Per-service dependencies allow HTTP tests without global replacements or live
// identity and permission servers.
type mentionService struct {
	members    func(context.Context, uuid.UUID) (map[string]string, error)
	identities func(context.Context, []string) ([]core.ZitaUser, error)
	profiles   func(context.Context, []string) ([]core.User, error)
}

func (s mentionService) users(ctx context.Context, spaceID, actorID uuid.UUID, targetID string) ([]MentionUserDetails, error) {
	roles, err := s.members(ctx, spaceID)
	if err != nil {
		return nil, err
	}
	if _, ok := roles[actorID.String()]; !ok {
		return nil, errMentionForbidden
	}
	ids := make([]string, 0, len(roles))
	if targetID != "" {
		if _, ok := roles[targetID]; !ok {
			return nil, errMentionNotFound
		}
		ids = append(ids, targetID)
	} else {
		for id := range roles {
			ids = append(ids, id)
		}
		sort.Strings(ids)
	}
	return s.profilesForIDs(ctx, roles, ids)
}

// ResolveMentionRecipients is for trusted publication code after its edit check.
// It resolves only the supplied IDs that currently belong to this space.
func ResolveMentionRecipients(ctx context.Context, spaceID, actorID uuid.UUID, targets []uuid.UUID) ([]MentionUserDetails, error) {
	service := mentionService{members: loadMentionRoles, identities: core.GetZitaIdsContext, profiles: core.SearchMentionUsersByIds}
	roles, err := service.members(ctx, spaceID)
	if err != nil {
		return nil, err
	}
	if _, ok := roles[actorID.String()]; !ok {
		return nil, errMentionForbidden
	}
	ids := make([]string, 0, len(targets))
	for _, id := range targets {
		if _, ok := roles[id.String()]; ok {
			ids = append(ids, id.String())
		}
	}
	return service.profilesForIDs(ctx, roles, ids)
}

func (s mentionService) profilesForIDs(ctx context.Context, roles map[string]string, ids []string) ([]MentionUserDetails, error) {
	if len(ids) == 0 {
		return []MentionUserDetails{}, nil
	}
	allowed := make(map[string]bool, len(ids))
	for _, id := range ids {
		allowed[id] = true
	}
	mappings, err := s.identities(ctx, ids)
	if err != nil {
		return nil, err
	}
	directoryToLocal := make(map[string]string)
	directoryIDs := make([]string, 0, len(mappings))
	for _, mapping := range mappings {
		if _, ok := roles[mapping.UserId]; !ok || !allowed[mapping.UserId] || mapping.Id == "" {
			continue
		}
		directoryToLocal[mapping.Id] = mapping.UserId
		directoryIDs = append(directoryIDs, mapping.Id)
	}
	profiles, err := s.profiles(ctx, directoryIDs)
	if err != nil {
		return nil, err
	}
	users := make([]MentionUserDetails, 0, len(profiles))
	seen := make(map[string]bool)
	for _, profile := range profiles {
		id, ok := directoryToLocal[profile.UserId]
		if !ok || seen[id] {
			continue
		}
		if !profile.IsActiveHuman() {
			continue
		}
		label := strings.TrimSpace(profile.Human.Profile.DisplayName)
		if label == "" {
			label = strings.TrimSpace(profile.Human.Profile.GivenName + " " + profile.Human.Profile.FamilyName)
		}
		email := strings.TrimSpace(profile.Human.Email.Email)
		if label == "" {
			label = email
		}
		if label == "" {
			continue
		}
		var avatarURL *string
		if raw := strings.TrimSpace(profile.Human.Profile.AvatarURL); raw != "" {
			if parsed, err := url.Parse(raw); err == nil && (parsed.Scheme == "https" || parsed.Scheme == "http") && parsed.Host != "" && parsed.User == nil {
				avatarURL = &raw
			}
		}
		users = append(users, MentionUserDetails{MentionUser: MentionUser{ID: id, Label: label, Email: email, AvatarURL: avatarURL}, SpaceRole: roles[id]})
		seen[id] = true
	}
	return users, nil
}

func (s mentionService) search(ctx context.Context, spaceID, actorID uuid.UUID, req mentionSearch) (MentionUserSearchResponse, error) {
	users, err := s.users(ctx, spaceID, actorID, "")
	if err != nil {
		return MentionUserSearchResponse{}, err
	}
	query := strings.ToLower(req.query)
	matches := make([]MentionUser, 0)
	for _, user := range users {
		if strings.Contains(strings.ToLower(user.Label), query) || strings.Contains(strings.ToLower(user.Email), query) {
			matches = append(matches, user.MentionUser)
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		left, right := strings.ToLower(matches[i].Label), strings.ToLower(matches[j].Label)
		if left == right {
			return matches[i].ID < matches[j].ID
		}
		return left < right
	})
	result := MentionUserSearchResponse{Users: []MentionUser{}}
	if req.offset >= uint64(len(matches)) {
		return result, nil
	}
	start := int(req.offset)
	end := start + req.limit
	if end > len(matches) {
		end = len(matches)
	}
	result.Users = matches[start:end]
	result.HasMore = end < len(matches)
	return result, nil
}

// Only direct user relations representing current membership qualify. Follow
// every permission-server page and ignore invitation/unrelated subjects.
func readMentionRoles(ctx context.Context, spaceID uuid.UUID, read func(context.Context, *payload.RelationshipReadRequest) (*payload.RelationshipReadResponse, error)) (map[string]string, error) {
	roles := make(map[string]string)
	req := &payload.RelationshipReadRequest{TenantId: "t1", Metadata: &payload.RelationshipReadRequestMetadata{}, PageSize: 100,
		Filter: &payload.TupleFilter{Entity: &payload.EntityFilter{Type: "space", Ids: []string{spaceID.String()}}}}
	tokens := make(map[string]bool)
	for {
		response, err := read(ctx, req)
		if err != nil {
			return nil, err
		}
		if response == nil {
			return nil, errors.New("empty membership response")
		}
		for _, tuple := range response.Tuples {
			if tuple == nil || tuple.Entity == nil || tuple.Subject == nil || tuple.Entity.Type != "space" || tuple.Entity.Id != spaceID.String() || tuple.Subject.Type != "user" || tuple.Subject.Relation != "" || roleWeight(tuple.Relation) < 0 {
				continue
			}
			id, err := uuid.Parse(tuple.Subject.Id)
			if err != nil {
				continue
			}
			role := normalizeRole(tuple.Relation)
			previous, ok := roles[id.String()]
			if !ok || roleWeight(role) > roleWeight(previous) {
				roles[id.String()] = role
			}
		}
		token := response.ContinuousToken
		if token == "" {
			return roles, nil
		}
		if tokens[token] {
			return nil, errors.New("repeated membership page token")
		}
		tokens[token] = true
		req.ContinuousToken = token
	}
}

func loadMentionRoles(ctx context.Context, spaceID uuid.UUID) (map[string]string, error) {
	var exists bool
	if err := core.GetPool().QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM core.space WHERE id = $1 AND deleted_at IS NULL)", spaceID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, errMentionSpaceNotFound
	}
	return readMentionRoles(ctx, spaceID, func(ctx context.Context, req *payload.RelationshipReadRequest) (*payload.RelationshipReadResponse, error) {
		return core.GetPermifyInstance().Data.ReadRelationships(ctx, req)
	})
}

type mentionAPI struct {
	service mentionService
	actor   func(*http.Request) (uuid.UUID, bool)
	canView func(uuid.UUID, uuid.UUID) (bool, error)
}

func registerMentionRoutes(r chi.Router) {
	api := mentionAPI{
		service: mentionService{members: loadMentionRoles, identities: core.GetZitaIdsContext, profiles: core.SearchMentionUsersByIds},
		actor:   func(r *http.Request) (uuid.UUID, bool) { _, id, ok := currentUser(r); return id, ok },
		canView: func(spaceID, actorID uuid.UUID) (bool, error) {
			return core.CheckPermission("space", spaceID.String(), "user", actorID.String(), core.SPACE_VIEW)
		},
	}
	api.register(r)
}

func (api mentionAPI) register(r chi.Router) {
	r.Get("/{spaceId}/mentions/users", api.search)
	r.Get("/{spaceId}/mentions/users/{userId}", api.detail)
}

func mentionError(w http.ResponseWriter, r *http.Request, status int) {
	code := core.ErrorCode_ERROR_CODE_UNSPECIFIED
	switch status {
	case http.StatusBadRequest:
		code = core.ErrorCode_ERROR_CODE_INVALID_INPUT
	case http.StatusUnauthorized, http.StatusForbidden:
		code = core.ErrorCode_ERROR_CODE_UNAUTHORIZED
	case http.StatusNotFound:
		code = core.ErrorCode_ERROR_CODE_NO_DATA
	}
	core.SendFailedReponse(w, r, status, core.ErrorCode_name[code])
}

func (api mentionAPI) authorize(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	w.Header().Set("Cache-Control", "private, no-store")
	actorID, ok := api.actor(r)
	if !ok {
		mentionError(w, r, http.StatusUnauthorized)
		return uuid.Nil, uuid.Nil, false
	}
	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		mentionError(w, r, http.StatusBadRequest)
		return uuid.Nil, uuid.Nil, false
	}
	allowed, err := api.canView(spaceID, actorID)
	if err != nil {
		mentionError(w, r, http.StatusServiceUnavailable)
		return uuid.Nil, uuid.Nil, false
	}
	if !allowed {
		mentionError(w, r, http.StatusForbidden)
		return uuid.Nil, uuid.Nil, false
	}
	return spaceID, actorID, true
}

func mentionServiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errMentionForbidden):
		mentionError(w, r, http.StatusForbidden)
	case errors.Is(err, errMentionNotFound), errors.Is(err, errMentionSpaceNotFound):
		mentionError(w, r, http.StatusNotFound)
	default:
		mentionError(w, r, http.StatusServiceUnavailable)
	}
}

func (api mentionAPI) search(w http.ResponseWriter, r *http.Request) {
	spaceID, actorID, ok := api.authorize(w, r)
	if !ok {
		return
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		mentionError(w, r, http.StatusBadRequest)
		return
	}
	req, err := parseMentionSearch(values)
	if err != nil {
		mentionError(w, r, http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	result, err := api.service.search(ctx, spaceID, actorID, req)
	if err != nil {
		mentionServiceError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func (api mentionAPI) detail(w http.ResponseWriter, r *http.Request) {
	spaceID, actorID, ok := api.authorize(w, r)
	if !ok {
		return
	}
	userID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		mentionError(w, r, http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	users, err := api.service.users(ctx, spaceID, actorID, userID.String())
	if err != nil {
		mentionServiceError(w, r, err)
		return
	}
	if len(users) == 0 {
		mentionError(w, r, http.StatusNotFound)
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, users[0])
}
