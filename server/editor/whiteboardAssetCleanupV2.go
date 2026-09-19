package editor

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"
)

type whiteboardAssetCleanupResult struct{ Expired, Recovered, Deleted, Failed, Exhausted int }

// StartWhiteboardAssetCleanupV2 returns a shutdown channel. Durable jobs survive
// process exit; leases and bounded retries recover interrupted storage work.
func StartWhiteboardAssetCleanupV2(ctx context.Context) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		if value, err := strconv.ParseBool(os.Getenv("WHITEBOARD_ASSET_V2_CLEANUP_ENABLED")); err == nil && !value {
			return
		}
		interval := time.Minute
		if value, err := time.ParseDuration(os.Getenv("WHITEBOARD_ASSET_V2_CLEANUP_INTERVAL")); err == nil && value >= time.Second {
			interval = value
		}
		s := newWhiteboardAssetServiceV2()
		run := func() {
			result, err := s.cleanupAssetPass(ctx, 100, 8)
			if err != nil && ctx.Err() == nil {
				logWhiteboardV2Error("whiteboard v2 asset cleanup failed", err)
			}
			if core.Logger != nil && (result.Expired+result.Recovered+result.Deleted+result.Failed+result.Exhausted) > 0 {
				core.Logger.Info("whiteboard v2 asset cleanup", zap.Int("expired", result.Expired), zap.Int("recovered", result.Recovered), zap.Int("deleted", result.Deleted), zap.Int("failed", result.Failed), zap.Int("exhausted", result.Exhausted))
			}
		}
		if ctx.Err() != nil {
			return
		}
		run()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				run()
			}
		}
	}()
	return done
}

func (s *whiteboardAssetServiceV2) cleanupAssetPass(ctx context.Context, batch, maxAttempts int) (whiteboardAssetCleanupResult, error) {
	var result whiteboardAssetCleanupResult
	if batch < 1 || batch > 1000 || maxAttempts < 1 {
		return result, errors.New("invalid asset cleanup bounds")
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return result, err
	}
	rows, err := tx.Query(ctx, `SELECT u.id,u.page_id,p.space_id,u.actor_id FROM whiteboard.whiteboard_asset_upload u JOIN core.page p ON p.id=u.page_id JOIN core.space s ON s.id=p.space_id
        WHERE u.state IN ('prepared','staging','staged') AND (u.expires_at<=now() OR s.deleted_at IS NOT NULL OR (u.state='staging' AND u.lease_until<=now())) ORDER BY u.expires_at,u.id LIMIT $1`, batch)
	if err != nil {
		draftRollback(ctx, tx)
		return result, err
	}
	type candidate struct {
		ID uuid.UUID
		In whiteboardDraftInput
	}
	candidates := []candidate{}
	for rows.Next() {
		var item candidate
		if err = rows.Scan(&item.ID, &item.In.PageID, &item.In.SpaceID, &item.In.ActorID); err != nil {
			break
		}
		candidates = append(candidates, item)
	}
	rows.Close()
	if err == nil {
		err = rows.Err()
	}
	draftRollback(ctx, tx)
	if err != nil {
		return result, err
	}
	for _, item := range candidates {
		expired, recovered, err := s.recoverAssetUpload(ctx, item.In, item.ID)
		if errors.Is(err, errWhiteboardV2BoardNotFound) || errors.Is(err, errWhiteboardAssetNotFound) {
			continue
		}
		if err != nil {
			return result, err
		}
		if expired {
			result.Expired++
		}
		if recovered {
			result.Recovered++
		}
	}
	for i := 0; i < batch; i++ {
		if err = ctx.Err(); err != nil {
			return result, err
		}
		claimed, failed, exhausted, err := s.cleanupAssetObject(ctx, maxAttempts)
		result.Exhausted += exhausted
		if err != nil {
			return result, err
		}
		if !claimed {
			break
		}
		if failed {
			result.Failed++
		} else {
			result.Deleted++
		}
	}
	return result, nil
}

func (s *whiteboardAssetServiceV2) recoverAssetUpload(ctx context.Context, in whiteboardDraftInput, id uuid.UUID) (bool, bool, error) {
	tx, _, err := s.beginAsset(ctx, in, true)
	if err != nil {
		return false, false, err
	}
	defer draftRollback(ctx, tx)
	row, err := loadWhiteboardAssetUpload(ctx, tx, in, id)
	if err != nil {
		return false, false, err
	}
	if assetUploadTerminal(row.State) {
		return false, false, nil
	}
	var deleted bool
	if err = tx.QueryRow(ctx, `SELECT deleted_at IS NOT NULL FROM core.space WHERE id=$1`, in.SpaceID).Scan(&deleted); err != nil {
		return false, false, err
	}
	if deleted || !time.Now().Before(row.ExpiresAt) {
		if err = terminateWhiteboardUpload(ctx, tx, in, &row, "expired"); err != nil {
			return false, false, err
		}
		return true, false, tx.Commit(ctx)
	}
	if row.State == "staging" && row.LeaseUntil != nil && !row.LeaseUntil.After(time.Now()) {
		if err = queueWhiteboardUploadObject(ctx, tx, in, row, "abandoned-stage"); err != nil {
			return false, false, err
		}
		if _, err = tx.Exec(ctx, `UPDATE whiteboard.whiteboard_asset_upload SET state='prepared',storage_key=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`, id); err != nil {
			return false, false, err
		}
		return false, true, tx.Commit(ctx)
	}
	return false, false, nil
}

func (s *whiteboardAssetServiceV2) cleanupAssetObject(ctx context.Context, maxAttempts int) (bool, bool, int, error) {
	tx, err := s.begin(ctx)
	if err != nil {
		return false, false, 0, err
	}
	defer draftRollback(ctx, tx)
	// A worker that crashes on its last claim must still become visibly exhausted.
	tag, err := tx.Exec(ctx, `UPDATE whiteboard.whiteboard_asset_cleanup SET exhausted_at=now(),lease_id=NULL,lease_until=NULL,last_error=COALESCE(last_error,'cleanup lease expired on final attempt')
        WHERE completed_at IS NULL AND exhausted_at IS NULL AND attempt_count >= $1 AND (lease_until IS NULL OR lease_until<=now())`, maxAttempts)
	if err != nil {
		return false, false, 0, err
	}
	exhausted := int(tag.RowsAffected())
	lease := uuid.New()
	var id uuid.UUID
	var key string
	var attempt int
	// Legacy keys are deterministic and may still be shared by retained v1
	// documents or upload tokens. Their page must be gone before cleanup can
	// claim them; both legacy owner tables have cascading page foreign keys.
	err = tx.QueryRow(ctx, `WITH candidate AS (
        SELECT c.id FROM whiteboard.whiteboard_asset_cleanup c WHERE c.completed_at IS NULL AND c.exhausted_at IS NULL AND c.not_before<=now()
          AND (c.lease_until IS NULL OR c.lease_until<=now()) AND c.attempt_count<$1
          AND (c.storage_key LIKE 'whiteboard-v2-assets/%' OR NOT EXISTS(SELECT 1 FROM core.page p WHERE p.id=c.page_id))
          AND NOT EXISTS(SELECT 1 FROM whiteboard.whiteboard_asset a WHERE a.storage_key=c.storage_key)
          AND NOT EXISTS(SELECT 1 FROM whiteboard.whiteboard_asset_upload u WHERE u.storage_key=c.storage_key AND u.state IN ('prepared','staging','staged'))
        ORDER BY c.not_before,c.id FOR UPDATE OF c SKIP LOCKED LIMIT 1
    ) UPDATE whiteboard.whiteboard_asset_cleanup c SET lease_id=$2,lease_until=now()+interval '3 minutes',attempt_count=attempt_count+1
      FROM candidate WHERE c.id=candidate.id RETURNING c.id,c.storage_key,c.attempt_count`, maxAttempts, lease).Scan(&id, &key, &attempt)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, exhausted, tx.Commit(ctx)
	}
	if err != nil {
		return false, false, exhausted, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, false, exhausted, err
	}
	ioCtx, cancel := context.WithTimeout(ctx, whiteboardAssetWriteTimeout)
	store, deleteErr := s.store(ioCtx)
	if deleteErr == nil {
		deleteErr = store.Delete(ioCtx, key)
	}
	cancel()
	// Even shutdown gets a bounded opportunity to record the physical result.
	metadataCtx, metadataCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer metadataCancel()
	finish, err := s.begin(metadataCtx)
	if err != nil {
		return true, deleteErr != nil, exhausted, err
	}
	defer draftRollback(metadataCtx, finish)
	if deleteErr == nil {
		_, err = finish.Exec(metadataCtx, `UPDATE whiteboard.whiteboard_asset_cleanup SET completed_at=now(),lease_id=NULL,lease_until=NULL,last_error=NULL WHERE id=$1 AND lease_id=$2`, id, lease)
	} else {
		backoff := time.Second * time.Duration(1<<min(attempt, 12))
		if backoff > time.Hour {
			backoff = time.Hour
		}
		message := deleteErr.Error()
		if len(message) > 2048 {
			message = message[:2048]
		}
		// PostgreSQL text rejects NUL and invalid UTF-8, including a multibyte
		// character split by the byte limit. Error logging must not block retries.
		message = strings.ReplaceAll(strings.ToValidUTF8(message, ""), "\x00", "")
		var exhaustedAt *time.Time
		if attempt >= maxAttempts {
			now := time.Now().UTC()
			exhaustedAt = &now
			exhausted++
		}
		_, err = finish.Exec(metadataCtx, `UPDATE whiteboard.whiteboard_asset_cleanup SET lease_id=NULL,lease_until=NULL,last_error=$3,not_before=$4,exhausted_at=$5 WHERE id=$1 AND lease_id=$2`, id, lease, message, time.Now().Add(backoff), exhaustedAt)
	}
	if err != nil {
		return true, deleteErr != nil, exhausted, err
	}
	return true, deleteErr != nil, exhausted, finish.Commit(metadataCtx)
}
