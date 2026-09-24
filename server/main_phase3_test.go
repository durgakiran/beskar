package main

import (
	"context"
	"errors"
	"testing"
	"time"

	mediaservice "github.com/durgakiran/beskar/media/services"
)

func TestPhase3WhiteboardStagingCleanupMainWiring(t *testing.T) {
	original := launchWhiteboardStagingCleanup
	t.Cleanup(func() { launchWhiteboardStagingCleanup = original })
	launches := 0
	launchWhiteboardStagingCleanup = func(ctx context.Context, worker *mediaservice.WhiteboardStagingCleanupWorker) <-chan struct{} {
		if worker == nil {
			t.Fatal("cleanup wiring constructed a nil worker")
		}
		if ctx == nil {
			t.Fatal("cleanup wiring received a nil application context")
		}
		launches++
		done := make(chan struct{})
		close(done)
		return done
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	<-startWhiteboardStagingCleanup(ctx, mediaservice.WhiteboardStagingCleanupConfig{Enabled: false})
	if launches != 0 {
		t.Fatal("disabled cleanup worker was launched")
	}
	<-startWhiteboardStagingCleanup(ctx, mediaservice.WhiteboardStagingCleanupConfig{Enabled: true})
	if launches != 1 {
		t.Fatalf("enabled cleanup worker launches=%d", launches)
	}
}

func TestPhase3WhiteboardStagingCleanupWorkerCancelsAndCompletes(t *testing.T) {
	type metadataKey struct{}
	ctx, cancel := context.WithCancel(context.WithValue(context.Background(), metadataKey{}, "shutdown-metadata"))
	passStarted := make(chan struct{})
	cancellationObserved := make(chan bool, 1)
	worker := mediaservice.NewWhiteboardStagingCleanupWorkerWithPass(mediaservice.WhiteboardStagingCleanupConfig{
		Enabled: true, Interval: time.Hour, Expiry: time.Minute, BatchSize: 1,
	}, func(passContext context.Context) (mediaservice.WhiteboardStagingCleanupResult, error) {
		close(passStarted)
		<-passContext.Done()
		cancellationObserved <- passContext.Value(metadataKey{}) == "shutdown-metadata" &&
			errors.Is(passContext.Err(), context.Canceled)
		return mediaservice.WhiteboardStagingCleanupResult{}, nil
	})
	done := worker.Start(ctx)
	select {
	case <-passStarted:
	case <-time.After(time.Second):
		t.Fatal("cleanup worker did not start an active pass")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup worker did not complete after cancelling its active pass")
	}
	if !<-cancellationObserved {
		t.Fatal("active cleanup pass did not receive cancellation with its context metadata")
	}
}
