package notificationv2

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
	tx   pgx.Tx
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// WithTx binds all operations to a caller-owned transaction. Mutations use a
// savepoint, so only the caller can commit the outer business transaction.
func (s *Service) WithTx(tx pgx.Tx) *Service {
	if tx == nil {
		panic("notificationv2: WithTx requires a transaction")
	}
	return &Service{pool: s.pool, tx: tx}
}
func (s *Service) db() database {
	if s.tx != nil {
		return s.tx
	}
	return s.pool
}
func (s *Service) begin(ctx context.Context) (pgx.Tx, error) {
	if s.tx != nil {
		return s.tx.Begin(ctx)
	}
	return s.pool.Begin(ctx)
}

type database interface {
	querier
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type querier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

const projection = `to_jsonb(n) || jsonb_build_object(
 'target_users',COALESCE((SELECT jsonb_agg(t.user_id ORDER BY t.user_id) FROM notifications_v2.notification_target_users t WHERE t.notification_id=n.id),'[]'::jsonb),
 'target_segments',COALESCE((SELECT jsonb_agg(t.segment_id ORDER BY t.segment_id) FROM notifications_v2.notification_target_segments t WHERE t.notification_id=n.id),'[]'::jsonb),
 'target_emails',COALESCE((SELECT jsonb_agg(t.email ORDER BY t.email) FROM notifications_v2.notification_target_emails t WHERE t.notification_id=n.id),'[]'::jsonb))`

func readDefinition(ctx context.Context, q querier, source string, id uuid.UUID, includeDeleted bool) (Definition, error) {
	var raw []byte
	err := q.QueryRow(ctx, `SELECT `+projection+` FROM notifications_v2.notifications n WHERE n.id=$1 AND n.source_service=$2 AND ($3 OR n.deleted_at IS NULL)`, id, source, includeDeleted).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return Definition{}, notFound
	}
	if err != nil {
		return Definition{}, err
	}
	var d Definition
	err = json.Unmarshal(raw, &d)
	return d, err
}
func (s *Service) Get(ctx context.Context, p Producer, id uuid.UUID) (Definition, error) {
	if err := validateProducer(p); err != nil {
		return Definition{}, err
	}
	return readDefinition(ctx, s.db(), p.Source, id, false)
}

func (s *Service) Create(ctx context.Context, p Producer, key string, input DefinitionInput) (Definition, bool, error) {
	if err := validateProducer(p); err != nil {
		return Definition{}, false, err
	}
	if strings.TrimSpace(key) == "" || len(key) > 200 || strings.ContainsAny(key, "\r\n") {
		return Definition{}, false, invalid("Idempotency-Key must contain 1 to 200 bytes")
	}
	if err := normalize(&input); err != nil {
		return Definition{}, false, err
	}
	hash := requestHash(input)
	tx, err := s.begin(ctx)
	if err != nil {
		return Definition{}, false, err
	}
	defer tx.Rollback(ctx)
	// Serialize same-key submissions, including the period before a row exists.
	_, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, strconv.Itoa(len(p.Source))+":"+p.Source+key)
	if err != nil {
		return Definition{}, false, err
	}
	var existing uuid.UUID
	var originalHash string
	err = tx.QueryRow(ctx, `SELECT id,request_hash FROM notifications_v2.notifications WHERE source_service=$1 AND idempotency_key=$2`, p.Source, key).Scan(&existing, &originalHash)
	if err == nil {
		if originalHash != hash {
			return Definition{}, false, conflict("idempotency key already used with different content")
		}
		d, e := readDefinition(ctx, tx, p.Source, existing, true)
		if e != nil {
			return d, false, e
		}
		if d.DeletedAt != nil {
			return Definition{}, false, &apiError{http.StatusGone, "definition was deleted; use a new idempotency key for new work"}
		}
		return d, false, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Definition{}, false, err
	}
	if err = validateDependencies(ctx, tx, input, false); err != nil {
		return Definition{}, false, err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return Definition{}, false, err
	}
	next, err := nextRun(&input, now)
	if err != nil {
		return Definition{}, false, err
	}
	status := "active"
	if next == nil {
		status = "completed"
	}
	id := uuid.New()
	_, err = tx.Exec(ctx, `INSERT INTO notifications_v2.notifications
 (id,source_service,idempotency_key,request_hash,correlation_id,notification_type_id,mode_id,template_id,template_version,message_details,priority,schedule_kind,scheduled_at,cron_expression,timezone,starts_at,ends_at,next_run_at,misfire_policy,delivery_ttl_seconds,status,revision,created_at,updated_at,created_by,updated_by,notification_topic_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,1,$22,$22,$23,$23,$24)`, id, p.Source, key, hash, input.CorrelationID, input.NotificationTypeID, input.ModeID, input.TemplateID, input.TemplateVersion, input.MessageDetails, input.Priority, input.ScheduleKind, input.ScheduledAt, input.CronExpression, input.Timezone, input.StartsAt, input.EndsAt, next, input.MisfirePolicy, input.DeliveryTTLSeconds, status, now, p.ActorID, input.NotificationTopicID)
	if err != nil {
		return Definition{}, false, err
	}
	if err = replaceTargets(ctx, tx, id, input, now); err != nil {
		return Definition{}, false, err
	}
	d, err := readDefinition(ctx, tx, p.Source, id, false)
	if err != nil {
		return Definition{}, false, err
	}
	return d, true, tx.Commit(ctx)
}

func validateDependencies(ctx context.Context, tx pgx.Tx, d DefinitionInput, allowRetired bool) error {
	var mode string
	var schema []byte
	err := tx.QueryRow(ctx, `SELECT m.code,t.variable_schema FROM notifications_v2.notification_types c
 JOIN notifications_v2.notification_topics topic ON topic.id=$6 AND topic.notification_type_id=c.id AND topic.active
 JOIN notifications_v2.notification_modes m ON m.id=$2
 JOIN notifications_v2.notification_templates t ON t.id=$3 AND t.version=$4 AND t.mode_id=m.id
 WHERE c.id=$1 AND c.active AND m.active AND ($5 OR t.retired_at IS NULL) FOR SHARE OF c,m,t,topic`, d.NotificationTypeID, d.ModeID, d.TemplateID, d.TemplateVersion, allowRetired, d.NotificationTopicID).Scan(&mode, &schema)
	if errors.Is(err, pgx.ErrNoRows) {
		return invalid("type, topic and mode must be active, topic must belong to its type, and the pinned template must exist, be available, and match the mode")
	}
	if err != nil {
		return err
	}
	if len(d.TargetEmails) > 0 && mode != "email" {
		return invalid("direct email targets require email mode")
	}
	if err = validateVariables(schema, d.MessageDetails); err != nil {
		return err
	}
	if len(d.TargetSegments) > 0 {
		rows, err := tx.Query(ctx, `SELECT id FROM notifications_v2.segments WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE`, d.TargetSegments)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil {
			return err
		}
		if len(ids) != len(d.TargetSegments) {
			return invalid("target segment does not exist or is deleted")
		}
	}
	return nil
}
func replaceTargets(ctx context.Context, tx pgx.Tx, id uuid.UUID, d DefinitionInput, now time.Time) error {
	// Table names are constants, never derived from a request.
	for _, table := range []string{"notification_target_users", "notification_target_segments", "notification_target_emails"} {
		if _, err := tx.Exec(ctx, `DELETE FROM notifications_v2.`+table+` WHERE notification_id=$1`, id); err != nil {
			return err
		}
	}
	for _, v := range d.TargetUsers {
		if _, err := tx.Exec(ctx, `INSERT INTO notifications_v2.notification_target_users VALUES($1,$2,$3)`, id, v, now); err != nil {
			return err
		}
	}
	for _, v := range d.TargetSegments {
		if _, err := tx.Exec(ctx, `INSERT INTO notifications_v2.notification_target_segments VALUES($1,$2,$3)`, id, v, now); err != nil {
			return err
		}
	}
	for _, v := range d.TargetEmails {
		if _, err := tx.Exec(ctx, `INSERT INTO notifications_v2.notification_target_emails VALUES($1,$2,$3)`, id, v, now); err != nil {
			return err
		}
	}
	return nil
}

func lockDefinition(ctx context.Context, tx pgx.Tx, p Producer, id uuid.UUID, revision int64) (Definition, error) {
	if err := validateProducer(p); err != nil {
		return Definition{}, err
	}
	if revision < 1 {
		return Definition{}, invalid("revision must be positive")
	}
	var found uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM notifications_v2.notifications WHERE id=$1 AND source_service=$2 AND deleted_at IS NULL FOR UPDATE`, id, p.Source).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return Definition{}, notFound
	}
	if err != nil {
		return Definition{}, err
	}
	d, err := readDefinition(ctx, tx, p.Source, id, false)
	if err != nil {
		return d, err
	}
	if d.Revision != revision {
		return d, &apiError{http.StatusPreconditionFailed, "revision changed; reload the definition"}
	}
	return d, nil
}

// Patch replaces supplied top-level fields. Objects and target
// arrays replace their whole field; null only clears documented nullable fields.
func mergeInput(current DefinitionInput, patch map[string]json.RawMessage) (DefinitionInput, error) {
	raw, _ := json.Marshal(current)
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	nullable := map[string]bool{"correlation_id": true, "scheduled_at": true, "cron_expression": true, "starts_at": true, "ends_at": true, "delivery_ttl_seconds": true}
	if len(patch) == 0 {
		return current, invalid("patch must contain at least one field")
	}
	for k, v := range patch {
		if _, ok := fields[k]; !ok {
			return current, invalid("field is not editable: " + k)
		}
		if strings.TrimSpace(string(v)) == "null" && !nullable[k] {
			return current, invalid("field cannot be null: " + k)
		}
		fields[k] = v
	}
	raw, _ = json.Marshal(fields)
	var result DefinitionInput
	if err := json.Unmarshal(raw, &result); err != nil {
		return current, invalid("invalid patch field type")
	}
	return result, normalize(&result)
}
func (s *Service) Patch(ctx context.Context, p Producer, id uuid.UUID, revision int64, patch map[string]json.RawMessage) (Definition, error) {
	tx, err := s.begin(ctx)
	if err != nil {
		return Definition{}, err
	}
	defer tx.Rollback(ctx)
	old, err := lockDefinition(ctx, tx, p, id, revision)
	if err != nil {
		return Definition{}, err
	}
	if old.Status == "cancelled" || old.Status == "completed" {
		return Definition{}, conflict("terminal definitions cannot be edited; create a new definition")
	}
	input, err := mergeInput(old.DefinitionInput, patch)
	if err != nil {
		return Definition{}, err
	}
	allowRetired := old.TemplateID == input.TemplateID && old.TemplateVersion == input.TemplateVersion
	if err = validateDependencies(ctx, tx, input, allowRetired); err != nil {
		return Definition{}, err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return Definition{}, err
	}
	next, err := nextRun(&input, now)
	if err != nil {
		return Definition{}, err
	}
	// Each edit creates a new revision with future scheduling. Frozen events stay intact.
	status := old.Status
	if status == "paused" {
		next = nil
	} else if next == nil {
		status = "completed"
	}
	_, err = tx.Exec(ctx, `UPDATE notifications_v2.notifications SET correlation_id=$3,notification_type_id=$4,mode_id=$5,template_id=$6,template_version=$7,message_details=$8,priority=$9,schedule_kind=$10,scheduled_at=$11,cron_expression=$12,timezone=$13,starts_at=$14,ends_at=$15,next_run_at=$16,misfire_policy=$17,delivery_ttl_seconds=$18,status=$19,revision=revision+1,updated_at=$20,updated_by=$21,notification_topic_id=$22 WHERE id=$1 AND source_service=$2`, id, p.Source, input.CorrelationID, input.NotificationTypeID, input.ModeID, input.TemplateID, input.TemplateVersion, input.MessageDetails, input.Priority, input.ScheduleKind, input.ScheduledAt, input.CronExpression, input.Timezone, input.StartsAt, input.EndsAt, next, input.MisfirePolicy, input.DeliveryTTLSeconds, status, now, p.ActorID, input.NotificationTopicID)
	if err != nil {
		return Definition{}, err
	}
	if err = replaceTargets(ctx, tx, id, input, now); err != nil {
		return Definition{}, err
	}
	d, err := readDefinition(ctx, tx, p.Source, id, false)
	if err != nil {
		return Definition{}, err
	}
	return d, tx.Commit(ctx)
}

func (s *Service) Transition(ctx context.Context, p Producer, id uuid.UUID, revision int64, action string) (Definition, error) {
	tx, err := s.begin(ctx)
	if err != nil {
		return Definition{}, err
	}
	defer tx.Rollback(ctx)
	d, err := lockDefinition(ctx, tx, p, id, revision)
	if err != nil {
		return Definition{}, err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return Definition{}, err
	}
	var next *time.Time
	status := d.Status
	var deleted *time.Time
	switch action {
	case "pause":
		if status != "active" {
			return Definition{}, conflict("only active definitions can be paused")
		}
		status = "paused"
	case "resume":
		if status != "paused" {
			return Definition{}, conflict("only paused definitions can be resumed")
		}
		if err = validateDependencies(ctx, tx, d.DefinitionInput, true); err != nil {
			return Definition{}, err
		}
		next, err = nextRun(&d.DefinitionInput, now)
		if err != nil {
			return Definition{}, err
		}
		status = "active"
		if next == nil {
			status = "completed"
		}
	case "cancel", "delete":
		status = "cancelled"
		if action == "delete" {
			deleted = &now
		}
		// Lock order is definition -> events -> deliveries. Future workers must use
		// this order and recheck cancellation before external sends.
		_, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_events SET status='cancelled',lease_token=NULL,lease_expires_at=NULL,updated_at=$2 WHERE notification_id=$1 AND (status IN ('pending','expanding','failed') OR (status='ready' AND EXISTS (SELECT 1 FROM notifications_v2.notification_deliveries d WHERE d.event_id=notification_events.id AND d.status IN ('pending','retrying','processing'))))`, id, now)
		if err != nil {
			return Definition{}, err
		}
		_, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_deliveries d SET status='cancelled',lease_token=NULL,lease_expires_at=NULL,updated_at=$2 FROM notifications_v2.notification_events e WHERE d.event_id=e.id AND e.notification_id=$1 AND d.status IN ('pending','retrying','processing')`, id, now)
		if err != nil {
			return Definition{}, err
		}
	default:
		return Definition{}, invalid("invalid lifecycle action")
	}
	_, err = tx.Exec(ctx, `UPDATE notifications_v2.notifications SET status=$3,next_run_at=$4,deleted_at=$5,revision=revision+1,updated_at=$6,updated_by=$7 WHERE id=$1 AND source_service=$2`, id, p.Source, status, next, deleted, now, p.ActorID)
	if err != nil {
		return Definition{}, err
	}
	result, err := readDefinition(ctx, tx, p.Source, id, true)
	if err != nil {
		return Definition{}, err
	}
	return result, tx.Commit(ctx)
}

type cursor struct {
	CreatedAt time.Time `json:"created_at"`
	ID        uuid.UUID `json:"id"`
}

func (s *Service) List(ctx context.Context, p Producer, limit int, token, status string) (ListResult, error) {
	result := ListResult{Items: []Definition{}}
	if err := validateProducer(p); err != nil {
		return result, err
	}
	if limit < 1 || limit > 100 {
		return result, invalid("limit must be between 1 and 100")
	}
	if status != "" && status != "active" && status != "paused" && status != "completed" && status != "cancelled" {
		return result, invalid("invalid status filter")
	}
	var at any
	var id any
	if token != "" {
		if len(token) > 512 {
			return result, invalid("invalid cursor")
		}
		raw, err := base64.RawURLEncoding.DecodeString(token)
		var c cursor
		if err != nil || json.Unmarshal(raw, &c) != nil || c.ID == uuid.Nil || c.CreatedAt.IsZero() {
			return result, invalid("invalid cursor")
		}
		at = c.CreatedAt
		id = c.ID
	}
	rows, err := s.db().Query(ctx, `SELECT `+projection+` FROM notifications_v2.notifications n WHERE n.source_service=$1 AND n.deleted_at IS NULL AND ($2='' OR n.status=$2) AND ($3::timestamptz IS NULL OR (n.created_at,n.id)<($3,$4::uuid)) ORDER BY n.created_at DESC,n.id DESC LIMIT $5`, p.Source, status, at, id, limit+1)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		var d Definition
		if err = rows.Scan(&raw); err != nil {
			return result, err
		}
		if err = json.Unmarshal(raw, &d); err != nil {
			return result, err
		}
		result.Items = append(result.Items, d)
	}
	if err = rows.Err(); err != nil {
		return result, err
	}
	if len(result.Items) > limit {
		result.Items = result.Items[:limit]
		last := result.Items[limit-1]
		raw, _ := json.Marshal(cursor{last.CreatedAt, last.ID})
		result.NextCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return result, nil
}
