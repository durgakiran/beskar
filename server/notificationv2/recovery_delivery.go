package notificationv2

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Expired SMTP claims with a started/unknown attempt are never blindly resent.
// In-app writes and their status commit atomically, so an abandoned claim with
// no committed send attempt can safely return to the queue.
func recoverExpiredDelivery(ctx context.Context, tx pgx.Tx, d deliveryRecord) error {
	var latest string
	var messageID *string
	err := tx.QueryRow(ctx, `SELECT status,provider_message_id FROM notifications_v2.notification_delivery_attempts WHERE delivery_id=$1 ORDER BY attempt_number DESC LIMIT 1`, d.ID).Scan(&latest, &messageID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	status, code := "retrying", "abandoned_claim"
	if latest == "accepted" {
		// Acceptance was recorded after the lease elapsed; preserve that knowledge.
		status, code = "accepted", ""
		if d.Mode == "in_app" {
			status = "delivered"
		}
	} else if latest == "permanent_failure" {
		status, code = "failed", "provider_permanent_failure"
	} else if latest == "started" || latest == "unknown" {
		status, code = "dead_lettered", "smtp_outcome_unknown"
		if d.Mode == "in_app" {
			status, code = "retrying", "in_app_claim_abandoned"
		}
		_, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_delivery_attempts SET status='unknown',error_code=$2,finished_at=clock_timestamp() WHERE delivery_id=$1 AND status='started'`, d.ID, code)
		if err != nil {
			return err
		}
	}
	if d.DefinitionStatus == "cancelled" || d.DeletedAt != nil || d.EventStatus == "cancelled" {
		status, code = "cancelled", "definition_cancelled"
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return err
	}
	var available *time.Time
	if status == "retrying" {
		var policy deliveryPolicy
		if json.Unmarshal(d.Policy, &policy) != nil || !policy.valid() {
			status, code = "failed", "invalid_retry_policy"
		} else if d.AttemptCount >= policy.MaxAttempts {
			status, code = "dead_lettered", "attempts_exhausted"
		} else {
			next := deliveryRetry(now, policy, d.AttemptCount)
			if next.Before(d.AvailableAt) {
				next = d.AvailableAt
			}
			available = &next
		}
	}
	expiryCheck := now
	if available != nil {
		expiryCheck = *available
	}
	if status == "retrying" && d.ExpiresAt != nil && !expiryCheck.Before(*d.ExpiresAt) {
		status, code = "expired", "occurrence_expired"
	}
	if err = setDeliveryState(ctx, tx, d.ID, status, code, available); err != nil {
		return err
	}
	if status == "accepted" || status == "delivered" {
		_, err = tx.Exec(ctx, `UPDATE notifications_v2.notification_deliveries SET provider_message_id=$2,accepted_at=COALESCE(accepted_at,clock_timestamp()),delivered_at=CASE WHEN $3='delivered' THEN COALESCE(delivered_at,clock_timestamp()) ELSE delivered_at END WHERE id=$1`, d.ID, messageID, status)
	}
	return err
}
