# Watchdog implementation plan: Redis-backed leader eviction

Implements the design from [leader-save-and-presence.md §Proposed](./leader-save-and-presence.md).

**Goal**: when the signaling leader stops making saves or presence heartbeats for `SIGNAL_LEADER_EVICT_SEC` seconds, the signalserver forcibly closes that WebSocket → `handleUnregister` fires → `electLeaderInternal` promotes the next healthy tab → draft saves resume automatically.

---

## Phases at a glance

| Phase | Scope | File(s) |
|-------|-------|---------|
| 1 | Extend `draft_leader_ts` TTL to 10 min | `server/editor/pageevents/presence.go` |
| 2a | `isDraftLeader` in `PUT /editor/update` body — UI | `ui/app/components/DocumentEditor.tsx` |
| 2b | `isDraftLeader` in `PUT /editor/update` body — server types | `server/editor/types.go` |
| 2c | `TouchDraftLeaderTs` helper — server | `server/editor/pageevents/presence.go` |
| 2d | Call `TouchDraftLeaderTs` after successful save | `server/editor/draft_debounce.go` |
| 3 | Add Redis client to signalserver | `signalserver/main.go`, `signalserver/go.mod` |
| 4 | Write room state to Redis on join/leave/election | `signalserver/main.go` |
| 5 | Watchdog goroutine (polling ticker) | `signalserver/main.go` |
| 6 | Clear `inactive_emit` dedupe key on eviction | `signalserver/main.go` (inside `evictLeader`) |
| 7 | Env vars & config wiring | `docker/env/*.env`, `docker/app/app.yml` |
| 8 | QA checklist | — |

---

## Phase 1 — Extend `draft_leader_ts` TTL to 10 min

**File**: `server/editor/pageevents/presence.go`

**Why**: the key currently has a 2-minute TTL. The watchdog eviction threshold is 90 s + up to 15 s poll interval = ~105 s worst case. If the key expires before the watchdog reads it, the watchdog sees Nil and skips — never evicting. Extending to 10 min makes Nil reliably mean "no leader has ever posted for this page" rather than "key expired since the last poll".

**Change** (two lines in `RecordEditorPresence`):
```go
// before
pipe.Set(ctx, tsKey,   strconv.FormatInt(now, 10), 2*time.Minute)
pipe.Set(ctx, userKey, userID.String(),             2*time.Minute)

// after
pipe.Set(ctx, tsKey,   strconv.FormatInt(now, 10), 10*time.Minute)
pipe.Set(ctx, userKey, userID.String(),             10*time.Minute)
```

**Threshold ordering**:

```
Heartbeat interval          30 s   (NEXT_PUBLIC_EDITOR_PRESENCE)
editor.inactive threshold   75 s   (EDITOR_INACTIVE_THRESHOLD_SEC)
Watchdog poll interval      15 s   (SIGNAL_WATCHDOG_INTERVAL_SEC)
Leader eviction threshold   90 s   (SIGNAL_LEADER_EVICT_SEC)
draft_leader_ts TTL        600 s   (10 min — well above eviction threshold)
```

**Rule**: `eviction threshold` must be less than `draft_leader_ts TTL` by at least `poll interval + 30 s` to guarantee the key is still readable when the watchdog fires.

**Verify**: `REDIS_CLI TTL beskar:presence:draft_leader_ts:<spaceId>:<pageId>` returns ~600 after a presence POST.

---

## Phase 2 — Add `isDraftLeader` to `PUT /editor/update`

Currently `PUT /editor/update` never touches `draft_leader_ts`. A leader that is actively saving but whose presence heartbeat is delayed (hidden tab, slow network) should not be evicted. Adding `isDraftLeader` to the save request closes this gap.

### 2a — UI: extend `IPayload` and pass the flag

**File**: `ui/app/components/DocumentEditor.tsx`

**Change 1** — add field to interface:
```typescript
// before
interface IPayload {
    title: string;
    ownerId: string;
    parentId?: number;
    id: number;
    docId?: number;
    spaceId: string;
    data: any;
    assetReferences?: AssetReferencesPayload;
}

// after
interface IPayload {
    title: string;
    ownerId: string;
    parentId?: number;
    id: number;
    docId?: number;
    spaceId: string;
    data: any;
    isDraftLeader?: boolean;
    assetReferences?: AssetReferencesPayload;
}
```

**Change 2** — pass `isLeader` in `updateContent`:
```typescript
// before
const payLoad: IPayload = {
    data: content,
    id: Number(slug[1]),
    ownerId: profileData.data.id,
    spaceId: slug[0],
    docId: docId,
    parentId: parentId,
    title: title,
    assetReferences: extractAssetReferences(content),
};

// after
const payLoad: IPayload = {
    data: content,
    id: Number(slug[1]),
    ownerId: profileData.data.id,
    spaceId: slug[0],
    docId: docId,
    parentId: parentId,
    title: title,
    isDraftLeader: isLeader,
    assetReferences: extractAssetReferences(content),
};
```

`isLeader` is already in scope here — no new state needed.

### 2b — Server: add field to `InputDraftDocument`

**File**: `server/editor/types.go`

`ValidateNewDraftDoc` unmarshals bytes directly into `InputDraftDocument` via `json.Unmarshal`. Adding the field is sufficient — no validation changes needed.

```go
// before
type InputDraftDocument struct {
    Document
    Data            []byte                      `json:"data"`
    AssetReferences *assetref.PayloadReferences `json:"assetReferences,omitempty"`
}

// after
type InputDraftDocument struct {
    Document
    Data            []byte                      `json:"data"`
    IsDraftLeader   bool                        `json:"isDraftLeader"`
    AssetReferences *assetref.PayloadReferences `json:"assetReferences,omitempty"`
}
```

### 2c — Server: add `TouchDraftLeaderTs` to presence package

**File**: `server/editor/pageevents/presence.go`

Add a lightweight function that refreshes the ts + user keys without the 5 s rate-limit guard used by `RecordEditorPresence`. The rate-limit in `RecordEditorPresence` is fine for the heartbeat (30 s interval), but save calls can arrive every 2 s (debounce) and we want each one to refresh the key.

```go
// TouchDraftLeaderTs updates the draft-leader liveness timestamp for the watchdog.
// Called from PUT /editor/update when isDraftLeader=true.
// No rate-limiting — saves can arrive every EDITOR_DRAFT_DEBOUNCE_SEC seconds.
func TouchDraftLeaderTs(ctx context.Context, spaceID uuid.UUID, pageID int64, userID uuid.UUID) error {
    redisMu.RLock()
    c := client
    redisMu.RUnlock()
    if c == nil {
        return nil // Redis disabled — no-op
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
```

### 2d — Server: call `TouchDraftLeaderTs` after successful save

**Files**: `server/editor/draft_debounce.go` (not `editorController.go` — debounce merges payloads; touch must use the document that was actually persisted).

After a successful `doc.Update()` in `flushDraftDebounced` and in the `sec == 0` branch of `RunDraftUpdateWithDebounce`, when `doc.IsDraftLeader && pageevents.Enabled()`:

```go
if err == nil && doc.IsDraftLeader && pageevents.Enabled() {
    if terr := pageevents.TouchDraftLeaderTs(ctx, doc.SpaceId, pageID, doc.OwnerId); terr != nil {
        core.Logger.Warn("pageevents: touch draft leader ts", zap.Error(terr))
    }
}
```

**Verify**: `REDIS_CLI MONITOR` shows `SET beskar:presence:draft_leader_ts:...` after each leader save.

---

## Phase 3 — Add Redis client to signalserver

### 3a — Add dependency

**File**: `signalserver/go.mod` / install

```bash
cd signalserver && go get github.com/redis/go-redis/v9
```

`go-redis/v9` is already used in the app server so the pattern is established.

### 3b — Redis client in `signalserver/main.go`

Add a package-level client (nil when `SIGNAL_REDIS_URL` is not set) and an init function:

```go
import (
    // existing imports ...
    "context"
    "github.com/redis/go-redis/v9"
)

var sigRedis *redis.Client // nil if SIGNAL_REDIS_URL not configured

func initSignalRedis() {
    url := os.Getenv("SIGNAL_REDIS_URL")
    if url == "" {
        log.Println("SIGNAL_REDIS_URL not set — watchdog disabled")
        return
    }
    opts, err := redis.ParseURL(url)
    if err != nil {
        log.Printf("signalserver: invalid SIGNAL_REDIS_URL: %v", err)
        return
    }
    c := redis.NewClient(opts)
    ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
    defer cancel()
    if err := c.Ping(ctx).Err(); err != nil {
        log.Printf("signalserver: redis ping failed: %v — watchdog disabled", err)
        return
    }
    sigRedis = c
    log.Println("signalserver: redis connected, watchdog enabled")
}
```

Call `initSignalRedis()` from `main()` before `setupRoutes()`.

---

## Phase 4 — Write room state to Redis on membership changes

All Redis writes in signalserver are **fire-and-forget goroutines** — they must not block under `h.mu` (which is held during election and unregister). Use `context.Background()` with a short timeout.

### 4a — Topic parsing helper

```go
// parseTopicIDs splits "<pageId>-space-<spaceId>" into its parts.
// Returns ("", "", false) if the topic does not match the expected format.
func parseTopicIDs(topic string) (pageID string, spaceID string, ok bool) {
    parts := strings.SplitN(topic, "-space-", 2)
    if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
        return "", "", false
    }
    return parts[0], parts[1], true
}
```

### 4b — Redis write helper

```go
const roomKeyTTL = 0 // no expiry — cleaned up explicitly on unregister

func redisSetRoomLeader(topic, leaderClientID string) {
    if sigRedis == nil {
        return
    }
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        defer cancel()
        key := "beskar:room:" + topic + ":leader"
        if err := sigRedis.Set(ctx, key, leaderClientID, roomKeyTTL).Err(); err != nil {
            log.Printf("signalserver: redis set room leader: %v", err)
        }
    }()
}

func redisAddRoomMember(topic, clientID string) {
    if sigRedis == nil {
        return
    }
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        defer cancel()
        key := "beskar:room:" + topic + ":members"
        if err := sigRedis.HSet(ctx, key, clientID, "1").Err(); err != nil {
            log.Printf("signalserver: redis add room member: %v", err)
        }
    }()
}

func redisRemoveRoomMember(topic, clientID string, topicDrained bool) {
    if sigRedis == nil {
        return
    }
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        defer cancel()
        memberKey := "beskar:room:" + topic + ":members"
        leaderKey := "beskar:room:" + topic + ":leader"
        pipe := sigRedis.Pipeline()
        pipe.HDel(ctx, memberKey, clientID)
        if topicDrained {
            pipe.Del(ctx, memberKey, leaderKey)
        }
        if _, err := pipe.Exec(ctx); err != nil {
            log.Printf("signalserver: redis remove room member: %v", err)
        }
    }()
}
```

### 4c — Wire into existing subscribe and unregister

In `electLeaderInternal`: after storing `h.topicLeaderID[topicName] = newLeaderID`, add:
```go
redisSetRoomLeader(topicName, newLeaderID)
```

In `readPump` subscribe case: after `h.topics[t][c] = true`, add:
```go
redisAddRoomMember(t, c.clientID)
```

In `handleUnregister`: after `delete(clients, c)`, determine `topicDrained := len(clients) == 0`, then:
```go
redisRemoveRoomMember(topic, c.clientID, topicDrained)
```

---

## Phase 5 — Watchdog goroutine

### 5a — Configuration helpers

```go
func watchdogInterval() time.Duration {
    if v := os.Getenv("SIGNAL_WATCHDOG_INTERVAL_SEC"); v != "" {
        if n, err := strconv.Atoi(v); err == nil && n > 0 {
            return time.Duration(n) * time.Second
        }
    }
    return 15 * time.Second
}

func leaderEvictSec() int64 {
    if v := os.Getenv("SIGNAL_LEADER_EVICT_SEC"); v != "" {
        if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
            return n
        }
    }
    return 90
}
```

### 5b — Watchdog goroutine

```go
func (h *Hub) startWatchdog(ctx context.Context) {
    if sigRedis == nil {
        return
    }
    go func() {
        ticker := time.NewTicker(watchdogInterval())
        defer ticker.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-ticker.C:
                h.watchdogTick(ctx)
            }
        }
    }()
}

func (h *Hub) watchdogTick(ctx context.Context) {
    threshold := leaderEvictSec()

    // Snapshot topic→leaderClientID under read lock.
    // Never hold the lock during Redis I/O.
    h.mu.RLock()
    snapshot := make(map[string]string, len(h.topicLeaderID))
    for topic, leaderID := range h.topicLeaderID {
        snapshot[topic] = leaderID
    }
    h.mu.RUnlock()

    for topic, leaderClientID := range snapshot {
        pageID, spaceID, ok := parseTopicIDs(topic)
        if !ok {
            continue
        }

        tsKey := fmt.Sprintf("beskar:presence:draft_leader_ts:%s:%s", spaceID, pageID)

        tsStr, err := sigRedis.Get(ctx, tsKey).Result()
        if err != nil {
            if !errors.Is(err, redis.Nil) {
                log.Printf("watchdog: redis error topic=%s: %v — skipping", topic, err)
            }
            // Nil = no leader activity recorded yet, or Redis error — skip, do not evict.
            continue
        }

        lastTS, err := strconv.ParseInt(tsStr, 10, 64)
        if err != nil {
            continue
        }
        if time.Now().Unix()-lastTS < threshold {
            continue // leader is active
        }

        // Double-check: re-read to guard against a write arriving between reads.
        tsStr2, err := sigRedis.Get(ctx, tsKey).Result()
        if err != nil || tsStr2 != tsStr {
            continue // key refreshed — skip
        }

        h.evictLeader(topic, leaderClientID, pageID, spaceID)
    }
}
```

### 5c — `evictLeader`

```go
func (h *Hub) evictLeader(topic, leaderClientID, pageID, spaceID string) {
    h.mu.RLock()
    clients, ok := h.topics[topic]
    if !ok {
        h.mu.RUnlock()
        return
    }
    var target *Client
    for c := range clients {
        if c.clientID == leaderClientID {
            target = c
            break
        }
    }
    h.mu.RUnlock()

    if target == nil {
        return // already unregistered between snapshot and now
    }

    log.Printf("watchdog: evicting stale leader clientID=%s topic=%s", leaderClientID, topic)
    target.conn.Close() // readPump exits → handleUnregister → electLeaderInternal

    // Clear the inactive_emit dedupe key so followers can receive a fresh editor.inactive
    // if the new leader also goes quiet.
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        defer cancel()
        dedupeKey := fmt.Sprintf("beskar:presence:inactive_emit:%s:%s", spaceID, pageID)
        if err := sigRedis.Del(ctx, dedupeKey).Err(); err != nil {
            log.Printf("watchdog: redis del inactive_emit: %v", err)
        }
    }()
}
```

### 5d — Start watchdog from `main`

```go
func main() {
    initSignalRedis()
    setupRoutes()
    ctx := context.Background()
    hub.startWatchdog(ctx)
    log.Println("Starting server on port 8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

---

## Phase 6 — Clear `inactive_emit` on eviction

Already included in `evictLeader` above. The `DEL beskar:presence:inactive_emit:<spaceId>:<pageId>` fires as a goroutine immediately after `conn.Close()`. By the time the new leader posts its first presence (~30 s), the dedupe key is already gone so `CheckPublishDraftLeaderInactive` can fire again for the new leader if it also goes quiet.

---

## Phase 7 — Env vars and config wiring

### `docker/env/deploy.env.example` and `docker/env/dev.env`

Add the three new signalserver variables:

```env
# Signalserver watchdog (all optional; watchdog disabled if SIGNAL_REDIS_URL is unset)
SIGNAL_REDIS_URL=redis://redis:6379/0
SIGNAL_LEADER_EVICT_SEC=90
SIGNAL_WATCHDOG_INTERVAL_SEC=15
```

`SIGNAL_REDIS_URL` points at the same Redis instance used by the app server — no new infrastructure.

### `docker/app/app.yml`

Add the three vars to the signalserver service's `environment:` block (same pattern as existing `AUTH_SERVER_URL`).

### Threshold ordering constraint

```
Heartbeat interval          30 s   (NEXT_PUBLIC_EDITOR_PRESENCE)
editor.inactive threshold   75 s   (EDITOR_INACTIVE_THRESHOLD_SEC)
Watchdog poll interval      15 s   (SIGNAL_WATCHDOG_INTERVAL_SEC)
Leader eviction threshold   90 s   (SIGNAL_LEADER_EVICT_SEC)
draft_leader_ts TTL        600 s   (10 min, after Phase 1 change)
```

**Rule**: `eviction threshold` must be less than `draft_leader_ts TTL` by at least `poll interval + 30 s` so the key is still readable when the watchdog fires.

---

## Phase 8 — QA checklist

### Functional tests (manual, two browser windows)

| Test | Steps | Expected |
|------|-------|----------|
| Normal save | Two tabs open. Check DevTools Network. | Only leader tab shows `PUT editor/update`. Follower tab shows none. |
| Clean disconnect handoff | Leader tab: close window. | Follower tab: `isLeader` flips within 3 s; follower tab starts `PUT editor/update`. |
| Late-joiner leadership steal | Two tabs A (`zz...` ID) and B (`aa...` ID). Open B after A. | B gets `isLeader=true`, A stops saving. Awareness pill switches. |
| `editor.inactive` banner | Leader tab: hide it (switch to another app). Wait >75 s. | Follower sees "Save leader may be offline" banner. |
| Watchdog eviction (frozen leader) | Leader tab: freeze JS (DevTools → Sources → pause). Wait >90 s. | Signalserver log shows `watchdog: evicting stale leader`. Follower becomes leader within one poll interval. |
| Watchdog eviction (hidden tab) | Leader tab: minimize. Wait >90 s. | Watchdog reads stale ts, evicts leader. Visible follower becomes leader, saves resume. |
| Redis down gracefully | Stop Redis while two tabs are open. | Watchdog logs Redis error and skips every topic — no spurious eviction. Collaboration continues via WebRTC. |
| `TouchDraftLeaderTs` on save | Redis `MONITOR`. Leader types. | Each debounced save shows `SET beskar:presence:draft_leader_ts:... EX 600` in MONITOR. |
| Signalserver without `SIGNAL_REDIS_URL` | Unset the env var, restart. | Signalserver logs "watchdog disabled". No Redis calls. Existing behaviour unchanged. |

### Go build and vet

```bash
cd signalserver && go build ./... && go vet ./...
```

### TypeScript typecheck

```bash
cd ui && npx tsc --noEmit
```

---

## File change summary

| File | Change |
|------|--------|
| `server/editor/pageevents/presence.go` | TTL 2 min → 10 min; add `TouchDraftLeaderTs` function |
| `server/editor/types.go` | Add `IsDraftLeader bool` to `InputDraftDocument` |
| `server/editor/draft_debounce.go` | Call `TouchDraftLeaderTs` after successful `Update()` when `IsDraftLeader` |
| `ui/app/components/DocumentEditor.tsx` | Add `isDraftLeader?: boolean` to `IPayload`; pass `isLeader` in `updateContent` |
| `signalserver/main.go` | Redis client + init; `parseTopicIDs`; Redis write helpers; wire into subscribe/unregister/election; `startWatchdog`, `watchdogTick`, `evictLeader` |
| `signalserver/go.mod` + `go.sum` | Add `github.com/redis/go-redis/v9` |
| `docker/env/deploy.env.example` | Add `SIGNAL_REDIS_URL`, `SIGNAL_LEADER_EVICT_SEC`, `SIGNAL_WATCHDOG_INTERVAL_SEC` |
| `docker/env/dev.env` | Same three vars (pointing at local Redis) |
| `docker/app/app.yml` | Forward new env vars to signalserver container |

**Lines of new code (estimated)**: ~120 in signalserver, ~25 in app server, ~5 in UI.
No schema changes. No new infrastructure (reuses existing Redis).

---

## Revision history

| Date | Notes |
|------|--------|
| 2026-05-06 | Initial plan: 8 phases covering TTL extension, isDraftLeader on saves, signalserver Redis client, room state writes, watchdog goroutine, inactive_emit clear, config and QA. |
| 2026-05-06 | Reverted to polling goroutine: simpler for initial version; keyspace notifications deferred to a future iteration. |
| 2026-05-06 | Implemented: presence TTL 10m, `TouchDraftLeaderTs` + debounce paths, `IsDraftLeader` on draft payload, UI `isDraftLeader`, signalserver Redis + room keys + watchdog + `topicLeaderID` clear on drain, docker env + `app.yml`. |
