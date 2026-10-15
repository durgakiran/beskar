package notificationv2

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/durgakiran/beskar/core"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type audienceDirectoryFunc func(context.Context, pgx.Tx, []uuid.UUID, bool) (map[uuid.UUID]AudienceUser, error)

func (f audienceDirectoryFunc) Resolve(c context.Context, tx pgx.Tx, ids []uuid.UUID, email bool) (map[uuid.UUID]AudienceUser, error) {
	return f(c, tx, ids, email)
}

func testAudiencePostgres(t *testing.T, pool *pgxpool.Pool) {
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`TRUNCATE notifications_v2.notifications CASCADE`)
	actor, template, provider, segment := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	users := []uuid.UUID{uuid.New(), uuid.New(), uuid.New()}
	exec(`INSERT INTO notifications_v2.notification_templates(id,version,name,mode_id,details,variable_schema,locale,created_at,created_by) VALUES($1,1,'Audience test',2,'{}','{}','en',now(),$2)`, template, actor)
	exec(`INSERT INTO notifications_v2.notification_providers(id,code,mode_id,adapter_key,config,max_concurrency,enabled,created_at,updated_at) VALUES($1,'audience-test',2,'in_app','{}',1,true,now(),now())`, provider)
	exec(`INSERT INTO notifications_v2.notification_routes(notification_type_id,mode_id,provider_id,max_attempts,retry_initial_seconds,retry_max_seconds,enabled,updated_at) VALUES(1,2,$1,5,30,300,true,now())`, provider)
	exec(`INSERT INTO notifications_v2.segments(id,name,created_at,updated_at) VALUES($1,'Audience test',now(),now())`, segment)
	for _, u := range users {
		exec(`INSERT INTO notifications_v2.segment_users(segment_id,user_id,created_at) VALUES($1,$2,now())`, segment, u)
	}
	service := NewService(pool)
	producer := Producer{Source: "audience-test", ActorID: actor}
	scheduler, _ := NewScheduler(pool, DefaultSchedulerConfig(), nil)
	makeEvent := func() uuid.UUID {
		t.Helper()
		in := inputFixture()
		in.ModeID = 2
		in.TemplateID = template
		in.TargetUsers = []uuid.UUID{users[0]}
		in.TargetSegments = []uuid.UUID{segment}
		d, _, err := service.Create(ctx, producer, uuid.NewString(), in)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = scheduler.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		var event uuid.UUID
		if err = pool.QueryRow(ctx, `SELECT id FROM notifications_v2.notification_events WHERE notification_id=$1`, d.ID).Scan(&event); err != nil {
			t.Fatal(err)
		}
		return event
	}
	c := DefaultAudienceConfig()
	c.HashKey = []byte("01234567890123456789012345678901")
	directory := audienceDirectoryFunc(func(ctx context.Context, tx pgx.Tx, ids []uuid.UUID, email bool) (map[uuid.UUID]AudienceUser, error) {
		out := map[uuid.UUID]AudienceUser{}
		for _, id := range ids {
			out[id] = AudienceUser{Email: id.String() + "@example.com", EmailVerified: true}
		}
		return out, nil
	})
	worker, err := NewAudienceExpander(pool, c, directory, nil)
	if err != nil {
		t.Fatal(err)
	}
	run := func() AudienceStats {
		t.Helper()
		s, err := worker.ProcessBatch(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	state := func(event uuid.UUID) string {
		t.Helper()
		var s string
		if err := pool.QueryRow(ctx, `SELECT status FROM notifications_v2.notification_events WHERE id=$1`, event).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	count := func(event uuid.UUID) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM notifications_v2.notification_deliveries WHERE event_id=$1`, event).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	t.Run("concurrent expansion deduplicates audience and freezes payload", func(t *testing.T) {
		event := makeEvent()
		exec(`UPDATE notifications_v2.notifications SET message_details='{"changed":true}',status='paused' WHERE id=(SELECT notification_id FROM notifications_v2.notification_events WHERE id=$1)`, event)
		var wg sync.WaitGroup
		for i := 0; i < 5; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := worker.ProcessBatch(ctx); err != nil {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
		if state(event) != "ready" || count(event) != 3 {
			t.Fatal("wrong expansion result")
		}
		var payload, policy []byte
		if err := pool.QueryRow(ctx, `SELECT message_details_snapshot,policy_snapshot FROM notifications_v2.notification_deliveries WHERE event_id=$1 LIMIT 1`, event).Scan(&payload, &policy); err != nil {
			t.Fatal(err)
		}
		var variables map[string]any
		_ = json.Unmarshal(payload, &variables)
		if variables["name"] != "Alex" {
			t.Fatalf("read live definition: %s", payload)
		}
		var p map[string]any
		_ = json.Unmarshal(policy, &p)
		if p["max_attempts"] != float64(5) || p["quiet_hours_bypass"] != false {
			t.Fatalf("bad policy %s", policy)
		}
		if run().Claimed != 0 {
			t.Fatal("ready event reclaimed")
		}
	})
	t.Run("preferences suppression quiet hours and expiry", func(t *testing.T) {
		exec(`INSERT INTO notifications_v2.user_preferences(id,user_id,notification_type_id,mode_id,opt_in,created_at,updated_at) VALUES($1,$2,1,2,false,now(),now())`, uuid.New(), users[0])
		hash, _ := DestinationHash(c.HashKey, "in_app", users[1].String())
		exec(`INSERT INTO notifications_v2.notification_suppressions(id,mode_id,destination_hash,reason,source,created_at,updated_at) VALUES($1,2,$2,'test','test',now(),now())`, uuid.New(), hash)
		exec(`INSERT INTO notifications_v2.user_quiet_hours(id,user_id,mode_id,enabled,timezone,start_time,end_time,created_at,updated_at) VALUES($1,$2,2,true,'UTC',(now() AT TIME ZONE 'UTC'-interval '1 hour')::time,(now() AT TIME ZONE 'UTC'+interval '2 hour')::time,now(),now())`, uuid.New(), users[2])
		event := makeEvent()
		run()
		var suppressed, deferred int
		if err := pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE status='suppressed'),count(*) FILTER(WHERE status='pending' AND eligible_at>now() AND available_at=eligible_at) FROM notifications_v2.notification_deliveries WHERE event_id=$1`, event).Scan(&suppressed, &deferred); err != nil {
			t.Fatal(err)
		}
		if suppressed != 2 || deferred != 1 {
			t.Fatalf("suppressed %d deferred %d", suppressed, deferred)
		}
		expiry := makeEvent()
		exec(`UPDATE notifications_v2.notification_events SET expires_at=scheduled_at+interval '1 second' WHERE id=$1`, expiry)
		run()
		var result string
		if err := pool.QueryRow(ctx, `SELECT status FROM notifications_v2.notification_deliveries WHERE event_id=$1 AND user_id=$2`, expiry, users[2]).Scan(&result); err != nil || result != "expired" {
			t.Fatalf("expiry %s %v", result, err)
		}
	})
	t.Run("missing route retries and future expansion waits", func(t *testing.T) {
		event := makeEvent()
		exec(`UPDATE notifications_v2.notification_routes SET enabled=false WHERE provider_id=$1`, provider)
		run()
		if state(event) != "pending" || count(event) != 0 {
			t.Fatal("missing route partially expanded")
		}
		if run().Claimed != 0 {
			t.Fatal("retry backoff ignored")
		}
		exec(`UPDATE notifications_v2.notification_routes SET enabled=true WHERE provider_id=$1`, provider)
		exec(`UPDATE notifications_v2.notification_events SET expansion_available_at=now() WHERE id=$1`, event)
		run()
		if state(event) != "ready" {
			t.Fatal("retry not expanded")
		}
	})
	t.Run("failed insert rolls back whole audience", func(t *testing.T) {
		event := makeEvent()
		exec(`CREATE FUNCTION notifications_v2.audience_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_id='` + event.String() + `'::uuid AND (SELECT count(*) FROM notifications_v2.notification_deliveries WHERE event_id=NEW.event_id)>0 THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`)
		exec(`CREATE TRIGGER audience_fault BEFORE INSERT ON notifications_v2.notification_deliveries FOR EACH ROW EXECUTE FUNCTION notifications_v2.audience_fault()`)
		defer exec(`DROP TRIGGER IF EXISTS audience_fault ON notifications_v2.notification_deliveries; DROP FUNCTION notifications_v2.audience_fault()`)
		run()
		if state(event) != "pending" || count(event) != 0 {
			t.Fatal("partial audience committed")
		}
		exec(`DROP TRIGGER audience_fault ON notifications_v2.notification_deliveries`)
		exec(`UPDATE notifications_v2.notification_events SET expansion_available_at=now() WHERE id=$1`, event)
		run()
		if count(event) != 3 {
			t.Fatal("retry did not restore full audience")
		}
	})
	t.Run("lease recovery fences stale claimant", func(t *testing.T) {
		event := makeEvent()
		first, err := worker.claim(ctx, nil)
		if err != nil || first.id != event {
			t.Fatalf("claim %v", err)
		}
		exec(`UPDATE notifications_v2.notification_events SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, event)
		recovery, err := NewRecoveryWorker(pool, DefaultRecoveryConfig(), c, nil)
		if err != nil {
			t.Fatal(err)
		}
		stats, err := recovery.ProcessBatch(ctx)
		if err != nil || stats.Requeued != 1 {
			t.Fatalf("recovery %+v %v", stats, err)
		}
		exec(`UPDATE notifications_v2.notification_events SET expansion_available_at=now() WHERE id=$1`, event)
		second, err := worker.claim(ctx, nil)
		if err != nil || second.token == first.token {
			t.Fatalf("reclaim %v", err)
		}
		if _, err = worker.expand(ctx, first); err != errExpansionLost {
			t.Fatalf("stale owner accepted %v", err)
		}
		if err = worker.recordFailure(ctx, first, fmt.Errorf("old failure")); err != nil {
			t.Fatal(err)
		}
		if _, err = worker.expand(ctx, second); err != nil {
			t.Fatal(err)
		}
		if state(event) != "ready" || count(event) != 3 {
			t.Fatal("recovery failed")
		}
	})
	t.Run("recovery stops expansion at budget and expiry", func(t *testing.T) {
		recovery, err := NewRecoveryWorker(pool, DefaultRecoveryConfig(), c, nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, reason := range []string{"expansion_attempts_exhausted", "occurrence_expired"} {
			event := makeEvent()
			if _, err = worker.claim(ctx, nil); err != nil {
				t.Fatal(err)
			}
			exec(`UPDATE notifications_v2.notification_events SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, event)
			if reason == "expansion_attempts_exhausted" {
				exec(`UPDATE notifications_v2.notification_events SET expansion_attempt_count=$2 WHERE id=$1`, event, c.MaxAttempts)
			} else {
				exec(`UPDATE notifications_v2.notification_events SET scheduled_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE id=$1`, event)
			}
			if _, err = recovery.ProcessBatch(ctx); err != nil {
				t.Fatal(err)
			}
			var code string
			if err = pool.QueryRow(ctx, `SELECT last_error_code FROM notifications_v2.notification_events WHERE id=$1`, event).Scan(&code); err != nil {
				t.Fatal(err)
			}
			if state(event) != "failed" || code != reason {
				t.Fatalf("state=%s reason=%s", state(event), code)
			}
		}
	})
	t.Run("exhausted and invalid audience fails explicitly", func(t *testing.T) {
		event := makeEvent()
		exec(`UPDATE notifications_v2.notification_events SET expansion_attempt_count=$2 WHERE id=$1`, event, c.MaxAttempts)
		run()
		if state(event) != "failed" {
			t.Fatal("retry budget ignored")
		}
		event = makeEvent()
		small := c
		small.MaxRecipients = 2
		limited, _ := NewAudienceExpander(pool, small, directory, nil)
		if _, err := limited.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		if state(event) != "failed" || count(event) != 0 {
			t.Fatal("audience silently truncated")
		}
	})

	t.Run("registered email destinations and recipient failures", func(t *testing.T) {
		emailTemplate, emailProvider := uuid.New(), uuid.New()
		exec(`INSERT INTO notifications_v2.notification_templates(id,version,name,mode_id,details,variable_schema,locale,created_at,created_by) VALUES($1,1,'Audience email',1,'{}','{}','en',now(),$2)`, emailTemplate, actor)
		exec(`INSERT INTO notifications_v2.notification_providers(id,code,mode_id,adapter_key,config,max_concurrency,enabled,created_at,updated_at) VALUES($1,'audience-email',1,'smtp','{}',1,true,now(),now())`, emailProvider)
		exec(`INSERT INTO notifications_v2.notification_routes(notification_type_id,mode_id,provider_id,max_attempts,retry_initial_seconds,retry_max_seconds,enabled,updated_at) VALUES(1,1,$1,5,30,300,true,now())`, emailProvider)
		in := inputFixture()
		in.TemplateID = emailTemplate
		in.TargetUsers = users
		d, _, err := service.Create(ctx, producer, uuid.NewString(), in)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = scheduler.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		emailDirectory := audienceDirectoryFunc(func(context.Context, pgx.Tx, []uuid.UUID, bool) (map[uuid.UUID]AudienceUser, error) {
			return map[uuid.UUID]AudienceUser{users[0]: {Email: "User@EXAMPLE.COM", EmailVerified: true}, users[1]: {Email: "bad", EmailVerified: true}, users[2]: {Email: "other@example.com"}}, nil
		})
		emailWorker, _ := NewAudienceExpander(pool, c, emailDirectory, nil)
		if _, err = emailWorker.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		var pending, failed int
		if err = pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE status='pending' AND destination_snapshot->>'email'='User@example.com'),count(*) FILTER(WHERE status='failed') FROM notifications_v2.notification_deliveries WHERE event_id IN(SELECT id FROM notifications_v2.notification_events WHERE notification_id=$1)`, d.ID).Scan(&pending, &failed); err != nil {
			t.Fatal(err)
		}
		if pending != 1 || failed != 2 {
			t.Fatalf("email pending=%d failed=%d", pending, failed)
		}
	})
	t.Run("directory outage retries without partial deliveries", func(t *testing.T) {
		event := makeEvent()
		unavailable := audienceDirectoryFunc(func(context.Context, pgx.Tx, []uuid.UUID, bool) (map[uuid.UUID]AudienceUser, error) {
			return nil, fmt.Errorf("temporary directory outage")
		})
		failing, _ := NewAudienceExpander(pool, c, unavailable, nil)
		if _, err := failing.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		if state(event) != "pending" || count(event) != 0 {
			t.Fatal("directory failure lost audience")
		}
		exec(`UPDATE notifications_v2.notification_events SET expansion_available_at=now() WHERE id=$1`, event)
		run()
	})

	t.Run("Zitadel adapter batches exact IDs and honors context", func(t *testing.T) {
		exec(`CREATE SCHEMA IF NOT EXISTS core; CREATE TABLE IF NOT EXISTS core.user_id_map(zita_id text PRIMARY KEY,user_id uuid UNIQUE NOT NULL)`)
		ids := []uuid.UUID{}
		for i := 0; i < 13; i++ {
			id := uuid.New()
			ids = append(ids, id)
			exec(`INSERT INTO core.user_id_map(user_id,zita_id) VALUES($1,$2)`, id, "test-"+id.String()[:20])
		}
		calls := 0
		endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			if r.URL.Path != "/v2/users" || r.Header.Get("Authorization") != "Bearer test-token" {
				t.Error("bad directory request")
			}
			var query core.UserSearchQuery
			if json.NewDecoder(r.Body).Decode(&query) != nil {
				t.Error("bad directory JSON")
				w.WriteHeader(400)
				return
			}
			selected := query.Queries[0].InUserIdsQuery.UserIds
			if len(selected) > 10 || query.Query.Limit != 10 {
				t.Error("unbounded directory batch")
			}
			result := []core.User{}
			for _, id := range selected {
				result = append(result, core.User{UserId: id, Human: core.Human{Email: core.EmailAddress{Email: id + "@example.com", IsVerified: true}}})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"details": map[string]any{"totalResult": len(result)}, "result": result})
		}))
		defer endpoint.Close()
		adapter := &ZitadelAudienceDirectory{IssuerURL: endpoint.URL, Token: "test-token", Client: endpoint.Client()}
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		found, err := adapter.Resolve(ctx, tx, ids, true)
		if err != nil || len(found) != 13 || calls != 2 {
			t.Fatalf("directory %d users %d calls: %v", len(found), calls, err)
		}
		for _, u := range found {
			if !u.EmailVerified {
				t.Fatal("verified email lost")
			}
		}
		cancelled, cancel := context.WithCancel(ctx)
		cancel()
		if _, err = adapter.Resolve(cancelled, tx, ids, true); err == nil {
			t.Fatal("cancelled directory request continued")
		}
	})
	t.Run("shutdown", func(t *testing.T) {
		select {
		case <-worker.Start(ctx):
		case <-time.After(time.Second):
			t.Fatal("disabled expander ran")
		}
		on := c
		on.Enabled = true
		enabled, _ := NewAudienceExpander(pool, on, directory, nil)
		cancelled, cancel := context.WithCancel(ctx)
		cancel()
		select {
		case <-enabled.Start(cancelled):
		case <-time.After(time.Second):
			t.Fatal("shutdown hung")
		}
	})
}
