package search

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var errUnavailable = errors.New("search unavailable")

// Result exposes only authorized current publications. No global totals or raw
// ranking scores are returned, since those may describe inaccessible documents.
type Result struct {
	PageID    int64     `json:"pageId"`
	SpaceID   uuid.UUID `json:"spaceId"`
	SpaceName string    `json:"spaceName"`
	Title     string    `json:"title"`
	Snippet   string    `json:"snippet"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Service struct {
	candidates   func(context.Context, string, int, int) ([]candidate, error)
	publications func(context.Context, []int64) (map[int64]publication, error)
	canView      func(context.Context, int64, uuid.UUID) (bool, error)
}

func NewService(source, target *pgxpool.Pool) *Service {
	service := &Service{}
	if source == nil || target == nil {
		return service
	}
	repo := repository{source, target}
	service.candidates = repo.candidates
	service.publications = repo.publications
	service.canView = func(ctx context.Context, page int64, user uuid.UUID) (bool, error) {
		return core.CheckPermissionContext(ctx, "page", strconv.FormatInt(page, 10), "user", user.String(), core.PAGE_VIEW)
	}
	return service
}

func (s *Service) Search(ctx context.Context, actor uuid.UUID, query string, limit int) ([]Result, error) {
	if limit < 1 || limit > 20 {
		return nil, errUnavailable
	}
	results := make([]Result, 0, limit)
	if actor == uuid.Nil || s.candidates == nil || s.publications == nil || s.canView == nil {
		return nil, errUnavailable
	}
	// Bound backend work for a dropdown. Continue past denied/stale hits instead
	// of filtering just the first result page. Never expose candidate counts.
	const batchSize, maxCandidates = 40, 200
	seen := make(map[int64]bool)
	for offset := 0; offset < maxCandidates; offset += batchSize {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		candidates, err := s.candidates(ctx, query, batchSize, offset)
		if err != nil {
			return nil, errUnavailable
		}
		if len(candidates) == 0 {
			break
		}
		ids := make([]int64, 0, len(candidates))
		for _, c := range candidates {
			ids = append(ids, c.PageID)
		}
		current, err := s.publications(ctx, ids)
		if err != nil {
			return nil, errUnavailable
		}
		for _, c := range candidates {
			p, eligible := current[c.PageID]
			if !eligible || seen[c.PageID] || p.DocID != c.DocID || p.SpaceID != c.SpaceID || !p.UpdatedAt.Equal(c.UpdatedAt) {
				continue
			}
			seen[c.PageID] = true
			allowed, err := s.canView(ctx, c.PageID, actor)
			if err != nil {
				return nil, errUnavailable
			}
			if !allowed {
				continue
			}
			results = append(results, Result{p.PageID, p.SpaceID, p.SpaceName, p.Title, strings.Join(strings.Fields(c.Snippet), " "), p.UpdatedAt.UTC()})
			if len(results) == limit {
				return results, nil
			}
		}
		if len(candidates) < batchSize {
			break
		}
	}
	return results, nil
}
