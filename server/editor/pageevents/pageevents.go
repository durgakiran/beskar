// Package pageevents implements Redis Pub/Sub fan-out and SSE delivery for editor page events
// (document.published, draft.updated). See new-features/document-collaboration/implementation-plan.md §8.
package pageevents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

const channelPrefix = "beskar:pageevents:"

// PageEventV1 is the wire format for SSE and Redis payloads.
type PageEventV1 struct {
	SchemaVersion   int       `json:"schemaVersion"`
	Type            string    `json:"type"`
	SpaceID         string    `json:"spaceId"`
	PageID          int64     `json:"pageId"`
	DocID           int64     `json:"docId"`
	DraftGeneration int64     `json:"draftGeneration"`
	OccurredAt      time.Time `json:"occurredAt"`
	UserID          string    `json:"userId,omitempty"`
	Reason          string    `json:"reason,omitempty"`
}

var (
	logMu sync.RWMutex
	log   *zap.Logger

	redisMu sync.RWMutex
	client  *redis.Client

	hubMu sync.RWMutex
	// key: spaceUUID + "/" + pageId -> list of subscriber channels
	subs map[string][]chan []byte

	activeSSE atomic.Int64
)

func SetLogger(l *zap.Logger) {
	logMu.Lock()
	defer logMu.Unlock()
	log = l
}

func logger() *zap.Logger {
	logMu.RLock()
	defer logMu.RUnlock()
	if log != nil {
		return log
	}
	return zap.NewNop()
}

// Enabled reports whether Redis is connected and publishing will work.
func Enabled() bool {
	redisMu.RLock()
	defer redisMu.RUnlock()
	return client != nil
}

// Init connects to Redis from REDIS_ADDR or REDIS_HOST (+ optional REDIS_PASSWORD, REDIS_PORT) and starts the subscriber.
func Init(ctx context.Context) {
	addr := strings.TrimSpace(os.Getenv("REDIS_ADDR"))
	if addr == "" {
		host := strings.TrimSpace(os.Getenv("REDIS_HOST"))
		if host == "" {
			logger().Warn("pageevents: REDIS_ADDR / REDIS_HOST unset; page event SSE fan-out disabled")
			return
		}
		port := strings.TrimSpace(os.Getenv("REDIS_PORT"))
		if port == "" {
			port = "6379"
		}
		pass := os.Getenv("REDIS_PASSWORD")
		if pass != "" {
			addr = fmt.Sprintf("redis://:%s@%s:%s/0", pass, host, port)
		} else {
			addr = fmt.Sprintf("redis://%s:%s/0", host, port)
		}
	}

	opts, err := redis.ParseURL(addr)
	if err != nil {
		logger().Warn("pageevents: invalid redis URL", zap.String("addr", addr), zap.Error(err))
		return
	}

	c := redis.NewClient(opts)
	if err := c.Ping(ctx).Err(); err != nil {
		logger().Warn("pageevents: redis ping failed", zap.Error(err))
		_ = c.Close()
		return
	}

	redisMu.Lock()
	client = c
	hubMu.Lock()
	if subs == nil {
		subs = make(map[string][]chan []byte)
	}
	hubMu.Unlock()
	redisMu.Unlock()

	logger().Info("pageevents: redis connected, starting subscriber")
	go runSubscriber(ctx)
}

func channelKey(spaceID uuid.UUID, pageID int64) string {
	return fmt.Sprintf("%s%s:%d", channelPrefix, spaceID.String(), pageID)
}

func hubKey(spaceID uuid.UUID, pageID int64) string {
	return spaceID.String() + "/" + strconv.FormatInt(pageID, 10)
}

func publish(ctx context.Context, ev PageEventV1) error {
	redisMu.RLock()
	c := client
	redisMu.RUnlock()
	if c == nil {
		return nil
	}
	b, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	spaceID, err := uuid.Parse(ev.SpaceID)
	if err != nil {
		return err
	}
	return c.Publish(ctx, channelKey(spaceID, ev.PageID), string(b)).Err()
}

// PublishDocumentPublished emits after a successful publish transaction.
func PublishDocumentPublished(ctx context.Context, spaceID uuid.UUID, pageID, docID, draftGeneration int64) error {
	return publish(ctx, PageEventV1{
		SchemaVersion:   1,
		Type:            "document.published",
		SpaceID:         spaceID.String(),
		PageID:          pageID,
		DocID:           docID,
		DraftGeneration: draftGeneration,
		OccurredAt:      time.Now().UTC(),
	})
}

// PublishDraftUpdated emits after a successful draft PUT /update.
func PublishDraftUpdated(ctx context.Context, spaceID uuid.UUID, pageID, docID, draftGeneration int64) error {
	return publish(ctx, PageEventV1{
		SchemaVersion:   1,
		Type:            "draft.updated",
		SpaceID:         spaceID.String(),
		PageID:          pageID,
		DocID:           docID,
		DraftGeneration: draftGeneration,
		OccurredAt:      time.Now().UTC(),
	})
}

// PublishEditorInactive notifies subscribers that the draft save leader may be unresponsive (M6).
func PublishEditorInactive(ctx context.Context, spaceID uuid.UUID, pageID int64, userID, reason string) error {
	return publish(ctx, PageEventV1{
		SchemaVersion:   1,
		Type:            "editor.inactive",
		SpaceID:         spaceID.String(),
		PageID:          pageID,
		DocID:           0,
		DraftGeneration: 0,
		OccurredAt:      time.Now().UTC(),
		UserID:          userID,
		Reason:          reason,
	})
}

// ActiveSSEConnections returns the number of open page-event SSE streams on this process (M8 observability hook).
func ActiveSSEConnections() int64 {
	return activeSSE.Load()
}

func runSubscriber(ctx context.Context) {
	redisMu.RLock()
	c := client
	redisMu.RUnlock()
	if c == nil {
		return
	}
	sub := c.PSubscribe(ctx, channelPrefix+"*")
	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			_ = sub.Close()
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if msg == nil {
				continue
			}
			payload := []byte(msg.Payload)
			rest := strings.TrimPrefix(msg.Channel, channelPrefix)
			idx := strings.LastIndex(rest, ":")
			if idx <= 0 || idx >= len(rest)-1 {
				continue
			}
			spaceStr := rest[:idx]
			pageStr := rest[idx+1:]
			pageID, err := strconv.ParseInt(pageStr, 10, 64)
			if err != nil {
				continue
			}
			sid, err := uuid.Parse(spaceStr)
			if err != nil {
				continue
			}
			key := hubKey(sid, pageID)
			hubMu.RLock()
			list := append([]chan []byte(nil), subs[key]...)
			hubMu.RUnlock()
			for _, chSub := range list {
				select {
				case chSub <- payload:
				default:
				}
			}
		}
	}
}

func register(spaceID uuid.UUID, pageID int64) chan []byte {
	ch := make(chan []byte, 32)
	key := hubKey(spaceID, pageID)
	hubMu.Lock()
	subs[key] = append(subs[key], ch)
	hubMu.Unlock()
	activeSSE.Add(1)
	logger().Debug("pageevents_sse_open", zap.Int64("active", activeSSE.Load()))
	return ch
}

func unregister(spaceID uuid.UUID, pageID int64, ch chan []byte) {
	key := hubKey(spaceID, pageID)
	hubMu.Lock()
	list := subs[key]
	out := list[:0]
	for _, c := range list {
		if c != ch {
			out = append(out, c)
		}
	}
	if len(out) == 0 {
		delete(subs, key)
	} else {
		subs[key] = out
	}
	hubMu.Unlock()
	activeSSE.Add(-1)
	logger().Debug("pageevents_sse_close", zap.Int64("active", activeSSE.Load()))
	close(ch)
}

// ServeSSE streams PageEventV1 JSON as SSE `data:` lines. Requires Redis (503 if disabled).
func ServeSSE(w http.ResponseWriter, r *http.Request, spaceID uuid.UUID, pageID int64) {
	if !Enabled() {
		http.Error(w, `{"error":"page events unavailable (redis not configured)"}`, http.StatusServiceUnavailable)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := register(spaceID, pageID)
	defer unregister(spaceID, pageID, ch)

	// Write headers + prelude
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()

	tick := time.NewTicker(25 * time.Second)
	defer tick.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := CheckPublishDraftLeaderInactive(ctx, spaceID, pageID); err != nil {
				logger().Warn("pageevents inactive check", zap.Error(err))
			}
			_, _ = fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		case payload := <-ch:
			_, _ = fmt.Fprintf(w, "data: %s\n\n", string(payload))
			flusher.Flush()
		}
	}
}
