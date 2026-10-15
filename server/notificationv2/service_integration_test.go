package notificationv2

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresDefinitions(t *testing.T) {
	dsn := os.Getenv("NOTIFICATION_V2_TEST_DSN")
	if dsn == "" {
		t.Skip("set NOTIFICATION_V2_TEST_DSN to a disposable notification_v2_test database")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ConnConfig.Database != "notification_v2_test" {
		t.Fatal("refusing database other than notification_v2_test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	run := func(q string, args ...any) {
		t.Helper()
		if _, e := pool.Exec(ctx, q, args...); e != nil {
			t.Fatal(e)
		}
	}
	run(`DROP SCHEMA IF EXISTS notifications CASCADE; DROP SCHEMA IF EXISTS notifications_v2 CASCADE; DROP TABLE IF EXISTS public.databasechangeloglock,public.databasechangelog`)
	path, err := filepath.Abs("../../db/beskar/updates")
	if err != nil {
		t.Fatal(err)
	}
	run(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='beskar_admin') THEN CREATE ROLE beskar_admin; END IF; END $$`)
	for _, file := range []string{"notifications.xml", "email_notifications.xml", "notifications_v2.xml", "notifications_v2_seed.xml", "notifications_v2_definitions.xml", "notifications_v2_email_recipients.xml", "notifications_v2_business.xml"} {
		args := []string{"--defaults-file=/dev/null", "--url=jdbc:postgresql://" + net.JoinHostPort(cfg.ConnConfig.Host, strconv.Itoa(int(cfg.ConnConfig.Port))) + "/notification_v2_test", "--username=" + cfg.ConnConfig.User, "--search-path=" + path, "--changelog-file=" + file, "update", "-Dapp_user=" + pgx.Identifier{cfg.ConnConfig.User}.Sanitize()}
		cmd := exec.CommandContext(ctx, "liquibase", args...)
		cmd.Dir = t.TempDir()
		cmd.Env = append(os.Environ(), "LIQUIBASE_COMMAND_PASSWORD="+cfg.ConnConfig.Password)
		if output, e := cmd.CombinedOutput(); e != nil {
			t.Fatalf("migration: %v\n%s", e, output)
		}
	}
	actor := uuid.New()
	template := uuid.New()
	segment := uuid.New()
	run(`INSERT INTO notifications_v2.notification_templates(id,version,name,mode_id,details,variable_schema,locale,created_at,created_by) VALUES($1,1,'Test',1,'{}','{"type":"object","required":["name"],"properties":{"name":{"type":"string"}},"additionalProperties":false}','en',now(),$2)`, template, actor)
	run(`INSERT INTO notifications_v2.segments(id,name,created_at,updated_at) VALUES($1,'Test',now(),now())`, segment)
	service := NewService(pool)
	fixture := func() DefinitionInput { d := inputFixture(); d.TemplateID = template; return d }
	principal := func() Producer { return Producer{Source: uuid.NewString(), ActorID: actor} }
	checkStatus := func(err error, status int) {
		t.Helper()
		var e *apiError
		if !errors.As(err, &e) || e.Status != status {
			t.Fatalf("expected HTTP %d, got %v", status, err)
		}
	}
	t.Run("idempotency concurrent callers and replay after retirement", func(t *testing.T) {
		p := principal()
		in := fixture()
		key := uuid.NewString()
		var wg sync.WaitGroup
		ids := make(chan uuid.UUID, 6)
		created := make(chan bool, 6)
		for i := 0; i < 6; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				d, fresh, e := service.Create(ctx, p, key, in)
				if e != nil {
					t.Error(e)
					return
				}
				ids <- d.ID
				created <- fresh
			}()
		}
		wg.Wait()
		close(ids)
		close(created)
		var first uuid.UUID
		for id := range ids {
			if first == uuid.Nil {
				first = id
			}
			if id != first {
				t.Fatal("duplicate definitions")
			}
		}
		n := 0
		for value := range created {
			if value {
				n++
			}
		}
		if n != 1 {
			t.Fatalf("created %d definitions", n)
		}
		run(`UPDATE notifications_v2.notification_templates SET retired_at=now() WHERE id=$1`, template)
		_, fresh, e := service.Create(ctx, p, key, in)
		if e != nil || fresh {
			t.Fatalf("replay checked mutable template: %v", e)
		}
		run(`UPDATE notifications_v2.notification_templates SET retired_at=NULL WHERE id=$1`, template)
		in.Priority++
		_, _, e = service.Create(ctx, p, key, in)
		checkStatus(e, 409)
	})
	t.Run("ownership pagination and direct email target", func(t *testing.T) {
		p := principal()
		in := fixture()
		in.TargetUsers = nil
		in.TargetEmails = []string{"Invitee@EXAMPLE.COM"}
		first, _, e := service.Create(ctx, p, "first", in)
		if e != nil {
			t.Fatal(e)
		}
		if len(first.TargetEmails) != 1 || first.TargetEmails[0] != "Invitee@example.com" {
			t.Fatal("email target missing")
		}
		_, e = service.Get(ctx, principal(), first.ID)
		checkStatus(e, 404)
		_, e = service.Patch(ctx, principal(), first.ID, 1, map[string]json.RawMessage{"priority": json.RawMessage(`1`)})
		checkStatus(e, 404)
		_, e = service.Transition(ctx, principal(), first.ID, 1, "cancel")
		checkStatus(e, 404)
		for _, key := range []string{"second", "third"} {
			if _, _, e = service.Create(ctx, p, key, in); e != nil {
				t.Fatal(e)
			}
		}
		page, e := service.List(ctx, p, 2, "", "")
		if e != nil || len(page.Items) != 2 || page.NextCursor == "" {
			t.Fatalf("first page: %+v %v", page, e)
		}
		next, e := service.List(ctx, p, 2, page.NextCursor, "")
		if e != nil || len(next.Items) != 1 || next.NextCursor != "" {
			t.Fatalf("next page: %+v %v", next, e)
		}
		for _, a := range page.Items {
			if a.ID == next.Items[0].ID {
				t.Fatal("duplicate page entry")
			}
		}
		other, e := service.List(ctx, principal(), 50, "", "")
		if e != nil || len(other.Items) != 0 {
			t.Fatal("cross-producer list")
		}
	})
	t.Run("transactional patch and competing revisions", func(t *testing.T) {
		p := principal()
		in := fixture()
		in.TargetSegments = []uuid.UUID{segment}
		d, _, e := service.Create(ctx, p, "patch", in)
		if e != nil {
			t.Fatal(e)
		}
		bad, _ := json.Marshal([]uuid.UUID{uuid.New()})
		_, e = service.Patch(ctx, p, d.ID, 1, map[string]json.RawMessage{"target_segments": bad, "priority": json.RawMessage(`7`)})
		checkStatus(e, 422)
		unchanged, e := service.Get(ctx, p, d.ID)
		if e != nil || unchanged.Revision != 1 || unchanged.Priority != 50 || len(unchanged.TargetSegments) != 1 {
			t.Fatalf("failed patch changed definition: %+v %v", unchanged, e)
		}
		errorsCh := make(chan error, 2)
		var wg sync.WaitGroup
		for i := 0; i < 2; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, e := service.Patch(ctx, p, d.ID, 1, map[string]json.RawMessage{"priority": json.RawMessage(`9`)})
				errorsCh <- e
			}()
		}
		wg.Wait()
		close(errorsCh)
		success := 0
		for e := range errorsCh {
			if e == nil {
				success++
			} else {
				checkStatus(e, 412)
			}
		}
		if success != 1 {
			t.Fatal("concurrent edits both succeeded")
		}
		changed, e := service.Get(ctx, p, d.ID)
		if e != nil || changed.Revision != 2 || changed.Priority != 9 {
			t.Fatal("wrong revision")
		}
	})
	t.Run("validation rolls back creation", func(t *testing.T) {
		p := principal()
		in := fixture()
		in.MessageDetails = json.RawMessage(`{"name":1}`)
		_, _, e := service.Create(ctx, p, "bad", in)
		checkStatus(e, 422)
		in = fixture()
		in.ModeID = 2
		_, _, e = service.Create(ctx, p, "badmode", in)
		checkStatus(e, 422)
		out, e := service.List(ctx, p, 50, "", "")
		if e != nil || len(out.Items) != 0 {
			t.Fatal("invalid create persisted")
		}
	})
	t.Run("pause resume and revision checks", func(t *testing.T) {
		p := principal()
		d, _, e := service.Create(ctx, p, "lifecycle", fixture())
		if e != nil {
			t.Fatal(e)
		}
		d, e = service.Transition(ctx, p, d.ID, 1, "pause")
		if e != nil || d.Status != "paused" || d.NextRunAt != nil || d.Revision != 2 {
			t.Fatalf("pause: %+v %v", d, e)
		}
		_, e = service.Transition(ctx, p, d.ID, 1, "resume")
		checkStatus(e, 412)
		d, e = service.Transition(ctx, p, d.ID, 2, "resume")
		if e != nil || d.Status != "active" || d.NextRunAt == nil || d.Revision != 3 {
			t.Fatalf("resume: %+v %v", d, e)
		}
	})
	t.Run("cancel clears leases and preserves accepted history", func(t *testing.T) {
		p := principal()
		in := fixture()
		d, _, e := service.Create(ctx, p, "cancel", in)
		if e != nil {
			t.Fatal(e)
		}
		event := uuid.New()
		provider := uuid.New()
		run(`INSERT INTO notifications_v2.notification_providers(id,code,mode_id,adapter_key,config,max_concurrency,enabled,created_at,updated_at) VALUES($1,$2,1,'smtp','{}',1,true,now(),now())`, provider, uuid.NewString())
		run(`INSERT INTO notifications_v2.notification_events(id,notification_id,revision,scheduled_at,template_id,template_version,definition_snapshot,status,expansion_available_at,expansion_attempt_count,created_at,updated_at) VALUES($1,$2,1,now(),$3,1,'{}','ready',now(),0,now(),now())`, event, d.ID, template)
		for _, status := range []string{"pending", "processing", "accepted"} {
			var token any
			var expiry any
			if status == "processing" {
				token = uuid.New()
				expiry = time.Now().Add(time.Hour)
			}
			run(`INSERT INTO notifications_v2.notification_deliveries(id,event_id,user_id,notification_type_id,mode_id,provider_id,destination_snapshot,message_details_snapshot,policy_snapshot,priority,status,eligible_at,available_at,attempt_count,lease_token,lease_expires_at,created_at,updated_at) VALUES($1,$2,$3,1,1,$4,'{}','{}','{}',50,$5,now(),now(),0,$6,$7,now(),now())`, uuid.New(), event, uuid.New(), provider, status, token, expiry)
		}
		d, e = service.Transition(ctx, p, d.ID, 1, "cancel")
		if e != nil || d.Status != "cancelled" {
			t.Fatal(e)
		}
		var count int
		if e = pool.QueryRow(ctx, `SELECT count(*) FROM notifications_v2.notification_deliveries WHERE event_id=$1 AND status='cancelled' AND lease_token IS NULL AND lease_expires_at IS NULL`, event).Scan(&count); e != nil || count != 2 {
			t.Fatal("unsent work not cancelled", e)
		}
		if e = pool.QueryRow(ctx, `SELECT count(*) FROM notifications_v2.notification_deliveries WHERE event_id=$1 AND status='accepted'`, event).Scan(&count); e != nil || count != 1 {
			t.Fatal("accepted history changed", e)
		}
		d, e = service.Transition(ctx, p, d.ID, 2, "delete")
		if e != nil || d.DeletedAt == nil {
			t.Fatal(e)
		}
		_, e = service.Get(ctx, p, d.ID)
		checkStatus(e, 404)
		_, _, e = service.Create(ctx, p, "cancel", in)
		checkStatus(e, 410)
	})

	t.Run("topic validation and database relationship", func(t *testing.T) {
		p := principal()
		in := fixture()
		in.NotificationTopicID = 6
		_, _, e := service.Create(ctx, p, "wrong-topic", in)
		checkStatus(e, 422)
		in.NotificationTopicID = 1
		d, _, e := service.Create(ctx, p, "right-topic", in)
		if e != nil {
			t.Fatal(e)
		}
		if d.NotificationTopicID != 1 {
			t.Fatal("topic missing from read")
		}
		if _, e = pool.Exec(ctx, `UPDATE notifications_v2.notifications SET notification_topic_id=6 WHERE id=$1`, d.ID); e == nil {
			t.Fatal("database allowed a mismatched topic/type")
		}
		run(`UPDATE notifications_v2.notification_topics SET active=false WHERE id=1`)
		_, _, e = service.Create(ctx, p, "inactive-topic", in)
		checkStatus(e, 422)
		run(`UPDATE notifications_v2.notification_topics SET active=true WHERE id=1`)
		_, e = service.Patch(ctx, p, d.ID, 1, map[string]json.RawMessage{"notification_topic_id": json.RawMessage(`6`)})
		checkStatus(e, 422)
	})
	t.Run("internal caller transaction owns all mutations", func(t *testing.T) {
		p := principal()
		tx, e := pool.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(ctx)
		bound := service.WithTx(tx)
		d, _, e := bound.Create(ctx, p, "outer-rollback", fixture())
		if e != nil {
			t.Fatal(e)
		}
		if _, e = bound.Get(ctx, p, d.ID); e != nil {
			t.Fatal(e)
		}
		if list, e := bound.List(ctx, p, 10, "", ""); e != nil || len(list.Items) != 1 {
			t.Fatal("bound reads cannot see uncommitted definition", e)
		}
		_, e = service.Get(ctx, p, d.ID)
		checkStatus(e, 404)
		_, e = bound.Patch(ctx, p, d.ID, 1, map[string]json.RawMessage{"priority": json.RawMessage(`200`)})
		checkStatus(e, 422)
		d, e = bound.Patch(ctx, p, d.ID, 1, map[string]json.RawMessage{"priority": json.RawMessage(`30`)})
		if e != nil {
			t.Fatal("savepoint did not preserve outer transaction", e)
		}
		d, e = bound.Transition(ctx, p, d.ID, 2, "pause")
		if e != nil {
			t.Fatal(e)
		}
		if e = tx.Rollback(ctx); e != nil {
			t.Fatal(e)
		}
		_, e = service.Get(ctx, p, d.ID)
		checkStatus(e, 404)
		committed, e := pool.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer committed.Rollback(ctx)
		saved, _, e := service.WithTx(committed).Create(ctx, p, "outer-commit", fixture())
		if e != nil {
			t.Fatal(e)
		}
		if e = committed.Commit(ctx); e != nil {
			t.Fatal(e)
		}
		if _, e = service.Get(ctx, p, saved.ID); e != nil {
			t.Fatal(e)
		}
	})
	t.Run("HTTP contract", func(t *testing.T) {
		p := principal()
		controller := NewController(service, func(*http.Request) (Producer, error) { return p, nil })
		router := controller.Router()
		call := func(method, path, body, revision string) *httptest.ResponseRecorder {
			r := httptest.NewRequest(method, path, strings.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Idempotency-Key", "http")
			if revision != "" {
				r.Header.Set("If-Match", revision)
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			return w
		}
		raw, _ := json.Marshal(fixture())
		created := call("POST", "/", string(raw), "")
		if created.Code != 201 || created.Header().Get("ETag") != `"1"` {
			t.Fatalf("create: %d %s", created.Code, created.Body.String())
		}
		var response struct {
			Data Definition `json:"data"`
		}
		if e := json.Unmarshal(created.Body.Bytes(), &response); e != nil {
			t.Fatal(e)
		}
		path := "/" + response.Data.ID.String()
		if w := call("PATCH", path, `{"priority":2}`, ""); w.Code != 428 {
			t.Fatalf("missing revision: %d", w.Code)
		}
		if w := call("PATCH", path, `{"source_service":"other"}`, `"1"`); w.Code != 422 {
			t.Fatalf("ownership field: %d", w.Code)
		}
		if w := call("PATCH", path, `{"priority":2}`, `"1"`); w.Code != 200 || w.Header().Get("ETag") != `"2"` {
			t.Fatalf("patch: %d %s", w.Code, w.Body.String())
		}
		if w := call("POST", path+"/pause", "", `"2"`); w.Code != 200 {
			t.Fatalf("pause: %d %s", w.Code, w.Body.String())
		}
		if w := call("POST", path+"/resume", "", `"3"`); w.Code != 200 {
			t.Fatalf("resume: %d", w.Code)
		}
		if w := call("POST", path+"/cancel", "", `"4"`); w.Code != 200 {
			t.Fatalf("cancel: %d", w.Code)
		}
		if w := call("GET", path, "", ""); w.Code != 200 {
			t.Fatalf("get: %d", w.Code)
		}
		if w := call("DELETE", path, "", `"5"`); w.Code != 204 {
			t.Fatalf("delete: %d", w.Code)
		}
		if w := call("GET", path, "", ""); w.Code != 404 {
			t.Fatalf("get deleted: %d", w.Code)
		}
	})
	t.Run("scheduler", func(t *testing.T) { testSchedulerPostgres(t, pool) })
	t.Run("audience", func(t *testing.T) { testAudiencePostgres(t, pool) })
	t.Run("delivery", func(t *testing.T) { testDeliveryPostgres(t, pool) })
}
