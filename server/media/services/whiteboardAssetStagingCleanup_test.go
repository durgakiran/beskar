package media

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestWhiteboardStagingCleanupCancelledMetadataWriteIsPreservedAndBounded(t *testing.T) {
	type metadataKey struct{}
	const drainTimeout = 40 * time.Millisecond
	worker := NewWhiteboardStagingCleanupWorker(WhiteboardStagingCleanupConfig{
		DrainTimeout: drainTimeout,
	})
	writerCalled := make(chan context.Context, 1)
	worker.writeMetadata = func(ctx context.Context, _ string, _ ...any) error {
		writerCalled <- ctx
		<-ctx.Done()
		return ctx.Err()
	}
	activeCtx, cancelActive := context.WithCancel(context.WithValue(context.Background(), metadataKey{}, "cleanup-metadata"))
	cancelActive()

	started := time.Now()
	err := worker.writeCleanupMetadata(activeCtx, "metadata update")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("drain write ended with %v", err)
	}
	if elapsed := time.Since(started); elapsed < drainTimeout || elapsed > time.Second {
		t.Fatalf("drain write completed outside configured bound: %v", elapsed)
	}
	writeCtx := <-writerCalled
	if writeCtx.Err() != nil {
		if !errors.Is(writeCtx.Err(), context.DeadlineExceeded) {
			t.Fatalf("drain write context ended with %v", writeCtx.Err())
		}
	}
	if got := writeCtx.Value(metadataKey{}); got != "cleanup-metadata" {
		t.Fatalf("drain write context lost metadata: %v", got)
	}
	deadline, ok := writeCtx.Deadline()
	if !ok || deadline.Before(started) || deadline.After(started.Add(drainTimeout+10*time.Millisecond)) {
		t.Fatalf("drain write context deadline is outside configured bound: %v", deadline)
	}
	select {
	case extra := <-writerCalled:
		t.Fatalf("cancelled metadata write ran more than once: %v", extra)
	default:
	}
}

func TestWhiteboardStagingCleanupRetriesMetadataWriteCancelledInFlight(t *testing.T) {
	type metadataKey struct{}
	worker := NewWhiteboardStagingCleanupWorker(WhiteboardStagingCleanupConfig{
		DrainTimeout: time.Second,
	})
	activeCtx, cancelActive := context.WithCancel(context.WithValue(context.Background(), metadataKey{}, "cleanup-metadata"))
	calls := 0
	worker.writeMetadata = func(ctx context.Context, _ string, _ ...any) error {
		calls++
		if calls == 1 {
			cancelActive()
			<-ctx.Done()
			return ctx.Err()
		}
		if ctx.Err() != nil || ctx.Value(metadataKey{}) != "cleanup-metadata" {
			t.Fatalf("recovery write did not retain live metadata context: err=%v metadata=%v", ctx.Err(), ctx.Value(metadataKey{}))
		}
		if _, ok := ctx.Deadline(); !ok {
			t.Fatal("recovery write was not bounded")
		}
		return nil
	}

	if err := worker.writeCleanupMetadata(activeCtx, "metadata update"); err != nil {
		t.Fatalf("bounded recovery write failed: %v", err)
	}
	if calls != 2 {
		t.Fatalf("metadata writes=%d, want initial cancelled write plus bounded recovery", calls)
	}
}

func TestWhiteboardStagingCleanupCancellationDrainsOnlyActiveCandidateWithinOnePassDeadline(t *testing.T) {
	type metadataKey struct{}
	const drainTimeout = 40 * time.Millisecond
	activeCtx, cancelActive := context.WithCancel(context.WithValue(context.Background(), metadataKey{}, "pass-metadata"))
	worker := NewWhiteboardStagingCleanupWorker(WhiteboardStagingCleanupConfig{
		DrainTimeout: drainTimeout,
		MaxAttempts:  8,
		MaxBackoff:   time.Hour,
	})
	candidates := []whiteboardStagingCleanupCandidate{
		{token: uuid.New(), status: "cleanup_pending"},
		{token: uuid.New(), status: "cleanup_pending"},
		{token: uuid.New(), status: "cleanup_pending"},
	}
	cleanupCalls := 0
	worker.cleanup = func(context.Context, whiteboardStagingCleanupCandidate) error {
		cleanupCalls++
		cancelActive()
		return errors.New("cancelled active cleanup")
	}
	metadataCalls := 0
	worker.writeMetadata = func(ctx context.Context, _ string, _ ...any) error {
		metadataCalls++
		if got := ctx.Value(metadataKey{}); got != "pass-metadata" {
			t.Fatalf("drain write context lost active metadata: %v", got)
		}
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Fatal("drain write context has no pass-wide deadline")
		}
		if remaining := time.Until(deadline); remaining <= 0 || remaining > drainTimeout {
			t.Fatalf("drain deadline outside configured pass budget: %v", remaining)
		}
		<-ctx.Done()
		return ctx.Err()
	}

	started := time.Now()
	result, err := worker.processCandidates(activeCtx, time.Now().UTC(), candidates)
	elapsed := time.Since(started)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancelled pass ended with %v", err)
	}
	if result.Claimed != len(candidates) || result.Failed != 1 {
		t.Fatalf("cancelled pass result=%#v", result)
	}
	if cleanupCalls != 1 || metadataCalls != 1 {
		t.Fatalf("cancelled pass processed cleanup=%d metadata=%d; want active candidate only", cleanupCalls, metadataCalls)
	}
	if elapsed < drainTimeout || elapsed > 500*time.Millisecond {
		t.Fatalf("multi-candidate drain completed outside one pass budget: %v", elapsed)
	}
}
