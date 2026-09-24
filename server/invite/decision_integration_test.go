package invite

import (
	permify "buf.build/gen/go/permifyco/permify/protocolbuffers/go/base/v1"
	"context"
	"errors"
	"github.com/durgakiran/beskar/core"
	"go.uber.org/zap"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Uses a dedicated disposable database only; never the configured application DB.
func TestInvitationDecisionIntegration(t *testing.T) {
	dsn := os.Getenv("INVITE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set INVITE_TEST_DATABASE_URL to a disposable invite_acceptance database")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ConnConfig.Database != "invite_acceptance" {
		t.Fatal("refusing to use a non-test database")
	}
	ctx := context.Background()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	_, err = pool.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS notifications; CREATE SCHEMA IF NOT EXISTS core;
 CREATE TABLE IF NOT EXISTS core.space(id uuid PRIMARY KEY,name text);
 CREATE TABLE IF NOT EXISTS notifications.invites(sender_id uuid NOT NULL, token varchar(35) NOT NULL, user_id uuid, entity varchar(35) NOT NULL, entity_id varchar(100) NOT NULL, email_id text NOT NULL, role varchar(30),status varchar(10),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`)
	if err != nil {
		t.Fatal(err)
	}
	sender, user, space := uuid.New(), uuid.NewString(), uuid.NewString()
	_, err = pool.Exec(ctx, `INSERT INTO core.space VALUES ($1,'Invitation acceptance test')`, space)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM notifications.invites WHERE entity_id=$1`, space)
		pool.Exec(ctx, `DELETE FROM core.space WHERE id=$1`, space)
	})
	seed := func(age time.Duration, status any) string {
		t.Helper()
		token := (Invite{}).token()
		_, err := pool.Exec(ctx, CREATE_INVITE, sender, token, uuid.Nil, "space", space, "Recipient@example.test", "viewer")
		if err != nil {
			t.Fatal(err)
		}
		_, err = pool.Exec(ctx, `UPDATE notifications.invites SET created_at=$1,status=$2 WHERE token=$3`, time.Now().Add(-age), status, token)
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	var grants atomic.Int32
	grant := func(context.Context, InviteDetailsDBO, string) error { grants.Add(1); return nil }
	decide := func(token, decision string) (InviteDecisionResponse, error) {
		r, _, e := decideInvite(ctx, pool, user, "recipient@example.test", token, decision, grant)
		return r, e
	}
	t.Run("accept case-insensitive recipient and replay", func(t *testing.T) {
		token := seed(time.Hour, nil)
		before := grants.Load()
		r, err := decide(token, "accept")
		if err != nil || r.Status != "accepted" {
			t.Fatalf("%+v %v", r, err)
		}
		for _, decision := range []string{"accept", "reject"} {
			r, err := decide(token, decision)
			if err != nil || r.Status != "accepted" {
				t.Fatalf("%+v %v", r, err)
			}
		}
		if grants.Load() != before+1 {
			t.Fatal("replayed permission grant")
		}
	})
	t.Run("decline does not grant access", func(t *testing.T) {
		token := seed(time.Hour, nil)
		before := grants.Load()
		r, err := decide(token, "reject")
		if err != nil || r.Status != "rejected" || grants.Load() != before {
			t.Fatalf("%+v %v", r, err)
		}
	})
	t.Run("wrong account missing and invalid decision", func(t *testing.T) {
		token := seed(time.Hour, nil)
		_, _, err := decideInvite(ctx, pool, user, "other@example.test", token, "accept", grant)
		if !errors.Is(err, errInviteWrongAccount) {
			t.Fatal(err)
		}
		if _, err := decide("nonexistent", "accept"); !errors.Is(err, errInviteNotFound) {
			t.Fatal(err)
		}
		if _, err := decide(token, "other"); !errors.Is(err, errInviteInvalidDecision) {
			t.Fatal(err)
		}
	})
	t.Run("expired revoked and rejected never grant", func(t *testing.T) {
		for _, tc := range []struct {
			age    time.Duration
			status any
			want   string
		}{{8 * 24 * time.Hour, nil, "expired"}, {time.Hour, "REMOVED", "removed"}, {time.Hour, "REJECTED", "rejected"}} {
			token := seed(tc.age, tc.status)
			before := grants.Load()
			r, err := decide(token, "accept")
			if err != nil || r.Status != tc.want || grants.Load() != before {
				t.Fatalf("%+v %v", r, err)
			}
		}
	})
	t.Run("permission outage rolls back and is retryable", func(t *testing.T) {
		token := seed(time.Hour, nil)
		_, _, err := decideInvite(ctx, pool, user, "recipient@example.test", token, "accept", func(context.Context, InviteDetailsDBO, string) error { return errors.New("permission outage") })
		if err == nil {
			t.Fatal("expected failure")
		}
		r, err := decide(token, "accept")
		if err != nil || r.Status != "accepted" {
			t.Fatalf("%+v %v", r, err)
		}
	})
	t.Run("simultaneous accept and decline serialize", func(t *testing.T) {
		token := seed(time.Hour, nil)
		entered, release := make(chan struct{}), make(chan struct{})
		result := make(chan error, 2)
		go func() {
			r, _, err := decideInvite(ctx, pool, user, "recipient@example.test", token, "accept", func(context.Context, InviteDetailsDBO, string) error { close(entered); <-release; return nil })
			if err == nil && r.Status != "accepted" {
				err = errors.New("accept lost")
			}
			result <- err
		}()
		<-entered
		go func() {
			r, err := decide(token, "reject")
			if err == nil && r.Status != "accepted" {
				err = errors.New("decline overwrote acceptance")
			}
			result <- err
		}()
		close(release)
		for i := 0; i < 2; i++ {
			if err := <-result; err != nil {
				t.Fatal(err)
			}
		}
	})
	t.Run("revocation preserves terminal link and new token is independent", func(t *testing.T) {
		token := seed(time.Hour, nil)
		_, err := pool.Exec(ctx, REMOVE_INVITATION, sender, "recipient@example.test", space, "viewer")
		if err != nil {
			t.Fatal(err)
		}
		r, err := decide(token, "accept")
		if err != nil || r.Status != "removed" {
			t.Fatalf("%+v %v", r, err)
		}
		fresh := seed(time.Hour, nil)
		if strings.EqualFold(fresh, token) {
			t.Fatal("token reused")
		}
		r, err = decide(fresh, "accept")
		if err != nil || r.Status != "accepted" {
			t.Fatalf("%+v %v", r, err)
		}
	})
	t.Run("actual permission service membership", func(t *testing.T) {
		endpoint := os.Getenv("INVITE_TEST_PERMIFY_ENDPOINT")
		if endpoint == "" {
			t.Skip("set INVITE_TEST_PERMIFY_ENDPOINT for disposable permission service")
		}
		if endpoint != "127.0.0.1:55442" {
			t.Fatal("permission integration requires the isolated localhost service")
		}
		t.Setenv("PERMIFY_ENDPOINT", endpoint)
		t.Setenv("PERMIFY_SECRET", "")
		t.Setenv("PG_HOST", cfg.ConnConfig.Host)
		t.Setenv("PG_PORT", strconv.Itoa(int(cfg.ConnConfig.Port)))
		t.Setenv("PG_USER", cfg.ConnConfig.User)
		t.Setenv("PG_PASSWORD", cfg.ConnConfig.Password)
		t.Setenv("PG_DB", cfg.ConnConfig.Database)
		t.Setenv("QUOTA_SYSTEM_ENABLED", "false")
		previousLogger := core.Logger
		core.Logger = zap.NewNop()
		t.Cleanup(func() { core.Logger = previousLogger })
		_, err := pool.Exec(ctx, `ALTER TABLE core.space ADD COLUMN IF NOT EXISTS archived_at timestamptz; ALTER TABLE core.space ADD COLUMN IF NOT EXISTS deleted_at timestamptz`)
		if err != nil {
			t.Fatal(err)
		}
		client := core.GetPermifyInstance()
		if _, err := client.Tenancy.Create(ctx, &permify.TenantCreateRequest{Id: "t1", Name: "Invitation tests"}); err != nil && !strings.Contains(strings.ToLower(err.Error()), "already") {
			t.Fatal(err)
		}
		schema, err := os.ReadFile("../../permify/schema.perm")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := client.Schema.Write(ctx, &permify.SchemaWriteRequest{TenantId: "t1", Schema: string(schema)}); err != nil {
			t.Fatal(err)
		}
		if _, err := core.CreateSubjectPermissions("space", space, "user", sender.String(), "owner"); err != nil {
			t.Fatal(err)
		}
		// Real creation/re-invitation service, with only the identity-directory
		// lookup replaced by a local response for an unknown recipient.
		directory := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"result":[]}`))
		}))
		defer directory.Close()
		t.Setenv("ISSUER_URL", directory.URL)
		t.Setenv("SERVER_PAT", "")
		freshInvite := Invite{Entity: "space", EntityId: space, SenderId: sender, Email: "new@example.test", Role: "viewer", UserId: uuid.New()}
		first, err := freshInvite.invite()
		if err != nil {
			t.Fatal(err)
		}
		if freshInvite.UserId != uuid.Nil {
			t.Fatal("trusted caller-supplied recipient id")
		}
		if _, err := freshInvite.invite(); err == nil {
			t.Fatal("duplicate pending invite accepted")
		}
		if _, err := pool.Exec(ctx, `UPDATE notifications.invites SET created_at=now()-interval '8 days' WHERE token=$1`, first); err != nil {
			t.Fatal(err)
		}
		fresh, err := freshInvite.invite()
		if err != nil || fresh == first {
			t.Fatalf("reinvite failed: %v", err)
		}
		result, _, err := decideInvite(ctx, pool, uuid.NewString(), "new@example.test", first, "accept", grantInviteAccess)
		if err != nil || result.Status != "expired" {
			t.Fatalf("old link revived: %+v %v", result, err)
		}
		result, _, err = decideInvite(ctx, pool, uuid.NewString(), "new@example.test", fresh, "accept", grantInviteAccess)
		if err != nil || result.Status != "accepted" {
			t.Fatalf("fresh invite failed: %+v %v", result, err)
		}
		for _, role := range []string{"viewer", "editor", "commenter", "admin"} {
			token := seed(time.Hour, nil)
			member := uuid.NewString()
			if _, err := pool.Exec(ctx, `UPDATE notifications.invites SET role=$1 WHERE token=$2`, role, token); err != nil {
				t.Fatal(err)
			}
			result, _, err := decideInvite(ctx, pool, member, "recipient@example.test", token, "accept", grantInviteAccess)
			if err != nil || result.Status != "accepted" {
				t.Fatalf("%s: %+v %v", role, result, err)
			}
			allowed, err := core.CheckPermission("space", space, "user", member, core.SPACE_VIEW)
			if err != nil || !allowed {
				t.Fatalf("%s failed to grant access: %v", role, err)
			}
			if role == "viewer" {
				canEdit, err := core.CheckPermission("space", space, "user", member, "edit_page")
				if err != nil || canEdit {
					t.Fatal("viewer gained edit permission")
				}
			}
		}
		token := seed(time.Hour, nil)
		if _, err := pool.Exec(ctx, `UPDATE core.space SET archived_at=now() WHERE id=$1`, space); err != nil {
			t.Fatal(err)
		}
		if _, _, err := decideInvite(ctx, pool, uuid.NewString(), "recipient@example.test", token, "accept", grantInviteAccess); err == nil {
			t.Fatal("archived space accepted invite")
		}
		if _, err := pool.Exec(ctx, `UPDATE core.space SET archived_at=NULL WHERE id=$1`, space); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE notifications.invites SET sender_id=$1 WHERE token=$2`, uuid.New(), token); err != nil {
			t.Fatal(err)
		}
		if _, _, err := decideInvite(ctx, pool, uuid.NewString(), "recipient@example.test", token, "accept", grantInviteAccess); err == nil {
			t.Fatal("unauthorized sender granted access")
		}
	})

}
