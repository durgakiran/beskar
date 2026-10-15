package notificationv2

import (
	"testing"
	"time"
)

func stamp(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}
func ptr[T any](v T) *T { return &v }

func TestOccurrencePlan(t *testing.T) {
	now := stamp("2026-10-03T09:05:30Z")
	for _, tc := range []struct {
		name, kind, policy, cron, due string
		ttl                           *int
		wantSlot, wantNext            string
		expired, misfired             bool
	}{
		{name: "delayed immediate is not a misfire", kind: "immediate", policy: "skip", due: "2026-10-03T08:00:00Z", wantSlot: "2026-10-03T08:00:00Z"},
		{name: "delayed once", kind: "once", policy: "skip", due: "2026-10-03T08:00:00Z", wantSlot: "2026-10-03T08:00:00Z"},
		{name: "expired once", kind: "once", policy: "fire_once", due: "2026-10-03T08:00:00Z", ttl: ptr(60), expired: true},
		{name: "normal cron", kind: "cron", policy: "skip", cron: "* * * * *", due: "2026-10-03T09:05:00Z", wantSlot: "2026-10-03T09:05:00Z", wantNext: "2026-10-03T09:06:00Z"},
		{name: "skip outage", kind: "cron", policy: "skip", cron: "* * * * *", due: "2026-10-03T08:00:00Z", wantNext: "2026-10-03T09:06:00Z", misfired: true},
		{name: "fire latest once", kind: "cron", policy: "fire_once", cron: "* * * * *", due: "2026-10-03T08:00:00Z", wantSlot: "2026-10-03T09:05:00Z", wantNext: "2026-10-03T09:06:00Z", misfired: true},
		{name: "latest expired", kind: "cron", policy: "fire_once", cron: "0 * * * *", due: "2026-10-03T07:00:00Z", ttl: ptr(60), wantNext: "2026-10-03T10:00:00Z", expired: true, misfired: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := Definition{DefinitionInput: inputFixture(), NextRunAt: ptr(stamp(tc.due))}
			d.ScheduleKind = tc.kind
			d.MisfirePolicy = tc.policy
			d.DeliveryTTLSeconds = tc.ttl
			if tc.kind == "cron" {
				d.CronExpression = &tc.cron
			}
			p, err := planOccurrence(d, now, time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			checkTime(t, p.scheduled, tc.wantSlot)
			checkTime(t, p.next, tc.wantNext)
			if p.expired != tc.expired || p.misfired != tc.misfired {
				t.Fatalf("unexpected flags: %+v", p)
			}
			if tc.ttl != nil && p.scheduled != nil && !p.expires.Equal(p.scheduled.Add(time.Duration(*tc.ttl)*time.Second)) {
				t.Fatal("TTL origin changed")
			}
		})
	}
}
func checkTime(t *testing.T, got *time.Time, want string) {
	t.Helper()
	if want == "" {
		if got != nil {
			t.Fatalf("expected nil, got %s", got)
		}
		return
	}
	if got == nil || !got.Equal(stamp(want)) {
		t.Fatalf("got %v, want %s", got, want)
	}
}

func TestLatestMissedCron(t *testing.T) {
	for _, tc := range []struct{ name, cron, zone, due, now, end, want string }{
		{"years of minute backlog", "* * * * *", "UTC", "2020-01-01T00:00:00Z", "2026-10-03T09:05:30Z", "", "2026-10-03T09:05:00Z"},
		{"end exclusive", "0 9 * * *", "UTC", "2026-10-01T09:00:00Z", "2026-10-10T10:00:00Z", "2026-10-03T09:00:00Z", "2026-10-02T09:00:00Z"},
		{"leap day", "0 9 29 2 *", "UTC", "2024-02-29T09:00:00Z", "2026-10-03T09:05:30Z", "", "2024-02-29T09:00:00Z"},
		{"fall fold first only", "30 1 * * *", "America/New_York", "2026-10-31T05:30:00Z", "2026-11-01T06:45:00Z", "", "2026-11-01T05:30:00Z"},
		{"spring gap skipped", "30 2 * * *", "America/New_York", "2026-03-07T07:30:00Z", "2026-03-08T10:00:00Z", "", "2026-03-07T07:30:00Z"},
		{"non UTC", "0 9 * * *", "Asia/Kolkata", "2026-10-01T03:30:00Z", "2026-10-03T09:05:30Z", "", "2026-10-03T03:30:00Z"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := Definition{DefinitionInput: inputFixture(), NextRunAt: ptr(stamp(tc.due))}
			d.ScheduleKind = "cron"
			d.CronExpression = &tc.cron
			d.Timezone = tc.zone
			d.MisfirePolicy = "fire_once"
			if tc.end != "" {
				d.EndsAt = ptr(stamp(tc.end))
			}
			p, err := planOccurrence(d, stamp(tc.now), time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			checkTime(t, p.scheduled, tc.want)
			if tc.end != "" && p.next != nil {
				t.Fatal("ended schedule not completed")
			}
		})
	}
}

func TestSchedulerConfiguration(t *testing.T) {
	names := []string{"NOTIFICATION_V2_SCHEDULER_ENABLED", "NOTIFICATION_V2_SCHEDULER_POLL_INTERVAL", "NOTIFICATION_V2_SCHEDULER_BATCH_SIZE", "NOTIFICATION_V2_SCHEDULER_MISFIRE_GRACE", "NOTIFICATION_V2_SCHEDULER_TRANSACTION_TIMEOUT"}
	for _, name := range names {
		t.Setenv(name, "")
	}
	c, err := LoadSchedulerConfig()
	if err != nil || c.Enabled || c.MisfireGrace != time.Minute {
		t.Fatalf("bad defaults %+v %v", c, err)
	}
	for _, entry := range []struct{ name, value string }{{names[0], "yesplease"}, {names[1], "0s"}, {names[2], "0"}, {names[3], "-1s"}, {names[4], "2h"}} {
		t.Run(entry.name, func(t *testing.T) {
			t.Setenv(entry.name, entry.value)
			if _, err := LoadSchedulerConfig(); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
}
