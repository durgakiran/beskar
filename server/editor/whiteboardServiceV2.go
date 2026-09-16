package editor

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	errWhiteboardV2LockTimeout        = errors.New("whiteboard creation lock wait timed out")
	errWhiteboardV2KeyReuse           = errors.New("idempotency key was reused with different content")
	errWhiteboardV2NotFound           = errors.New("space or parent not found")
	errWhiteboardV2Archived           = errors.New("space is archived")
	errWhiteboardV2PermissionsPending = errors.New("whiteboard permission provisioning is pending")
)

// whiteboardServiceV2 owns v2 creation, checkpoints, draft retrieval and publication.
// Dependencies are configured once, rather than passed through the router per call.
type whiteboardServiceV2 struct {
	migrationStore   func(context.Context) (storage.Store, error)
	inspectMigration func(context.Context, []byte, string) (whiteboardMigrationInspection, error)
	materialize      func(context.Context, [][]byte, string) (whiteboardMaterialized, error)
	begin            func(context.Context) (pgx.Tx, error)
	provision        func(context.Context, whiteboardCreateV2Result) error
}

func newWhiteboardServiceV2() *whiteboardServiceV2 {
	return &whiteboardServiceV2{
		begin:     beginWhiteboardV2Transaction,
		provision: provisionWhiteboardV2Permissions,
	}
}

func beginWhiteboardV2Transaction(ctx context.Context) (pgx.Tx, error) {
	return core.GetPool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
}

func provisionWhiteboardV2Permissions(ctx context.Context, result whiteboardCreateV2Result) error {
	_, err := core.CreateSubjectPermissionsContext(ctx, "page", strconv.FormatInt(result.PageID, 10), "space", result.SpaceID.String(), "space")
	return err
}

func (service *whiteboardServiceV2) CreateWhiteboard(ctx context.Context, input whiteboardCreateV2Input) (whiteboardCreateV2Result, error) {
	result, err := service.createTransaction(ctx, input)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "55P03" {
			return result, fmt.Errorf("%w: %w", errWhiteboardV2LockTimeout, err)
		}
		return result, err
	}

	// PostgreSQL and Permify cannot commit atomically. Receipt replay repairs
	// permission setup without creating another board after an ambiguous failure.
	permissionContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := service.provision(permissionContext, result); err != nil {
		return result, fmt.Errorf("%w: %w", errWhiteboardV2PermissionsPending, err)
	}
	return result, nil
}

func whiteboardCreateV2Hash(body whiteboardCreateV2Body) string {
	// The validated struct provides deterministic field order and normalizes
	// omitted/null parentId to the same request. Space/actor are receipt keys.
	data, _ := json.Marshal(body)
	return fmt.Sprintf("sha256:%x", sha256.Sum256(data))
}

func (service *whiteboardServiceV2) createTransaction(ctx context.Context, input whiteboardCreateV2Input) (whiteboardCreateV2Result, error) {
	result := whiteboardCreateV2Result{SpaceID: input.SpaceID}
	tx, err := service.begin(ctx)
	if err != nil {
		return result, err
	}
	defer func() {
		cleanupContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanupContext)
	}()
	// LOCAL resets on commit/rollback, so pooled connections retain no override.
	// Bound each lock wait, including subsequent row and foreign-key locks.
	if _, err := tx.Exec(ctx, whiteboardV2SetLockTimeout); err != nil {
		return result, err
	}
	// Serialize identical requests before any page is allocated. A hash collision
	// only adds contention; receipt lookup always uses the full scoped identity.
	lockKey := "whiteboard-create-v2:" + input.ActorID.String() + ":" + input.SpaceID.String() + ":" + input.IdempotencyKey.String()
	if _, err := tx.Exec(ctx, whiteboardV2LockRequest, lockKey); err != nil {
		return result, err
	}
	requestHash := whiteboardCreateV2Hash(input.whiteboardCreateV2Body)
	var storedHash string
	err = tx.QueryRow(ctx, whiteboardV2GetReceipt, input.ActorID, input.SpaceID, input.IdempotencyKey).Scan(&storedHash, &result.PageID)
	if err == nil {
		if result.PageID == 0 {
			return result, errWhiteboardV2NotFound
		}
		if storedHash != requestHash {
			return result, errWhiteboardV2KeyReuse
		}
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return result, err
	}
	var archived, deleted bool
	err = tx.QueryRow(ctx, whiteboardV2LockSpace, input.SpaceID).Scan(&archived, &deleted)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && deleted) {
		return result, errWhiteboardV2NotFound
	}
	if err != nil {
		return result, err
	}
	if archived {
		return result, errWhiteboardV2Archived
	}
	parentID := int64(-1)
	if input.ParentID != nil {
		parentID = *input.ParentID
		var found int64
		if err := tx.QueryRow(ctx, whiteboardV2LockParent, parentID, input.SpaceID).Scan(&found); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return result, errWhiteboardV2NotFound
			}
			return result, err
		}
	}
	if err := tx.QueryRow(ctx, newPageWithType, input.SpaceID, input.ActorID, parentID, time.Now(), 1, "whiteboard").Scan(&result.PageID); err != nil {
		return result, err
	}
	snapshotID := uuid.New()
	// Canonical Yjs update-v1 encoding of a fresh Y.Doc: no structs and no
	// deletions. Title is stored in snapshot metadata at this initial boundary.
	initialState := []byte{0, 0}
	digest := fmt.Sprintf("sha256:%x", sha256.Sum256(initialState))
	writes := []struct {
		query string
		args  []any
	}{
		{whiteboardV2InsertBoard, []any{result.PageID, input.ActorID}},
		{whiteboardV2InsertSnapshot, []any{snapshotID, result.PageID, initialState, digest, input.Title, input.ActorID}},
		{whiteboardV2InsertDraft, []any{result.PageID, snapshotID, input.ActorID}},
		{whiteboardV2InsertReceipt, []any{input.ActorID, input.SpaceID, input.IdempotencyKey, requestHash, result.PageID}},
	}
	for _, write := range writes {
		if _, err := tx.Exec(ctx, write.query, write.args...); err != nil {
			return result, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}
