package notificationv2

import (
	"testing"
	"time"
)

func TestAudienceQuietHours(t *testing.T) {
	for _, tc := range []struct {
		name, zone, at, want string
		start, end           time.Duration
	}{
		{"outside", "UTC", "2026-10-03T12:00:00Z", "2026-10-03T12:00:00Z", 22 * time.Hour, 7 * time.Hour},
		{"overnight", "UTC", "2026-10-03T23:00:00Z", "2026-10-04T07:00:00Z", 22 * time.Hour, 7 * time.Hour},
		{"inclusive start", "UTC", "2026-10-03T22:00:00Z", "2026-10-04T07:00:00Z", 22 * time.Hour, 7 * time.Hour},
		{"exclusive end", "UTC", "2026-10-03T07:00:00Z", "2026-10-03T07:00:00Z", 22 * time.Hour, 7 * time.Hour},
		{"timezone", "Asia/Kolkata", "2026-10-03T20:00:00Z", "2026-10-04T01:30:00Z", 22 * time.Hour, 7 * time.Hour},
		{"spring gap end", "America/New_York", "2026-03-08T06:00:00Z", "2026-03-08T07:00:00Z", time.Hour, 150 * time.Minute},
		{"second fold", "America/New_York", "2026-11-01T06:10:00Z", "2026-11-01T06:30:00Z", time.Hour, 90 * time.Minute},
		{"seconds", "UTC", "2026-10-03T12:00:15Z", "2026-10-03T12:00:30Z", 12 * time.Hour, 12*time.Hour + 30*time.Second},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := nextAllowed(stamp(tc.at), quietWindow{true, tc.zone, tc.start, tc.end})
			if err != nil || !got.Equal(stamp(tc.want)) {
				t.Fatalf("got %v, %v; want %s", got, err, tc.want)
			}
		})
	}
	if _, err := nextAllowed(time.Now(), quietWindow{true, "invalid", 0, time.Hour}); err == nil {
		t.Fatal("invalid timezone accepted")
	}
}
func TestDestinationHash(t *testing.T) {
	key := []byte("01234567890123456789012345678901")
	a, err := DestinationHash(key, "email", "User@EXAMPLE.COM")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := DestinationHash(key, "email", "User@example.com")
	if a != b {
		t.Fatal("domain normalization differs")
	}
	c, _ := DestinationHash(key, "email", "user@example.com")
	if a == c {
		t.Fatal("local part case erased")
	}
	if _, err := DestinationHash(nil, "email", "User@example.com"); err == nil {
		t.Fatal("empty key accepted")
	}
}

func TestAudienceConfiguration(t *testing.T) {
	c := DefaultAudienceConfig()
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}
	c.Enabled = true
	if err := c.validate(); err == nil {
		t.Fatal("enabled worker accepted missing hash key")
	}
	c.HashKey = []byte("01234567890123456789012345678901")
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}
	c.LeaseDuration = c.TransactionTimeout
	if err := c.validate(); err == nil {
		t.Fatal("lease without timeout margin accepted")
	}
}
