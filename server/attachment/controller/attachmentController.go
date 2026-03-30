package controller

import (
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode"

	services "github.com/durgakiran/beskar/attachment/services"
	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/google/uuid"
)

type uploadResponseData struct {
	AttachmentID string `json:"attachmentId"`
	URL          string `json:"url"`
	FileName     string `json:"fileName"`
	FileSize     int64  `json:"fileSize"`
	MimeType     string `json:"mimeType"`
}

func uploadAttachment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "unauthorized", ""))
		return
	}

	pageIDStr := r.FormValue("pageId")
	if pageIDStr == "" {
		render.Status(r, http.StatusBadRequest)
		render.Render(w, r, core.NewFailedResponse(400, core.FAILURE, "pageId is required", ""))
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil || pageID < 1 {
		render.Status(r, http.StatusBadRequest)
		render.Render(w, r, core.NewFailedResponse(400, core.FAILURE, "invalid pageId", ""))
		return
	}

	ownerID, ok := beskarUserUUID(user)
	if !ok {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "unauthorized", ""))
		return
	}
	// Same as editor getDocumentToEdit: must be able to edit the page (editor role or higher).
	if !core.ValidateUserPagePermission(pageIDStr, ownerID, "edit") {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "no permission to upload for this page", ""))
		return
	}

	maxForm := int64(services.MaxAttachmentBytes) + (1 << 20)
	if err := r.ParseMultipartForm(maxForm); err != nil {
		render.Status(r, http.StatusRequestEntityTooLarge)
		render.Render(w, r, core.NewFailedResponse(413, core.FAILURE, "request too large", ""))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		render.Status(r, http.StatusBadRequest)
		render.Render(w, r, core.NewFailedResponse(400, core.FAILURE, "file is required", ""))
		return
	}
	defer file.Close()

	if header.Size > 0 && header.Size > int64(services.MaxAttachmentBytes) {
		render.Status(r, http.StatusRequestEntityTooLarge)
		render.Render(w, r, core.NewFailedResponse(413, core.FAILURE, "file too large", ""))
		return
	}

	data, err := io.ReadAll(io.LimitReader(file, int64(services.MaxAttachmentBytes)+1))
	if err != nil {
		core.Logger.Error("attachment upload read: " + err.Error())
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(500, core.FAILURE, "failed to read file", ""))
		return
	}
	if len(data) > services.MaxAttachmentBytes {
		render.Status(r, http.StatusRequestEntityTooLarge)
		render.Render(w, r, core.NewFailedResponse(413, core.FAILURE, "file too large", ""))
		return
	}

	sniffLen := 512
	if len(data) < sniffLen {
		sniffLen = len(data)
	}
	detected := http.DetectContentType(data[:sniffLen])
	// Normalize common cases (browser may send octet-stream for PDF)
	mimeType := detected
	if header.Header.Get("Content-Type") != "" {
		ct := header.Header.Get("Content-Type")
		if i := strings.Index(ct, ";"); i >= 0 {
			ct = strings.TrimSpace(ct[:i])
		}
		// Prefer declared type when sniff says octet-stream
		if detected == "application/octet-stream" && ct != "" && ct != "application/octet-stream" {
			mimeType = ct
		}
	}

	if !services.MimeAllowed(mimeType) {
		render.Status(r, http.StatusUnsupportedMediaType)
		render.Render(w, r, core.NewFailedResponse(415, core.FAILURE, "mime type not allowed", mimeType))
		return
	}

	origName := header.Filename
	if origName == "" {
		origName = "file"
	}

	rec, err := services.SaveAttachment(ctx, pageID, user.Id, origName, mimeType, data)
	if err != nil {
		core.Logger.Error("attachment save: " + err.Error())
		msg := err.Error()
		if strings.Contains(msg, "mime type not allowed") {
			render.Status(r, http.StatusUnsupportedMediaType)
			render.Render(w, r, core.NewFailedResponse(415, core.FAILURE, msg, ""))
			return
		}
		if strings.Contains(msg, "too large") {
			render.Status(r, http.StatusRequestEntityTooLarge)
			render.Render(w, r, core.NewFailedResponse(413, core.FAILURE, msg, ""))
			return
		}
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(500, core.FAILURE, "upload failed", ""))
		return
	}

	out := uploadResponseData{
		AttachmentID: rec.ID,
		URL:          "/api/v1/attachments/" + rec.ID,
		FileName:     rec.FileName,
		FileSize:     rec.FileSize,
		MimeType:     rec.MimeType,
	}
	render.Status(r, http.StatusCreated)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, out))
}

func downloadAttachment(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "unauthorized", ""))
		return
	}

	ownerID, ok := beskarUserUUID(user)
	if !ok {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "unauthorized", ""))
		return
	}

	id := chi.URLParam(r, "attachmentId")
	rec, err := services.GetAttachmentMeta(ctx, id)
	if err != nil {
		core.Logger.Error("attachment meta: " + err.Error())
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(500, core.FAILURE, "failed to load attachment", ""))
		return
	}
	if rec == nil {
		render.Status(r, http.StatusNotFound)
		render.Render(w, r, core.NewFailedResponse(404, core.FAILURE, "not found", ""))
		return
	}

	// Same as editor getDocumentToView: viewer (or higher) on the page may download.
	pageIDStr := strconv.FormatInt(rec.PageID, 10)
	if !core.ValidateUserPagePermission(pageIDStr, ownerID, "view") {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "no permission to download this attachment", ""))
		return
	}

	data, err := services.ReadAttachmentBytes(rec.StoragePath)
	if err != nil {
		core.Logger.Error("attachment read: " + err.Error())
		render.Status(r, http.StatusNotFound)
		render.Render(w, r, core.NewFailedResponse(404, core.FAILURE, "file missing", ""))
		return
	}

	w.Header().Set("Content-Disposition", contentDispositionFilename(rec.FileName))
	w.Header().Set("Content-Type", rec.MimeType)
	w.Header().Set("Content-Length", strconv.FormatInt(rec.FileSize, 10))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// beskarUserUUID returns the app user id used by Permify (user.AId).
func beskarUserUUID(user core.UserInfo) (uuid.UUID, bool) {
	if user.AId == "" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(user.AId)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func contentDispositionFilename(name string) string {
	safe := strings.Map(func(r rune) rune {
		if r < 32 || r > 126 {
			return '_'
		}
		if r == '"' || r == '\\' || r == '/' {
			return '_'
		}
		if unicode.IsControl(r) {
			return '_'
		}
		return r
	}, name)
	if strings.TrimSpace(safe) == "" {
		safe = "download"
	}
	return `attachment; filename="` + safe + `"`
}

// Router exposes attachment HTTP routes (mount under /api/v1/attachments with auth middleware).
func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Post("/upload", uploadAttachment)
	r.Get("/{attachmentId}", downloadAttachment)
	return r
}
