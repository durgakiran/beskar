package notificationv2

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

func inputFixture() DefinitionInput {
	return DefinitionInput{NotificationTopicID: 1, NotificationTypeID: 1, ModeID: 1, TemplateID: uuid.New(), TemplateVersion: 1, MessageDetails: json.RawMessage(`{"name":"Alex"}`), Priority: 50, ScheduleKind: "immediate", Timezone: "UTC", MisfirePolicy: "skip", TargetUsers: []uuid.UUID{uuid.New()}}
}
func TestNormalizationAndPatch(t *testing.T) {
	d := inputFixture()
	id := d.TargetUsers[0]
	d.TargetUsers = append(d.TargetUsers, id)
	if err := normalize(&d); err != nil {
		t.Fatal(err)
	}
	hash := requestHash(d)
	d.TargetUsers = append(d.TargetUsers, id)
	if err := normalize(&d); err != nil {
		t.Fatal(err)
	}
	if hash != requestHash(d) {
		t.Fatal("deduplication changed request identity")
	}
	if _, err := mergeInput(d, map[string]json.RawMessage{"source_service": json.RawMessage(`"other"`)}); err == nil {
		t.Fatal("accepted ownership injection")
	}
	if _, err := mergeInput(d, map[string]json.RawMessage{"priority": json.RawMessage(`null`)}); err == nil {
		t.Fatal("accepted null priority")
	}
	if _, err := mergeInput(d, map[string]json.RawMessage{"target_users": json.RawMessage(`[]`)}); err == nil {
		t.Fatal("accepted empty audience")
	}
	patched, err := mergeInput(d, map[string]json.RawMessage{"message_details": json.RawMessage(`{"new":1}`)})
	if err != nil {
		t.Fatal(err)
	}
	if string(patched.MessageDetails) != `{"new":1}` {
		t.Fatal("message variables must replace, not merge")
	}
	d.TargetEmails = []string{"User@EXAMPLE.COM", "User@example.com"}
	if err := normalize(&d); err != nil {
		t.Fatal(err)
	}
	if len(d.TargetEmails) != 1 || d.TargetEmails[0] != "User@example.com" {
		t.Fatal("email normalization changed local identity")
	}
}
func TestSchemaValidation(t *testing.T) {
	schema := []byte(`{"type":"object","required":["name"],"properties":{"name":{"type":"string"}},"additionalProperties":false}`)
	if err := validateVariables(schema, []byte(`{"name":"Alex"}`)); err != nil {
		t.Fatal(err)
	}
	if err := validateVariables(schema, []byte(`{"name":3}`)); err == nil {
		t.Fatal("accepted wrong variable type")
	}
	if err := validateVariables([]byte(`{"$ref":"http://127.0.0.1/private"}`), []byte(`{}`)); err == nil {
		t.Fatal("accepted external schema reference")
	}
}

func TestInternalInputRejectsTrailingJSON(t *testing.T) {
	for _, raw := range []string{`{} {}`, `{} trailing`} {
		d := inputFixture()
		d.MessageDetails = json.RawMessage(raw)
		if err := normalize(&d); err == nil {
			t.Fatalf("accepted trailing JSON: %s", raw)
		}
	}
}
func TestSchedules(t *testing.T) {
	parse := func(v string) time.Time {
		t.Helper()
		x, e := time.Parse(time.RFC3339, v)
		if e != nil {
			t.Fatal(e)
		}
		return x
	}
	tests := []struct{ expr, zone, now, want string }{
		{"30 2 * * *", "America/New_York", "2026-03-07T08:00:00Z", "2026-03-09T06:30:00Z"},
		{"30 1 * * *", "America/New_York", "2026-11-01T05:45:00Z", "2026-11-02T06:30:00Z"},
		{"30 1 * * *", "America/New_York", "2026-11-01T04:00:00Z", "2026-11-01T05:30:00Z"},
		{"0 9 * * *", "Asia/Kolkata", "2026-10-03T00:00:00Z", "2026-10-03T03:30:00Z"},
	}
	for _, tt := range tests {
		t.Run(tt.now+tt.zone, func(t *testing.T) {
			d := inputFixture()
			d.ScheduleKind = "cron"
			d.CronExpression = &tt.expr
			d.Timezone = tt.zone
			n, e := nextRun(&d, parse(tt.now))
			if e != nil {
				t.Fatal(e)
			}
			if n == nil || !n.Equal(parse(tt.want)) {
				t.Fatalf("got %v want %s", n, tt.want)
			}
		})
	}
	d := inputFixture()
	d.ScheduleKind = "cron"
	expr := "0 9 1 * MON"
	d.CronExpression = &expr
	if _, err := nextRun(&d, parse("2026-10-03T00:00:00Z")); err == nil {
		t.Fatal("accepted ambiguous day restriction")
	}
	expr = "0 9 * * *"
	end := parse("2026-10-03T09:00:00Z")
	d.EndsAt = &end
	if n, e := nextRun(&d, end.Add(-time.Minute)); e != nil || n != nil {
		t.Fatalf("exclusive end: %v %v", n, e)
	}
	d.EndsAt = nil
	d.StartsAt = &end
	if n, e := nextRun(&d, end.Add(-time.Hour)); e != nil || n == nil || !n.Equal(end) {
		t.Fatalf("inclusive start: %v %v", n, e)
	}
}
