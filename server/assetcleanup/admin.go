package assetcleanup

import (
	"net/http"
	"strconv"

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
	r.Post("/run/mark", a.runMark)
	r.Post("/run/purge", a.runPurge)
	r.Post("/reindex/published-all", a.reindexPublishedAll)
	r.Post("/reindex/comments", a.reindexComments)
	r.Post("/reindex/classify-drafts", a.classifyDrafts)
	r.Post("/reindex/pages/{pageId}", a.reindexPage)
	r.Post("/reindex/docs/{docId}", a.reindexDoc)
	r.Post("/restore/attachments/{assetId}", a.restoreAttachment)
	r.Post("/restore/images/{assetId}", a.restoreImage)
	return r
}

func (a *AdminController) ensureEnabled(w http.ResponseWriter, r *http.Request) bool {
	if !a.config.AdminEnabled || a.config.AdminToken == "" {
		core.SendFailedReponse(w, r, http.StatusNotFound, "asset cleanup admin routes are disabled")
		return false
	}
	if r.Header.Get("X-Asset-Cleanup-Admin-Token") != a.config.AdminToken {
		core.SendFailedReponse(w, r, http.StatusForbidden, "asset cleanup admin access denied")
		return false
	}
	return true
}

func (a *AdminController) status(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, a.worker.Status())
}

func (a *AdminController) runMark(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	result, err := a.worker.RunMarkOnce(r.Context())
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "asset cleanup mark run failed")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func (a *AdminController) runPurge(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	result, err := a.worker.RunPurgeOnce(r.Context())
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "asset cleanup purge run failed")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func (a *AdminController) reindexPublishedAll(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	result, err := BackfillAllPublishedDocs(r.Context())
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "published doc reindex failed")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func (a *AdminController) reindexComments(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	result, err := BackfillCommentReplyReferences(r.Context())
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "comment reply reindex failed")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func (a *AdminController) classifyDrafts(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	result, err := ClassifyDraftCoverage(r.Context())
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "draft coverage classification failed")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}

func (a *AdminController) reindexPage(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	pageID, err := strconv.ParseInt(chi.URLParam(r, "pageId"), 10, 64)
	if err != nil || pageID < 1 {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "invalid page id")
		return
	}
	count, err := ReindexPublishedPage(r.Context(), pageID)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "page reindex failed")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, map[string]any{
		"pageId": pageID,
		"docs":   count,
	})
}

func (a *AdminController) reindexDoc(w http.ResponseWriter, r *http.Request) {
	if !a.ensureEnabled(w, r) {
		return
	}
	docID, err := strconv.ParseInt(chi.URLParam(r, "docId"), 10, 64)
	if err != nil || docID < 1 {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "invalid doc id")
		return
	}
	if err := ReindexPublishedDoc(r.Context(), docID); err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "doc reindex failed")
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, map[string]any{"docId": docID})
}

func (a *AdminController) restoreAttachment(w http.ResponseWriter, r *http.Request) {
	a.restoreAsset(w, r, "attachment", chi.URLParam(r, "assetId"))
}

func (a *AdminController) restoreImage(w http.ResponseWriter, r *http.Request) {
	a.restoreAsset(w, r, "image", chi.URLParam(r, "assetId"))
}

func (a *AdminController) restoreAsset(w http.ResponseWriter, r *http.Request, assetType string, assetID string) {
	if !a.ensureEnabled(w, r) {
		return
	}
	result, err := RestoreAsset(r.Context(), assetType, assetID)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}
