package quota

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type phase3QuotaTx struct {
	execErrors []error
	execCalls  int
}

func (tx *phase3QuotaTx) Begin(context.Context) (pgx.Tx, error) { return tx, nil }
func (tx *phase3QuotaTx) Commit(context.Context) error          { return nil }
func (tx *phase3QuotaTx) Rollback(context.Context) error        { return nil }
func (tx *phase3QuotaTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	return 0, nil
}
func (tx *phase3QuotaTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults { return nil }
func (tx *phase3QuotaTx) LargeObjects() pgx.LargeObjects                         { return pgx.LargeObjects{} }
func (tx *phase3QuotaTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	return nil, nil
}
func (tx *phase3QuotaTx) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	index := tx.execCalls
	tx.execCalls++
	if index < len(tx.execErrors) && tx.execErrors[index] != nil {
		return pgconn.CommandTag{}, tx.execErrors[index]
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}
func (tx *phase3QuotaTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query")
}
func (tx *phase3QuotaTx) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("unexpected QueryRow")
}
func (tx *phase3QuotaTx) Conn() *pgx.Conn { return nil }

func TestPhase3QuotaModes(t *testing.T) {
	t.Run("blocking", func(t *testing.T) {
		t.Setenv("QUOTA_SYSTEM_ENABLED", "true")
		t.Setenv("QUOTA_STORAGE_BLOCKING_ENABLED", "true")
		t.Setenv("QUOTA_MONITOR_ONLY", "false")
		if !storageBlockingEnabled() {
			t.Fatal("storage quota must block when blocking mode is enabled")
		}
	})
	t.Run("monitor only", func(t *testing.T) {
		t.Setenv("QUOTA_SYSTEM_ENABLED", "true")
		t.Setenv("QUOTA_STORAGE_BLOCKING_ENABLED", "true")
		t.Setenv("QUOTA_MONITOR_ONLY", "true")
		if storageBlockingEnabled() || !monitorEnabled() {
			t.Fatal("monitor-only mode must observe without blocking")
		}
	})
	t.Run("disabled", func(t *testing.T) {
		t.Setenv("QUOTA_SYSTEM_ENABLED", "false")
		t.Setenv("QUOTA_STORAGE_BLOCKING_ENABLED", "true")
		if storageBlockingEnabled() || monitorEnabled() {
			t.Fatal("disabled quota mode must neither block nor monitor")
		}
	})
}

func TestPhase3UploadReservationTransactionCoverage(t *testing.T) {
	ctx := context.Background()
	reservation := UploadReservation{
		SpaceID:       uuid.MustParse("11111111-1111-4111-8111-111111111111"),
		ReservedBytes: 128,
		SourceType:    "whiteboard_asset",
		SourceID:      "asset:sha256:test",
		CorrelationID: "phase3-correlation",
		Metadata:      map[string]any{"page_id": 42},
	}

	t.Run("disabled and empty reservations are no-ops", func(t *testing.T) {
		t.Setenv("QUOTA_SYSTEM_ENABLED", "false")
		tx := &phase3QuotaTx{}
		if err := CommitUploadUsageTx(ctx, tx, reservation); err != nil {
			t.Fatal(err)
		}
		if err := ReleaseUploadReservation(ctx, reservation); err != nil {
			t.Fatal(err)
		}
		if err := ReleaseUploadReservationTx(ctx, tx, reservation); err != nil {
			t.Fatal(err)
		}
		if tx.execCalls != 0 {
			t.Fatalf("disabled quota executed %d statements", tx.execCalls)
		}

		t.Setenv("QUOTA_SYSTEM_ENABLED", "true")
		empty := reservation
		empty.ReservedBytes = 0
		if err := CommitUploadUsageTx(ctx, tx, empty); err != nil {
			t.Fatal(err)
		}
		if err := ReleaseUploadReservation(ctx, empty); err != nil {
			t.Fatal(err)
		}
		if err := ReleaseUploadReservationTx(ctx, tx, empty); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("commit and release update usage and append events", func(t *testing.T) {
		t.Setenv("QUOTA_SYSTEM_ENABLED", "true")
		commitTx := &phase3QuotaTx{}
		if err := CommitUploadUsageTx(ctx, commitTx, reservation); err != nil {
			t.Fatal(err)
		}
		if commitTx.execCalls != 2 {
			t.Fatalf("commit executed %d statements", commitTx.execCalls)
		}
		releaseTx := &phase3QuotaTx{}
		if err := ReleaseUploadReservationTx(ctx, releaseTx, reservation); err != nil {
			t.Fatal(err)
		}
		if releaseTx.execCalls != 2 {
			t.Fatalf("release executed %d statements", releaseTx.execCalls)
		}
	})

	t.Run("database failures are returned", func(t *testing.T) {
		t.Setenv("QUOTA_SYSTEM_ENABLED", "true")
		failure := errors.New("database unavailable")
		for _, test := range []struct {
			name string
			call func(pgx.Tx) error
		}{
			{"commit update", func(tx pgx.Tx) error { return CommitUploadUsageTx(ctx, tx, reservation) }},
			{"release update", func(tx pgx.Tx) error { return ReleaseUploadReservationTx(ctx, tx, reservation) }},
		} {
			t.Run(test.name, func(t *testing.T) {
				if err := test.call(&phase3QuotaTx{execErrors: []error{failure}}); !errors.Is(err, failure) {
					t.Fatalf("error = %v", err)
				}
				if err := test.call(&phase3QuotaTx{execErrors: []error{nil, failure}}); !errors.Is(err, failure) {
					t.Fatalf("event error = %v", err)
				}
			})
		}
	})
}
