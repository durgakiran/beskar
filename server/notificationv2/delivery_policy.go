package notificationv2

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"net"
	"time"

	"github.com/durgakiran/beskar/notification"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	gomail "github.com/wneessen/go-mail"
)

func (w *DeliveryWorker) preflight(ctx context.Context, tx pgx.Tx, d deliveryRecord, now time.Time) (bool, error) {
	stop := func(status, reason string) (bool, error) {
		return false, setDeliveryState(ctx, tx, d.ID, status, reason, nil)
	}
	deferUntil := func(reason string, next time.Time) (bool, error) {
		if d.ExpiresAt != nil && !next.Before(*d.ExpiresAt) {
			return stop("expired", "occurrence_expired")
		}
		return false, setDeliveryState(ctx, tx, d.ID, d.Status, reason, &next)
	}
	if d.ExpiresAt != nil && !now.Before(*d.ExpiresAt) {
		return stop("expired", "occurrence_expired")
	}
	if !d.ChannelMatches {
		return stop("failed", "provider_channel_mismatch")
	}
	if !d.ProviderEnabled {
		return deferUntil("provider_disabled", now.Add(30*time.Second))
	}
	if d.Mode == "email" && (d.Adapter != "smtp" || d.ProviderID != w.config.SMTPProviderID) {
		return stop("failed", "smtp_provider_not_bound")
	}
	if d.Mode == "in_app" && d.Adapter != "in_app" {
		return stop("failed", "unsupported_in_app_adapter")
	}
	if d.RequestsPerSecond != nil && *d.RequestsPerSecond < 1 {
		return stop("failed", "invalid_provider_rate")
	}
	// JSON null user_id decodes to uuid.Nil. Query with SQL NULL for external
	// addresses so no synthetic user preference or quiet-hour row can apply.
	var userID any
	if d.UserID != uuid.Nil {
		userID = d.UserID
	} else if d.Mode != "email" {
		return stop("failed", "user_required_for_channel")
	}
	var allow bool
	var q quietWindow
	var start, end float64
	err := tx.QueryRow(ctx, `SELECT COALESCE(p.opt_in,t.default_opt_in),COALESCE(q.enabled,false),COALESCE(q.timezone,'UTC'),COALESCE(extract(epoch FROM q.start_time),0)::double precision,COALESCE(extract(epoch FROM q.end_time),0)::double precision FROM notifications_v2.notification_types t LEFT JOIN notifications_v2.user_preferences p ON p.notification_type_id=t.id AND p.user_id=$1 AND p.mode_id=$2 LEFT JOIN notifications_v2.user_quiet_hours q ON q.user_id=$1 AND q.mode_id=$2 WHERE t.id=$3`, userID, d.ModeID, d.TypeID).Scan(&allow, &q.enabled, &q.timezone, &start, &end)
	if err != nil {
		return false, err
	}
	if !allow {
		return stop("suppressed", "preference_opt_out")
	}
	// Existing invitation email opt-outs survive the producer cutover. This
	// mapping is server-owned, not a producer-supplied policy bypass.
	if d.Mode == "email" && d.TopicCode == "space_invite_created" && d.UserID != uuid.Nil {
		var blocked bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM notifications.email_preferences WHERE recipient_user_id=$1 AND category='space_invite' AND NOT enabled)`, d.UserID).Scan(&blocked); err != nil {
			return false, err
		}
		if blocked {
			return stop("suppressed", "legacy_preference_opt_out")
		}
	}
	var dest map[string]string
	if json.Unmarshal(d.Destination, &dest) != nil {
		return stop("failed", "invalid_destination")
	}
	endpoint := dest["email"]
	if d.Mode == "in_app" {
		endpoint = dest["user_id"]
		if endpoint != d.UserID.String() {
			return stop("failed", "in_app_recipient_mismatch")
		}
	}
	hash, err := DestinationHash(w.config.HashKey, d.Mode, endpoint)
	if err != nil {
		return stop("failed", "invalid_destination")
	}
	var suppressed bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM notifications_v2.notification_suppressions WHERE mode_id=$1 AND destination_hash=$2 AND (expires_at IS NULL OR expires_at>clock_timestamp()))`, d.ModeID, hash).Scan(&suppressed); err != nil {
		return false, err
	}
	if suppressed {
		return stop("suppressed", "destination_suppressed")
	}
	if d.Mode == "email" {
		// Preserve the existing account-wide suppression list during coexistence.
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM notifications.email_suppressions WHERE email=$1)`, notification.NormalizeEmail(endpoint)).Scan(&suppressed); err != nil {
			return false, err
		}
		if suppressed {
			return stop("suppressed", "legacy_destination_suppressed")
		}
	}
	q.start = time.Duration(start * float64(time.Second))
	q.end = time.Duration(end * float64(time.Second))
	eligible, err := nextAllowed(now, q)
	if err != nil {
		return stop("failed", "quiet_hours_invalid")
	}
	if eligible.After(now) {
		if _, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_deliveries SET eligible_at=GREATEST(eligible_at,$2),available_at=GREATEST(available_at,$2) WHERE id=$1`, d.ID, eligible); err != nil {
			return false, err
		}
		return deferUntil("quiet_hours", eligible)
	}
	return true, nil
}

// SMTP only proves acceptance, not delivery. A typed rejection or a failure
// before DATA is safe to classify; ambiguous transport failures need review.
func classifyDeliveryError(err error) (status, code string) {
	if err == nil {
		return "accepted", ""
	}
	var send *gomail.SendError
	if errors.As(err, &send) {
		if send.Reason == gomail.ErrSMTPReset {
			return "unknown", "smtp_outcome_unknown"
		}
		reply := send.ErrorCode()
		if reply >= 500 && reply < 600 {
			return "permanent_failure", "smtp_rejected"
		}
		if reply >= 400 && reply < 500 {
			return "transient_failure", "smtp_temporary_rejection"
		}
		switch send.Reason {
		case gomail.ErrGetSender, gomail.ErrGetRcpts, gomail.ErrNoUnencoded:
			return "permanent_failure", "smtp_message_invalid"
		case gomail.ErrSMTPMailFrom, gomail.ErrSMTPRcptTo, gomail.ErrSMTPData, gomail.ErrConnCheck:
			return "transient_failure", "smtp_pre_data_failure"
		}
	}
	var provider *notification.ProviderError
	if errors.As(err, &provider) {
		switch provider.Code {
		case "smtp_host_missing", "from_address_missing", "message_build_failed", "smtp_client_create_failed", "email_disabled":
			return "permanent_failure", provider.Code
		}
	}
	var op *net.OpError
	if errors.As(err, &op) && op.Op == "dial" {
		return "transient_failure", "smtp_connection_failed"
	}
	return "unknown", "smtp_outcome_unknown"
}
func deliveryRetry(now time.Time, p deliveryPolicy, attempt int) time.Time {
	delay := time.Duration(p.RetryInitial) * time.Second
	maxDelay := time.Duration(p.RetryMax) * time.Second
	for i := 1; i < attempt && delay < maxDelay; i++ {
		delay = min(delay*2, maxDelay)
	}
	return now.Add(delay/2 + time.Duration(rand.Int64N(int64(delay/2)+1)))
}
func (w *DeliveryWorker) finishEmail(ctx context.Context, conn *pgxpool.Conn, c deliveryCandidate, original deliveryRecord, token, attempt uuid.UUID, result notification.ProviderResult, sendErr error, p deliveryPolicy) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollbackAudience(tx)
	d, err := lockDelivery(ctx, tx, c, false)
	if err != nil {
		return err
	}
	outcome, code := classifyDeliveryError(sendErr)
	// This attempt belongs to this caller even if cancellation cleared the
	// delivery lease. Record its result without altering another owner's state.
	_, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_delivery_attempts SET status=$3,provider_message_id=NULLIF($4,''),error_code=NULLIF($5,''),error_message=NULL,finished_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND status='started'`, attempt, token, outcome, result.MessageID, code)
	if err != nil {
		return err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return err
	}
	if d.Status != "processing" || d.LeaseToken == nil || *d.LeaseToken != token || d.LeaseExpiresAt == nil || !d.LeaseExpiresAt.After(now) {
		return tx.Commit(ctx)
	}
	status := "failed"
	var available *time.Time
	switch outcome {
	case "accepted":
		status = "accepted"
	case "unknown":
		status = "dead_lettered"
	case "transient_failure":
		next := deliveryRetry(now, p, original.AttemptCount+1)
		available = &next
		status = "retrying"
		if d.ExpiresAt != nil && !next.Before(*d.ExpiresAt) {
			status = "expired"
			code = "occurrence_expired"
		} else if original.AttemptCount+1 >= p.MaxAttempts {
			status = "dead_lettered"
			code = "attempts_exhausted"
		}
	}
	if err = setDeliveryState(ctx, tx, d.ID, status, code, available); err != nil {
		return err
	}
	if outcome == "accepted" {
		if _, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_deliveries SET provider_message_id=NULLIF($2,''),accepted_at=clock_timestamp() WHERE id=$1`, d.ID, result.MessageID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
