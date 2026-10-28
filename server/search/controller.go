package search

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type controller struct {
	search func(context.Context, uuid.UUID, string, int) ([]Result, error)
	actor  func(*http.Request) (uuid.UUID, bool)
}

func Router(service *Service) *chi.Mux {
	c := controller{search: service.Search, actor: func(r *http.Request) (uuid.UUID, bool) {
		user, err := core.GetUserInfo(r.Context())
		if err != nil || user.Id == "" {
			return uuid.Nil, false
		}
		id, err := uuid.Parse(user.AId)
		return id, err == nil && id != uuid.Nil
	}}
	r := chi.NewRouter()
	r.Get("/documents", c.documents)
	return r
}

func (c controller) documents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	actor, ok := c.actor(r)
	if !ok {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Authentication required")
		return
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid search query")
		return
	}
	query := strings.TrimSpace(values.Get("q"))
	if !utf8.ValidString(query) || utf8.RuneCountInString(query) < 2 || utf8.RuneCountInString(query) > 200 || strings.IndexFunc(query, unicode.IsControl) >= 0 {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Search must contain 2 to 200 characters")
		return
	}
	limit := 8
	if raw := values.Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 20 {
			core.SendFailedReponse(w, r, http.StatusBadRequest, "Limit must be between 1 and 20")
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	results, err := c.search(ctx, actor, query, limit)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusServiceUnavailable, "Search is temporarily unavailable")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, struct {
		Results []Result `json:"results"`
	}{results})
}
