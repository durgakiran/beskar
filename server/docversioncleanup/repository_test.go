package docversioncleanup

import (
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestCandidateQueriesKeepRetentionSafetyPredicates(t *testing.T) {
	queries := map[string]string{
		"list candidates":     listCandidateVersionsQuery,
		"dry run impact":      dryRunImpactQuery,
		"lock prune batch":    lockNextPagePruneCandidatesQuery,
		"recheck prunability": isDocStillPrunableQuery,
	}

	for name, query := range queries {
		t.Run(name, func(t *testing.T) {
			assertContains(t, query, "lower(sub.status) = 'active'")
			assertContains(t, query, "s.deleted_at IS NULL")
			assertContains(t, query, "COALESCE(p.type, 'document') = 'document'")
			assertContains(t, query, "d.draft = 0")
			assertContains(t, query, "lp.doc_id IS NULL")

			limitJoins := strings.Count(query, "metric_key = 'document_history_retention_days'")
			if limitJoins == 0 {
				t.Fatal("expected document history retention plan limit join")
			}
			if got := strings.Count(query, "pl.limit_value > 0"); got != limitJoins {
				t.Fatalf("expected each retention limit join to validate positive value, got %d joins and %d validations", limitJoins, got)
			}
			if got := strings.Count(query, "pl.limit_unit = 'days'"); got != limitJoins {
				t.Fatalf("expected each retention limit join to validate day unit, got %d joins and %d validations", limitJoins, got)
			}
		})
	}
}

func TestCleanupDeletesOnlyPublishedDocReferencesAndPageDocMap(t *testing.T) {
	cleanupQueries := []string{
		deletePublishedDocAssetReferencesQuery,
		deletePageDocMapQuery,
	}
	for _, query := range cleanupQueries {
		if strings.Contains(query, "core.attachment") {
			t.Fatal("cleanup query must not delete attachment rows")
		}
		if strings.Contains(query, "core.image_asset") {
			t.Fatal("cleanup query must not delete image asset rows")
		}
	}

	assertContains(t, deletePublishedDocAssetReferencesQuery, "source_kind = 'published_doc'")
	assertContains(t, deletePageDocMapQuery, "DELETE FROM core.page_doc_map")
}

func TestRepositoryHelpers(t *testing.T) {
	if got := stringPtrIfNotEmpty(""); got != nil {
		t.Fatalf("expected empty string to return nil, got %q", *got)
	}
	if got := stringPtrIfNotEmpty("basic"); got == nil || *got != "basic" {
		t.Fatalf("expected non-empty string pointer, got %#v", got)
	}

	if got := splitPlanCodes(""); len(got) != 0 {
		t.Fatalf("expected empty plan code list, got %#v", got)
	}
	got := splitPlanCodes("basic,pro")
	if len(got) != 2 || got[0] != "basic" || got[1] != "pro" {
		t.Fatalf("unexpected plan codes %#v", got)
	}
}

func TestTimePtrIfValid(t *testing.T) {
	if got := timePtrIfValid(pgtype.Timestamptz{}); got != nil {
		t.Fatalf("expected invalid timestamptz to return nil, got %s", got)
	}

	now := time.Now().UTC()
	got := timePtrIfValid(pgtype.Timestamptz{Time: now, Valid: true})
	if got == nil || !got.Equal(now) {
		t.Fatalf("expected valid timestamptz pointer, got %#v", got)
	}
}

func TestMinPositive(t *testing.T) {
	tests := []struct {
		name string
		a    int
		b    int
		want int
	}{
		{name: "both positive", a: 10, b: 3, want: 3},
		{name: "first invalid", a: 0, b: 3, want: 3},
		{name: "second invalid", a: 10, b: -1, want: 10},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := minPositive(tt.a, tt.b); got != tt.want {
				t.Fatalf("expected %d, got %d", tt.want, got)
			}
		})
	}
}

func assertContains(t *testing.T, value string, substring string) {
	t.Helper()
	if !strings.Contains(value, substring) {
		t.Fatalf("expected query to contain %q", substring)
	}
}
