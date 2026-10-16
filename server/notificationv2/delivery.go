package notificationv2

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/durgakiran/beskar/notification"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type DeliveryWorker struct {
	mentionAccess         func(context.Context, pgx.Tx, deliveryRecord) (bool, error)
	pool                  *pgxpool.Pool
	config                DeliveryConfig
	email                 notification.EmailProvider
	fromAddress, fromName string
	logger                *zap.Logger
}

func NewDeliveryWorker(pool *pgxpool.Pool, c DeliveryConfig, email notification.EmailProvider, fromAddress, fromName string, logger *zap.Logger) (*DeliveryWorker, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	if pool == nil {
		return nil, fmt.Errorf("delivery database required")
	}
	if c.EmailEnabled && (email == nil || fromAddress == "") {
		return nil, fmt.Errorf("email provider and sender required")
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	c.HashKey = append([]byte(nil), c.HashKey...)
	return &DeliveryWorker{pool: pool, config: c, email: email, fromAddress: fromAddress, fromName: fromName, logger: logger}, nil
}
func (w *DeliveryWorker) Start(ctx context.Context) <-chan struct{} {
	done := make(chan struct{})
	var wg sync.WaitGroup
	for _, mode := range []string{"email", "in_app"} {
		if !w.enabled(mode) {
			continue
		}
		wg.Add(1)
		go func(mode string) {
			defer wg.Done()
			ticker := time.NewTicker(w.config.PollInterval)
			defer ticker.Stop()
			for ctx.Err() == nil {
				n, err := w.ProcessBatch(ctx, mode)
				if err != nil && ctx.Err() == nil {
					w.logger.Error("notification delivery batch failed", zap.String("mode", mode))
				}
				if n > 0 {
					w.logger.Info("notification delivery batch", zap.String("mode", mode), zap.Int("processed", n))
				}
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
			}
		}(mode)
	}
	go func() { wg.Wait(); close(done) }()
	return done
}
func (w *DeliveryWorker) enabled(mode string) bool {
	return mode == "email" && w.config.EmailEnabled || mode == "in_app" && w.config.InAppEnabled
}

type deliveryCandidate struct{ ID, DefinitionID, EventID, ProviderID uuid.UUID }
type deliveryRecord struct {
	ID                uuid.UUID       `json:"id"`
	EventID           uuid.UUID       `json:"event_id"`
	DefinitionID      uuid.UUID       `json:"definition_id"`
	UserID            uuid.UUID       `json:"user_id"`
	ProviderID        uuid.UUID       `json:"provider_id"`
	ModeID            int16           `json:"mode_id"`
	TypeID            int16           `json:"notification_type_id"`
	Mode              string          `json:"mode"`
	Status            string          `json:"status"`
	DefinitionStatus  string          `json:"definition_status"`
	DeletedAt         *time.Time      `json:"definition_deleted_at"`
	EventStatus       string          `json:"event_status"`
	ExpiresAt         *time.Time      `json:"expires_at"`
	LeaseToken        *uuid.UUID      `json:"lease_token"`
	LeaseExpiresAt    *time.Time      `json:"lease_expires_at"`
	AvailableAt       time.Time       `json:"available_at"`
	AttemptCount      int             `json:"attempt_count"`
	Destination       json.RawMessage `json:"destination_snapshot"`
	MessageDetails    json.RawMessage `json:"message_details_snapshot"`
	Policy            json.RawMessage `json:"policy_snapshot"`
	TemplateDetails   json.RawMessage `json:"template_details"`
	VariableSchema    json.RawMessage `json:"variable_schema"`
	TypeCode          string          `json:"type_code"`
	TopicCode         string          `json:"topic_code"`
	Adapter           string          `json:"adapter_key"`
	ProviderEnabled   bool            `json:"provider_enabled"`
	ChannelMatches    bool            `json:"channel_matches"`
	RequestsPerSecond *int            `json:"requests_per_second"`
}
type deliveryPolicy struct {
	MaxAttempts  int `json:"max_attempts"`
	RetryInitial int `json:"retry_initial_seconds"`
	RetryMax     int `json:"retry_max_seconds"`
}

func (p deliveryPolicy) valid() bool {
	return p.MaxAttempts > 0 && p.MaxAttempts <= 1000 && p.RetryInitial > 0 && p.RetryMax >= p.RetryInitial && p.RetryMax <= 86400
}

func (w *DeliveryWorker) ProcessBatch(ctx context.Context, mode string) (int, error) {
	if mode != "email" && mode != "in_app" {
		return 0, fmt.Errorf("unsupported delivery mode")
	}
	if !w.enabled(mode) {
		return 0, nil
	}
	queryCtx, cancel := context.WithTimeout(ctx, w.config.TransactionTimeout)
	rows, err := w.pool.Query(queryCtx, `SELECT d.id,e.notification_id,e.id,d.provider_id FROM notifications_v2.notification_deliveries d JOIN notifications_v2.notification_events e ON e.id=d.event_id JOIN notifications_v2.notification_modes m ON m.id=d.mode_id WHERE m.code=$1 AND d.status IN('pending','retrying') AND d.available_at<=statement_timestamp() AND e.status='ready' ORDER BY d.priority DESC,d.available_at,d.id LIMIT $2`, mode, w.config.BatchSize)
	if err != nil {
		cancel()
		return 0, err
	}
	candidates, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (deliveryCandidate, error) {
		var c deliveryCandidate
		err := row.Scan(&c.ID, &c.DefinitionID, &c.EventID, &c.ProviderID)
		return c, err
	})
	cancel()
	if err != nil {
		return 0, err
	}
	processed := 0
	var failures []error
	for _, c := range candidates {
		if ctx.Err() != nil {
			break
		}
		ok, err := w.process(ctx, c, mode)
		if err != nil {
			failures = append(failures, fmt.Errorf("delivery %s could not be processed", c.ID))
			w.logger.Warn("notification delivery transaction failed", zap.String("delivery_id", c.ID.String()))
		}
		if ok {
			processed++
		}
	}
	return processed, errors.Join(failures...)
}

// A session advisory lock bounds this implementation to one in-flight call per
// provider across v2 instances. Keep the reserved connection outside transactions
// during SMTP; all database stages use that connection, even with a one-slot pool.
func reserveProvider(ctx context.Context, pool *pgxpool.Pool, id uuid.UUID) (*pgxpool.Conn, func(), error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, nil, err
	}
	var locked bool
	err = conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended('notification-v2-provider:'||$1::text,0))`, id.String()).Scan(&locked)
	if err != nil {
		raw := conn.Hijack()
		_ = raw.Close(context.Background())
		return nil, nil, err
	}
	if !locked {
		conn.Release()
		return nil, nil, nil
	}
	release := func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var released bool
		err := conn.QueryRow(cleanup, `SELECT pg_advisory_unlock(hashtextextended('notification-v2-provider:'||$1::text,0))`, id.String()).Scan(&released)
		if err != nil || !released {
			raw := conn.Hijack()
			_ = raw.Close(cleanup)
		} else {
			conn.Release()
		}
	}
	return conn, release, nil
}
func lockDelivery(ctx context.Context, tx pgx.Tx, c deliveryCandidate, skip bool) (deliveryRecord, error) {
	suffix := " FOR UPDATE"
	if skip {
		suffix += " SKIP LOCKED"
	}
	var id uuid.UUID
	for _, v := range []struct {
		table string
		id    uuid.UUID
	}{{"notifications", c.DefinitionID}, {"notification_events", c.EventID}, {"notification_deliveries", c.ID}} {
		if err := tx.QueryRow(ctx, `SELECT id FROM notifications_v2.`+v.table+` WHERE id=$1`+suffix, v.id).Scan(&id); err != nil {
			return deliveryRecord{}, err
		}
	}
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT to_jsonb(d)||jsonb_build_object('definition_id',n.id,'definition_status',n.status,'definition_deleted_at',n.deleted_at,'event_status',e.status,'expires_at',e.expires_at,'template_details',t.details,'variable_schema',t.variable_schema,'type_code',nt.code,'topic_code',topic.code,'mode',m.code,'adapter_key',p.adapter_key,'provider_enabled',p.enabled,'channel_matches',p.mode_id=d.mode_id AND t.mode_id=d.mode_id,'requests_per_second',p.requests_per_second)
 FROM notifications_v2.notification_deliveries d JOIN notifications_v2.notification_events e ON e.id=d.event_id JOIN notifications_v2.notifications n ON n.id=e.notification_id JOIN notifications_v2.notification_templates t ON t.id=e.template_id AND t.version=e.template_version JOIN notifications_v2.notification_types nt ON nt.id=d.notification_type_id JOIN notifications_v2.notification_modes m ON m.id=d.mode_id JOIN notifications_v2.notification_providers p ON p.id=d.provider_id LEFT JOIN notifications_v2.notification_topics topic ON topic.id=(e.definition_snapshot->>'notification_topic_id')::smallint AND topic.notification_type_id=d.notification_type_id WHERE d.id=$1`, c.ID).Scan(&raw)
	if err != nil {
		return deliveryRecord{}, err
	}
	var d deliveryRecord
	err = json.Unmarshal(raw, &d)
	return d, err
}
func setDeliveryState(ctx context.Context, tx pgx.Tx, id uuid.UUID, status, code string, available *time.Time) error {
	_, err := tx.Exec(ctx, `UPDATE notifications_v2.notification_deliveries SET status=$2,last_error_code=NULLIF($3,''),last_error_message=NULL,available_at=COALESCE($4,available_at),lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1`, id, status, code, available)
	return err
}
func (w *DeliveryWorker) process(ctx context.Context, c deliveryCandidate, mode string) (bool, error) {
	acquire, cancel := context.WithTimeout(ctx, w.config.TransactionTimeout)
	conn, release, err := reserveProvider(acquire, w.pool, c.ProviderID)
	cancel()
	if err != nil || conn == nil {
		return false, err
	}
	defer release()
	dbctx, stop := context.WithTimeout(ctx, w.config.TransactionTimeout)
	defer stop()
	tx, err := conn.Begin(dbctx)
	if err != nil {
		return false, err
	}
	defer rollbackAudience(tx)
	d, err := lockDelivery(dbctx, tx, c, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var now time.Time
	if err = tx.QueryRow(dbctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return false, err
	}
	if d.ProviderID != c.ProviderID || d.Mode != mode {
		return false, nil
	}

	if (d.Status != "pending" && d.Status != "retrying") || d.AvailableAt.After(now) {
		return false, nil
	}
	if d.DefinitionStatus == "cancelled" || d.DeletedAt != nil || d.EventStatus == "cancelled" {
		err = setDeliveryState(dbctx, tx, d.ID, "cancelled", "definition_cancelled", nil)
		if err != nil {
			return false, err
		}
		return true, tx.Commit(dbctx)
	}
	if d.EventStatus != "ready" {
		return false, nil
	}
	eligible, err := w.preflight(dbctx, tx, d, now)
	if err != nil {
		return false, err
	}
	if !eligible {
		return true, tx.Commit(dbctx)
	}
	email, inbox, err := renderDelivery(d)
	if err != nil {
		if err = setDeliveryState(dbctx, tx, d.ID, "failed", "template_render_failed", nil); err != nil {
			return false, err
		}
		return true, tx.Commit(dbctx)
	}
	var policy deliveryPolicy
	if json.Unmarshal(d.Policy, &policy) != nil || !policy.valid() {
		err = setDeliveryState(dbctx, tx, d.ID, "failed", "invalid_retry_policy", nil)
		if err != nil {
			return false, err
		}
		return true, tx.Commit(dbctx)
	}
	if d.AttemptCount >= policy.MaxAttempts {
		err = setDeliveryState(dbctx, tx, d.ID, "dead_lettered", "attempts_exhausted", nil)
		if err != nil {
			return false, err
		}
		return true, tx.Commit(dbctx)
	}
	// Rendering can take time. Recheck the deadline immediately before reserving
	// provider capacity and recording the attempt.
	if err = tx.QueryRow(dbctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return false, err
	}
	if d.ExpiresAt != nil && !now.Before(*d.ExpiresAt) {
		if err = setDeliveryState(dbctx, tx, d.ID, "expired", "occurrence_expired", nil); err != nil {
			return false, err
		}
		return true, tx.Commit(dbctx)
	}
	if d.RequestsPerSecond != nil {
		var last *time.Time
		if err = tx.QueryRow(dbctx, `SELECT max(started_at) FROM notifications_v2.notification_delivery_attempts WHERE provider_id=$1`, d.ProviderID).Scan(&last); err != nil {
			return false, err
		}
		if last != nil {
			next := last.Add(time.Second / time.Duration(*d.RequestsPerSecond))
			if now.Before(next) {
				err = setDeliveryState(dbctx, tx, d.ID, d.Status, "provider_rate_limited", &next)
				if err != nil {
					return false, err
				}
				return true, tx.Commit(dbctx)
			}
		}
	}
	token, attempt := uuid.New(), uuid.New()
	_, err = tx.Exec(dbctx, `UPDATE notifications_v2.notification_deliveries SET status='processing',attempt_count=attempt_count+1,lease_token=$2,lease_expires_at=clock_timestamp()+$3::double precision*interval '1 second',updated_at=clock_timestamp() WHERE id=$1`, d.ID, token, w.config.LeaseDuration.Seconds())
	if err != nil {
		return false, err
	}
	_, err = tx.Exec(dbctx, `INSERT INTO notifications_v2.notification_delivery_attempts(id,delivery_id,attempt_number,provider_id,lease_token,status,started_at) VALUES($1,$2,$3,$4,$5,'started',clock_timestamp())`, attempt, d.ID, d.AttemptCount+1, d.ProviderID, token)
	if err != nil {
		return false, err
	}
	if mode == "in_app" {
		// Existing feed APIs see this inbox row; rollback also rolls back the attempt.
		if err = notification.NewServiceWithPool(w.pool).EmitTx(dbctx, tx, inbox); err != nil {
			return false, err
		}
		if _, err = tx.Exec(dbctx, `UPDATE notifications_v2.notification_delivery_attempts SET status='accepted',finished_at=clock_timestamp() WHERE id=$1`, attempt); err != nil {
			return false, err
		}
		if err = setDeliveryState(dbctx, tx, d.ID, "delivered", "", nil); err != nil {
			return false, err
		}
		if _, err = tx.Exec(dbctx, `UPDATE notifications_v2.notification_deliveries SET accepted_at=clock_timestamp(),delivered_at=clock_timestamp() WHERE id=$1`, d.ID); err != nil {
			return false, err
		}
		return true, tx.Commit(dbctx)
	}
	if err = tx.Commit(dbctx); err != nil {
		return false, err
	}
	stop()
	email.FromAddress = w.fromAddress
	email.FromName = w.fromName
	sendctx, endSend := context.WithTimeout(ctx, w.config.SendTimeout)
	result, sendErr := w.email.Send(sendctx, email)
	endSend()
	// Save the result even when the application context was cancelled during SMTP.
	finishctx, endFinish := context.WithTimeout(context.Background(), w.config.TransactionTimeout)
	defer endFinish()
	err = w.finishEmail(finishctx, conn, c, d, token, attempt, result, sendErr, policy)
	return true, err
}
