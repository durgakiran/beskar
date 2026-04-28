package quota

import (
	"context"
	"time"

	"go.uber.org/zap"
)

type Reconciler struct {
	config Config
}

func NewReconciler(config Config) *Reconciler {
	return &Reconciler{config: config}
}

func (r *Reconciler) Start(ctx context.Context) {
	if !r.config.ReconciliationEnabled {
		return
	}
	ticker := time.NewTicker(r.config.ReconciliationInterval)
	defer ticker.Stop()

	r.runOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.runOnce(ctx)
		}
	}
}

func (r *Reconciler) runOnce(ctx context.Context) {
	result, err := ReconcileAllSpaces(ctx, "background_job")
	if err != nil {
		logger().Error("quota reconciliation failed", zap.Error(err))
		return
	}
	logger().Info("quota reconciliation completed",
		zap.Int("space_count", result.SpaceCount),
		zap.Int("drifted_space_count", result.DriftedSpaceCount),
		zap.Int64("total_drift_bytes", result.TotalDriftBytes),
	)
}
