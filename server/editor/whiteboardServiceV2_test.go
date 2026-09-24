package editor

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestWhiteboardCreateV2RetryRepairsPermissionsWithoutNewBoard(t *testing.T) {
	input := whiteboardCreateV2Input{
		whiteboardCreateV2Body: whiteboardCreateV2Body{Title: "Board"},
		ActorID:                uuid.New(), SpaceID: uuid.New(), IdempotencyKey: uuid.New(),
	}
	var transactions []*whiteboardV2TestTx
	permissionAttempts := 0
	permissionFailure := errors.New("temporary permission outage")
	service := &whiteboardServiceV2{
		begin: func(context.Context) (pgx.Tx, error) {
			tx := &whiteboardV2TestTx{t: t, writes: make(map[string][]any)}
			if len(transactions) > 0 {
				previous := transactions[len(transactions)-1]
				if !previous.committed {
					t.Fatal("first request must commit before provisioning")
				}
				tx.receiptHash = previous.writes[whiteboardV2InsertReceipt][3].(string)
			}
			transactions = append(transactions, tx)
			return tx, nil
		},
		provision: func(ctx context.Context, result whiteboardCreateV2Result) error {
			permissionAttempts++
			if result.PageID != 42 || result.SpaceID != input.SpaceID {
				t.Fatal("incorrect provisioning identity")
			}
			deadline, ok := ctx.Deadline()
			if !ok || time.Until(deadline) > 5*time.Second {
				t.Fatal("provisioning needs a five-second deadline")
			}
			if !transactions[len(transactions)-1].rolledBack {
				t.Fatal("transaction must be closed before provisioning")
			}
			if permissionAttempts == 1 {
				return permissionFailure
			}
			return nil
		},
	}
	first, err := service.CreateWhiteboard(context.Background(), input)
	if !errors.Is(err, errWhiteboardV2PermissionsPending) || !errors.Is(err, permissionFailure) {
		t.Fatalf("provisioning error must retain classification and cause: %v", err)
	}
	second, err := service.CreateWhiteboard(context.Background(), input)
	if err != nil || first != second {
		t.Fatalf("retry must return the original board: %+v, %v", second, err)
	}
	if len(transactions[0].writes) != 5 || len(transactions[1].writes) != 0 || permissionAttempts != 2 {
		t.Fatal("retry must reuse the committed receipt and reprovision the same page")
	}
}

func TestWhiteboardServiceV2SkipsProvisioningAfterTransactionFailure(t *testing.T) {
	for _, failure := range []string{"begin", "insert", "commit"} {
		t.Run(failure, func(t *testing.T) {
			dbError := errors.New("database unavailable")
			tx := &whiteboardV2TestTx{t: t, writes: make(map[string][]any)}
			service := &whiteboardServiceV2{
				begin: func(context.Context) (pgx.Tx, error) {
					if failure == "begin" {
						return nil, dbError
					}
					if failure == "insert" {
						tx.failQuery = whiteboardV2InsertSnapshot
					}
					if failure == "commit" {
						tx.commitErr = dbError
					}
					return tx, nil
				},
				provision: func(context.Context, whiteboardCreateV2Result) error {
					t.Fatal("must not provision after transaction failure")
					return nil
				},
			}
			_, err := service.CreateWhiteboard(context.Background(), whiteboardCreateV2Input{})
			if err == nil || errors.Is(err, errWhiteboardV2PermissionsPending) {
				t.Fatalf("expected database error: %v", err)
			}
		})
	}
}

func TestWhiteboardServiceV2ProvisioningContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var permissionContext context.Context
	service := &whiteboardServiceV2{
		begin: func(context.Context) (pgx.Tx, error) {
			return &whiteboardV2TestTx{t: t, writes: make(map[string][]any)}, nil
		},
		provision: func(ctx context.Context, _ whiteboardCreateV2Result) error {
			permissionContext = ctx
			cancel()
			if !errors.Is(ctx.Err(), context.Canceled) {
				t.Fatal("request cancellation must propagate")
			}
			return ctx.Err()
		},
	}
	defer cancel()
	_, err := service.CreateWhiteboard(ctx, whiteboardCreateV2Input{})
	if !errors.Is(err, context.Canceled) || permissionContext.Err() == nil {
		t.Fatal("service must preserve cancellation and release provisioning context")
	}
}

// A strict transaction double exercises ordering, failure propagation and
// semantic write arguments without requiring the application database.
type whiteboardV2TestTx struct {
	pgx.Tx
	t                                              *testing.T
	receiptHash                                    string
	archived, deleted, missingSpace, missingParent bool
	failQuery                                      string
	queryErr                                       error
	commitErr                                      error
	queries                                        []string
	writes                                         map[string][]any
	committed, rolledBack                          bool
}

type whiteboardV2TestRow struct {
	values []any
	err    error
}

func (row whiteboardV2TestRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	for i := range dest {
		reflect.ValueOf(dest[i]).Elem().Set(reflect.ValueOf(row.values[i]))
	}
	return nil
}
func (tx *whiteboardV2TestTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	tx.queries = append(tx.queries, query)
	if query == tx.failQuery {
		if tx.queryErr != nil {
			return pgconn.CommandTag{}, tx.queryErr
		}
		return pgconn.CommandTag{}, errors.New("injected failure")
	}
	if query != whiteboardV2LockRequest && query != whiteboardV2SetLockTimeout {
		tx.writes[query] = args
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}
func (tx *whiteboardV2TestTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.queries = append(tx.queries, query)
	if query == tx.failQuery {
		if tx.queryErr != nil {
			return whiteboardV2TestRow{err: tx.queryErr}
		}
		return whiteboardV2TestRow{err: errors.New("injected failure")}
	}
	switch query {
	case whiteboardV2GetReceipt:
		if tx.receiptHash == "" {
			return whiteboardV2TestRow{err: pgx.ErrNoRows}
		}
		return whiteboardV2TestRow{values: []any{tx.receiptHash, int64(42)}}
	case whiteboardV2LockSpace:
		if tx.missingSpace {
			return whiteboardV2TestRow{err: pgx.ErrNoRows}
		}
		return whiteboardV2TestRow{values: []any{tx.archived, tx.deleted}}
	case whiteboardV2LockParent:
		if tx.missingParent {
			return whiteboardV2TestRow{err: pgx.ErrNoRows}
		}
		return whiteboardV2TestRow{values: []any{args[0]}}
	case newPageWithType:
		tx.writes[query] = args
		return whiteboardV2TestRow{values: []any{int64(42)}}
	default:
		tx.t.Fatalf("unexpected query: %s", query)
		return nil
	}
}
func (tx *whiteboardV2TestTx) Commit(context.Context) error {
	tx.committed = tx.commitErr == nil
	return tx.commitErr
}
func (tx *whiteboardV2TestTx) Rollback(context.Context) error { tx.rolledBack = true; return nil }

func TestWhiteboardCreateV2Transaction(t *testing.T) {
	input := whiteboardCreateV2Input{whiteboardCreateV2Body: whiteboardCreateV2Body{Title: "Board"},
		SpaceID: uuid.New(), ActorID: uuid.New(), IdempotencyKey: uuid.New()}
	for _, name := range []string{"create", "parent", "replay", "key-reuse", "archived", "deleted", "missing-space", "missing-parent", "commit-failure"} {
		t.Run(name, func(t *testing.T) {
			in := input
			tx := &whiteboardV2TestTx{t: t, writes: make(map[string][]any)}
			var expected error
			switch name {
			case "replay":
				tx.receiptHash = whiteboardCreateV2Hash(in.whiteboardCreateV2Body)
			case "key-reuse":
				tx.receiptHash = "different"
				expected = errWhiteboardV2KeyReuse
			case "archived":
				tx.archived = true
				expected = errWhiteboardV2Archived
			case "deleted":
				tx.deleted = true
				expected = errWhiteboardV2NotFound
			case "missing-space":
				tx.missingSpace = true
				expected = errWhiteboardV2NotFound
			case "missing-parent":
				tx.missingParent = true
				expected = errWhiteboardV2NotFound
			case "commit-failure":
				tx.commitErr = errors.New("commit failed")
				expected = tx.commitErr
			}
			if name == "parent" || name == "missing-parent" {
				parent := int64(123)
				in.ParentID = &parent
			}
			result, err := (&whiteboardServiceV2{begin: func(context.Context) (pgx.Tx, error) { return tx, nil }}).createTransaction(context.Background(), in)
			if !errors.Is(err, expected) {
				t.Fatalf("got %v; want %v", err, expected)
			}
			if !tx.rolledBack {
				t.Fatal("missing transaction cleanup")
			}
			if tx.queries[0] != whiteboardV2SetLockTimeout || tx.queries[1] != whiteboardV2LockRequest || tx.queries[2] != whiteboardV2GetReceipt {
				t.Fatal("receipt must be serialized before allocation")
			}
			if name == "replay" || name == "key-reuse" {
				if len(tx.queries) != 3 || len(tx.writes) != 0 || tx.committed {
					t.Fatal("replay performed new writes")
				}
				return
			}
			if expected != nil {
				if tx.committed {
					t.Fatal("committed failed creation")
				}
				if name != "commit-failure" && len(tx.writes) != 0 {
					t.Fatal("wrote before validating space/parent")
				}
				return
			}
			if !tx.committed || result.PageID != 42 || result.SpaceID != input.SpaceID || len(tx.writes) != 5 {
				t.Fatal("incomplete creation")
			}
			page := tx.writes[newPageWithType]
			wantParent := int64(-1)
			if in.ParentID != nil {
				wantParent = *in.ParentID
			}
			if page[0] != in.SpaceID || page[1] != in.ActorID || page[2] != wantParent || page[5] != "whiteboard" {
				t.Fatal(page)
			}
			snapshot := tx.writes[whiteboardV2InsertSnapshot]
			state := snapshot[2].([]byte)
			if !reflect.DeepEqual(state, []byte{0, 0}) || snapshot[3] != fmt.Sprintf("sha256:%x", sha256.Sum256(state)) || snapshot[4] != in.Title {
				t.Fatal(snapshot)
			}
			if tx.writes[whiteboardV2InsertDraft][1] != snapshot[0] {
				t.Fatal("draft points to wrong snapshot")
			}
			receipt := tx.writes[whiteboardV2InsertReceipt]
			if !reflect.DeepEqual(receipt, []any{in.ActorID, in.SpaceID, in.IdempotencyKey, whiteboardCreateV2Hash(in.whiteboardCreateV2Body), int64(42)}) {
				t.Fatal(receipt)
			}
		})
	}
	for _, query := range []string{whiteboardV2SetLockTimeout, whiteboardV2LockRequest, whiteboardV2GetReceipt, whiteboardV2LockSpace,
		newPageWithType, whiteboardV2InsertBoard, whiteboardV2InsertSnapshot, whiteboardV2InsertDraft, whiteboardV2InsertReceipt} {
		t.Run("failure-"+query, func(t *testing.T) {
			tx := &whiteboardV2TestTx{t: t, failQuery: query, writes: make(map[string][]any)}
			_, err := (&whiteboardServiceV2{begin: func(context.Context) (pgx.Tx, error) { return tx, nil }}).createTransaction(context.Background(), input)
			if err == nil || tx.committed || !tx.rolledBack {
				t.Fatal("failed statement must abort transaction")
			}
		})
	}
}

func TestWhiteboardServiceV2LockTimeout(t *testing.T) {
	input := whiteboardCreateV2Input{whiteboardCreateV2Body: whiteboardCreateV2Body{Title: "Board"},
		SpaceID: uuid.New(), ActorID: uuid.New(), IdempotencyKey: uuid.New()}
	for _, query := range []string{whiteboardV2LockRequest, whiteboardV2LockSpace, whiteboardV2InsertReceipt} {
		t.Run(query, func(t *testing.T) {
			cause := &pgconn.PgError{Code: "55P03", Message: "canceling statement due to lock timeout"}
			tx := &whiteboardV2TestTx{t: t, writes: make(map[string][]any), failQuery: query, queryErr: cause}
			service := &whiteboardServiceV2{
				begin: func(context.Context) (pgx.Tx, error) { return tx, nil },
				provision: func(context.Context, whiteboardCreateV2Result) error {
					t.Fatal("provisioned after lock timeout")
					return nil
				},
			}
			_, err := service.CreateWhiteboard(context.Background(), input)
			if !errors.Is(err, errWhiteboardV2LockTimeout) || !errors.Is(err, cause) || !tx.rolledBack || tx.committed {
				t.Fatalf("timeout must be retryable and roll back: %v", err)
			}
			if tx.queries[0] != whiteboardV2SetLockTimeout {
				t.Fatal("timeout must be set before acquiring locks")
			}
			if query == whiteboardV2LockRequest && (len(tx.queries) != 2 || len(tx.writes) != 0) {
				t.Fatal("continued creation after advisory lock timeout")
			}
		})
	}
}
