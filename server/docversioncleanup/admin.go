package docversioncleanup

import (
	"errors"
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
)

type AdminController struct {
	config Config
	worker *Worker
}

func NewAdminController(config Config, worker *Worker) *AdminController {
	return &AdminController{
		config: config,
		worker: worker,
	}
}

func (a *AdminController) Router() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/status", a.status)
	r.Post("/dry-run", a.runDryRun)
	r.Post("/run", a.runCleanup)
	return r
}

func (a *AdminController) ensureEnabled(w http.ResponseWriter, r *http.Request) bool {
	if !a.config.AdminEnabled || a.config.AdminToken == "" {
		core.SendFailedReponse(w, r, http.StatusNotFound, "document version cleanup admin routes are disabled")
		return false
	}
	if r.Header.Get("X-Document-Version-Cleanup-Admin-Token") != a.config.AdminToken {
		core.SendFailedReponse(w, r, http.StatusForbidden, "document version cleanup admin access denied")
		return false
	}
	return true
}

func (a *AdminController) status(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	preflight, err := CheckPublishedDocCoveragePreflight(r.Context())
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "document version cleanup status failed")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, map[string]any{
		"config": map[string]any{
			"enabled":              a.config.Enabled,
			"dryRun":               a.config.DryRun,
			"defaultRetentionDays": a.config.DefaultRetentionDays,
			"batchSize":            a.config.BatchSize,
			"maxDocsPerRun":        a.config.MaxDocsPerRun,
			"interval":             a.config.Interval.String(),
		},
		"preflight": preflight,
		"stats":     a.worker.Status(),
	})
}

func (a *AdminController) runDryRun(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	result, err := a.worker.RunDryRunOnce(r.Context())
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "document version cleanup dry run failed")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func (a *AdminController) runCleanup(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	result, err := a.worker.RunCleanupOnce(r.Context())
	if errors.Is(err, ErrPublishedDocCoveragePreflightFailed) {
		core.SendSuccessResponse(w, r, http.StatusOK, result)
		return
	}
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "document version cleanup run failed")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}
