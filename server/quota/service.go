package quota

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/docversioncleanup"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"
)

func logger() *zap.Logger {
	return core.Logger
}

func quotaConfig() Config {
	return LoadConfig()
}

func monitorEnabled() bool {
	config := quotaConfig()
	if !config.QuotaSystemEnabled {
		return false
	}
	value := strings.TrimSpace(os.Getenv("QUOTA_MONITOR_ENABLED"))
	if value == "" {
		return true
	}
	enabled, err := strconv.ParseBool(value)
	if err != nil {
		return true
	}
	return enabled
}

func storageBlockingEnabled() bool {
	config := quotaConfig()
	return config.QuotaSystemEnabled && config.StorageBlockingEnabled && !config.MonitorOnlyEnabled
}

func collaboratorBlockingEnabled() bool {
	config := quotaConfig()
	return config.QuotaSystemEnabled && config.CollaboratorBlockingEnabled && !config.MonitorOnlyEnabled
}

func quotaSystemEnabled() bool {
	return quotaConfig().QuotaSystemEnabled
}

func percentage(current int64, limit *int64) *float64 {
	if limit == nil || *limit <= 0 {
		return nil
	}
	value := (float64(current) / float64(*limit)) * 100
	return &value
}

func getAccountForUser(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error) {
	var accountID uuid.UUID
	err := core.GetPool().QueryRow(ctx, getAccountForUserQuery, userID).Scan(&accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &accountID, nil
}

func resolvePageContext(ctx context.Context, pageID int64) (pageQuotaContextRow, error) {
	var row pageQuotaContextRow
	err := core.GetPool().QueryRow(ctx, getPageQuotaContextQuery, pageID).Scan(&row.PageID, &row.SpaceID, &row.AccountID)
	return row, err
}

func getAccountUsageRow(ctx context.Context, accountID uuid.UUID) (accountUsageRow, error) {
	var row accountUsageRow
	err := core.GetPool().QueryRow(ctx, getAccountUsageQuery, accountID).Scan(
		&row.AccountID,
		&row.UserID,
		&row.SpaceCount,
		&row.StorageBytesUsed,
		&row.StorageBytesReserved,
	)
	return row, err
}

func getSpaceUsageRow(ctx context.Context, spaceID uuid.UUID) (spaceUsageRow, error) {
	var row spaceUsageRow
	err := core.GetPool().QueryRow(ctx, getSpaceUsageQuery, spaceID).Scan(
		&row.SpaceID,
		&row.AccountID,
		&row.StorageBytesUsed,
		&row.StorageBytesReserved,
	)
	return row, err
}

func getSpaceUsageStateForUpdate(ctx context.Context, tx pgx.Tx, spaceID uuid.UUID) (spaceUsageStateForUpdateRow, error) {
	var row spaceUsageStateForUpdateRow
	err := tx.QueryRow(ctx, getSpaceUsageStateForUpdateQuery, spaceID).Scan(
		&row.AccountID,
		&row.StorageBytesUsed,
		&row.StorageBytesReserved,
		&row.UpdatedAt,
		&row.LastReconciledAt,
	)
	return row, err
}

func getAccountReconciledStorage(ctx context.Context, accountID uuid.UUID) (int64, error) {
	var total int64
	err := core.GetPool().QueryRow(ctx, getAccountReconciledStorageQuery, accountID).Scan(&total)
	return total, err
}

func getSpaceReconciledStorage(ctx context.Context, spaceID uuid.UUID) (int64, error) {
	var total int64
	err := core.GetPool().QueryRow(ctx, getSpaceReconciledStorageQuery, spaceID).Scan(&total)
	return total, err
}

func getActiveSubscription(ctx context.Context, accountID uuid.UUID) (*subscriptionRow, error) {
	var row subscriptionRow
	err := core.GetPool().QueryRow(ctx, getActiveSubscriptionQuery, accountID).Scan(
		&row.ID,
		&row.AccountID,
		&row.PlanID,
		&row.Status,
		&row.EffectiveFrom,
		&row.EffectiveTo,
		&row.Source,
		&row.PlanCode,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func getPlanLimits(ctx context.Context, planID uuid.UUID) (map[string]PlanLimit, error) {
	rows, err := core.GetPool().Query(ctx, getPlanLimitsQuery, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	limits := map[string]PlanLimit{}
	for rows.Next() {
		var row planLimitRow
		if err := rows.Scan(&row.MetricKey, &row.LimitValue, &row.LimitUnit, &row.EnforcementMode); err != nil {
			return nil, err
		}
		limits[row.MetricKey] = PlanLimit{
			MetricKey:       row.MetricKey,
			LimitValue:      row.LimitValue,
			LimitUnit:       row.LimitUnit,
			EnforcementMode: row.EnforcementMode,
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return limits, nil
}

func getLimitPointer(limits map[string]PlanLimit, metricKey string) *int64 {
	limit, ok := limits[metricKey]
	if !ok {
		return nil
	}
	value := limit.LimitValue
	return &value
}

func documentHistoryRetentionDays(limits map[string]PlanLimit) int64 {
	if limit, ok := limits[metricDocumentHistoryRetention]; ok && limit.LimitValue > 0 && limit.LimitUnit == "days" {
		return limit.LimitValue
	}
	return int64(docversioncleanup.LoadConfig().DefaultRetentionDays)
}

func getDocumentHistoryRetentionDaysForAccount(ctx context.Context, accountID uuid.UUID) (int64, error) {
	fallback := documentHistoryRetentionDays(nil)
	var retentionDays int64
	err := core.GetPool().QueryRow(ctx, getActiveDocumentHistoryRetentionDaysQuery, accountID, fallback).Scan(&retentionDays)
	if errors.Is(err, pgx.ErrNoRows) {
		return fallback, nil
	}
	if err != nil {
		return 0, err
	}
	return retentionDays, nil
}

func getCollaboratorCount(spaceID uuid.UUID) (int, error) {
	tuples, err := core.GetSubjectsAssociatedWithEntity("space", spaceID.String())
	if err != nil {
		return 0, err
	}

	users := make(map[string]struct{})
	for _, tuple := range tuples {
		if tuple == nil || tuple.Subject == nil || tuple.Subject.Type != "user" {
			continue
		}
		users[tuple.Subject.Id] = struct{}{}
	}
	return len(users), nil
}

func getPendingInviteCount(ctx context.Context, spaceID uuid.UUID) (int, error) {
	var count int
	err := core.GetPool().QueryRow(ctx, getPendingInviteCountQuery, spaceID.String()).Scan(&count)
	return count, err
}

func getPageStorageBytes(ctx context.Context, tx pgx.Tx, pageID int64) (int64, error) {
	var total int64
	err := tx.QueryRow(ctx, getPageStorageBytesQuery, pageID).Scan(&total)
	return total, err
}

func eventMetadataBytes(metadata map[string]any) []byte {
	if len(metadata) == 0 {
		return nil
	}
	bytes, err := json.Marshal(metadata)
	if err != nil {
		logger().Warn("quota event metadata marshal failed", zap.Error(err))
		return nil
	}
	return bytes
}

func insertUsageEvent(ctx context.Context, tx pgx.Tx, reservation UploadReservation, eventType string, deltaValue int64) error {
	_, err := tx.Exec(
		ctx,
		insertSpaceUsageEventQuery,
		reservation.SpaceID,
		metricStorageBytesTotal,
		eventType,
		deltaValue,
		reservation.SourceType,
		reservation.SourceID,
		reservation.CorrelationID,
		eventMetadataBytes(reservation.Metadata),
	)
	return err
}

func loadLockedUsageRows(ctx context.Context, tx pgx.Tx, accountID uuid.UUID) ([]lockedUsageRow, error) {
	rows, err := tx.Query(ctx, getAccountUsageRowsForUpdateQuery, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, pgx.RowToStructByNameLax[lockedUsageRow])
}

func loadAllSpaceUsageStates(ctx context.Context) ([]spaceUsageStateRow, error) {
	rows, err := core.GetPool().Query(ctx, getAllSpaceUsageStatesQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	states := []spaceUsageStateRow{}
	for rows.Next() {
		var row spaceUsageStateRow
		if err := rows.Scan(
			&row.SpaceID,
			&row.AccountID,
			&row.StorageBytesUsed,
			&row.StorageBytesReserved,
			&row.UpdatedAt,
			&row.LastReconciledAt,
		); err != nil {
			return nil, err
		}
		states = append(states, row)
	}
	return states, rows.Err()
}

func loadAllActiveSpaceIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := core.GetPool().Query(ctx, getAllActiveSpaceIDsQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (uuid.UUID, error) {
		var id uuid.UUID
		err := row.Scan(&id)
		return id, err
	})
}

func storageLimitForAccount(ctx context.Context, accountID uuid.UUID) (*int64, error) {
	subscription, err := getActiveSubscription(ctx, accountID)
	if err != nil || subscription == nil {
		return nil, err
	}
	limits, err := getPlanLimits(ctx, subscription.PlanID)
	if err != nil {
		return nil, err
	}
	return getLimitPointer(limits, metricStorageBytesTotal), nil
}

func collaboratorLimitForAccount(ctx context.Context, accountID uuid.UUID) (*int64, *subscriptionRow, map[string]PlanLimit, error) {
	subscription, err := getActiveSubscription(ctx, accountID)
	if err != nil || subscription == nil {
		return nil, subscription, nil, err
	}
	limits, err := getPlanLimits(ctx, subscription.PlanID)
	if err != nil {
		return nil, nil, nil, err
	}
	return getLimitPointer(limits, metricCollaboratorsPerSpace), subscription, limits, nil
}

func loadQuotaState(ctx context.Context, accountID uuid.UUID) (accountUsageRow, int64, *subscriptionRow, map[string]PlanLimit, error) {
	usage, err := getAccountUsageRow(ctx, accountID)
	if err != nil {
		return accountUsageRow{}, 0, nil, nil, err
	}
	reconciled, err := getAccountReconciledStorage(ctx, accountID)
	if err != nil {
		return accountUsageRow{}, 0, nil, nil, err
	}
	subscription, err := getActiveSubscription(ctx, accountID)
	if err != nil {
		return accountUsageRow{}, 0, nil, nil, err
	}
	limits := map[string]PlanLimit{}
	if subscription != nil {
		limits, err = getPlanLimits(ctx, subscription.PlanID)
		if err != nil {
			return accountUsageRow{}, 0, nil, nil, err
		}
	}
	return usage, reconciled, subscription, limits, nil
}

func GetAccountUsageSummaryForUser(ctx context.Context, userID uuid.UUID) (AccountUsageSummary, error) {
	accountID, err := getAccountForUser(ctx, userID)
	if err != nil {
		return AccountUsageSummary{}, err
	}
	if accountID == nil {
		return AccountUsageSummary{
			AccountID:                    uuid.Nil,
			UserID:                       userID,
			DocumentHistoryRetentionDays: documentHistoryRetentionDays(nil),
			SpaceCount:                   0,
		}, nil
	}

	usage, reconciled, subscription, limits, err := loadQuotaState(ctx, *accountID)
	if err != nil {
		return AccountUsageSummary{}, err
	}
	retentionDays, err := getDocumentHistoryRetentionDaysForAccount(ctx, usage.AccountID)
	if err != nil {
		return AccountUsageSummary{}, err
	}

	storageLimit := getLimitPointer(limits, metricStorageBytesTotal)
	summary := AccountUsageSummary{
		AccountID:                    usage.AccountID,
		UserID:                       usage.UserID,
		AccountStorageUsed:           usage.StorageBytesUsed,
		AccountStorageReserved:       usage.StorageBytesReserved,
		AccountStorageLimit:          storageLimit,
		AccountPercentConsumed:       percentage(usage.StorageBytesUsed, storageLimit),
		ReconciledAccountStorageUsed: reconciled,
		DocumentHistoryRetentionDays: retentionDays,
		SpaceCount:                   usage.SpaceCount,
	}
	if subscription != nil {
		summary.AccountPlanCode = subscription.PlanCode
		summary.AccountSubscriptionStatus = subscription.Status
	}
	return summary, nil
}

func GetAccountUsageSummaryByAccountID(ctx context.Context, accountID uuid.UUID) (AccountUsageSummary, error) {
	usage, reconciled, subscription, limits, err := loadQuotaState(ctx, accountID)
	if err != nil {
		return AccountUsageSummary{}, err
	}
	retentionDays, err := getDocumentHistoryRetentionDaysForAccount(ctx, usage.AccountID)
	if err != nil {
		return AccountUsageSummary{}, err
	}

	storageLimit := getLimitPointer(limits, metricStorageBytesTotal)
	summary := AccountUsageSummary{
		AccountID:                    usage.AccountID,
		UserID:                       usage.UserID,
		AccountStorageUsed:           usage.StorageBytesUsed,
		AccountStorageReserved:       usage.StorageBytesReserved,
		AccountStorageLimit:          storageLimit,
		AccountPercentConsumed:       percentage(usage.StorageBytesUsed, storageLimit),
		ReconciledAccountStorageUsed: reconciled,
		DocumentHistoryRetentionDays: retentionDays,
		SpaceCount:                   usage.SpaceCount,
	}
	if subscription != nil {
		summary.AccountPlanCode = subscription.PlanCode
		summary.AccountSubscriptionStatus = subscription.Status
	}
	return summary, nil
}

func GetSpaceUsageSummary(ctx context.Context, spaceID uuid.UUID) (SpaceUsageSummary, error) {
	usage, err := getSpaceUsageRow(ctx, spaceID)
	if err != nil {
		return SpaceUsageSummary{}, err
	}
	reconciled, err := getSpaceReconciledStorage(ctx, spaceID)
	if err != nil {
		return SpaceUsageSummary{}, err
	}
	subscription, err := getActiveSubscription(ctx, usage.AccountID)
	if err != nil {
		return SpaceUsageSummary{}, err
	}
	limits := map[string]PlanLimit{}
	if subscription != nil {
		limits, err = getPlanLimits(ctx, subscription.PlanID)
		if err != nil {
			return SpaceUsageSummary{}, err
		}
	}
	memberCount, err := getCollaboratorCount(spaceID)
	if err != nil {
		return SpaceUsageSummary{}, err
	}
	retentionDays, err := getDocumentHistoryRetentionDaysForAccount(ctx, usage.AccountID)
	if err != nil {
		return SpaceUsageSummary{}, err
	}

	collaboratorLimit := getLimitPointer(limits, metricCollaboratorsPerSpace)
	summary := SpaceUsageSummary{
		SpaceID:                      usage.SpaceID,
		AccountID:                    usage.AccountID,
		SpaceStorageUsed:             usage.StorageBytesUsed,
		SpaceStorageReserved:         usage.StorageBytesReserved,
		ReconciledSpaceStorageUsed:   reconciled,
		CollaboratorLimitPerSpace:    collaboratorLimit,
		DocumentHistoryRetentionDays: retentionDays,
		CurrentCollaboratorCount:     memberCount,
	}
	if subscription != nil {
		summary.AccountPlanCode = subscription.PlanCode
		summary.AccountSubscriptionStatus = subscription.Status
	}
	if collaboratorLimit != nil {
		summary.CollaboratorPercentConsumed = percentage(int64(memberCount), collaboratorLimit)
	}
	return summary, nil
}

func MonitorUploadAttempt(ctx context.Context, input UploadMonitorInput) {
	if !monitorEnabled() || input.AttemptBytes <= 0 {
		return
	}

	pageContext, err := resolvePageContext(ctx, input.PageID)
	if err != nil {
		logger().Warn("quota monitor could not resolve page context",
			zap.Int64("page_id", input.PageID),
			zap.String("source_type", input.SourceType),
			zap.Error(err),
		)
		return
	}

	usage, reconciled, subscription, limits, err := loadQuotaState(ctx, pageContext.AccountID)
	if err != nil {
		logger().Warn("quota monitor could not load account quota state",
			zap.Int64("page_id", input.PageID),
			zap.String("source_type", input.SourceType),
			zap.String("account_id", pageContext.AccountID.String()),
			zap.Error(err),
		)
		return
	}

	limit, ok := limits[metricStorageBytesTotal]
	if !ok || limit.LimitValue <= 0 {
		return
	}

	projected := usage.StorageBytesUsed + input.AttemptBytes
	if projected <= limit.LimitValue {
		return
	}

	fields := []zap.Field{
		zap.String("action", "upload_monitor"),
		zap.String("reason_code", reasonAccountStorageExceeded),
		zap.String("metric_key", metricStorageBytesTotal),
		zap.String("source_type", input.SourceType),
		zap.String("source_id", input.SourceID),
		zap.String("content_type", input.ContentType),
		zap.String("file_name", input.FileName),
		zap.String("account_id", pageContext.AccountID.String()),
		zap.String("space_id", pageContext.SpaceID.String()),
		zap.Int64("page_id", input.PageID),
		zap.String("actor_user_id", input.ActorUserID),
		zap.Int64("current_value", usage.StorageBytesUsed),
		zap.Int64("reconciled_current_value", reconciled),
		zap.Int64("attempted_delta", input.AttemptBytes),
		zap.Int64("projected_value", projected),
		zap.Int64("limit_value", limit.LimitValue),
		zap.String("limit_unit", limit.LimitUnit),
		zap.String("enforcement_mode", limit.EnforcementMode),
	}
	if subscription != nil {
		fields = append(fields,
			zap.String("plan_code", subscription.PlanCode),
			zap.String("subscription_status", subscription.Status),
		)
	}
	logger().Info("quota monitor: upload would exceed account storage limit", fields...)
}

func MonitorCollaboratorAddition(ctx context.Context, input CollaboratorMonitorInput) {
	if !monitorEnabled() || input.AttemptedAdds <= 0 {
		return
	}

	usage, err := getSpaceUsageRow(ctx, input.SpaceID)
	if err != nil {
		logger().Warn("quota monitor could not resolve space usage",
			zap.String("space_id", input.SpaceID.String()),
			zap.String("action", input.Action),
			zap.Error(err),
		)
		return
	}
	subscription, err := getActiveSubscription(ctx, usage.AccountID)
	if err != nil {
		logger().Warn("quota monitor could not resolve collaborator subscription state",
			zap.String("space_id", input.SpaceID.String()),
			zap.String("account_id", usage.AccountID.String()),
			zap.String("action", input.Action),
			zap.Error(err),
		)
		return
	}

	limits := map[string]PlanLimit{}
	if subscription != nil {
		limits, err = getPlanLimits(ctx, subscription.PlanID)
		if err != nil {
			logger().Warn("quota monitor could not resolve collaborator plan limits",
				zap.String("space_id", input.SpaceID.String()),
				zap.String("account_id", usage.AccountID.String()),
				zap.String("action", input.Action),
				zap.Error(err),
			)
			return
		}
	}

	limit, ok := limits[metricCollaboratorsPerSpace]
	if !ok || limit.LimitValue <= 0 {
		return
	}

	currentCount, err := getCollaboratorCount(input.SpaceID)
	if err != nil {
		logger().Warn("quota monitor could not resolve collaborator count",
			zap.String("space_id", input.SpaceID.String()),
			zap.String("action", input.Action),
			zap.Error(err),
		)
		return
	}

	projected := int64(currentCount + input.AttemptedAdds)
	if projected <= limit.LimitValue {
		return
	}

	fields := []zap.Field{
		zap.String("action", input.Action),
		zap.String("reason_code", reasonCollaboratorCapExceeded),
		zap.String("metric_key", metricCollaboratorsPerSpace),
		zap.String("space_id", input.SpaceID.String()),
		zap.String("account_id", usage.AccountID.String()),
		zap.String("actor_user_id", input.ActorUserID),
		zap.String("target_reference", input.TargetReference),
		zap.Int("current_value", currentCount),
		zap.Int("attempted_delta", input.AttemptedAdds),
		zap.Int64("projected_value", projected),
		zap.Int64("limit_value", limit.LimitValue),
		zap.String("limit_unit", limit.LimitUnit),
		zap.String("enforcement_mode", limit.EnforcementMode),
	}
	if subscription != nil {
		fields = append(fields,
			zap.String("plan_code", subscription.PlanCode),
			zap.String("subscription_status", subscription.Status),
		)
	}
	logger().Info("quota monitor: collaborator addition would exceed per-space limit", fields...)
}

func ReserveUploadCapacity(ctx context.Context, pageID int64, attemptBytes int64, sourceType string, sourceID string, metadata map[string]any) (UploadReservation, error) {
	if !quotaSystemEnabled() {
		return UploadReservation{}, nil
	}
	if attemptBytes <= 0 {
		return UploadReservation{}, nil
	}

	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return UploadReservation{}, err
	}
	defer tx.Rollback(ctx)

	reservation, err := ReserveUploadCapacityTx(ctx, tx, pageID, attemptBytes, sourceType, sourceID, metadata)
	if err != nil {
		return UploadReservation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return UploadReservation{}, err
	}
	return reservation, nil
}

// ReserveUploadCapacityTx keeps quota reservation and caller-owned recovery
// metadata in one transaction. Callers must persist that metadata before commit.
func ReserveUploadCapacityTx(ctx context.Context, tx pgx.Tx, pageID int64, attemptBytes int64, sourceType string, sourceID string, metadata map[string]any) (UploadReservation, error) {
	if !quotaSystemEnabled() || attemptBytes <= 0 {
		return UploadReservation{}, nil
	}
	var pageContext pageQuotaContextRow
	if err := tx.QueryRow(ctx, getPageQuotaContextQuery, pageID).Scan(
		&pageContext.PageID, &pageContext.SpaceID, &pageContext.AccountID,
	); err != nil {
		return UploadReservation{}, err
	}
	var limit *int64
	var limitValue int64
	var planID uuid.UUID
	planErr := tx.QueryRow(ctx, `SELECT s.plan_id
		FROM billing.account_subscription s
		WHERE s.account_id = $1
		  AND (s.effective_to IS NULL OR s.effective_to > now())
		ORDER BY CASE WHEN lower(s.status) IN ('active','trialing','grace_period') THEN 0 ELSE 1 END,
		  s.effective_from DESC, s.created_at DESC LIMIT 1`, pageContext.AccountID).Scan(&planID)
	if planErr != nil && !errors.Is(planErr, pgx.ErrNoRows) {
		return UploadReservation{}, planErr
	}
	if planErr == nil {
		limitErr := tx.QueryRow(ctx, `SELECT limit_value FROM billing.plan_limit
			WHERE plan_id=$1 AND metric_key=$2`, planID, metricStorageBytesTotal).Scan(&limitValue)
		if limitErr == nil {
			limit = &limitValue
		} else if !errors.Is(limitErr, pgx.ErrNoRows) {
			return UploadReservation{}, limitErr
		}
	}
	if _, err := tx.Exec(ctx, ensureSpaceUsageRowQuery, pageContext.SpaceID); err != nil {
		return UploadReservation{}, err
	}
	lockedRows, err := loadLockedUsageRows(ctx, tx, pageContext.AccountID)
	if err != nil {
		return UploadReservation{}, err
	}

	var total int64
	for _, row := range lockedRows {
		total += row.StorageBytesUsed + row.StorageBytesReserved
	}
	if limit != nil && total+attemptBytes > *limit {
		if storageBlockingEnabled() {
			return UploadReservation{}, ErrAccountStorageLimitExceeded
		}
		if monitorEnabled() {
			logger().Info("quota monitor: upload would exceed account storage limit",
				zap.String("action", "upload_reserve"),
				zap.String("reason_code", reasonAccountStorageExceeded),
				zap.String("metric_key", metricStorageBytesTotal),
				zap.String("source_type", sourceType),
				zap.String("source_id", sourceID),
				zap.String("account_id", pageContext.AccountID.String()),
				zap.String("space_id", pageContext.SpaceID.String()),
				zap.Int64("page_id", pageID),
				zap.Int64("current_value", total),
				zap.Int64("attempted_delta", attemptBytes),
				zap.Int64("projected_value", total+attemptBytes),
				zap.Int64("limit_value", *limit),
				zap.Bool("monitor_only_enabled", quotaConfig().MonitorOnlyEnabled),
			)
		}
	}

	if _, err := tx.Exec(ctx, updateSpaceUsageReserveQuery, pageContext.SpaceID, attemptBytes); err != nil {
		return UploadReservation{}, err
	}

	reservation := UploadReservation{
		AccountID:     pageContext.AccountID,
		SpaceID:       pageContext.SpaceID,
		ReservedBytes: attemptBytes,
		SourceType:    sourceType,
		SourceID:      sourceID,
		CorrelationID: uuid.NewString(),
		Metadata:      metadata,
	}
	if err := insertUsageEvent(ctx, tx, reservation, "reserve", attemptBytes); err != nil {
		return UploadReservation{}, err
	}
	return reservation, nil
}

func CommitUploadUsageTx(ctx context.Context, tx pgx.Tx, reservation UploadReservation) error {
	if !quotaSystemEnabled() {
		return nil
	}
	if reservation.ReservedBytes <= 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, updateSpaceUsageCommitQuery, reservation.SpaceID, reservation.ReservedBytes); err != nil {
		return err
	}
	return insertUsageEvent(ctx, tx, reservation, "commit", reservation.ReservedBytes)
}

func ReleaseUploadReservation(ctx context.Context, reservation UploadReservation) error {
	if !quotaSystemEnabled() {
		return nil
	}
	if reservation.ReservedBytes <= 0 {
		return nil
	}
	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := ReleaseUploadReservationTx(ctx, tx, reservation); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func ReleaseUploadReservationTx(ctx context.Context, tx pgx.Tx, reservation UploadReservation) error {
	if !quotaSystemEnabled() || reservation.ReservedBytes <= 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, updateSpaceUsageReleaseQuery, reservation.SpaceID, reservation.ReservedBytes); err != nil {
		return err
	}
	return insertUsageEvent(ctx, tx, reservation, "release", -reservation.ReservedBytes)
}

func ValidateCollaboratorAddition(ctx context.Context, spaceID uuid.UUID, attemptedAdds int, includePendingInvites bool) error {
	if !quotaSystemEnabled() {
		return nil
	}
	if attemptedAdds <= 0 {
		return nil
	}

	usage, err := getSpaceUsageRow(ctx, spaceID)
	if err != nil {
		return err
	}
	subscription, err := getActiveSubscription(ctx, usage.AccountID)
	if err != nil || subscription == nil {
		return err
	}
	limits, err := getPlanLimits(ctx, subscription.PlanID)
	if err != nil {
		return err
	}
	limit := getLimitPointer(limits, metricCollaboratorsPerSpace)
	if limit == nil || *limit <= 0 {
		return nil
	}

	currentCount, err := getCollaboratorCount(spaceID)
	if err != nil {
		return err
	}
	if includePendingInvites {
		pendingCount, err := getPendingInviteCount(ctx, spaceID)
		if err != nil {
			return err
		}
		currentCount += pendingCount
	}
	if int64(currentCount+attemptedAdds) > *limit {
		if collaboratorBlockingEnabled() {
			return ErrCollaboratorLimitExceeded
		}
		if monitorEnabled() {
			logger().Info("quota monitor: collaborator addition would exceed per-space limit",
				zap.String("action", "collaborator_validate"),
				zap.String("reason_code", reasonCollaboratorCapExceeded),
				zap.String("metric_key", metricCollaboratorsPerSpace),
				zap.String("space_id", spaceID.String()),
				zap.String("account_id", usage.AccountID.String()),
				zap.Int("current_value", currentCount),
				zap.Int("attempted_delta", attemptedAdds),
				zap.Int64("projected_value", int64(currentCount+attemptedAdds)),
				zap.Int64("limit_value", *limit),
				zap.Bool("include_pending_invites", includePendingInvites),
				zap.Bool("monitor_only_enabled", quotaConfig().MonitorOnlyEnabled),
			)
		}
	}
	return nil
}

func ReleasePageStorageUsageTx(ctx context.Context, tx pgx.Tx, spaceID uuid.UUID, pageID int64, sourceType string) error {
	if !quotaSystemEnabled() {
		return nil
	}
	total, err := getPageStorageBytes(ctx, tx, pageID)
	if err != nil || total <= 0 {
		return err
	}
	if _, err := tx.Exec(ctx, ensureSpaceUsageRowQuery, spaceID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, updateSpaceUsageUsedDeltaQuery, spaceID, -total); err != nil {
		return err
	}
	reservation := UploadReservation{
		SpaceID:       spaceID,
		ReservedBytes: total,
		SourceType:    sourceType,
		SourceID:      fmt.Sprintf("page:%d", pageID),
		CorrelationID: uuid.NewString(),
		Metadata: map[string]any{
			"pageId": pageID,
		},
	}
	return insertUsageEvent(ctx, tx, reservation, "release", -total)
}

func ApplyStorageUsageDeltaTx(ctx context.Context, tx pgx.Tx, spaceID uuid.UUID, deltaBytes int64, eventType string, sourceType string, sourceID string, metadata map[string]any) error {
	if !quotaSystemEnabled() || deltaBytes == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, ensureSpaceUsageRowQuery, spaceID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, updateSpaceUsageUsedDeltaQuery, spaceID, deltaBytes); err != nil {
		return err
	}
	reservation := UploadReservation{
		SpaceID:       spaceID,
		ReservedBytes: absInt64(deltaBytes),
		SourceType:    sourceType,
		SourceID:      sourceID,
		CorrelationID: uuid.NewString(),
		Metadata:      metadata,
	}
	if strings.TrimSpace(eventType) == "" {
		eventType = "reconcile"
	}
	return insertUsageEvent(ctx, tx, reservation, eventType, deltaBytes)
}

func ReconcileSpace(ctx context.Context, spaceID uuid.UUID, sourceType string) (SpaceReconcileResult, error) {
	if !quotaSystemEnabled() {
		return SpaceReconcileResult{SpaceID: spaceID}, nil
	}

	tx, err := core.GetPool().Begin(ctx)
	if err != nil {
		return SpaceReconcileResult{}, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, ensureSpaceUsageRowQuery, spaceID); err != nil {
		return SpaceReconcileResult{}, err
	}

	state, err := getSpaceUsageStateForUpdate(ctx, tx, spaceID)
	if err != nil {
		return SpaceReconcileResult{}, err
	}

	reconciledUsed, err := getSpaceReconciledStorage(ctx, spaceID)
	if err != nil {
		return SpaceReconcileResult{}, err
	}

	result := SpaceReconcileResult{
		SpaceID:               spaceID,
		AccountID:             state.AccountID,
		StoredUsedBytesBefore: state.StorageBytesUsed,
		StoredUsedBytesAfter:  reconciledUsed,
		ReconciledUsedBytes:   reconciledUsed,
		ReservedBytes:         state.StorageBytesReserved,
		DriftBytes:            reconciledUsed - state.StorageBytesUsed,
	}

	if result.DriftBytes != 0 {
		if _, err := tx.Exec(ctx, updateSpaceUsageReconcileQuery, spaceID, reconciledUsed); err != nil {
			return SpaceReconcileResult{}, err
		}
		event := UploadReservation{
			AccountID:     state.AccountID,
			SpaceID:       spaceID,
			ReservedBytes: absInt64(result.DriftBytes),
			SourceType:    sourceType,
			SourceID:      spaceID.String(),
			CorrelationID: uuid.NewString(),
			Metadata: map[string]any{
				"storedUsedBytesBefore": state.StorageBytesUsed,
				"storedUsedBytesAfter":  reconciledUsed,
				"reservedBytes":         state.StorageBytesReserved,
			},
		}
		if err := insertUsageEvent(ctx, tx, event, "reconcile", result.DriftBytes); err != nil {
			return SpaceReconcileResult{}, err
		}
		result.WasUpdated = true
	} else {
		if _, err := tx.Exec(ctx, updateSpaceUsageLastReconciledQuery, spaceID); err != nil {
			return SpaceReconcileResult{}, err
		}
	}

	lastReconciledAt := time.Now().UTC()
	result.LastReconciledAt = &lastReconciledAt
	if err := tx.Commit(ctx); err != nil {
		return SpaceReconcileResult{}, err
	}
	return result, nil
}

func ReconcileAllSpaces(ctx context.Context, sourceType string) (ReconcileAllResult, error) {
	spaceIDs, err := loadAllActiveSpaceIDs(ctx)
	if err != nil {
		return ReconcileAllResult{}, err
	}

	result := ReconcileAllResult{
		SpaceCount: len(spaceIDs),
		Results:    make([]SpaceReconcileResult, 0, len(spaceIDs)),
	}
	for _, spaceID := range spaceIDs {
		spaceResult, err := ReconcileSpace(ctx, spaceID, sourceType)
		if err != nil {
			return ReconcileAllResult{}, err
		}
		result.Results = append(result.Results, spaceResult)
		if spaceResult.DriftBytes != 0 {
			result.DriftedSpaceCount++
			result.TotalDriftBytes += absInt64(spaceResult.DriftBytes)
		}
	}
	return result, nil
}

func ListSpaceUsageProblems(ctx context.Context, staleMinutes int) ([]SpaceUsageProblem, error) {
	states, err := loadAllSpaceUsageStates(ctx)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	problems := []SpaceUsageProblem{}
	for _, state := range states {
		reconciledUsed, err := getSpaceReconciledStorage(ctx, state.SpaceID)
		if err != nil {
			return nil, err
		}
		driftBytes := reconciledUsed - state.StorageBytesUsed
		problem := SpaceUsageProblem{
			SpaceID:             state.SpaceID,
			AccountID:           state.AccountID,
			StoredUsedBytes:     state.StorageBytesUsed,
			ReconciledUsedBytes: reconciledUsed,
			ReservedBytes:       state.StorageBytesReserved,
			DriftBytes:          driftBytes,
			UpdatedAt:           state.UpdatedAt,
			LastReconciledAt:    state.LastReconciledAt,
		}

		if state.StorageBytesReserved > 0 && state.UpdatedAt != nil {
			staleFor := int(now.Sub(*state.UpdatedAt).Minutes())
			if staleFor >= staleMinutes {
				problem.ReservationLooksStale = true
				problem.ReservationStaleMinutes = staleFor
			}
		}

		if driftBytes != 0 || state.StorageBytesReserved < 0 || problem.ReservationLooksStale {
			problems = append(problems, problem)
		}
	}
	return problems, nil
}

func ClearStaleReservations(ctx context.Context, olderThanMinutes int, sourceType string) (ClearReservationsResult, error) {
	if !quotaSystemEnabled() {
		return ClearReservationsResult{OlderThanMinutes: olderThanMinutes}, nil
	}

	states, err := loadAllSpaceUsageStates(ctx)
	if err != nil {
		return ClearReservationsResult{}, err
	}

	now := time.Now().UTC()
	result := ClearReservationsResult{
		OlderThanMinutes: olderThanMinutes,
		Results:          []SpaceReconcileResult{},
	}
	for _, state := range states {
		if state.StorageBytesReserved <= 0 || state.UpdatedAt == nil {
			continue
		}
		if int(now.Sub(*state.UpdatedAt).Minutes()) < olderThanMinutes {
			continue
		}

		tx, err := core.GetPool().Begin(ctx)
		if err != nil {
			return ClearReservationsResult{}, err
		}

		if _, err := tx.Exec(ctx, ensureSpaceUsageRowQuery, state.SpaceID); err != nil {
			tx.Rollback(ctx)
			return ClearReservationsResult{}, err
		}
		lockedState, err := getSpaceUsageStateForUpdate(ctx, tx, state.SpaceID)
		if err != nil {
			tx.Rollback(ctx)
			return ClearReservationsResult{}, err
		}
		if lockedState.StorageBytesReserved <= 0 {
			if err := tx.Commit(ctx); err != nil {
				return ClearReservationsResult{}, err
			}
			continue
		}
		if _, err := tx.Exec(ctx, updateSpaceUsageReleaseQuery, state.SpaceID, lockedState.StorageBytesReserved); err != nil {
			tx.Rollback(ctx)
			return ClearReservationsResult{}, err
		}
		reservation := UploadReservation{
			AccountID:     lockedState.AccountID,
			SpaceID:       state.SpaceID,
			ReservedBytes: lockedState.StorageBytesReserved,
			SourceType:    sourceType,
			SourceID:      state.SpaceID.String(),
			CorrelationID: uuid.NewString(),
			Metadata: map[string]any{
				"clearedReservationBytes": lockedState.StorageBytesReserved,
				"olderThanMinutes":        olderThanMinutes,
			},
		}
		if err := insertUsageEvent(ctx, tx, reservation, "release", -lockedState.StorageBytesReserved); err != nil {
			tx.Rollback(ctx)
			return ClearReservationsResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return ClearReservationsResult{}, err
		}

		result.ClearedCount++
		result.ClearedBytes += lockedState.StorageBytesReserved
		result.Results = append(result.Results, SpaceReconcileResult{
			SpaceID:               state.SpaceID,
			AccountID:             lockedState.AccountID,
			StoredUsedBytesBefore: lockedState.StorageBytesUsed,
			StoredUsedBytesAfter:  lockedState.StorageBytesUsed,
			ReconciledUsedBytes:   lockedState.StorageBytesUsed,
			ReservedBytes:         0,
			DriftBytes:            0,
			WasUpdated:            true,
		})
	}
	return result, nil
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}

func currentUserID(ctx context.Context) (uuid.UUID, error) {
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	if strings.TrimSpace(user.AId) == "" {
		return uuid.Nil, fmt.Errorf("missing application user id")
	}
	return uuid.Parse(user.AId)
}
