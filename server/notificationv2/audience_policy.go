package notificationv2

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/mail"
	"strings"
	"time"
)

// NormalizeDestination is shared with future suppression writers and senders.
// Email local-part case is preserved, matching definition input normalization.
func NormalizeDestination(mode, destination string) (string, error) {
	destination = strings.TrimSpace(destination)
	switch mode {
	case "email":
		a, err := mail.ParseAddress(destination)
		if err != nil || a.Address != destination || len(destination) > 254 || strings.ContainsAny(destination, "\r\n") {
			return "", fmt.Errorf("invalid email destination")
		}
		at := strings.LastIndex(destination, "@")
		if at < 1 {
			return "", fmt.Errorf("invalid email destination")
		}
		return destination[:at+1] + strings.ToLower(destination[at+1:]), nil
	case "in_app":
		return destination, nil
	default:
		return "", fmt.Errorf("unsupported notification mode")
	}
}

// DestinationHash requires a stable secret shared by expansion, suppression
// writers and delivery workers. Rotation needs an explicit data migration.
func DestinationHash(key []byte, mode, destination string) (string, error) {
	if len(key) < 32 {
		return "", fmt.Errorf("suppression hash key must contain at least 32 bytes")
	}
	normalized, err := NormalizeDestination(mode, destination)
	if err != nil {
		return "", err
	}
	h := hmac.New(sha256.New, key)
	h.Write([]byte(mode + ":" + normalized))
	return "v1:" + hex.EncodeToString(h.Sum(nil)), nil
}

type quietWindow struct {
	enabled    bool
	timezone   string
	start, end time.Duration
}

// Quiet-window boundaries have wall-clock meaning, including DST gaps/folds.
// Walk real instants to the next local boundary instead of trusting time.Date's
// unspecified choice of offset for ambiguous or nonexistent local times.
func nextAllowed(at time.Time, q quietWindow) (time.Time, error) {
	if !q.enabled {
		return at, nil
	}
	if q.start < 0 || q.end < 0 || q.start >= 24*time.Hour || q.end >= 24*time.Hour || q.start == q.end {
		return time.Time{}, fmt.Errorf("invalid quiet-hour window")
	}
	loc, err := time.LoadLocation(q.timezone)
	if err != nil || q.timezone == "" || q.timezone == "Local" {
		return time.Time{}, fmt.Errorf("invalid quiet-hour timezone")
	}
	candidate := at
	// Three real days cover a skipped local date as well as ordinary DST changes.
	deadline := at.Add(72 * time.Hour)
	for !candidate.After(deadline) {
		local := candidate.In(loc)
		wall := time.Duration(local.Hour())*time.Hour + time.Duration(local.Minute())*time.Minute + time.Duration(local.Second())*time.Second + time.Duration(local.Nanosecond())
		inside := wall >= q.start && wall < q.end
		if q.start > q.end {
			inside = wall >= q.start || wall < q.end
		}
		if !inside {
			return candidate, nil
		}
		step := time.Minute - time.Duration(local.Second())*time.Second - time.Duration(local.Nanosecond())
		// Preserve sub-minute boundaries supported by PostgreSQL's time type.
		delta := q.end - wall
		if delta > 0 && delta < step {
			step = delta
		}
		candidate = candidate.Add(step)
	}
	return time.Time{}, fmt.Errorf("unable to resolve quiet-hour end")
}
