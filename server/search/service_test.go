package search

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func fixture(id int64) (candidate, publication) {
	space := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	stamp := time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC)
	return candidate{PageID: id, DocID: id + 100, SpaceID: space, UpdatedAt: stamp, Snippet: "private body\ntext"},
		publication{PageID: id, DocID: id + 100, SpaceID: space, UpdatedAt: stamp, Title: "Current title", SpaceName: "Space"}
}

func TestSearchExcludesDeniedAndStalePublications(t *testing.T) {
	var candidates []candidate
	current := make(map[int64]publication)
	for id := int64(1); id <= 6; id++ {
		c, p := fixture(id)
		candidates = append(candidates, c)
		current[id] = p
	}
	// Deleted, unpublished and archived pages are absent from the source query.
	delete(current, 2)
	p := current[3]
	p.DocID++
	current[3] = p
	p = current[4]
	p.UpdatedAt = p.UpdatedAt.Add(time.Second)
	current[4] = p
	p = current[5]
	p.SpaceID = uuid.New()
	current[5] = p
	checked := []int64{}
	s := Service{
		candidates:   func(context.Context, string, int, int) ([]candidate, error) { return candidates, nil },
		publications: func(context.Context, []int64) (map[int64]publication, error) { return current, nil },
		canView: func(_ context.Context, id int64, _ uuid.UUID) (bool, error) {
			checked = append(checked, id)
			return id == 6, nil
		},
	}
	result, err := s.Search(context.Background(), uuid.New(), "private", 8)
	if err != nil || len(result) != 1 || result[0].PageID != 6 || result[0].Title != "Current title" || result[0].Snippet != "private body text" {
		t.Fatalf("unexpected authorized result: %v", err)
	}
	if len(checked) != 2 || checked[0] != 1 || checked[1] != 6 {
		t.Fatalf("stale publications reached authorization: %v", checked)
	}
}

func TestSearchContinuesPastDeniedFirstBatch(t *testing.T) {
	calls := 0
	s := Service{
		candidates: func(_ context.Context, _ string, limit, offset int) ([]candidate, error) {
			calls++
			var items []candidate
			for id := int64(offset + 1); id <= int64(offset+limit); id++ {
				c, _ := fixture(id)
				items = append(items, c)
			}
			return items, nil
		},
		publications: func(_ context.Context, ids []int64) (map[int64]publication, error) {
			items := map[int64]publication{}
			for _, id := range ids {
				_, p := fixture(id)
				items[id] = p
			}
			return items, nil
		},
		canView: func(_ context.Context, id int64, _ uuid.UUID) (bool, error) { return id > 40, nil },
	}
	results, err := s.Search(context.Background(), uuid.New(), "body", 2)
	if err != nil || len(results) != 2 || results[0].PageID != 41 || calls != 2 {
		t.Fatal("did not fill results after filtering denied documents")
	}
}

func TestSearchFailsClosedOnAuthorizationFailure(t *testing.T) {
	c1, p1 := fixture(1)
	c2, p2 := fixture(2)
	s := Service{
		candidates: func(context.Context, string, int, int) ([]candidate, error) { return []candidate{c1, c2}, nil },
		publications: func(context.Context, []int64) (map[int64]publication, error) {
			return map[int64]publication{1: p1, 2: p2}, nil
		},
		canView: func(_ context.Context, id int64, _ uuid.UUID) (bool, error) {
			if id == 2 {
				return false, errors.New("private provider detail")
			}
			return true, nil
		},
	}
	results, err := s.Search(context.Background(), uuid.New(), "body", 8)
	if !errors.Is(err, errUnavailable) || results != nil {
		t.Fatal("authorization failure exposed partial results")
	}
}

func TestSearchBoundsDeniedCandidateScan(t *testing.T) {
	calls := 0
	s := Service{
		candidates: func(_ context.Context, _ string, limit, offset int) ([]candidate, error) {
			calls++
			items := []candidate{}
			for i := 0; i < limit; i++ {
				c, _ := fixture(int64(offset + i + 1))
				items = append(items, c)
			}
			return items, nil
		},
		publications: func(_ context.Context, ids []int64) (map[int64]publication, error) {
			out := map[int64]publication{}
			for _, id := range ids {
				_, p := fixture(id)
				out[id] = p
			}
			return out, nil
		},
		canView: func(context.Context, int64, uuid.UUID) (bool, error) { return false, nil },
	}
	results, err := s.Search(context.Background(), uuid.New(), "body", 8)
	if err != nil || len(results) != 0 || calls != 5 {
		t.Fatal("candidate work was not bounded")
	}
}

func TestSearchRejectsUnavailableInvalidAndCanceledRequests(t *testing.T) {
	s := NewService(nil, nil)
	if _, err := s.Search(context.Background(), uuid.New(), "body", 8); !errors.Is(err, errUnavailable) {
		t.Fatal("missing search dependencies did not fail closed")
	}
	for _, limit := range []int{-1, 0, 21} {
		if _, err := s.Search(context.Background(), uuid.New(), "body", limit); err == nil {
			t.Fatal("invalid limit accepted")
		}
	}
	c, p := fixture(1)
	s = &Service{candidates: func(context.Context, string, int, int) ([]candidate, error) { return []candidate{c}, nil }, publications: func(context.Context, []int64) (map[int64]publication, error) { return map[int64]publication{1: p}, nil }, canView: func(context.Context, int64, uuid.UUID) (bool, error) { return true, nil }}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if results, err := s.Search(ctx, uuid.New(), "body", 8); !errors.Is(err, context.Canceled) || results != nil {
		t.Fatal("canceled request continued searching")
	}
	if _, err := s.Search(context.Background(), uuid.Nil, "body", 8); err == nil {
		t.Fatal("anonymous search accepted")
	}
}

func TestKeywordPrefixIsLiteral(t *testing.T) {
	for input, want := range map[string]string{"Project Roa": "roa.*", "report OR title:secret*": "secret.*", "c++": "c", "設計": "設計.*"} {
		if got := keywordPrefix(input); got != want {
			t.Fatalf("%q: %q != %q", input, got, want)
		}
	}
}

func TestPunctuationDoesNotQueryBackend(t *testing.T) {
	results, err := (repository{}).candidates(context.Background(), "!!!", 8, 0)
	if err != nil || len(results) != 0 {
		t.Fatal("punctuation-only search should not query the index")
	}
}

func TestSearchFailsClosedOnDatabaseFailure(t *testing.T) {
	for _, failSource := range []bool{false, true} {
		c, p := fixture(1)
		s := Service{
			candidates: func(context.Context, string, int, int) ([]candidate, error) {
				if !failSource {
					return nil, errors.New("private database error")
				}
				return []candidate{c}, nil
			},
			publications: func(context.Context, []int64) (map[int64]publication, error) {
				if failSource {
					return nil, errors.New("private source error")
				}
				return map[int64]publication{1: p}, nil
			},
			canView: func(context.Context, int64, uuid.UUID) (bool, error) {
				t.Fatal("authorization ran after database failure")
				return true, nil
			},
		}
		results, err := s.Search(context.Background(), uuid.New(), "body", 8)
		if !errors.Is(err, errUnavailable) || results != nil {
			t.Fatal("database failure did not fail closed")
		}
	}
}
