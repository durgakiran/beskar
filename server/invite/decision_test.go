package invite

import (
	"database/sql"
	"encoding/hex"
	"github.com/google/uuid"
	"net/http/httptest"
	"testing"
	"time"
)

func TestInviteExpiry(t *testing.T) {
	now := time.Now().UTC()
	for _, tc := range []struct {
		name   string
		age    time.Duration
		status string
		want   string
	}{
		{"pending", 6 * 24 * time.Hour, "", ""}, {"boundary", inviteLifetime, "", "expired"}, {"expired", inviteLifetime + time.Second, "", "expired"},
		{"accepted remains accepted", 30 * 24 * time.Hour, "ACCEPTED", "accepted"}, {"revoked", time.Hour, "REMOVED", "removed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			created := now.Add(-tc.age)
			got := effectiveInviteStatus(InviteDetailsDBO{CreatedAt: &created, Status: sql.NullString{String: tc.status, Valid: tc.status != ""}}, now)
			value := ""
			if got != nil {
				value = *got
			}
			if value != tc.want {
				t.Fatalf("got %q want %q", value, tc.want)
			}
		})
	}
	if got := effectiveInviteStatus(InviteDetailsDBO{}, now); got == nil || *got != "expired" {
		t.Fatal("undated invite must fail closed")
	}
}
func TestNewInvitationTokensAreDistinct(t *testing.T) {
	i := Invite{Entity: "space", EntityId: uuid.NewString(), Email: "user@example.com"}
	first, second := i.token(), i.token()
	if first == second || len(first) != 32 {
		t.Fatal("tokens must be fresh, 128-bit random values")
	}
	if _, err := hex.DecodeString(first); err != nil {
		t.Fatal(err)
	}
}
func TestValidateInvitation(t *testing.T) {
	for _, tc := range []struct {
		name, entity, id, email, role string
		valid                         bool
	}{
		{"valid", "space", uuid.NewString(), " USER@example.com ", "viewer", true},
		{"commenter alias", "space", uuid.NewString(), "user@example.com", "commenter", true},
		{"owner escalation", "space", uuid.NewString(), "user@example.com", "owner", false},
		{"bad id", "space", "bad", "user@example.com", "viewer", false},
		{"bad email", "space", uuid.NewString(), "not-email", "viewer", false},
		{"bad entity", "page", uuid.NewString(), "user@example.com", "viewer", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			payload := []byte(`{"entity":"` + tc.entity + `","entityId":"` + tc.id + `","email":"` + tc.email + `","role":"` + tc.role + `"}`)
			got, err := validateInput(payload)
			if (err == nil) != tc.valid {
				t.Fatalf("unexpected validation: %v", err)
			}
			if err == nil && tc.role == "commenter" && got.Role != "commentor" {
				t.Fatal("relation alias not normalized")
			}
		})
	}
}
func TestLegacyLinksOnlyRedirect(t *testing.T) {
	for _, decision := range []string{"accept", "reject"} {
		response := httptest.NewRecorder()
		legacyInviteLink(decision)(response, httptest.NewRequest("GET", "/user/"+decision+"?token=test", nil))
		if response.Code != 303 || response.Header().Get("Location") != "/invite/action?decision="+decision+"&token=test" {
			t.Fatalf("unexpected redirect: %v", response.Result())
		}
	}
}
