package search

import (
	"context"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type candidate struct {
	PageID, DocID int64
	SpaceID       uuid.UUID
	UpdatedAt     time.Time
	Snippet       string
	Score         float32
}

type publication struct {
	PageID, DocID    int64
	SpaceID          uuid.UUID
	SpaceName, Title string
	UpdatedAt        time.Time
}

type repository struct{ source, target *pgxpool.Pool }

func (repo repository) candidates(ctx context.Context, query string, limit, offset int) ([]candidate, error) {
	prefix := keywordPrefix(query)
	if prefix == "" {
		return []candidate{}, nil
	}
	rows, err := repo.target.Query(ctx, searchCandidatesQuery, query, limit, offset, prefix)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]candidate, 0, limit)
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.PageID, &c.SpaceID, &c.DocID, &c.UpdatedAt, &c.Snippet, &c.Score); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

func (repo repository) publications(ctx context.Context, ids []int64) (map[int64]publication, error) {
	rows, err := repo.source.Query(ctx, currentPublicationsQuery, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[int64]publication)
	for rows.Next() {
		var p publication
		if err := rows.Scan(&p.PageID, &p.SpaceID, &p.SpaceName, &p.DocID, &p.Title, &p.UpdatedAt); err != nil {
			return nil, err
		}
		result[p.PageID] = p
	}
	return result, rows.Err()
}

// Build a literal final-token prefix. User input never becomes raw regex or a
// search parser expression. One-character final tokens use exact matching.
func keywordPrefix(query string) string {
	terms := strings.FieldsFunc(strings.ToLower(query), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
	if len(terms) == 0 {
		return ""
	}
	last := terms[len(terms)-1]
	prefix := regexp.QuoteMeta(last)
	if utf8.RuneCountInString(last) >= 2 {
		prefix += ".*"
	}
	return prefix
}
