package notificationv2

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Called after the API integration suite, using its migrated disposable database.
func testSchedulerPostgres(t *testing.T, pool *pgxpool.Pool) {
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`TRUNCATE notifications_v2.notifications CASCADE`)
	actor, template, segment := uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO notifications_v2.notification_templates(id,version,name,mode_id,details,variable_schema,locale,created_at,created_by) VALUES($1,1,'Scheduler test',1,'{}','{}','en',now(),$2)`, template, actor)
	exec(`INSERT INTO notifications_v2.segments(id,name,created_at,updated_at) VALUES($1,'Scheduler',now(),now())`, segment)
	svc := NewService(pool)
	producer := Producer{Source: "scheduler-test", ActorID: actor}
	create := func() Definition {
		t.Helper()
		in := inputFixture()
		in.TemplateID = template
		in.TargetSegments = []uuid.UUID{segment}
		in.TargetEmails = []string{"test@example.com"}
		d, _, err := svc.Create(ctx, producer, uuid.NewString(), in)
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	config := DefaultSchedulerConfig()
	scheduler, err := NewScheduler(pool, config, nil)
	if err != nil {
		t.Fatal(err)
	}
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	run := func() SchedulerStats {
		t.Helper()
		stats, err := scheduler.ProcessBatch(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return stats
	}

	t.Run("multiple instances no duplicate events and snapshots frozen", func(t *testing.T) {
		defs := make([]Definition, 24)
		for i := range defs {
			defs[i] = create()
		}
		var wg sync.WaitGroup
		for i := 0; i < 6; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				worker, _ := NewScheduler(pool, config, nil)
				if _, err := worker.ProcessBatch(ctx); err != nil {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
		if n := count(`SELECT count(*) FROM notifications_v2.notification_events`); n != len(defs) {
			t.Fatalf("events=%d", n)
		}
		for _, d := range defs {
			got, err := svc.Get(ctx, producer, d.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Status != "completed" || got.NextRunAt != nil || got.Revision != d.Revision || got.UpdatedBy != actor {
				t.Fatalf("bad completed definition %+v", got)
			}
			var raw []byte
			var when time.Time
			var status string
			if err := pool.QueryRow(ctx, `SELECT definition_snapshot,scheduled_at,status FROM notifications_v2.notification_events WHERE notification_id=$1`, d.ID).Scan(&raw, &when, &status); err != nil {
				t.Fatal(err)
			}
			var snapshot Definition
			if err := json.Unmarshal(raw, &snapshot); err != nil {
				t.Fatal(err)
			}
			if snapshot.NotificationTopicID != d.NotificationTopicID || len(snapshot.TargetUsers) != 1 || len(snapshot.TargetSegments) != 1 || len(snapshot.TargetEmails) != 1 || snapshot.TemplateVersion != d.TemplateVersion || !when.Equal(*d.NextRunAt) || status != "pending" {
				t.Fatalf("incomplete snapshot %s", raw)
			}
			// Direct DB modification represents a later definition edit; the event must stay frozen.
			exec(`UPDATE notifications_v2.notifications SET message_details='{"changed":true}' WHERE id=$1`, d.ID)
			if n := count(`SELECT count(*) FROM notifications_v2.notification_events WHERE notification_id=$1 AND definition_snapshot->'message_details' ? 'name'`, d.ID); n != 1 {
				t.Fatal("snapshot changed")
			}
		}
		if stats := run(); stats.Processed != 0 {
			t.Fatalf("completed definitions reclaimed %+v", stats)
		}
	})
	t.Run("locked definition skipped without blocking other work", func(t *testing.T) {
		locked, free := create(), create()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err = tx.Exec(ctx, `SELECT id FROM notifications_v2.notifications WHERE id=$1 FOR UPDATE`, locked.ID); err != nil {
			t.Fatal(err)
		}
		step, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		stats, err := scheduler.ProcessBatch(step)
		if err != nil || stats.Created != 1 {
			t.Fatalf("blocked or wrong work %+v %v", stats, err)
		}
		if count(`SELECT count(*) FROM notifications_v2.notification_events WHERE notification_id=$1`, free.ID) != 1 {
			t.Fatal("unlocked work not processed")
		}
		if err = tx.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		if run().Created != 1 {
			t.Fatal("released definition not recovered")
		}
	})
	t.Run("pause cancel delete future excluded", func(t *testing.T) {
		paused, cancelled, deleted, future := create(), create(), create(), create()
		for _, v := range []struct {
			d      Definition
			action string
		}{{paused, "pause"}, {cancelled, "cancel"}, {deleted, "delete"}} {
			if _, err := svc.Transition(ctx, producer, v.d.ID, v.d.Revision, v.action); err != nil {
				t.Fatal(err)
			}
		}
		exec(`UPDATE notifications_v2.notifications SET next_run_at=now()+interval '1 day' WHERE id=$1`, future.ID)
		if run().Processed != 0 {
			t.Fatal("ineligible definition processed")
		}
		exec(`UPDATE notifications_v2.notifications SET status='cancelled',next_run_at=NULL WHERE id=$1`, future.ID)
	})
	t.Run("expiry and misfires preserve original times", func(t *testing.T) {
		expired, skip, fire := create(), create(), create()
		exec(`UPDATE notifications_v2.notifications SET next_run_at=now()-interval '1 hour',delivery_ttl_seconds=1 WHERE id=$1`, expired.ID)
		exec(`UPDATE notifications_v2.notifications SET schedule_kind='cron',cron_expression='* * * * *',misfire_policy='skip',next_run_at=date_trunc('minute',now())-interval '1 day' WHERE id=$1`, skip.ID)
		exec(`UPDATE notifications_v2.notifications SET schedule_kind='cron',cron_expression='* * * * *',misfire_policy='fire_once',next_run_at=date_trunc('minute',now())-interval '1 day',delivery_ttl_seconds=3600 WHERE id=$1`, fire.ID)
		before := time.Now().UTC().Truncate(time.Minute)
		stats := run()
		if stats.Processed != 3 || stats.Created != 1 || stats.Expired != 1 || stats.Misfired != 2 {
			t.Fatalf("wrong outcomes %+v", stats)
		}
		var scheduled, expires time.Time
		if err := pool.QueryRow(ctx, `SELECT scheduled_at,expires_at FROM notifications_v2.notification_events WHERE notification_id=$1`, fire.ID).Scan(&scheduled, &expires); err != nil {
			t.Fatal(err)
		}
		after := time.Now().UTC().Truncate(time.Minute)
		if scheduled.Before(before) || scheduled.After(after) || !expires.Equal(scheduled.Add(time.Hour)) {
			t.Fatalf("bad slot/TTL %s %s", scheduled, expires)
		}
		exec(`UPDATE notifications_v2.notifications SET status='cancelled',next_run_at=NULL WHERE id=ANY($1::uuid[])`, []uuid.UUID{skip.ID, fire.ID})
	})
	t.Run("cursor write failure rolls back event and healthy row proceeds", func(t *testing.T) {
		bad, good := create(), create()
		// Inject a database failure after INSERT but before commit, without production hooks.
		exec(`CREATE FUNCTION notifications_v2.fail_scheduler_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='` + bad.ID.String() + `'::uuid AND NEW.status='completed' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$`)
		exec(`CREATE TRIGGER scheduler_fault BEFORE UPDATE ON notifications_v2.notifications FOR EACH ROW EXECUTE FUNCTION notifications_v2.fail_scheduler_update()`)
		defer exec(`DROP TRIGGER IF EXISTS scheduler_fault ON notifications_v2.notifications; DROP FUNCTION IF EXISTS notifications_v2.fail_scheduler_update()`)
		stats, err := scheduler.ProcessBatch(ctx)
		if err == nil || !strings.Contains(err.Error(), "injected failure") || stats.Created != 1 {
			t.Fatalf("failure not isolated %+v %v", stats, err)
		}
		if count(`SELECT count(*) FROM notifications_v2.notification_events WHERE notification_id=$1`, bad.ID) != 0 {
			t.Fatal("orphan event committed")
		}
		got, err := svc.Get(ctx, producer, bad.ID)
		if err != nil || got.Status != "active" || !got.NextRunAt.Equal(*bad.NextRunAt) {
			t.Fatalf("cursor changed after rollback %+v %v", got, err)
		}
		if count(`SELECT count(*) FROM notifications_v2.notification_events WHERE notification_id=$1`, good.ID) != 1 {
			t.Fatal("healthy row starved")
		}
		exec(`DROP TRIGGER scheduler_fault ON notifications_v2.notifications`)
		if run().Created != 1 {
			t.Fatal("rolled back work not retried")
		}
	})
	t.Run("existing occurrence conflict advances safely", func(t *testing.T) {
		d := create()
		exec(`INSERT INTO notifications_v2.notification_events(id,notification_id,revision,scheduled_at,template_id,template_version,definition_snapshot,status,expansion_available_at,expansion_attempt_count,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,'{}','pending',now(),0,now(),now())`, uuid.New(), d.ID, d.Revision, d.NextRunAt, template)
		if stats := run(); stats.Created != 0 || stats.Processed != 1 {
			t.Fatalf("duplicate or stuck %+v", stats)
		}
	})
	t.Run("start disabled and cancellation", func(t *testing.T) {
		select {
		case <-scheduler.Start(ctx):
		case <-time.After(time.Second):
			t.Fatal("disabled scheduler did not stop")
		}
		c := config
		c.Enabled = true
		worker, _ := NewScheduler(pool, c, nil)
		cancelled, stop := context.WithCancel(ctx)
		stop()
		select {
		case <-worker.Start(cancelled):
		case <-time.After(time.Second):
			t.Fatal("scheduler ignored shutdown")
		}
	})
}
