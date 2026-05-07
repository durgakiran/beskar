package pageevents

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	goredis "github.com/redis/go-redis/v9"
)

// inactiveThresholdSec is how long without a draft-leader heartbeat before editor.inactive may fire.
func inactiveThresholdSec() int64 {
	v := strings.TrimSpace(os.Getenv("EDITOR_INACTIVE_THRESHOLD_SEC"))
	if v == "" {
		return 75
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil || n < 30 {
		return 75
	}
	return n
}

// RecordEditorPresence stores last-seen for the user and optional draft-leader heartbeat timestamps in Redis.
// Returns rateLimited=true when called more often than once per ~5s per (space, page, user).
// When Redis is disabled, returns (false, nil) — a no-op success for the client.
func RecordEditorPresence(ctx context.Context, spaceID uuid.UUID, pageID int64, userID uuid.UUID, isDraftLeader bool, clientTime string) (rateLimited bool, err error) {
	_ = clientTime
	redisMu.RLock()
	c := client
	redisMu.RUnlock()
	if c == nil {
		return false, nil
	}
	rlKey := fmt.Sprintf("beskar:presence:rl:%s:%d:%s", spaceID.String(), pageID, userID.String())
	ok, err := c.SetNX(ctx, rlKey, "1", 5*time.Second).Result()
	if err != nil {
		return false, err
	}
	if !ok {
		return true, nil
	}
	now := time.Now().Unix()
	pipe := c.Pipeline()
	pipe.Set(ctx, fmt.Sprintf("beskar:presence:user_seen:%s:%d:%s", spaceID.String(), pageID, userID.String()),
		strconv.FormatInt(now, 10), 5*time.Minute)
	if isDraftLeader {
		tsKey := fmt.Sprintf("beskar:presence:draft_leader_ts:%s:%d", spaceID.String(), pageID)
		userKey := fmt.Sprintf("beskar:presence:draft_leader_user:%s:%d", spaceID.String(), pageID)
		// Long TTL so the signalserver watchdog can read stale timestamps (see watchdog-implementation-plan.md).
		pipe.Set(ctx, tsKey, strconv.FormatInt(now, 10), 10*time.Minute)
		pipe.Set(ctx, userKey, userID.String(), 10*time.Minute)
	}
	_, err = pipe.Exec(ctx)
	return false, err
}

// CheckPublishDraftLeaderInactive publishes editor.inactive at most once per interval while the
// last draft-leader heartbeat is older than EDITOR_INACTIVE_THRESHOLD_SEC (default 75).
func CheckPublishDraftLeaderInactive(ctx context.Context, spaceID uuid.UUID, pageID int64) error {
	redisMu.RLock()
	c := client
	redisMu.RUnlock()
	if c == nil {
		return nil
	}
	tsKey := fmt.Sprintf("beskar:presence:draft_leader_ts:%s:%d", spaceID.String(), pageID)
	userKey := fmt.Sprintf("beskar:presence:draft_leader_user:%s:%d", spaceID.String(), pageID)
	tsStr, err := c.Get(ctx, tsKey).Result()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return nil
		}
		return err
	}
	if tsStr == "" {
		return nil
	}
	lastTS, err := strconv.ParseInt(tsStr, 10, 64)
	if err != nil {
		return nil
	}
	if time.Now().Unix()-lastTS < inactiveThresholdSec() {
		return nil
	}
	userStr, err := c.Get(ctx, userKey).Result()
	if err != nil {
		if errors.Is(err, goredis.Nil) {
			return nil
		}
		return err
	}
	if userStr == "" {
		return nil
	}
	dedupeKey := fmt.Sprintf("beskar:presence:inactive_emit:%s:%d", spaceID.String(), pageID)
	set, err := c.SetNX(ctx, dedupeKey, "1", 90*time.Second).Result()
	if err != nil || !set {
		return err
	}
	return PublishEditorInactive(ctx, spaceID, pageID, userStr, "draft_leader_heartbeat_stale")
}

// TouchDraftLeaderTs updates draft-leader liveness in Redis (no rate-limit).
// Used after PUT /editor/update when the client reports isDraftLeader=true.
func TouchDraftLeaderTs(ctx context.Context, spaceID uuid.UUID, pageID int64, userID uuid.UUID) error {
	redisMu.RLock()
	c := client
	redisMu.RUnlock()
	if c == nil {
		return nil
	}
	now := strconv.FormatInt(time.Now().Unix(), 10)
	tsKey := fmt.Sprintf("beskar:presence:draft_leader_ts:%s:%d", spaceID.String(), pageID)
	userKey := fmt.Sprintf("beskar:presence:draft_leader_user:%s:%d", spaceID.String(), pageID)
	pipe := c.Pipeline()
	pipe.Set(ctx, tsKey, now, 10*time.Minute)
	pipe.Set(ctx, userKey, userID.String(), 10*time.Minute)
	_, err := pipe.Exec(ctx)
	return err
}
