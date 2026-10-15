package notificationv2

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/durgakiran/beskar/notification"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type testEmailSender struct {
	mu       sync.Mutex
	calls    int
	messages []notification.OutboundEmail
	fn       func(context.Context, notification.OutboundEmail) (notification.ProviderResult, error)
}

func (p *testEmailSender) Name() string { return "smtp" }
func (p *testEmailSender) Send(ctx context.Context, m notification.OutboundEmail) (notification.ProviderResult, error) {
	p.mu.Lock()
	p.calls++
	p.messages = append(p.messages, m)
	fn := p.fn
	p.mu.Unlock()
	if fn != nil {
		return fn(ctx, m)
	}
	return notification.ProviderResult{MessageID: "test-message"}, nil
}
func (p *testEmailSender) set(fn func(context.Context, notification.OutboundEmail) (notification.ProviderResult, error)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.fn = fn
}
func (p *testEmailSender) count() int { p.mu.Lock(); defer p.mu.Unlock(); return p.calls }

func testDeliveryPostgres(t *testing.T, pool *pgxpool.Pool) {
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`TRUNCATE notifications_v2.notifications CASCADE; TRUNCATE notifications.notification_events CASCADE`)
	actor, recipient, emailProvider, appProvider := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	emailTemplate, appTemplate := uuid.New(), uuid.New()
	for _, v := range []struct {
		id            uuid.UUID
		mode          int
		adapter, code string
	}{{emailProvider, 1, "smtp", "delivery-email"}, {appProvider, 2, "in_app", "delivery-app"}} {
		exec(`INSERT INTO notifications_v2.notification_providers(id,code,mode_id,adapter_key,config,max_concurrency,enabled,created_at,updated_at) VALUES($1,$2,$3,$4,'{}',2,true,now(),now())`, v.id, v.code, v.mode, v.adapter)
		exec(`INSERT INTO notifications_v2.notification_routes(notification_type_id,mode_id,provider_id,max_attempts,retry_initial_seconds,retry_max_seconds,enabled,updated_at) VALUES(1,$1,$2,3,2,30,true,now()) ON CONFLICT(notification_type_id,mode_id) DO UPDATE SET provider_id=EXCLUDED.provider_id,enabled=true,max_attempts=3,retry_initial_seconds=2,retry_max_seconds=30`, v.mode, v.id)
	}
	emailDetails := `{"subject":"Hello {{.name}}","text_body":"Hi {{.name}}","html_body":"<p>{{.name}}</p>"}`
	appDetails := `{"title":"Hello {{.name}}","body":"A document invitation","target_type":"page","target_id":"123","page_id":"123"}`
	for _, v := range []struct {
		id      uuid.UUID
		mode    int
		details string
	}{{emailTemplate, 1, emailDetails}, {appTemplate, 2, appDetails}} {
		exec(`INSERT INTO notifications_v2.notification_templates(id,version,name,mode_id,details,variable_schema,locale,created_at,created_by) VALUES($1,1,'Delivery', $2,$3,'{}','en',now(),$4)`, v.id, v.mode, v.details, actor)
	}
	key := []byte("01234567890123456789012345678901")
	a := DefaultAudienceConfig()
	a.HashKey = key
	directory := audienceDirectoryFunc(func(context.Context, pgx.Tx, []uuid.UUID, bool) (map[uuid.UUID]AudienceUser, error) {
		return map[uuid.UUID]AudienceUser{recipient: {Email: "recipient@example.com", EmailVerified: true}}, nil
	})
	expander, _ := NewAudienceExpander(pool, a, directory, nil)
	scheduler, _ := NewScheduler(pool, DefaultSchedulerConfig(), nil)
	service := NewService(pool)
	producer := Producer{Source: "delivery-test", ActorID: actor}
	create := func(mode string) (uuid.UUID, uuid.UUID) {
		t.Helper()
		in := inputFixture()
		in.TargetUsers = []uuid.UUID{recipient}
		in.TemplateID = emailTemplate
		if mode == "in_app" {
			in.ModeID = 2
			in.TemplateID = appTemplate
		}
		d, _, err := service.Create(ctx, producer, uuid.NewString(), in)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = scheduler.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		if _, err = expander.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		var id uuid.UUID
		if err = pool.QueryRow(ctx, `SELECT d.id FROM notifications_v2.notification_deliveries d JOIN notifications_v2.notification_events e ON e.id=d.event_id WHERE e.notification_id=$1`, d.ID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id, d.ID
	}
	sender := &testEmailSender{}
	config := DefaultDeliveryConfig()
	config.EmailEnabled = true
	config.InAppEnabled = true
	config.SMTPProviderID = emailProvider
	config.HashKey = key
	worker, err := NewDeliveryWorker(pool, config, sender, "sender@example.com", "Beskar", nil)
	if err != nil {
		t.Fatal(err)
	}
	run := func(mode string) {
		t.Helper()
		if _, err := worker.ProcessBatch(ctx, mode); err != nil {
			t.Fatal(err)
		}
	}
	state := func(id uuid.UUID) string {
		t.Helper()
		var state string
		if err := pool.QueryRow(ctx, `SELECT status FROM notifications_v2.notification_deliveries WHERE id=$1`, id).Scan(&state); err != nil {
			t.Fatal(err)
		}
		return state
	}
	attempts := func(id uuid.UUID) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM notifications_v2.notification_delivery_attempts WHERE delivery_id=$1`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	createExternal := func(addresses []string, includeUser bool) []uuid.UUID {
		t.Helper()
		in := inputFixture()
		in.TemplateID = emailTemplate
		in.TargetUsers = nil
		in.TargetEmails = addresses
		if includeUser {
			in.TargetUsers = []uuid.UUID{recipient}
		}
		d, _, err := service.Create(ctx, producer, uuid.NewString(), in)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = scheduler.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		selected := expander
		if !includeUser {
			selected, err = NewAudienceExpander(pool, a, audienceDirectoryFunc(func(context.Context, pgx.Tx, []uuid.UUID, bool) (map[uuid.UUID]AudienceUser, error) {
				return nil, errors.New("directory must not be called")
			}), nil)
			if err != nil {
				t.Fatal(err)
			}
		}
		if _, err = selected.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		rows, err := pool.Query(ctx, `SELECT d.id FROM notifications_v2.notification_deliveries d JOIN notifications_v2.notification_events e ON e.id=d.event_id WHERE e.notification_id=$1 ORDER BY d.destination_snapshot->>'email'`, d.ID)
		if err != nil {
			t.Fatal(err)
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil {
			t.Fatal(err)
		}
		return ids
	}
	t.Run("external emails expand deduplicate and send without a directory identity", func(t *testing.T) {
		ids := createExternal([]string{"External@EXAMPLE.COM", "External@example.com"}, false)
		if len(ids) != 1 {
			t.Fatalf("deliveries=%d", len(ids))
		}
		var external bool
		if err := pool.QueryRow(ctx, `SELECT user_id IS NULL AND destination_snapshot->>'email'='External@example.com' FROM notifications_v2.notification_deliveries WHERE id=$1`, ids[0]).Scan(&external); err != nil || !external {
			t.Fatalf("external=%v err=%v", external, err)
		}
		before := sender.count()
		run("email")
		run("email")
		if state(ids[0]) != "accepted" || attempts(ids[0]) != 1 || sender.count() != before+1 {
			t.Fatal("external delivery failed or duplicated")
		}
	})
	t.Run("matching user opt-out cannot be bypassed with a raw address", func(t *testing.T) {
		exec(`INSERT INTO notifications_v2.user_preferences(id,user_id,notification_type_id,mode_id,opt_in,created_at,updated_at) VALUES($1,$2,1,1,false,now(),now())`, uuid.New(), recipient)
		ids := createExternal([]string{"recipient@example.com"}, true)
		if len(ids) != 1 || state(ids[0]) != "suppressed" {
			t.Fatal("raw email bypassed user preference")
		}
		exec(`DELETE FROM notifications_v2.user_preferences WHERE user_id=$1`, recipient)
	})
	t.Run("external suppression recheck and retry", func(t *testing.T) {
		ids := createExternal([]string{"blocked@example.com"}, false)
		exec(`INSERT INTO notifications.email_suppressions(email,reason,source) VALUES('blocked@example.com','test','test')`)
		run("email")
		if state(ids[0]) != "suppressed" || attempts(ids[0]) != 0 {
			t.Fatal("external suppression ignored")
		}
		exec(`DELETE FROM notifications.email_suppressions WHERE email='blocked@example.com'`)
		ids = createExternal([]string{"retry-external@example.com"}, false)
		sender.set(func(context.Context, notification.OutboundEmail) (notification.ProviderResult, error) {
			return notification.ProviderResult{}, &net.OpError{Op: "dial", Err: errors.New("connection failed")}
		})
		run("email")
		sender.set(nil)
		if state(ids[0]) != "retrying" {
			t.Fatal("external retry missing")
		}
		exec(`UPDATE notifications_v2.notification_deliveries SET available_at=now() WHERE id=$1`, ids[0])
		run("email")
		if state(ids[0]) != "accepted" || attempts(ids[0]) != 2 {
			t.Fatal("external retry failed")
		}
	})
	t.Run("external defaults v2 suppression expiry and recovery", func(t *testing.T) {
		exec(`UPDATE notifications_v2.notification_types SET default_opt_in=false WHERE id=1`)
		ids := createExternal([]string{"default-opt-out@example.com"}, false)
		exec(`UPDATE notifications_v2.notification_types SET default_opt_in=true WHERE id=1`)
		if len(ids) != 1 || state(ids[0]) != "suppressed" {
			t.Fatal("external default opt-out ignored")
		}
		hash, err := DestinationHash(key, "email", "v2-blocked@example.com")
		if err != nil {
			t.Fatal(err)
		}
		exec(`INSERT INTO notifications_v2.notification_suppressions(id,mode_id,destination_hash,reason,source,created_at,updated_at) VALUES($1,1,$2,'test','test',now(),now())`, uuid.New(), hash)
		ids = createExternal([]string{"v2-blocked@example.com"}, false)
		if len(ids) != 1 || state(ids[0]) != "suppressed" {
			t.Fatal("external expansion suppression ignored")
		}
		exec(`DELETE FROM notifications_v2.notification_suppressions WHERE destination_hash=$1`, hash)
		ids = createExternal([]string{"expired-external@example.com"}, false)
		exec(`UPDATE notifications_v2.notification_events SET scheduled_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE id=(SELECT event_id FROM notifications_v2.notification_deliveries WHERE id=$1)`, ids[0])
		run("email")
		if state(ids[0]) != "expired" || attempts(ids[0]) != 0 {
			t.Fatal("external expiry ignored")
		}
		ids = createExternal([]string{"recovery-external@example.com"}, false)
		exec(`UPDATE notifications_v2.notification_deliveries SET status='processing',lease_token=$2,lease_expires_at=now()-interval '1 second' WHERE id=$1`, ids[0], uuid.New())
		recovery, err := NewRecoveryWorker(pool, DefaultRecoveryConfig(), a, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = recovery.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		if state(ids[0]) != "retrying" {
			t.Fatal("external recovery failed")
		}
		exec(`UPDATE notifications_v2.notification_deliveries SET available_at=now() WHERE id=$1`, ids[0])
		run("email")
		if state(ids[0]) != "accepted" {
			t.Fatal("recovered external delivery failed")
		}
	})
	t.Run("external delivery constraints reject duplicate address and in-app without user", func(t *testing.T) {
		ids := createExternal([]string{"first@example.com", "second@example.com"}, false)
		if len(ids) != 2 {
			t.Fatal("missing external recipients")
		}
		if _, err := pool.Exec(ctx, `UPDATE notifications_v2.notification_deliveries SET destination_snapshot='{"email":"first@example.com"}' WHERE id=$1`, ids[1]); err == nil {
			t.Fatal("duplicate external delivery accepted")
		}
		if _, err := pool.Exec(ctx, `UPDATE notifications_v2.notification_deliveries SET destination_snapshot='{}' WHERE id=$1`, ids[0]); err == nil {
			t.Fatal("empty external destination accepted")
		}
		id, _ := create("in_app")
		if _, err := pool.Exec(ctx, `UPDATE notifications_v2.notification_deliveries SET user_id=NULL WHERE id=$1`, id); err == nil {
			t.Fatal("anonymous in-app delivery accepted")
		}
		exec(`UPDATE notifications_v2.notification_deliveries SET status='cancelled' WHERE id=ANY($1::uuid[])`, append(ids, id))
	})
	t.Run("in-app concurrent exactly one inbox record and existing feed", func(t *testing.T) {
		id, _ := create("in_app")
		var wg sync.WaitGroup
		for i := 0; i < 5; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := worker.ProcessBatch(ctx, "in_app"); err != nil {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
		if state(id) != "delivered" || attempts(id) != 1 {
			t.Fatal("in-app delivery did not finish once")
		}
		feed, err := notification.NewServiceWithPool(pool).ListInAppNotifications(ctx, recipient, "all", "", 50)
		if err != nil || len(feed.Items) != 1 || feed.Items[0].Title != "Hello Alex" {
			t.Fatalf("feed %+v %v", feed, err)
		}
		run("in_app")
		feed, _ = notification.NewServiceWithPool(pool).ListInAppNotifications(ctx, recipient, "all", "", 50)
		if len(feed.Items) != 1 {
			t.Fatal("duplicate inbox record")
		}
	})
	t.Run("email provider acceptance", func(t *testing.T) {
		id, _ := create("email")
		before := sender.count()
		run("email")
		if state(id) != "accepted" || attempts(id) != 1 || sender.count() != before+1 {
			t.Fatal("email not accepted once")
		}
		sender.mu.Lock()
		m := sender.messages[len(sender.messages)-1]
		sender.mu.Unlock()
		if m.FromAddress != "sender@example.com" || m.ToAddress != "recipient@example.com" || m.Subject != "Hello Alex" || m.HTMLBody != "<p>Alex</p>" {
			t.Fatalf("wrong mail %+v", m)
		}
		var delivered *time.Time
		_ = pool.QueryRow(ctx, `SELECT delivered_at FROM notifications_v2.notification_deliveries WHERE id=$1`, id).Scan(&delivered)
		if delivered != nil {
			t.Fatal("SMTP acceptance claimed delivery")
		}
	})
	t.Run("current preference, suppression and expiry are checked", func(t *testing.T) {
		id, _ := create("email")
		exec(`INSERT INTO notifications_v2.user_preferences(id,user_id,notification_type_id,mode_id,opt_in,created_at,updated_at) VALUES($1,$2,1,1,false,now(),now())`, uuid.New(), recipient)
		run("email")
		if state(id) != "suppressed" || attempts(id) != 0 {
			t.Fatal("preference recheck failed")
		}
		exec(`DELETE FROM notifications_v2.user_preferences WHERE user_id=$1`, recipient)
		id, _ = create("email")
		hash, _ := DestinationHash(key, "email", "recipient@example.com")
		exec(`INSERT INTO notifications_v2.notification_suppressions(id,mode_id,destination_hash,reason,source,created_at,updated_at) VALUES($1,1,$2,'test','test',now(),now())`, uuid.New(), hash)
		run("email")
		if state(id) != "suppressed" || attempts(id) != 0 {
			t.Fatal("suppression recheck failed")
		}
		exec(`DELETE FROM notifications_v2.notification_suppressions WHERE destination_hash=$1`, hash)
		id, _ = create("email")
		exec(`UPDATE notifications_v2.notification_events SET expires_at=scheduled_at+interval '1 microsecond' WHERE id=(SELECT event_id FROM notifications_v2.notification_deliveries WHERE id=$1)`, id)
		run("email")
		if state(id) != "expired" || attempts(id) != 0 {
			t.Fatal("expiry ignored")
		}
	})
	t.Run("legacy email suppression is honored", func(t *testing.T) {
		id, _ := create("email")
		exec(`INSERT INTO notifications.email_suppressions(email,reason,source) VALUES('recipient@example.com','test','test')`)
		run("email")
		if state(id) != "suppressed" || attempts(id) != 0 {
			t.Fatal("legacy suppression ignored")
		}
		exec(`DELETE FROM notifications.email_suppressions WHERE email='recipient@example.com'`)
	})
	t.Run("quiet hours defer without consuming attempt", func(t *testing.T) {
		id, _ := create("email")
		exec(`INSERT INTO notifications_v2.user_quiet_hours(id,user_id,mode_id,enabled,timezone,start_time,end_time,created_at,updated_at) VALUES($1,$2,1,true,'UTC',(now() AT TIME ZONE 'UTC'-interval '1 hour')::time,(now() AT TIME ZONE 'UTC'+interval '2 hour')::time,now(),now())`, uuid.New(), recipient)
		run("email")
		var future bool
		_ = pool.QueryRow(ctx, `SELECT available_at>now() AND eligible_at=available_at FROM notifications_v2.notification_deliveries WHERE id=$1`, id).Scan(&future)
		if state(id) != "pending" || attempts(id) != 0 || !future {
			t.Fatal("quiet-hour deferral failed")
		}
		exec(`DELETE FROM notifications_v2.user_quiet_hours WHERE user_id=$1`, recipient)
		exec(`UPDATE notifications_v2.notification_deliveries SET status='cancelled' WHERE id=$1`, id)
	})
	t.Run("known transient retry and permanent rejection", func(t *testing.T) {
		id, _ := create("email")
		sender.set(func(context.Context, notification.OutboundEmail) (notification.ProviderResult, error) {
			return notification.ProviderResult{}, &net.OpError{Op: "dial", Err: errors.New("refused")}
		})
		run("email")
		if state(id) != "retrying" || attempts(id) != 1 {
			t.Fatal("transient error not queued")
		}
		before := sender.count()
		run("email")
		if sender.count() != before {
			t.Fatal("backoff ignored")
		}
		sender.set(nil)
		exec(`UPDATE notifications_v2.notification_deliveries SET available_at=now() WHERE id=$1`, id)
		run("email")
		if state(id) != "accepted" || attempts(id) != 2 {
			t.Fatal("retry failed")
		}
		id, _ = create("email")
		sender.set(func(context.Context, notification.OutboundEmail) (notification.ProviderResult, error) {
			return notification.ProviderResult{}, &notification.ProviderError{Kind: notification.ProviderErrorPermanent, Code: "message_build_failed"}
		})
		run("email")
		if state(id) != "failed" {
			t.Fatal("permanent failure retried")
		}
		sender.set(nil)
	})
	t.Run("ambiguous SMTP timeout is held for review", func(t *testing.T) {
		id, _ := create("email")
		sender.set(func(context.Context, notification.OutboundEmail) (notification.ProviderResult, error) {
			return notification.ProviderResult{}, context.DeadlineExceeded
		})
		run("email")
		if state(id) != "dead_lettered" {
			t.Fatal("uncertain outcome automatically retried")
		}
		var s string
		_ = pool.QueryRow(ctx, `SELECT status FROM notifications_v2.notification_delivery_attempts WHERE delivery_id=$1`, id).Scan(&s)
		if s != "unknown" {
			t.Fatal("attempt uncertainty lost")
		}
		sender.set(nil)
	})
	t.Run("cancellation during SMTP preserves attempt without resurrecting delivery", func(t *testing.T) {
		id, definition := create("email")
		sender.set(func(context.Context, notification.OutboundEmail) (notification.ProviderResult, error) {
			d, err := service.Get(ctx, producer, definition)
			if err != nil {
				return notification.ProviderResult{}, err
			}
			_, err = service.Transition(ctx, producer, definition, d.Revision, "cancel")
			return notification.ProviderResult{MessageID: "after-cancel"}, err
		})
		run("email")
		if state(id) != "cancelled" {
			t.Fatal("cancelled delivery resurrected")
		}
		var s string
		_ = pool.QueryRow(ctx, `SELECT status FROM notifications_v2.notification_delivery_attempts WHERE delivery_id=$1`, id).Scan(&s)
		if s != "accepted" {
			t.Fatal("provider outcome lost")
		}
		sender.set(nil)
	})
	t.Run("invitation resolution links legacy and v2 inbox items by recipient and target", func(t *testing.T) {
		token := uuid.NewString()
		// Change only this test template before creating the occurrence snapshot.
		exec(`UPDATE notifications_v2.notification_templates SET details=$2 WHERE id=$1`, appTemplate, `{"title":"Invitation","target_type":"invite","target_id":"`+token+`","action_required":true,"actions":[{"key":"accept","label":"Accept","method":"POST","url":"/api/v1/invite/user/decision"}]}`)
		id, _ := create("in_app")
		run("in_app")
		exec(`UPDATE notifications_v2.notification_templates SET details=$2 WHERE id=$1`, appTemplate, appDetails)
		inboxService := notification.NewServiceWithPool(pool)
		otherUser := uuid.New()
		for _, entry := range []struct {
			key, targetType, targetID string
			user                      uuid.UUID
		}{
			{"legacy:" + token, "invite", token, recipient},
			{"other-user:" + token, "invite", token, otherUser},
			{"other-invite:" + token, "invite", "other-" + token, recipient},
			{"other-type:" + token, "page", token, recipient},
		} {
			err := inboxService.Emit(ctx, notification.EmitNotificationRequest{EventKey: entry.key, Type: "space_invite_created", Category: "space_invite", Title: "Invite", Target: notification.NotificationTarget{Type: entry.targetType, ID: entry.targetID}, Recipients: []notification.NotificationRecipient{{UserID: &entry.user}}, Channels: []string{notification.ChannelInApp}})
			if err != nil {
				t.Fatal(err)
			}
		}
		for i := 0; i < 2; i++ {
			if err := inboxService.ResolveByTarget(ctx, "invite", token, recipient); err != nil {
				t.Fatal(err)
			}
		}
		var resolved, unresolved int
		if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE resolved_at IS NOT NULL AND read_at IS NOT NULL),count(*) FILTER (WHERE resolved_at IS NULL) FROM notifications.in_app_notifications WHERE target_id IN($1,$2)`, token, "other-"+token).Scan(&resolved, &unresolved); err != nil {
			t.Fatal(err)
		}
		if resolved != 2 || unresolved != 3 || state(id) != "delivered" {
			t.Fatalf("resolved=%d unresolved=%d delivery=%s", resolved, unresolved, state(id))
		}
	})
	t.Run("inbox failure rolls back inbox attempt and delivery state", func(t *testing.T) {
		id, _ := create("in_app")
		exec(`CREATE FUNCTION notifications_v2.delivery_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='` + id.String() + `'::uuid AND NEW.status='delivered' THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$`)
		exec(`CREATE TRIGGER delivery_fault BEFORE UPDATE ON notifications_v2.notification_deliveries FOR EACH ROW EXECUTE FUNCTION notifications_v2.delivery_fault()`)
		defer exec(`DROP TRIGGER IF EXISTS delivery_fault ON notifications_v2.notification_deliveries; DROP FUNCTION notifications_v2.delivery_fault()`)
		if _, err := worker.ProcessBatch(ctx, "in_app"); err == nil {
			t.Fatal("injected fault ignored")
		}
		if state(id) != "pending" || attempts(id) != 0 {
			t.Fatal("partial in-app transaction committed")
		}
		var n int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM notifications.notification_events WHERE event_key=$1`, "notification-v2-delivery:"+id.String()).Scan(&n)
		if n != 0 {
			t.Fatal("orphan inbox event")
		}
		exec(`DROP TRIGGER delivery_fault ON notifications_v2.notification_deliveries`)
		run("in_app")
		if state(id) != "delivered" {
			t.Fatal("in-app retry failed")
		}
	})
	t.Run("stale claims with uncertain attempts are not resent", func(t *testing.T) {
		id, _ := create("email")
		token := uuid.New()
		exec(`UPDATE notifications_v2.notification_deliveries SET status='processing',attempt_count=1,lease_token=$2,lease_expires_at=now()-interval '1 second' WHERE id=$1`, id, token)
		exec(`INSERT INTO notifications_v2.notification_delivery_attempts(id,delivery_id,attempt_number,provider_id,lease_token,status,started_at) VALUES($1,$2,1,$3,$4,'started',now()-interval '2 seconds')`, uuid.New(), id, emailProvider, token)
		before := sender.count()
		recovery, err := NewRecoveryWorker(pool, DefaultRecoveryConfig(), DefaultAudienceConfig(), nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = recovery.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		if state(id) != "dead_lettered" || sender.count() != before {
			t.Fatal("expired uncertain claim resent")
		}
	})
	t.Run("recovery preserves known attempt results", func(t *testing.T) {
		for _, tc := range []struct {
			outcome, want string
			attempt       int
		}{{"permanent_failure", "failed", 1}, {"transient_failure", "retrying", 1}, {"transient_failure", "dead_lettered", 3}, {"accepted", "accepted", 1}, {"", "retrying", 0}} {
			id, _ := create("email")
			token := uuid.New()
			exec(`UPDATE notifications_v2.notification_deliveries SET status='processing',attempt_count=$3,lease_token=$2,lease_expires_at=now()-interval '1 second' WHERE id=$1`, id, token, tc.attempt)
			if tc.outcome != "" {
				exec(`INSERT INTO notifications_v2.notification_delivery_attempts(id,delivery_id,attempt_number,provider_id,lease_token,status,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,now()-interval '2 seconds',now())`, uuid.New(), id, tc.attempt, emailProvider, token, tc.outcome)
			}
			before := sender.count()
			recovery, err := NewRecoveryWorker(pool, DefaultRecoveryConfig(), DefaultAudienceConfig(), nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = recovery.ProcessBatch(ctx); err != nil {
				t.Fatal(err)
			}
			if state(id) != tc.want || sender.count() != before {
				t.Fatalf("recovery %s got %s want %s", tc.outcome, state(id), tc.want)
			}
			if tc.want == "retrying" {
				exec(`UPDATE notifications_v2.notification_deliveries SET status='cancelled' WHERE id=$1`, id)
			}
		}
	})
	t.Run("concurrent recovery commits one transition", func(t *testing.T) {
		recovery, err := NewRecoveryWorker(pool, DefaultRecoveryConfig(), DefaultAudienceConfig(), nil)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := create("email")
		exec(`UPDATE notifications_v2.notification_deliveries SET status='processing',lease_token=$2,lease_expires_at=now()-interval '1 second' WHERE id=$1`, id, uuid.New())
		var c deliveryCandidate
		if err = pool.QueryRow(ctx, `SELECT d.id,e.notification_id,e.id,d.provider_id FROM notifications_v2.notification_deliveries d JOIN notifications_v2.notification_events e ON e.id=d.event_id WHERE d.id=$1`, id).Scan(&c.ID, &c.DefinitionID, &c.EventID, &c.ProviderID); err != nil {
			t.Fatal(err)
		}
		results := make(chan string, 2)
		errs := make(chan error, 2)
		for i := 0; i < 2; i++ {
			go func() { status, err := recovery.recoverDelivery(ctx, c); results <- status; errs <- err }()
		}
		changed := 0
		for i := 0; i < 2; i++ {
			if status := <-results; status != "" {
				changed++
			}
			if err := <-errs; err != nil {
				t.Fatal(err)
			}
		}
		if changed != 1 || state(id) != "retrying" {
			t.Fatalf("transitions=%d state=%s", changed, state(id))
		}
		exec(`UPDATE notifications_v2.notification_deliveries SET status='cancelled' WHERE id=$1`, id)
	})
	t.Run("recovery skips live leases and active provider sessions", func(t *testing.T) {
		recovery, err := NewRecoveryWorker(pool, DefaultRecoveryConfig(), DefaultAudienceConfig(), nil)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := create("email")
		exec(`UPDATE notifications_v2.notification_deliveries SET status='processing',lease_token=$2,lease_expires_at=now()+interval '1 minute' WHERE id=$1`, id, uuid.New())
		if _, err = recovery.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		if state(id) != "processing" {
			t.Fatal("live lease changed")
		}
		conn, release, err := reserveProvider(ctx, pool, emailProvider)
		if err != nil || conn == nil {
			t.Fatalf("reserve provider: %v", err)
		}
		exec(`UPDATE notifications_v2.notification_deliveries SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, id)
		_, err = recovery.ProcessBatch(ctx)
		release()
		if err != nil {
			t.Fatal(err)
		}
		if state(id) != "processing" {
			t.Fatal("active send recovered")
		}
		if _, err = recovery.ProcessBatch(ctx); err != nil {
			t.Fatal(err)
		}
		if state(id) != "retrying" {
			t.Fatal("abandoned claim not recovered")
		}
		exec(`UPDATE notifications_v2.notification_deliveries SET status='cancelled' WHERE id=$1`, id)
	})
	t.Run("recovery observes cancellation expiry and in-app retry", func(t *testing.T) {
		recovery, err := NewRecoveryWorker(pool, DefaultRecoveryConfig(), DefaultAudienceConfig(), nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, want := range []string{"cancelled", "expired", "retrying"} {
			id, definition := create("in_app")
			exec(`UPDATE notifications_v2.notification_deliveries SET status='processing',lease_token=$2,lease_expires_at=now()-interval '1 second' WHERE id=$1`, id, uuid.New())
			if want == "cancelled" {
				exec(`UPDATE notifications_v2.notifications SET status='cancelled' WHERE id=$1`, definition)
			}
			if want == "expired" {
				exec(`UPDATE notifications_v2.notification_events SET scheduled_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE notification_id=$1`, definition)
			}
			if _, err = recovery.ProcessBatch(ctx); err != nil {
				t.Fatal(err)
			}
			if state(id) != want {
				t.Fatalf("got %s want %s", state(id), want)
			}
			if want == "retrying" {
				exec(`UPDATE notifications_v2.notification_deliveries SET status='cancelled' WHERE id=$1`, id)
			}
		}
	})
	t.Run("provider rate limit and single flight across instances", func(t *testing.T) {
		// Prove locking with a blocked provider call and a competing worker.
		first, _ := create("email")
		second, _ := create("email")
		entered := make(chan struct{}, 1)
		release := make(chan struct{})
		var releaseOnce sync.Once
		defer releaseOnce.Do(func() { close(release) })
		sender.set(func(context.Context, notification.OutboundEmail) (notification.ProviderResult, error) {
			select {
			case entered <- struct{}{}:
			default:
			}
			<-release
			return notification.ProviderResult{}, nil
		})
		done := make(chan error, 1)
		go func() { _, err := worker.ProcessBatch(ctx, "email"); done <- err }()
		select {
		case <-entered:
		case <-time.After(3 * time.Second):
			t.Fatal("SMTP call did not start")
		}
		before := sender.count()
		if _, err := worker.ProcessBatch(ctx, "email"); err != nil {
			t.Fatal(err)
		}
		if sender.count() != before {
			t.Fatal("provider concurrency exceeded")
		}
		releaseOnce.Do(func() { close(release) })
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		sender.set(nil)
		if state(first) != "accepted" || state(second) != "accepted" {
			t.Fatal("provider work lost")
		}
		exec(`UPDATE notifications_v2.notification_providers SET requests_per_second=1 WHERE id=$1`, emailProvider)
		id, _ := create("email")
		run("email")
		if state(id) != "pending" || attempts(id) != 0 {
			t.Fatal("rate limit not enforced")
		}
		exec(`UPDATE notifications_v2.notification_providers SET requests_per_second=NULL WHERE id=$1`, emailProvider)
		exec(`UPDATE notifications_v2.notification_deliveries SET available_at=now() WHERE id=$1`, id)
		run("email")
	})
	t.Run("business producers publish and deliver every seeded inbox topic", func(t *testing.T) {
		business := NewBusinessProducer(pool, "beskar.space")
		for topic := range businessTemplates {
			token := uuid.NewString()
			spaceID := uuid.New()
			happened := time.Now().Add(-time.Minute)
			req := notification.EmitNotificationRequest{EventKey: topic + ":" + token, Type: topic, Actor: notification.NotificationActor{UserID: actor, Name: "Alice"}, Recipients: []notification.NotificationRecipient{{UserID: &recipient}}, Target: notification.NotificationTarget{Type: "space", ID: spaceID.String(), SpaceID: &spaceID}, Title: "Business title", Body: "Business body", Data: map[string]any{"href": "/space/" + spaceID.String(), "space_id": spaceID.String(), "space_name": "Team", "role": "viewer", "token": token}, CreatedAt: &happened}
			if topic == "space_invite_created" {
				req.Target.Type = "invite"
				req.Target.ID = token
			}
			if topic == "space_deleted" || topic == "space_member_removed" {
				req.Target = notification.NotificationTarget{Type: "account", ID: recipient.String()}
			}
			if err := business.Emit(ctx, req); err != nil {
				t.Fatal(err)
			}
			if err := business.Emit(ctx, req); err != nil {
				t.Fatal(err)
			}
			var count int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM notifications_v2.notifications WHERE source_service='beskar.space' AND correlation_id=$1`, req.EventKey).Scan(&count); err != nil || count != 1 {
				t.Fatalf("duplicate publication %d %v", count, err)
			}
			if _, err := scheduler.ProcessBatch(ctx); err != nil {
				t.Fatal(err)
			}
			if _, err := expander.ProcessBatch(ctx); err != nil {
				t.Fatal(err)
			}
			run("in_app")
			var raw []byte
			if err := pool.QueryRow(ctx, `SELECT to_jsonb(n) FROM notifications.in_app_notifications n JOIN notifications.notification_events e ON e.id=n.event_id JOIN notifications_v2.notification_deliveries d ON e.event_key='notification-v2-delivery:'||d.id::text JOIN notifications_v2.notification_events ve ON ve.id=d.event_id JOIN notifications_v2.notifications def ON def.id=ve.notification_id WHERE def.correlation_id=$1`, req.EventKey).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var inbox struct {
				Type, Title, Body, Category string
				Data                        map[string]any
				Actions                     []notification.NotificationAction
				ActionRequired              bool `json:"action_required"`
			}
			if err := json.Unmarshal(raw, &inbox); err != nil {
				t.Fatal(err)
			}
			if inbox.Type != topic || inbox.Title != req.Title || inbox.Body != req.Body || inbox.Data["href"] != req.Data["href"] || inbox.Data["space_id"] != spaceID.String() {
				t.Fatalf("lost business content: %s", raw)
			}
			if topic == "space_invite_created" && (len(inbox.Actions) != 2 || !inbox.ActionRequired || inbox.Data["token"] != token || inbox.Category != "space_invite") {
				t.Fatalf("invitation actions lost: %s", raw)
			}
		}
	})
	t.Run("business invite emails support known and external recipients and legacy opt-outs", func(t *testing.T) {
		business := NewBusinessProducer(pool, "beskar.invite")
		for _, kind := range []string{"known", "external", "opted-out"} {
			token := uuid.NewString()
			req := notification.EnqueueEmailRequest{MessageKey: "space_invite_created:" + token, TemplateKey: notification.TemplateSpaceInviteCreated, Recipient: notification.EmailRecipient{Email: "outside@example.com"}, TemplateData: map[string]any{"space_name": "Team", "sender_name": "Alice", "role": "viewer", "accept_url": "https://app.example/invite/action?token=" + token + "&decision=accept", "reject_url": "https://app.example/invite/action?token=" + token + "&decision=reject", "app_url": "https://app.example"}}
			if kind != "external" {
				req.Recipient.UserID = &recipient
			}
			if kind == "opted-out" {
				exec(`INSERT INTO notifications.email_preferences(recipient_user_id,category,enabled) VALUES($1,'space_invite',false)`, recipient)
			}
			if err := business.EnqueueSpaceInviteEmail(ctx, req, actor); err != nil {
				t.Fatal(err)
			}
			if err := business.EnqueueSpaceInviteEmail(ctx, req, actor); err != nil {
				t.Fatal(err)
			}
			if _, err := scheduler.ProcessBatch(ctx); err != nil {
				t.Fatal(err)
			}
			if _, err := expander.ProcessBatch(ctx); err != nil {
				t.Fatal(err)
			}
			before := sender.count()
			run("email")
			var status string
			var count int
			if err := pool.QueryRow(ctx, `SELECT count(*),min(d.status) FROM notifications_v2.notification_deliveries d JOIN notifications_v2.notification_events e ON e.id=d.event_id JOIN notifications_v2.notifications n ON n.id=e.notification_id WHERE n.correlation_id=$1`, req.MessageKey).Scan(&count, &status); err != nil {
				t.Fatal(err)
			}
			want := "accepted"
			sent := 1
			if kind == "opted-out" {
				want = "suppressed"
				sent = 0
			}
			if count != 1 || status != want || sender.count() != before+sent {
				t.Fatalf("kind=%s count=%d status=%s", kind, count, status)
			}
			if kind == "opted-out" {
				exec(`DELETE FROM notifications.email_preferences WHERE recipient_user_id=$1 AND category='space_invite'`, recipient)
			}
		}
	})
	t.Run("disabled startup and shutdown", func(t *testing.T) {
		disabled := DefaultDeliveryConfig()
		w, _ := NewDeliveryWorker(pool, disabled, nil, "", "", nil)
		select {
		case <-w.Start(ctx):
		case <-time.After(time.Second):
			t.Fatal("disabled delivery worker ran")
		}
		cancelled, cancel := context.WithCancel(ctx)
		cancel()
		select {
		case <-worker.Start(cancelled):
		case <-time.After(time.Second):
			t.Fatal("delivery shutdown hung")
		}
	})
}
