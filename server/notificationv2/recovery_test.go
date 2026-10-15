package notificationv2

import (
	"context"
	"testing"
	"time"
)

func TestRecoveryConfiguration(t *testing.T) {
	for _, name := range []string{"ENABLED", "POLL_INTERVAL", "TRANSACTION_TIMEOUT", "BATCH_SIZE"} {
		t.Setenv("NOTIFICATION_V2_RECOVERY_"+name, "")
	}
	c, err := LoadRecoveryConfig()
	if err != nil || c.Enabled || c.BatchSize != 100 {
		t.Fatalf("defaults: %+v %v", c, err)
	}
	for _, tc := range []struct{ name, value string }{{"ENABLED", "maybe"}, {"POLL_INTERVAL", "0s"}, {"TRANSACTION_TIMEOUT", "2h"}, {"BATCH_SIZE", "0"}, {"BATCH_SIZE", "invalid"}} {
		t.Run(tc.name+tc.value, func(t *testing.T) {
			t.Setenv("NOTIFICATION_V2_RECOVERY_"+tc.name, tc.value)
			if _, err := LoadRecoveryConfig(); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
	w := &RecoveryWorker{config: DefaultRecoveryConfig()}
	select {
	case <-w.Start(context.Background()):
	case <-time.After(time.Second):
		t.Fatal("disabled worker started")
	}
}
