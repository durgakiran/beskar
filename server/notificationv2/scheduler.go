package notificationv2

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

// Scheduler only materializes occurrences. It never expands audiences or sends.
// Instances coordinate through PostgreSQL row locks, not a singleton lease.
type Scheduler struct {
	pool   *pgxpool.Pool
	config SchedulerConfig
	logger *zap.Logger
}

func NewScheduler(pool *pgxpool.Pool, config SchedulerConfig, logger *zap.Logger) (*Scheduler, error) {
	if err := config.validate(); err != nil {
		return nil, err
	}
	if pool == nil {
		return nil, fmt.Errorf("notification scheduler requires a database pool")
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Scheduler{pool: pool, config: config, logger: logger}, nil
}

// Start returns a completion channel so shutdown can wait for transactions to unwind.
func (s *Scheduler) Start(ctx context.Context) <-chan struct{} {
	done := make(chan struct{})
	if !s.config.Enabled {
		close(done)
		return done
	}
	go func() {
		defer close(done)
		ticker := time.NewTicker(s.config.PollInterval)
		defer ticker.Stop()
		for ctx.Err() == nil {
			stats, err := s.ProcessBatch(ctx)
			if err != nil && ctx.Err() == nil {
				s.logger.Error("notification scheduler batch failed", zap.Error(err))
			}
			if stats.Processed > 0 {
				s.logger.Info("notification scheduler batch", zap.Int("processed", stats.Processed), zap.Int("created", stats.Created), zap.Int("expired", stats.Expired), zap.Int("misfired", stats.Misfired))
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

type SchedulerStats struct{ Processed, Created, Expired, Misfired int }

// ProcessBatch processes each claimed definition in its own transaction.
// Failed rows are excluded for the rest of this pass, so they cannot starve
// healthy definitions in the same batch. The next poll retries failed rows.
func (s *Scheduler) ProcessBatch(ctx context.Context) (SchedulerStats, error) {
	var total SchedulerStats
	var failures []error
	excluded := []uuid.UUID{}
	for i := 0; i < s.config.BatchSize && ctx.Err() == nil; i++ {
		stepCtx, cancel := context.WithTimeout(ctx, s.config.TransactionTimeout)
		id, stats, err := s.processOne(stepCtx, excluded)
		cancel()
		if id != uuid.Nil {
			excluded = append(excluded, id)
		}
		if err != nil {
			failures = append(failures, fmt.Errorf("definition %s: %w", id, err))
			if id == uuid.Nil {
				break
			}
			continue
		}
		if id == uuid.Nil {
			break
		}
		total.Processed += stats.Processed
		total.Created += stats.Created
		total.Expired += stats.Expired
		total.Misfired += stats.Misfired
	}
	if ctx.Err() != nil {
		failures = append(failures, ctx.Err())
	}
	return total, errors.Join(failures...)
}

func (s *Scheduler) processOne(ctx context.Context, excluded []uuid.UUID) (uuid.UUID, SchedulerStats, error) {
	var stats SchedulerStats
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, stats, err
	}
	// A cancelled work context must not prevent rollback/releasing the connection.
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}()
	var id uuid.UUID
	var source string
	err = tx.QueryRow(ctx, `SELECT id,source_service FROM notifications_v2.notifications
 WHERE status='active' AND deleted_at IS NULL AND next_run_at<=statement_timestamp()
 AND NOT(id=ANY($1::uuid[])) ORDER BY next_run_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, excluded).Scan(&id, &source)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, stats, nil
	}
	if err != nil {
		return id, stats, err
	}
	d, err := readDefinition(ctx, tx, source, id, false)
	if err != nil {
		return id, stats, err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return id, stats, err
	}
	plan, err := planOccurrence(d, now, s.config.MisfireGrace)
	if err != nil {
		return id, stats, err
	}
	if plan.scheduled != nil {
		// This versioned envelope freezes definition-owned policy and target selectors.
		// Segment membership, recipient preferences and provider policy are resolved
		// by the future expander, not by this scheduler.
		snapshot, marshalErr := json.Marshal(struct {
			Version int `json:"snapshot_version"`
			Definition
		}{1, d})
		if marshalErr != nil {
			return id, stats, marshalErr
		}
		tag, insertErr := tx.Exec(ctx, `INSERT INTO notifications_v2.notification_events
   (id,notification_id,revision,scheduled_at,expires_at,template_id,template_version,definition_snapshot,status,expansion_available_at,expansion_attempt_count,created_at,updated_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,0,$9,$9)
   ON CONFLICT(notification_id,revision,scheduled_at) DO NOTHING`, uuid.New(), id, d.Revision, plan.scheduled, plan.expires, d.TemplateID, d.TemplateVersion, snapshot, now)
		if insertErr != nil {
			return id, stats, insertErr
		}
		stats.Created = int(tag.RowsAffected())
	}
	status := "active"
	if plan.next == nil {
		status = "completed"
	}
	// Scheduler progress is not a definition edit: preserve revision and audit actor.
	_, err = tx.Exec(ctx, `UPDATE notifications_v2.notifications SET next_run_at=$2,status=$3,updated_at=$4 WHERE id=$1`, id, plan.next, status, now)
	if err != nil {
		return id, SchedulerStats{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return id, SchedulerStats{}, err
	}
	stats.Processed = 1
	if plan.expired {
		stats.Expired = 1
	}
	if plan.misfired {
		stats.Misfired = 1
	}
	return id, stats, nil
}

type occurrencePlan struct {
	scheduled, expires, next *time.Time
	expired, misfired        bool
}

func planOccurrence(d Definition, now time.Time, grace time.Duration) (occurrencePlan, error) {
	var p occurrencePlan
	if d.NextRunAt == nil || d.NextRunAt.After(now) {
		return p, fmt.Errorf("definition is not due")
	}
	slot := *d.NextRunAt
	switch d.ScheduleKind {
	case "immediate", "once": // Polling delay does not discard a one-time request.
	case "cron":
		p.misfired = now.Sub(slot) > grace
		if p.misfired {
			var err error
			p.next, err = nextRun(&d.DefinitionInput, now)
			if err != nil {
				return p, err
			}
			switch d.MisfirePolicy {
			case "skip":
				return p, nil
			case "fire_once":
				slot, err = latestCronSlot(d, now)
				if err != nil {
					return p, err
				}
			default:
				return p, fmt.Errorf("invalid misfire policy")
			}
		} else {
			var err error
			p.next, err = nextRun(&d.DefinitionInput, slot)
			if err != nil {
				return p, err
			}
		}
	default:
		return p, fmt.Errorf("invalid schedule kind")
	}
	if d.DeliveryTTLSeconds != nil {
		expiry := slot.Add(time.Duration(*d.DeliveryTTLSeconds) * time.Second)
		p.expires = &expiry
		if !now.Before(expiry) {
			p.expired = true
			return p, nil
		}
	}
	p.scheduled = &slot
	return p, nil
}

// Find the latest missed slot with logarithmic Next calls, rather than replaying
// every minute of a long outage. nextRun also applies bounds and DST fold rules.
func latestCronSlot(d Definition, now time.Time) (time.Time, error) {
	latest := *d.NextRunAt
	low, high := latest.Unix()/60, now.Unix()/60+1
	for high-low > 1 {
		mid := low + (high-low)/2
		next, err := nextRun(&d.DefinitionInput, time.Unix(mid*60, 0).Add(-time.Nanosecond))
		if err != nil {
			return time.Time{}, err
		}
		if next != nil && !next.After(now) {
			latest = *next
			low = next.Unix() / 60
		} else {
			high = mid
		}
	}
	return latest, nil
}
