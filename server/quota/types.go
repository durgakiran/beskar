package quota

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

const (
	metricStorageBytesTotal       = "storage.bytes.total"
	metricCollaboratorsPerSpace   = "collaborators.count.per_space"
	reasonAccountStorageExceeded  = "account_storage_limit_exceeded"
	reasonCollaboratorCapExceeded = "space_collaborator_limit_exceeded"
)

var (
	ErrAccountStorageLimitExceeded = errors.New("account storage limit exceeded")
	ErrCollaboratorLimitExceeded   = errors.New("space collaborator limit reached")
)

type pageQuotaContextRow struct {
	PageID    int64     `db:"id"`
	SpaceID   uuid.UUID `db:"space_id"`
	AccountID uuid.UUID `db:"account_id"`
}

type accountUsageRow struct {
	AccountID            uuid.UUID `db:"id"`
	UserID               uuid.UUID `db:"user_id"`
	SpaceCount           int       `db:"space_count"`
	StorageBytesUsed     int64     `db:"storage_bytes_used"`
	StorageBytesReserved int64     `db:"storage_bytes_reserved"`
}

type spaceUsageRow struct {
	SpaceID              uuid.UUID `db:"id"`
	AccountID            uuid.UUID `db:"account_id"`
	StorageBytesUsed     int64     `db:"storage_bytes_used"`
	StorageBytesReserved int64     `db:"storage_bytes_reserved"`
}

type lockedUsageRow struct {
	SpaceID              uuid.UUID `db:"space_id"`
	StorageBytesUsed     int64     `db:"storage_bytes_used"`
	StorageBytesReserved int64     `db:"storage_bytes_reserved"`
}

type subscriptionRow struct {
	ID            uuid.UUID  `db:"id"`
	AccountID     uuid.UUID  `db:"account_id"`
	PlanID        uuid.UUID  `db:"plan_id"`
	Status        string     `db:"status"`
	EffectiveFrom time.Time  `db:"effective_from"`
	EffectiveTo   *time.Time `db:"effective_to"`
	Source        string     `db:"source"`
	PlanCode      string     `db:"code"`
}

type planLimitRow struct {
	MetricKey       string `db:"metric_key"`
	LimitValue      int64  `db:"limit_value"`
	LimitUnit       string `db:"limit_unit"`
	EnforcementMode string `db:"enforcement_mode"`
}

type PlanLimit struct {
	MetricKey       string
	LimitValue      int64
	LimitUnit       string
	EnforcementMode string
}

type AccountUsageSummary struct {
	AccountID                    uuid.UUID `json:"accountId"`
	UserID                       uuid.UUID `json:"userId"`
	AccountPlanCode              string    `json:"accountPlanCode"`
	AccountSubscriptionStatus    string    `json:"accountSubscriptionStatus"`
	AccountStorageUsed           int64     `json:"accountStorageUsed"`
	AccountStorageReserved       int64     `json:"accountStorageReserved"`
	AccountStorageLimit          *int64    `json:"accountStorageLimit"`
	AccountPercentConsumed       *float64  `json:"accountPercentConsumed"`
	ReconciledAccountStorageUsed int64     `json:"reconciledAccountStorageUsed"`
	SpaceCount                   int       `json:"spaceCount"`
}

type SpaceUsageSummary struct {
	SpaceID                     uuid.UUID `json:"spaceId"`
	AccountID                   uuid.UUID `json:"accountId"`
	AccountPlanCode             string    `json:"accountPlanCode"`
	AccountSubscriptionStatus   string    `json:"accountSubscriptionStatus"`
	SpaceStorageUsed            int64     `json:"spaceStorageUsed"`
	SpaceStorageReserved        int64     `json:"spaceStorageReserved"`
	ReconciledSpaceStorageUsed  int64     `json:"reconciledSpaceStorageUsed"`
	CollaboratorLimitPerSpace   *int64    `json:"collaboratorLimitPerSpace"`
	CurrentCollaboratorCount    int       `json:"currentCollaboratorCount"`
	CollaboratorPercentConsumed *float64  `json:"collaboratorPercentConsumed"`
}

type UploadMonitorInput struct {
	PageID       int64
	ActorUserID  string
	AttemptBytes int64
	SourceType   string
	SourceID     string
	ContentType  string
	FileName     string
}

type CollaboratorMonitorInput struct {
	SpaceID         uuid.UUID
	ActorUserID     string
	AttemptedAdds   int
	Action          string
	TargetReference string
}

type UploadReservation struct {
	AccountID     uuid.UUID
	SpaceID       uuid.UUID
	ReservedBytes int64
	SourceType    string
	SourceID      string
	CorrelationID string
	Metadata      map[string]any
}

type spaceUsageStateRow struct {
	SpaceID              uuid.UUID  `db:"id"`
	AccountID            uuid.UUID  `db:"account_id"`
	StorageBytesUsed     int64      `db:"storage_bytes_used"`
	StorageBytesReserved int64      `db:"storage_bytes_reserved"`
	UpdatedAt            *time.Time `db:"updated_at"`
	LastReconciledAt     *time.Time `db:"last_reconciled_at"`
}

type spaceUsageStateForUpdateRow struct {
	AccountID            uuid.UUID  `db:"account_id"`
	StorageBytesUsed     int64      `db:"storage_bytes_used"`
	StorageBytesReserved int64      `db:"storage_bytes_reserved"`
	UpdatedAt            *time.Time `db:"updated_at"`
	LastReconciledAt     *time.Time `db:"last_reconciled_at"`
}

type SpaceReconcileResult struct {
	SpaceID               uuid.UUID  `json:"spaceId"`
	AccountID             uuid.UUID  `json:"accountId"`
	StoredUsedBytesBefore int64      `json:"storedUsedBytesBefore"`
	StoredUsedBytesAfter  int64      `json:"storedUsedBytesAfter"`
	ReconciledUsedBytes   int64      `json:"reconciledUsedBytes"`
	ReservedBytes         int64      `json:"reservedBytes"`
	DriftBytes            int64      `json:"driftBytes"`
	WasUpdated            bool       `json:"wasUpdated"`
	LastReconciledAt      *time.Time `json:"lastReconciledAt,omitempty"`
}

type ReconcileAllResult struct {
	SpaceCount        int                    `json:"spaceCount"`
	DriftedSpaceCount int                    `json:"driftedSpaceCount"`
	TotalDriftBytes   int64                  `json:"totalDriftBytes"`
	Results           []SpaceReconcileResult `json:"results"`
}

type SpaceUsageProblem struct {
	SpaceID                 uuid.UUID  `json:"spaceId"`
	AccountID               uuid.UUID  `json:"accountId"`
	StoredUsedBytes         int64      `json:"storedUsedBytes"`
	ReconciledUsedBytes     int64      `json:"reconciledUsedBytes"`
	ReservedBytes           int64      `json:"reservedBytes"`
	DriftBytes              int64      `json:"driftBytes"`
	UpdatedAt               *time.Time `json:"updatedAt,omitempty"`
	LastReconciledAt        *time.Time `json:"lastReconciledAt,omitempty"`
	ReservationLooksStale   bool       `json:"reservationLooksStale"`
	ReservationStaleMinutes int        `json:"reservationStaleMinutes"`
}

type ClearReservationsResult struct {
	OlderThanMinutes int                    `json:"olderThanMinutes"`
	ClearedCount     int                    `json:"clearedCount"`
	ClearedBytes     int64                  `json:"clearedBytes"`
	Results          []SpaceReconcileResult `json:"results"`
}
