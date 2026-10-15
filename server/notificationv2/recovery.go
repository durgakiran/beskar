package notificationv2

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type RecoveryWorker struct {
	pool      *pgxpool.Pool
	config    RecoveryConfig
	expansion AudienceConfig
	logger    *zap.Logger
}

func NewRecoveryWorker(pool *pgxpool.Pool, c RecoveryConfig, expansion AudienceConfig, logger *zap.Logger) (*RecoveryWorker, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	if pool == nil {
		return nil, fmt.Errorf("recovery database required")
	}
	if expansion.MaxAttempts < 1 || expansion.MaxAttempts > 100 || expansion.RetryInitial < time.Second || expansion.RetryMax < expansion.RetryInitial || expansion.RetryMax > 24*time.Hour {
		return nil, fmt.Errorf("invalid expansion recovery retry policy")
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	// Recovery only needs expansion retry policy, never the destination hash key.
	policy := AudienceConfig{MaxAttempts: expansion.MaxAttempts, RetryInitial: expansion.RetryInitial, RetryMax: expansion.RetryMax}
	return &RecoveryWorker{pool: pool, config: c, expansion: policy, logger: logger}, nil
}

type RecoveryStats struct{ Events, Deliveries, Requeued, Failed, Cancelled, Expired, Accepted, Delivered, DeadLettered int }

func (s *RecoveryStats) add(kind, status string) {
	if kind == "event" {
		s.Events++
	} else {
		s.Deliveries++
	}
	switch status {
	case "pending", "retrying":
		s.Requeued++
	case "failed":
		s.Failed++
	case "cancelled":
		s.Cancelled++
	case "expired":
		s.Expired++
	case "accepted":
		s.Accepted++
	case "delivered":
		s.Delivered++
	case "dead_lettered":
		s.DeadLettered++
	}
}
func (w *RecoveryWorker) Start(ctx context.Context) <-chan struct{} {
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
				w.logger.Error("notification recovery batch failed", zap.Error(err))
			}
			if stats.Events+stats.Deliveries > 0 {
				w.logger.Info("notification recovery batch", zap.Any("outcomes", stats))
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
func (w *RecoveryWorker) ProcessBatch(ctx context.Context) (RecoveryStats, error) {
	var stats RecoveryStats
	var failures []error
	// Bound each work kind separately: a busy expansion queue cannot hide delivery
	// recovery. Every candidate gets a fresh timeout and a separate transaction.
	for _, kind := range []string{"event", "delivery"} {
		query := `SELECT id,notification_id,id,'00000000-0000-0000-0000-000000000000'::uuid FROM notifications_v2.notification_events WHERE status='expanding' AND lease_expires_at<=statement_timestamp() ORDER BY lease_expires_at,id LIMIT $1`
		if kind == "delivery" {
			query = `SELECT d.id,e.notification_id,e.id,d.provider_id FROM notifications_v2.notification_deliveries d JOIN notifications_v2.notification_events e ON e.id=d.event_id WHERE d.status='processing' AND d.lease_expires_at<=statement_timestamp() ORDER BY d.lease_expires_at,d.id LIMIT $1`
		}
		scanCtx, cancel := context.WithTimeout(ctx, w.config.TransactionTimeout)
		rows, err := w.pool.Query(scanCtx, query, w.config.BatchSize)
		if err != nil {
			cancel()
			failures = append(failures, fmt.Errorf("scan %s recovery candidates: %w", kind, err))
			continue
		}
		candidates, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (deliveryCandidate, error) {
			var c deliveryCandidate
			err := row.Scan(&c.ID, &c.DefinitionID, &c.EventID, &c.ProviderID)
			return c, err
		})
		cancel()
		if err != nil {
			failures = append(failures, fmt.Errorf("read %s recovery candidates: %w", kind, err))
			continue
		}
		for _, c := range candidates {
			if ctx.Err() != nil {
				break
			}
			stepCtx, finish := context.WithTimeout(ctx, w.config.TransactionTimeout)
			var status string
			if kind == "event" {
				status, err = w.recoverEvent(stepCtx, c)
			} else {
				status, err = w.recoverDelivery(stepCtx, c)
			}
			finish()
			if err != nil {
				failures = append(failures, fmt.Errorf("recover %s %s failed", kind, c.ID))
				continue
			}
			if status != "" {
				stats.add(kind, status)
				if status == "failed" || status == "dead_lettered" {
					w.logger.Warn("notification recovery needs review", zap.String("kind", kind), zap.String("id", c.ID.String()), zap.String("status", status))
				}
			}
		}
		if ctx.Err() != nil {
			break
		}
	}
	if ctx.Err() != nil {
		failures = append(failures, ctx.Err())
	}
	return stats, errors.Join(failures...)
}
func (w *RecoveryWorker) recoverEvent(ctx context.Context, c deliveryCandidate) (string, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer rollbackAudience(tx)
	var definitionStatus string
	var deleted *time.Time
	err = tx.QueryRow(ctx, `SELECT status,deleted_at FROM notifications_v2.notifications WHERE id=$1 FOR UPDATE SKIP LOCKED`, c.DefinitionID).Scan(&definitionStatus, &deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var eventStatus string
	var lease, expires *time.Time
	var attempts int
	err = tx.QueryRow(ctx, `SELECT status,lease_expires_at,expires_at,expansion_attempt_count FROM notifications_v2.notification_events WHERE id=$1 FOR UPDATE SKIP LOCKED`, c.ID).Scan(&eventStatus, &lease, &expires, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return "", err
	}
	if eventStatus != "expanding" || lease == nil || lease.After(now) {
		return "", nil
	}
	status, code := "pending", "expansion_lease_expired"
	delay := w.expansion.RetryInitial
	for i := 1; i < attempts && delay < w.expansion.RetryMax; i++ {
		delay = min(delay*2, w.expansion.RetryMax)
	}
	next := now.Add(delay/2 + time.Duration(rand.Int64N(int64(delay/2)+1)))
	switch {
	case definitionStatus == "cancelled" || deleted != nil:
		status, code = "cancelled", "definition_cancelled"
	case expires != nil && !next.Before(*expires):
		status, code = "failed", "occurrence_expired"
	case attempts >= w.expansion.MaxAttempts:
		status, code = "failed", "expansion_attempts_exhausted"
	}
	_, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_events SET status=$2,last_error_code=$3,expansion_available_at=$4,lease_token=NULL,lease_expires_at=NULL,updated_at=$5 WHERE id=$1`, c.ID, status, code, next, now)
	if err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return status, nil
}
func (w *RecoveryWorker) recoverDelivery(ctx context.Context, c deliveryCandidate) (string, error) {
	// The sender holds this lock across SMTP. Do not diagnose an active network
	// call as abandoned merely because its database lease has elapsed.
	conn, release, err := reserveProvider(ctx, w.pool, c.ProviderID)
	if err != nil || conn == nil {
		return "", err
	}
	defer release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer rollbackAudience(tx)
	d, err := lockDelivery(ctx, tx, c, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return "", err
	}
	if d.Status != "processing" || d.LeaseExpiresAt == nil || d.LeaseExpiresAt.After(now) || d.ProviderID != c.ProviderID {
		return "", nil
	}
	if err = recoverExpiredDelivery(ctx, tx, d); err != nil {
		return "", err
	}
	var status string
	if err = tx.QueryRow(ctx, `SELECT status FROM notifications_v2.notification_deliveries WHERE id=$1`, d.ID).Scan(&status); err != nil {
		return "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return "", err
	}
	return status, nil
}
