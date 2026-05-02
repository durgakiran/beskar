package docversioncleanup

import (
	"context"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const documentCleanupIntegrationEnv = "DOCUMENT_VERSION_CLEANUP_INTEGRATION_TESTS"

type documentCleanupFixture struct {
	AccountID uuid.UUID
	UserID    uuid.UUID
	PlanID    uuid.UUID
	SpaceID   uuid.UUID
	PageID    int64
	OwnerID   uuid.UUID
	PlanCode  string
}

func TestIntegrationPruneOldNonLatestPublishedVersion(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()
	fixture := createDocumentCleanupFixture(t, ctx, pool, 7)
	jobRunID := uuid.New()

	prunedDocID := insertDocumentVersion(t, ctx, pool, fixture.PageID, fixture.OwnerID, "old-pruned", 100*365*24*time.Hour, false)
	latestDocID := insertDocumentVersion(t, ctx, pool, fixture.PageID, fixture.OwnerID, "old-latest", 99*365*24*time.Hour, false)
	recentDocID := insertDocumentVersion(t, ctx, pool, fixture.PageID, fixture.OwnerID, "recent", 24*time.Hour, false)
	draftDocID := insertDocumentVersion(t, ctx, pool, fixture.PageID, fixture.OwnerID, "draft", 40*24*time.Hour, true)
	insertContentWithTextNode(t, ctx, pool, prunedDocID)
	insertAssetReference(t, ctx, pool, fixture.PageID, prunedDocID, "published_doc", prunedDocID)
	insertAssetReference(t, ctx, pool, fixture.PageID, prunedDocID, "comment_reply", 999999)
	insertAssetReference(t, ctx, pool, fixture.PageID, latestDocID, "published_doc", latestDocID)

	candidates, err := ListCandidateVersions(ctx, 7, 10)
	if err != nil {
		t.Fatalf("list candidates: %v", err)
	}
	if !containsCandidate(candidates, prunedDocID) {
		t.Fatalf("expected old non-latest doc %d to be a cleanup candidate", prunedDocID)
	}
	for _, docID := range []int64{latestDocID, recentDocID, draftDocID} {
		if containsCandidate(candidates, docID) {
			t.Fatalf("doc %d should not be a cleanup candidate", docID)
		}
	}

	result, err := PruneNextPageBatch(ctx, 7, 10, jobRunID)
	if err != nil {
		t.Fatalf("prune batch: %v", err)
	}
	if result.PrunedVersionCount != 1 {
		t.Fatalf("expected 1 pruned version, got %d", result.PrunedVersionCount)
	}
	if result.AssetReferenceRowsDeleted != 1 {
		t.Fatalf("expected 1 published-doc asset reference delete, got %d", result.AssetReferenceRowsDeleted)
	}

	assertDocumentDeleted(t, ctx, pool, prunedDocID)
	assertDocumentExists(t, ctx, pool, latestDocID)
	assertDocumentExists(t, ctx, pool, recentDocID)
	assertDocumentExists(t, ctx, pool, draftDocID)
	assertContentDeleted(t, ctx, pool, prunedDocID)
	assertAssetReferenceMissing(t, ctx, pool, "published_doc", prunedDocID)
	assertAssetReferenceExists(t, ctx, pool, "comment_reply", 999999)
	assertCleanupLog(t, ctx, pool, fixture, prunedDocID, jobRunID)
}

func TestIntegrationRetentionUsesActivePlanAndFallback(t *testing.T) {
	pool := integrationPool(t)
	ctx := context.Background()

	activeThirtyDay := createDocumentCleanupFixture(t, ctx, pool, 30)
	activeOldDocID := insertDocumentVersion(t, ctx, pool, activeThirtyDay.PageID, activeThirtyDay.OwnerID, "active-old", 20*24*time.Hour, false)
	insertDocumentVersion(t, ctx, pool, activeThirtyDay.PageID, activeThirtyDay.OwnerID, "active-latest", 10*24*time.Hour, false)

	fallback := createDocumentCleanupFixtureWithoutSubscription(t, ctx, pool)
	fallbackOldDocID := insertDocumentVersion(t, ctx, pool, fallback.PageID, fallback.OwnerID, "fallback-old", 20*24*time.Hour, false)
	insertDocumentVersion(t, ctx, pool, fallback.PageID, fallback.OwnerID, "fallback-latest", 10*24*time.Hour, false)

	candidates, err := ListCandidateVersions(ctx, 7, 50)
	if err != nil {
		t.Fatalf("list candidates: %v", err)
	}
	if containsCandidate(candidates, activeOldDocID) {
		t.Fatalf("active 30-day plan doc %d should not use fallback 7-day retention", activeOldDocID)
	}
	if !containsCandidate(candidates, fallbackOldDocID) {
		t.Fatalf("missing-subscription doc %d should use fallback 7-day retention", fallbackOldDocID)
	}
}

func integrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if strings.ToLower(strings.TrimSpace(os.Getenv(documentCleanupIntegrationEnv))) != "true" {
		t.Skipf("set %s=true to run document version cleanup DB integration tests", documentCleanupIntegrationEnv)
	}
	return core.GetPool()
}

func createDocumentCleanupFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, retentionDays int) documentCleanupFixture {
	t.Helper()
	fixture := createDocumentCleanupFixtureWithoutSubscription(t, ctx, pool)
	_, err := pool.Exec(ctx, `
INSERT INTO billing.account_subscription (account_id, plan_id, status, effective_from, source)
VALUES ($1, $2, 'active', now() - interval '1 day', 'document_version_cleanup_integration_test')`,
		fixture.AccountID,
		fixture.PlanID,
	)
	if err != nil {
		t.Fatalf("insert subscription: %v", err)
	}
	_, err = pool.Exec(ctx, `
INSERT INTO billing.plan_limit (plan_id, metric_key, limit_value, limit_unit, enforcement_mode)
VALUES ($1, 'document_history_retention_days', $2, 'days', 'cleanup')
ON CONFLICT (plan_id, metric_key) DO UPDATE
SET limit_value = EXCLUDED.limit_value,
    limit_unit = EXCLUDED.limit_unit,
    enforcement_mode = EXCLUDED.enforcement_mode`,
		fixture.PlanID,
		retentionDays,
	)
	if err != nil {
		t.Fatalf("insert retention plan limit: %v", err)
	}
	return fixture
}

func createDocumentCleanupFixtureWithoutSubscription(t *testing.T, ctx context.Context, pool *pgxpool.Pool) documentCleanupFixture {
	t.Helper()
	fixture := documentCleanupFixture{
		AccountID: uuid.New(),
		UserID:    uuid.New(),
		PlanID:    uuid.New(),
		OwnerID:   uuid.New(),
		PlanCode:  "dvc_test_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
	}

	_, err := pool.Exec(ctx, `INSERT INTO billing.account (id, user_id, status) VALUES ($1, $2, 'active')`, fixture.AccountID, fixture.UserID)
	if err != nil {
		t.Fatalf("insert account: %v", err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO billing.plan (id, code, display_name, is_active) VALUES ($1, $2, $3, true)`, fixture.PlanID, fixture.PlanCode, fixture.PlanCode)
	if err != nil {
		t.Fatalf("insert plan: %v", err)
	}
	err = pool.QueryRow(ctx, `
INSERT INTO core.space (name, user_id, account_id)
VALUES ($1, $2, $3)
RETURNING id`,
		fixture.PlanCode,
		fixture.UserID,
		fixture.AccountID,
	).Scan(&fixture.SpaceID)
	if err != nil {
		t.Fatalf("insert space: %v", err)
	}
	err = pool.QueryRow(ctx, `
INSERT INTO core.page (draft, space_id, owner_id, status, type)
VALUES (0, $1, $2, 0, 'document')
RETURNING id`,
		fixture.SpaceID,
		fixture.OwnerID,
	).Scan(&fixture.PageID)
	if err != nil {
		t.Fatalf("insert page: %v", err)
	}
	_, err = pool.Exec(ctx, `
INSERT INTO core.asset_reference_coverage (page_id, published_backfilled_at, draft_status, cleanup_eligible)
VALUES ($1, now(), 'indexed', true)`,
		fixture.PageID,
	)
	if err != nil {
		t.Fatalf("insert asset reference coverage: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM core.document_version_cleanup_log WHERE account_id = $1`, fixture.AccountID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM core.space WHERE id = $1`, fixture.SpaceID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM billing.account_subscription WHERE account_id = $1`, fixture.AccountID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM billing.account WHERE id = $1`, fixture.AccountID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM billing.plan WHERE id = $1`, fixture.PlanID)
	})

	return fixture
}

func insertDocumentVersion(t *testing.T, ctx context.Context, pool *pgxpool.Pool, pageID int64, ownerID uuid.UUID, title string, age time.Duration, draft bool) int64 {
	t.Helper()
	draftValue := int16(0)
	if draft {
		draftValue = 1
	}
	version := time.Now().UTC().Add(-age)
	var docID int64
	err := pool.QueryRow(ctx, `
INSERT INTO core.page_doc_map (page_id, title, version, owner_id, draft)
VALUES ($1, $2, $3, $4, $5)
RETURNING doc_id`,
		pageID,
		title,
		version,
		ownerID,
		draftValue,
	).Scan(&docID)
	if err != nil {
		t.Fatalf("insert document version: %v", err)
	}
	return docID
}

func insertContentWithTextNode(t *testing.T, ctx context.Context, pool *pgxpool.Pool, docID int64) {
	t.Helper()
	contentID := uuid.New()
	_, err := pool.Exec(ctx, `
INSERT INTO core.content (id, doc_id, parent_id, "order", type, attrs, marks)
VALUES ($1, $2, NULL, 0, 'paragraph', '{}'::jsonb, '[]'::jsonb)`,
		contentID,
		docID,
	)
	if err != nil {
		t.Fatalf("insert content: %v", err)
	}
	_, err = pool.Exec(ctx, `
INSERT INTO core.text_node (parent_id, doc_id, marks, "order", text)
VALUES ($1, $2, '[]'::jsonb, 0, 'text')`,
		contentID,
		docID,
	)
	if err != nil {
		t.Fatalf("insert text node: %v", err)
	}
}

func insertAssetReference(t *testing.T, ctx context.Context, pool *pgxpool.Pool, pageID int64, docID int64, sourceKind string, sourceID int64) {
	t.Helper()
	_, err := pool.Exec(ctx, `
INSERT INTO core.asset_reference (asset_type, asset_id, page_id, doc_id, source_kind, source_id)
VALUES ('image', $1, $2, $3, $4, $5)`,
		"asset-"+uuid.NewString(),
		pageID,
		docID,
		sourceKind,
		strconv.FormatInt(sourceID, 10),
	)
	if err != nil {
		t.Fatalf("insert asset reference: %v", err)
	}
}

func containsCandidate(candidates []CandidateVersion, docID int64) bool {
	for _, candidate := range candidates {
		if candidate.DocID == docID {
			return true
		}
	}
	return false
}

func assertDocumentDeleted(t *testing.T, ctx context.Context, pool *pgxpool.Pool, docID int64) {
	t.Helper()
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM core.page_doc_map WHERE doc_id = $1`, docID).Scan(&count); err != nil {
		t.Fatalf("count document rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected doc %d to be deleted, found %d rows", docID, count)
	}
}

func assertDocumentExists(t *testing.T, ctx context.Context, pool *pgxpool.Pool, docID int64) {
	t.Helper()
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM core.page_doc_map WHERE doc_id = $1`, docID).Scan(&count); err != nil {
		t.Fatalf("count document rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected doc %d to exist, found %d rows", docID, count)
	}
}

func assertContentDeleted(t *testing.T, ctx context.Context, pool *pgxpool.Pool, docID int64) {
	t.Helper()
	var contentRows int
	var textRows int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM core.content WHERE doc_id = $1`, docID).Scan(&contentRows); err != nil {
		t.Fatalf("count content rows: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM core.text_node WHERE doc_id = $1`, docID).Scan(&textRows); err != nil {
		t.Fatalf("count text node rows: %v", err)
	}
	if contentRows != 0 || textRows != 0 {
		t.Fatalf("expected cascaded content/text delete for doc %d, found content=%d text=%d", docID, contentRows, textRows)
	}
}

func assertAssetReferenceMissing(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sourceKind string, sourceID int64) {
	t.Helper()
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM core.asset_reference WHERE source_kind = $1 AND source_id = $2`, sourceKind, strconv.FormatInt(sourceID, 10)).Scan(&count); err != nil {
		t.Fatalf("count asset references: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected %s asset reference %d to be deleted, found %d rows", sourceKind, sourceID, count)
	}
}

func assertAssetReferenceExists(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sourceKind string, sourceID int64) {
	t.Helper()
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM core.asset_reference WHERE source_kind = $1 AND source_id = $2`, sourceKind, strconv.FormatInt(sourceID, 10)).Scan(&count); err != nil {
		t.Fatalf("count asset references: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected %s asset reference %d to remain, found %d rows", sourceKind, sourceID, count)
	}
}

func assertCleanupLog(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fixture documentCleanupFixture, docID int64, jobRunID uuid.UUID) {
	t.Helper()
	var accountID uuid.UUID
	var planID uuid.UUID
	var planCode string
	var retentionDays int
	err := pool.QueryRow(ctx, `
SELECT account_id, plan_id, plan_code, retention_days
FROM core.document_version_cleanup_log
WHERE doc_id = $1 AND job_run_id = $2`,
		docID,
		jobRunID,
	).Scan(&accountID, &planID, &planCode, &retentionDays)
	if err != nil {
		t.Fatalf("load cleanup log: %v", err)
	}
	if accountID != fixture.AccountID || planID != fixture.PlanID || planCode != fixture.PlanCode || retentionDays != 7 {
		t.Fatalf("unexpected cleanup log context: account=%s plan=%s code=%s retention=%d", accountID, planID, planCode, retentionDays)
	}
}
