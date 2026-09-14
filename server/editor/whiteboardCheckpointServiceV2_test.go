package editor

import (
	"context"
	"errors"
	"fmt"
	"math"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type checkpointTestTx struct {
	pgx.Tx
	input                 whiteboardCheckpointV2Input
	head                  int64
	archived, deleted     bool
	missing               string
	hash                  string
	storedID              uuid.UUID
	storedSequence        int64
	fail                  string
	cause                 error
	calls                 []string
	writes                map[string][]any
	committed, rolledBack bool
	advanceRows           int64
}

func (tx *checkpointTestTx) Exec(_ context.Context, q string, args ...any) (pgconn.CommandTag, error) {
	tx.calls = append(tx.calls, q)
	if q == tx.fail {
		return pgconn.CommandTag{}, tx.cause
	}
	if q != whiteboardV2SetLockTimeout {
		tx.writes[q] = args
	}
	if q == whiteboardV2CheckpointAdvance {
		return pgconn.NewCommandTag(fmt.Sprintf("UPDATE %d", tx.advanceRows)), nil
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}
func (tx *checkpointTestTx) QueryRow(_ context.Context, q string, args ...any) pgx.Row {
	tx.calls = append(tx.calls, q)
	if q == tx.fail {
		return whiteboardV2TestRow{err: tx.cause}
	}
	if q == tx.missing {
		return whiteboardV2TestRow{err: pgx.ErrNoRows}
	}
	switch q {
	case whiteboardV2LockSpace:
		return whiteboardV2TestRow{values: []any{tx.archived, tx.deleted}}
	case whiteboardV2CheckpointLockBoard:
		return whiteboardV2TestRow{values: []any{tx.input.PageID}}
	case whiteboardV2CheckpointLockDraft:
		return whiteboardV2TestRow{values: []any{tx.head, int64(0)}}
	case whiteboardV2CheckpointReceipt:
		if !reflect.DeepEqual(args, []any{tx.input.PageID, tx.input.ActorID, tx.input.IdempotencyKey}) {
			panic("wrong receipt scope")
		}
		if tx.hash == "" {
			return whiteboardV2TestRow{err: pgx.ErrNoRows}
		}
		return whiteboardV2TestRow{values: []any{tx.storedID, tx.storedSequence, tx.hash}}
	}
	panic("unexpected query")
}
func (tx *checkpointTestTx) Commit(context.Context) error {
	if tx.fail == "commit" {
		return tx.cause
	}
	tx.committed = true
	return nil
}
func (tx *checkpointTestTx) Rollback(ctx context.Context) error {
	if ctx.Err() != nil {
		panic("cleanup inherited cancellation")
	}
	tx.rolledBack = true
	return nil
}
func checkpointTestInput() whiteboardCheckpointV2Input {
	return whiteboardCheckpointV2Input{PageID: 42, SpaceID: uuid.New(), ActorID: uuid.New(), IdempotencyKey: uuid.New(),
		UpdateEncoding: whiteboardUpdateEncodingV1, UpdateBytes: []byte{0, 0}}
}
func newCheckpointTestTx(in whiteboardCheckpointV2Input) *checkpointTestTx {
	return &checkpointTestTx{input: in, head: 16, storedID: uuid.New(), storedSequence: 3, writes: map[string][]any{}, advanceRows: 1}
}
func checkpointService(tx *checkpointTestTx) *whiteboardServiceV2 {
	return &whiteboardServiceV2{begin: func(context.Context) (pgx.Tx, error) { return tx, nil },
		provision: func(context.Context, whiteboardCreateV2Result) error { panic("checkpoint must not provision") }}
}
func TestCheckpointV2Transaction(t *testing.T) {
	for _, name := range []string{"append", "replay", "archived-replay", "deleted-replay", "key-reuse", "archived", "deleted", "missing-space", "missing-board", "missing-draft", "exhausted", "negative-head", "missing-advance"} {
		t.Run(name, func(t *testing.T) {
			in := checkpointTestInput()
			tx := newCheckpointTestTx(in)
			var want error
			switch name {
			case "replay", "archived-replay", "deleted-replay":
				tx.hash = whiteboardCheckpointV2Hash(in)
				tx.archived = name == "archived-replay"
				tx.deleted = name == "deleted-replay"
			case "key-reuse":
				tx.hash = "different"
				want = errWhiteboardV2KeyReuse
			case "archived":
				tx.archived = true
				want = errWhiteboardV2Archived
			case "deleted":
				tx.deleted = true
				want = errWhiteboardV2BoardNotFound
			case "missing-space":
				tx.missing = whiteboardV2LockSpace
				want = errWhiteboardV2BoardNotFound
			case "missing-board":
				tx.missing = whiteboardV2CheckpointLockBoard
				want = errWhiteboardV2BoardNotFound
			case "missing-draft":
				tx.missing = whiteboardV2CheckpointLockDraft
				want = errWhiteboardV2DraftMissing
			case "exhausted":
				tx.head = math.MaxInt64
			case "negative-head":
				tx.head = -1
			case "missing-advance":
				tx.advanceRows = 0
				want = errWhiteboardV2DraftMissing
			}
			result, err := checkpointService(tx).CheckpointWhiteboard(context.Background(), in)
			if name == "exhausted" || name == "negative-head" {
				if err == nil {
					t.Fatal("accepted invalid sequence")
				}
			} else if !errors.Is(err, want) {
				t.Fatalf("got %v want %v", err, want)
			}
			if !tx.rolledBack {
				t.Fatal("missing cleanup")
			}
			prefix := []string{whiteboardV2SetLockTimeout, whiteboardV2LockSpace, whiteboardV2CheckpointLockBoard, whiteboardV2CheckpointLockDraft, whiteboardV2CheckpointReceipt}
			n := len(tx.calls)
			if n > len(prefix) {
				n = len(prefix)
			}
			if !reflect.DeepEqual(tx.calls[:n], prefix[:n]) {
				t.Fatal("wrong locking/replay order")
			}
			if err != nil {
				if tx.committed {
					t.Fatal("committed failure")
				}
				if name != "missing-advance" && len(tx.writes) > 0 {
					t.Fatal("wrote before validation")
				}
				return
			}
			if tx.hash != "" {
				if tx.committed || len(tx.writes) != 0 || result.Sequence != 3 || result.UpdateID != tx.storedID {
					t.Fatal("replay changed acknowledgement or wrote")
				}
				return
			}
			if !tx.committed || result.PageID != 42 || result.Sequence != 17 || result.UpdateID == uuid.Nil || len(tx.writes) != 2 {
				t.Fatal("incomplete append")
			}
			expected := []any{result.UpdateID, in.PageID, int64(17), in.ActorID, in.IdempotencyKey, in.UpdateBytes, in.UpdateEncoding, whiteboardCheckpointV2Hash(in)}
			if !reflect.DeepEqual(tx.writes[whiteboardV2CheckpointInsert], expected) {
				t.Fatal("wrong persisted batch")
			}
			if !reflect.DeepEqual(tx.writes[whiteboardV2CheckpointAdvance], []any{in.PageID, int64(17), in.ActorID}) {
				t.Fatal("wrong draft advance")
			}
		})
	}
}
func TestCheckpointV2Failures(t *testing.T) {
	for _, q := range []string{whiteboardV2SetLockTimeout, whiteboardV2LockSpace, whiteboardV2CheckpointLockBoard, whiteboardV2CheckpointLockDraft, whiteboardV2CheckpointReceipt, whiteboardV2CheckpointInsert, whiteboardV2CheckpointAdvance, "commit"} {
		for _, lockTimeout := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%t", q, lockTimeout), func(t *testing.T) {
				in := checkpointTestInput()
				tx := newCheckpointTestTx(in)
				tx.fail = q
				tx.cause = errors.New("injected")
				if lockTimeout {
					tx.cause = &pgconn.PgError{Code: "55P03"}
				}
				_, err := checkpointService(tx).CheckpointWhiteboard(context.Background(), in)
				if !errors.Is(err, tx.cause) || tx.committed || !tx.rolledBack {
					t.Fatal("lost error or failed rollback")
				}
				if errors.Is(err, errWhiteboardV2LockTimeout) != lockTimeout {
					t.Fatal("wrong retry classification")
				}
			})
		}
	}
	cause := errors.New("begin failed")
	s := &whiteboardServiceV2{begin: func(context.Context) (pgx.Tx, error) { return nil, cause }}
	if _, err := s.CheckpointWhiteboard(context.Background(), checkpointTestInput()); !errors.Is(err, cause) {
		t.Fatal(err)
	}
}
func TestCheckpointV2OverlappingActors(t *testing.T) {
	in := checkpointTestInput()
	a := newCheckpointTestTx(in)
	first, err := checkpointService(a).CheckpointWhiteboard(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	in.ActorID = uuid.New() // Same bytes and even the same key belong to another scope.
	b := newCheckpointTestTx(in)
	b.head = first.Sequence
	second, err := checkpointService(b).CheckpointWhiteboard(context.Background(), in)
	if err != nil || second.Sequence != first.Sequence+1 || len(b.writes) != 2 {
		t.Fatal("overlapping actor batch rejected")
	}
}
