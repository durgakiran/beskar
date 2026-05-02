package quota

import "testing"

func TestDocumentHistoryRetentionDaysFromPlanLimit(t *testing.T) {
	limits := map[string]PlanLimit{
		metricDocumentHistoryRetention: {
			MetricKey:  metricDocumentHistoryRetention,
			LimitValue: 30,
			LimitUnit:  "days",
		},
	}

	got := documentHistoryRetentionDays(limits)
	if got != 30 {
		t.Fatalf("expected retention 30, got %d", got)
	}
}

func TestDocumentHistoryRetentionDaysFallsBackToConfig(t *testing.T) {
	t.Setenv("DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS", "14")

	got := documentHistoryRetentionDays(nil)
	if got != 14 {
		t.Fatalf("expected fallback retention 14, got %d", got)
	}
}

func TestDocumentHistoryRetentionDaysRejectsInvalidLimit(t *testing.T) {
	t.Setenv("DOCUMENT_VERSION_DEFAULT_RETENTION_DAYS", "7")
	limits := map[string]PlanLimit{
		metricDocumentHistoryRetention: {
			MetricKey:  metricDocumentHistoryRetention,
			LimitValue: 30,
			LimitUnit:  "months",
		},
	}

	got := documentHistoryRetentionDays(limits)
	if got != 7 {
		t.Fatalf("expected fallback retention 7, got %d", got)
	}
}
