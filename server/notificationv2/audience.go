package notificationv2

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type AudienceExpander struct {
	pool      *pgxpool.Pool
	config    AudienceConfig
	directory AudienceDirectory
	logger    *zap.Logger
}

func NewAudienceExpander(pool *pgxpool.Pool, c AudienceConfig, directory AudienceDirectory, logger *zap.Logger) (*AudienceExpander, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	if pool == nil || directory == nil {
		return nil, fmt.Errorf("audience database and directory are required")
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	c.HashKey = append([]byte(nil), c.HashKey...)
	return &AudienceExpander{pool: pool, config: c, directory: directory, logger: logger}, nil
}
func (w *AudienceExpander) Start(ctx context.Context) <-chan struct{} {
	done := make(chan struct{})
	if !w.config.Enabled {
		close(done)
		return done
	}
	go func() {
		defer close(done)
		ticker := time.NewTicker(w.config.PollInterval)
		defer ticker.Stop()
		for ctx.Err() == nil {
			stats, err := w.ProcessBatch(ctx)
			if err != nil && ctx.Err() == nil {
				w.logger.Error("notification audience batch failed", zap.Error(err))
			}
			if stats.Claimed > 0 {
				w.logger.Info("notification audience batch", zap.Int("claimed", stats.Claimed), zap.Int("ready", stats.Ready), zap.Int("deliveries", stats.Deliveries), zap.Int("failed", stats.Failed))
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return done
}

type AudienceStats struct{ Claimed, Ready, Deliveries, Failed int }
type expansionClaim struct {
	id, definition, token uuid.UUID
	attempt               int
}
type expansionError struct {
	code      string
	permanent bool
}

func (e *expansionError) Error() string                  { return e.code }
func expansionFailure(code string, permanent bool) error { return &expansionError{code, permanent} }

var errExpansionLost = errors.New("expansion ownership lost")

func rollbackAudience(tx pgx.Tx) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = tx.Rollback(ctx)
}
func (w *AudienceExpander) ProcessBatch(ctx context.Context) (AudienceStats, error) {
	var stats AudienceStats
	if len(w.config.HashKey) < 32 {
		return stats, fmt.Errorf("audience expansion requires a destination hash key before claiming work")
	}
	var failures []error
	excluded := []uuid.UUID{}
	for i := 0; i < w.config.BatchSize && ctx.Err() == nil; i++ {
		claimCtx, cancel := context.WithTimeout(ctx, w.config.TransactionTimeout)
		claim, err := w.claim(claimCtx, excluded)
		cancel()
		if err != nil {
			failures = append(failures, err)
			break
		}
		if claim.id == uuid.Nil {
			break
		}
		excluded = append(excluded, claim.id)
		stats.Claimed++
		if claim.token == uuid.Nil {
			continue
		}
		workCtx, stop := context.WithTimeout(ctx, w.config.TransactionTimeout)
		n, err := w.expand(workCtx, claim)
		stop()
		if err == nil {
			stats.Ready++
			stats.Deliveries += n
			continue
		}
		if errors.Is(err, errExpansionLost) {
			continue
		}
		stats.Failed++
		// Use a bounded independent context to release a failed claim on shutdown.
		failureCtx, finish := context.WithTimeout(context.Background(), 5*time.Second)
		recordErr := w.recordFailure(failureCtx, claim, err)
		finish()
		if recordErr != nil {
			failures = append(failures, fmt.Errorf("record expansion failure for %s: %w", claim.id, recordErr))
		}
		code := "expansion_unavailable"
		var known *expansionError
		if errors.As(err, &known) {
			code = known.code
		}
		w.logger.Warn("notification expansion failed", zap.String("event_id", claim.id.String()), zap.String("reason", code))
	}
	if ctx.Err() != nil {
		failures = append(failures, ctx.Err())
	}
	return stats, errors.Join(failures...)
}
func (w *AudienceExpander) claim(ctx context.Context, excluded []uuid.UUID) (expansionClaim, error) {
	var c expansionClaim
	if excluded == nil {
		excluded = []uuid.UUID{}
	}
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return c, err
	}
	defer rollbackAudience(tx)
	// Lock parents first, matching cancellation and scheduler lock order. Two
	// expanders may process different definitions without waiting on each other.
	err = tx.QueryRow(ctx, `SELECT n.id,e.id FROM notifications_v2.notifications n JOIN notifications_v2.notification_events e ON e.notification_id=n.id
 WHERE NOT(e.id=ANY($1::uuid[])) AND e.status='pending' AND e.expansion_available_at<=statement_timestamp()
 ORDER BY e.expansion_available_at,e.id LIMIT 1 FOR UPDATE OF n SKIP LOCKED`, excluded).Scan(&c.definition, &c.id)
	if errors.Is(err, pgx.ErrNoRows) {
		return expansionClaim{}, nil
	}
	if err != nil {
		return c, err
	}
	var state string
	var deleted *time.Time
	if err = tx.QueryRow(ctx, `SELECT status,deleted_at FROM notifications_v2.notifications WHERE id=$1`, c.definition).Scan(&state, &deleted); err != nil {
		return c, err
	}
	var eventState string
	var available time.Time
	if err = tx.QueryRow(ctx, `SELECT status,expansion_attempt_count,expansion_available_at FROM notifications_v2.notification_events WHERE id=$1 FOR UPDATE`, c.id).Scan(&eventState, &c.attempt, &available); err != nil {
		return c, err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return c, err
	}
	if eventState != "pending" || available.After(now) {
		return c, tx.Commit(ctx)
	}
	if state == "cancelled" || deleted != nil {
		_, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_events SET status='cancelled',lease_token=NULL,lease_expires_at=NULL,updated_at=$2 WHERE id=$1`, c.id, now)
	} else if c.attempt >= w.config.MaxAttempts {
		_, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_events SET status='failed',last_error_code='expansion_attempts_exhausted',lease_token=NULL,lease_expires_at=NULL,updated_at=$2 WHERE id=$1`, c.id, now)
	} else {
		c.token = uuid.New()
		c.attempt++
		_, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_events SET status='expanding',expansion_attempt_count=$2,lease_token=$3,lease_expires_at=$4,updated_at=$5 WHERE id=$1`, c.id, c.attempt, c.token, now.Add(w.config.LeaseDuration), now)
	}
	if err != nil {
		return c, err
	}
	return c, tx.Commit(ctx)
}
func (w *AudienceExpander) recordFailure(ctx context.Context, c expansionClaim, cause error) error {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackAudience(tx)
	if _, err = tx.Exec(ctx, `SELECT id FROM notifications_v2.notifications WHERE id=$1 FOR UPDATE`, c.definition); err != nil {
		return err
	}
	var known *expansionError
	code := "expansion_unavailable"
	permanent := false
	if errors.As(cause, &known) {
		code = known.code
		permanent = known.permanent
	}
	status := "pending"
	if permanent || c.attempt >= w.config.MaxAttempts {
		status = "failed"
	}
	delay := w.config.RetryInitial
	for i := 1; i < c.attempt && delay < w.config.RetryMax; i++ {
		delay = min(delay*2, w.config.RetryMax)
	}
	delay = delay/2 + time.Duration(rand.Int64N(int64(delay/2)+1))
	_, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_events SET status=$3,last_error_code=$4,expansion_available_at=clock_timestamp()+$5::double precision*interval '1 second',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND status='expanding' AND lease_token=$2`, c.id, c.token, status, code, delay.Seconds())
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// expand keeps membership reads and all delivery inserts in one repeatable-read
// transaction. The first version bounds audience size rather than publishing
// partial batches with potentially different segment memberships.
func (w *AudienceExpander) expand(ctx context.Context, c expansionClaim) (int, error) {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return 0, err
	}
	defer rollbackAudience(tx)
	var status string
	var deleted *time.Time
	if err = tx.QueryRow(ctx, `SELECT status,deleted_at FROM notifications_v2.notifications WHERE id=$1 FOR UPDATE`, c.definition).Scan(&status, &deleted); err != nil {
		return 0, err
	}
	if status == "cancelled" || deleted != nil {
		return 0, errExpansionLost
	}
	var raw []byte
	var scheduled time.Time
	var expires *time.Time
	err = tx.QueryRow(ctx, `SELECT definition_snapshot,scheduled_at,expires_at FROM notifications_v2.notification_events WHERE id=$1 AND status='expanding' AND lease_token=$2 AND lease_expires_at>clock_timestamp() FOR UPDATE`, c.id, c.token).Scan(&raw, &scheduled, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, errExpansionLost
	}
	if err != nil {
		return 0, err
	}
	var snapshot struct {
		Version int `json:"snapshot_version"`
		Definition
	}
	if json.Unmarshal(raw, &snapshot) != nil || snapshot.Version != 1 || snapshot.ID != c.definition {
		return 0, expansionFailure("invalid_event_snapshot", true)
	}
	d := snapshot.Definition
	recipients, err := w.prepareAudience(ctx, tx, d, scheduled, expires)
	if err != nil {
		return 0, err
	}
	for _, r := range recipients {
		if err = w.insertRecipient(ctx, tx, c.id, d, r); err != nil {
			return 0, err
		}
	}
	tag, err := tx.Exec(ctx, `UPDATE notifications_v2.notification_events SET status='ready',audience_resolved_at=clock_timestamp(),lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=clock_timestamp() WHERE id=$1 AND status='expanding' AND lease_token=$2 AND lease_expires_at>clock_timestamp()`, c.id, c.token)
	if err != nil {
		return 0, err
	}
	if tag.RowsAffected() != 1 {
		return 0, errExpansionLost
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(recipients), nil
}
