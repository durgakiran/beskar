package quota

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type AdminController struct {
	config Config
}

func NewAdminController(config Config) *AdminController {
	return &AdminController{config: config}
}

func (a *AdminController) Router() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/accounts/{accountId}/usage", a.getAccountUsage)
	r.Post("/spaces/{spaceId}/reconcile", a.reconcileSpace)
	r.Post("/spaces/reconcile-all", a.reconcileAllSpaces)
	r.Get("/spaces/problems", a.listSpaceProblems)
	r.Post("/reservations/clear-stale", a.clearStaleReservations)
	return r
}

func (a *AdminController) ensureEnabled(w http.ResponseWriter, r *http.Request) bool {
	if !a.config.AdminEnabled || a.config.AdminToken == "" {
		core.SendFailedReponse(w, r, http.StatusNotFound, "quota admin routes are disabled")
		return false
	}
	if r.Header.Get("X-Quota-Admin-Token") != a.config.AdminToken {
		core.SendFailedReponse(w, r, http.StatusForbidden, "quota admin access denied")
		return false
	}
	return true
}

func (a *AdminController) getAccountUsage(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	accountID, err := uuid.Parse(chi.URLParam(r, "accountId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "invalid account id")
		return
	}
	summary, err := GetAccountUsageSummaryByAccountID(r.Context(), accountID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			core.SendFailedReponse(w, r, http.StatusNotFound, "quota account not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to load quota account usage")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, summary)
}

func (a *AdminController) reconcileSpace(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "invalid space id")
		return
	}
	result, err := ReconcileSpace(r.Context(), spaceID, "admin_api")
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			core.SendFailedReponse(w, r, http.StatusNotFound, "quota space not found")
			return
		}
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to reconcile quota space")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func (a *AdminController) reconcileAllSpaces(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	result, err := ReconcileAllSpaces(r.Context(), "admin_api")
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to reconcile quota spaces")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func (a *AdminController) listSpaceProblems(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	staleMinutes := 60
	if parsed, err := strconv.Atoi(r.URL.Query().Get("staleMinutes")); err == nil && parsed > 0 {
		staleMinutes = parsed
	}
	problems, err := ListSpaceUsageProblems(r.Context(), staleMinutes)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to list quota problems")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, problems)
}

func (a *AdminController) clearStaleReservations(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	olderThanMinutes := 60
	if parsed, err := strconv.Atoi(r.URL.Query().Get("olderThanMinutes")); err == nil && parsed > 0 {
		olderThanMinutes = parsed
	}
	result, err := ClearStaleReservations(r.Context(), olderThanMinutes, "admin_api")
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "unable to clear stale quota reservations")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}
