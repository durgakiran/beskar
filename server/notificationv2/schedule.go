package notificationv2

import (
	"fmt"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/robfig/cron/v3"
)

// validateSchedule also computes the next scheduler cursor. Workers materialize
// occurrences separately; accepting a definition never invokes a provider.
func nextRun(d *DefinitionInput, now time.Time) (*time.Time, error) {
	loc, err := time.LoadLocation(d.Timezone)
	if err != nil || d.Timezone == "" || d.Timezone == "Local" {
		return nil, invalid("timezone must be an IANA timezone")
	}
	if d.StartsAt != nil && d.EndsAt != nil && !d.EndsAt.After(*d.StartsAt) {
		return nil, invalid("ends_at must follow starts_at")
	}
	switch d.ScheduleKind {
	case "immediate":
		if d.ScheduledAt != nil || d.CronExpression != nil || d.StartsAt != nil || d.EndsAt != nil {
			return nil, invalid("immediate schedules cannot have scheduling fields")
		}
		t := now.UTC()
		return &t, nil
	case "once":
		if d.ScheduledAt == nil || d.CronExpression != nil || d.StartsAt != nil || d.EndsAt != nil {
			return nil, invalid("once requires scheduled_at only")
		}
		if !d.ScheduledAt.After(now) {
			return nil, invalid("scheduled_at must be in the future")
		}
		t := d.ScheduledAt.UTC()
		return &t, nil
	case "cron":
		if d.ScheduledAt != nil || d.CronExpression == nil {
			return nil, invalid("cron requires cron_expression and no scheduled_at")
		}
		fields := strings.Fields(*d.CronExpression)
		if len(fields) != 5 {
			return nil, invalid("cron_expression must have five fields")
		}
		if fields[2] != "*" && fields[4] != "*" {
			return nil, invalid("day of month and weekday cannot both be restricted")
		}
		// Do not allow embedded timezone overrides or descriptor schedules.
		schedule, err := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow).Parse(strings.Join(fields, " "))
		if err != nil {
			return nil, invalid("invalid cron_expression")
		}
		spec := schedule.(*cron.SpecSchedule)
		spec.Location = loc
		after := now
		if d.StartsAt != nil && d.StartsAt.After(now) {
			after = d.StartsAt.Add(-time.Nanosecond)
		}
		if d.EndsAt != nil && !after.Before(*d.EndsAt) {
			return nil, nil
		}
		for i := 0; i < 1500; i++ {
			candidate := spec.Next(after)
			if candidate.IsZero() {
				return nil, invalid("cron has no occurrence within the evaluator's five-year search window")
			}
			if d.EndsAt != nil && !candidate.Before(*d.EndsAt) {
				return nil, nil
			}
			if !secondFold(candidate, loc) {
				t := candidate.UTC()
				return &t, nil
			}
			after = candidate
		}
		return nil, fmt.Errorf("unable to resolve cron daylight-saving transition")
	default:
		return nil, invalid("schedule_kind must be immediate, once, or cron")
	}
}

// A repeated wall-clock minute runs only on its first occurrence. Derive the
// preceding UTC offset so this works for non-hour transitions as well.
func secondFold(t time.Time, loc *time.Location) bool {
	local := t.In(loc)
	_, offset := local.Zone()
	for _, delta := range []time.Duration{time.Hour, 3 * time.Hour, 24 * time.Hour, 48 * time.Hour} {
		_, previousOffset := t.Add(-delta).In(loc).Zone()
		if previousOffset <= offset {
			continue
		}
		earlier := t.Add(-time.Duration(previousOffset-offset) * time.Second).In(loc)
		if earlier.Year() == local.Year() && earlier.YearDay() == local.YearDay() && earlier.Hour() == local.Hour() && earlier.Minute() == local.Minute() {
			return true
		}
	}
	return false
}
