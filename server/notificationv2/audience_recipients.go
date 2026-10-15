package notificationv2

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type audienceRecipient struct {
	userID              uuid.UUID
	hash                string
	provider            uuid.UUID
	destination, policy json.RawMessage
	status, reason      string
	eligible, available time.Time
}

type audiencePreference struct {
	optIn *bool
	quiet quietWindow
}

func (w *AudienceExpander) prepareAudience(ctx context.Context, tx pgx.Tx, d Definition, scheduled time.Time, expires *time.Time) ([]audienceRecipient, error) {
	var mode string
	var defaultOptIn bool
	err := tx.QueryRow(ctx, `SELECT m.code,t.default_opt_in FROM notifications_v2.notification_modes m CROSS JOIN notifications_v2.notification_types t JOIN notifications_v2.notification_topics topic ON topic.notification_type_id=t.id WHERE m.id=$1 AND t.id=$2 AND topic.id=$3`, d.ModeID, d.NotificationTypeID, d.NotificationTopicID).Scan(&mode, &defaultOptIn)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, expansionFailure("invalid_event_catalog", true)
	}
	if err != nil {
		return nil, err
	}
	if len(d.TargetEmails) > 0 && mode != "email" {
		return nil, expansionFailure("email_targets_require_email_mode", true)
	}
	if mode != "email" && mode != "in_app" {
		return nil, expansionFailure("unsupported_delivery_mode", true)
	}
	var templateMode int16
	if err = tx.QueryRow(ctx, `SELECT mode_id FROM notifications_v2.notification_templates WHERE id=$1 AND version=$2`, d.TemplateID, d.TemplateVersion).Scan(&templateMode); err != nil {
		return nil, expansionFailure("event_template_unavailable", true)
	}
	if templateMode != d.ModeID {
		return nil, expansionFailure("event_template_mode_mismatch", true)
	}
	var provider uuid.UUID
	var maxAttempts, initial, maxDelay int
	err = tx.QueryRow(ctx, `SELECT p.id,r.max_attempts,r.retry_initial_seconds,r.retry_max_seconds FROM notifications_v2.notification_routes r JOIN notifications_v2.notification_providers p ON p.id=r.provider_id AND p.mode_id=r.mode_id WHERE r.notification_type_id=$1 AND r.mode_id=$2 AND r.enabled AND p.enabled`, d.NotificationTypeID, d.ModeID).Scan(&provider, &maxAttempts, &initial, &maxDelay)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, expansionFailure("route_unavailable", false)
	}
	if err != nil {
		return nil, err
	}
	policy, _ := json.Marshal(map[string]any{"snapshot_version": 1, "max_attempts": maxAttempts, "retry_initial_seconds": initial, "retry_max_seconds": maxDelay, "quiet_hours_bypass": false, "notification_topic_id": d.NotificationTopicID})
	if len(d.TargetSegments) > 0 {
		var n int
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM notifications_v2.segments WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL`, d.TargetSegments).Scan(&n); err != nil {
			return nil, err
		}
		if n != len(d.TargetSegments) {
			return nil, expansionFailure("target_segment_unavailable", true)
		}
	}
	rows, err := tx.Query(ctx, `SELECT user_id FROM (SELECT unnest($1::uuid[]) AS user_id UNION SELECT user_id FROM notifications_v2.segment_users WHERE segment_id=ANY($2::uuid[])) audience ORDER BY user_id LIMIT $3`, d.TargetUsers, d.TargetSegments, w.config.MaxRecipients+1)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, err
	}
	if len(ids)+len(d.TargetEmails) > w.config.MaxRecipients {
		return nil, expansionFailure("audience_limit_exceeded", true)
	}
	if len(ids) == 0 && len(d.TargetEmails) == 0 {
		return []audienceRecipient{}, nil
	}
	users := map[uuid.UUID]AudienceUser{}
	if len(ids) > 0 {
		users, err = w.directory.Resolve(ctx, tx, ids, mode == "email")
		if err != nil {
			return nil, expansionFailure("directory_unavailable", false)
		}
	}
	preferences := map[uuid.UUID]audiencePreference{}
	rows, err = tx.Query(ctx, `SELECT u.id,p.opt_in,COALESCE(q.enabled,false),COALESCE(q.timezone,'UTC'),COALESCE(extract(epoch FROM q.start_time),0)::double precision,COALESCE(extract(epoch FROM q.end_time),0)::double precision FROM unnest($1::uuid[]) u(id) LEFT JOIN notifications_v2.user_preferences p ON p.user_id=u.id AND p.notification_type_id=$2 AND p.mode_id=$3 LEFT JOIN notifications_v2.user_quiet_hours q ON q.user_id=u.id AND q.mode_id=$3`, ids, d.NotificationTypeID, d.ModeID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id uuid.UUID
		var p audiencePreference
		var start, end float64
		if err = rows.Scan(&id, &p.optIn, &p.quiet.enabled, &p.quiet.timezone, &start, &end); err != nil {
			rows.Close()
			return nil, err
		}
		p.quiet.start = time.Duration(start * float64(time.Second))
		p.quiet.end = time.Duration(end * float64(time.Second))
		preferences[id] = p
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return nil, err
	}
	recipients := make([]audienceRecipient, 0, len(ids))
	hashes := []string{}
	seenEmails := map[string]bool{}
	for _, id := range ids {
		r := audienceRecipient{userID: id, provider: provider, destination: json.RawMessage(`{}`), policy: policy, status: "pending", eligible: scheduled, available: now}
		if r.available.Before(scheduled) {
			r.available = scheduled
		}
		u, exists := users[id]
		endpoint := id.String()
		if !exists {
			r.status = "failed"
			r.reason = "recipient_not_found"
		} else if mode == "email" {
			endpoint, err = NormalizeDestination(mode, u.Email)
			if err == nil {
				seenEmails[endpoint] = true
			}
			if err != nil {
				r.status = "failed"
				r.reason = "invalid_email_destination"
			} else if !u.EmailVerified {
				r.status = "failed"
				r.reason = "email_not_verified"
			} else {
				r.destination, _ = json.Marshal(map[string]string{"email": endpoint})
			}
		} else {
			r.destination, _ = json.Marshal(map[string]string{"user_id": id.String()})
		}
		pref := preferences[id]
		allow := defaultOptIn
		if pref.optIn != nil {
			allow = *pref.optIn
		}
		if !allow {
			r.status = "suppressed"
			r.reason = "preference_opt_out"
		}
		if r.status == "pending" {
			hash, err := DestinationHash(w.config.HashKey, mode, endpoint)
			if err != nil {
				return nil, expansionFailure("destination_hash_configuration_invalid", true)
			}
			r.hash = hash
			hashes = append(hashes, hash)
			allowed, err := nextAllowed(r.available, pref.quiet)
			if err != nil {
				return nil, expansionFailure("quiet_hours_invalid", true)
			}
			if allowed.After(r.available) {
				r.eligible = allowed
				r.available = allowed
			}
		}
		if expires != nil && !r.available.Before(*expires) {
			r.status = "expired"
			r.reason = "occurrence_expired"
		}
		recipients = append(recipients, r)
	}
	for _, address := range d.TargetEmails {
		endpoint, e := NormalizeDestination("email", address)
		if e != nil {
			return nil, expansionFailure("invalid_email_destination", true)
		}
		if seenEmails[endpoint] {
			continue
		}
		seenEmails[endpoint] = true
		hash, e := DestinationHash(w.config.HashKey, "email", endpoint)
		if e != nil {
			return nil, e
		}
		destination, _ := json.Marshal(map[string]string{"email": endpoint})
		r := audienceRecipient{provider: provider, destination: destination, policy: policy, status: "pending", eligible: scheduled, available: now, hash: hash}
		if r.available.Before(scheduled) {
			r.available = scheduled
		}
		if !defaultOptIn {
			r.status = "suppressed"
			r.reason = "preference_opt_out"
		}
		if expires != nil && !r.available.Before(*expires) {
			r.status = "expired"
			r.reason = "occurrence_expired"
		}
		recipients = append(recipients, r)
		hashes = append(hashes, hash)
	}
	rows, err = tx.Query(ctx, `SELECT destination_hash FROM notifications_v2.notification_suppressions WHERE mode_id=$1 AND destination_hash=ANY($2::text[]) AND (expires_at IS NULL OR expires_at>clock_timestamp())`, d.ModeID, hashes)
	if err != nil {
		return nil, err
	}
	blocked, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	suppressed := map[string]bool{}
	for _, h := range blocked {
		suppressed[h] = true
	}
	for i := range recipients {
		r := &recipients[i]
		if r.status == "pending" && suppressed[r.hash] {
			r.status = "suppressed"
			r.reason = "destination_suppressed"
		}
	}
	return recipients, nil
}
func (w *AudienceExpander) insertRecipient(ctx context.Context, tx pgx.Tx, event uuid.UUID, d Definition, r audienceRecipient) error {
	var userID any
	if r.userID != uuid.Nil {
		userID = r.userID
	}
	_, err := tx.Exec(ctx, `INSERT INTO notifications_v2.notification_deliveries
 (id,event_id,user_id,notification_type_id,mode_id,provider_id,destination_snapshot,message_details_snapshot,policy_snapshot,priority,status,eligible_at,available_at,attempt_count,last_error_code,created_at,updated_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,NULLIF($14,''),clock_timestamp(),clock_timestamp())`, uuid.New(), event, userID, d.NotificationTypeID, d.ModeID, r.provider, r.destination, d.MessageDetails, r.policy, d.Priority, r.status, r.eligible, r.available, r.reason)
	return err
}
