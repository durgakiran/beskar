package media

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/durgakiran/beskar/core"
	media "github.com/durgakiran/beskar/media/services"
	"github.com/durgakiran/beskar/quota"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/google/uuid"
)

type fileNameType struct {
	Name string `json:"name"`
}

type whiteboardAssetResponse struct {
	Hash     string `json:"hash"`
	MimeType string `json:"mimeType"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Bytes    int64  `json:"byteLength"`
}

var (
	getUserInfoForMedia        = core.GetUserInfo
	validateUserPagePermission = core.ValidateUserPagePermission
)

func applyWhiteboardAssetHeaders(header http.Header, record *media.WhiteboardAssetRecord, contentLength int64) {
	header.Set("Content-Type", record.MimeType)
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	header.Set("Cross-Origin-Resource-Policy", "same-origin")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("Cache-Control", "private, max-age=31536000, immutable")
	header.Set("Content-Disposition", `inline; filename="`+record.ContentHash+`"`)
	if contentLength > 0 {
		header.Set("Content-Length", strconv.FormatInt(contentLength, 10))
	}
}

func authorizedPageID(w http.ResponseWriter, r *http.Request, permission string) (int64, bool) {
	user, err := getUserInfoForMedia(r.Context())
	if err != nil || user.Id == "" {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "unauthorized", ""))
		return 0, false
	}
	pageIDString := chi.URLParam(r, "pageId")
	pageID, err := strconv.ParseInt(pageIDString, 10, 64)
	if err != nil || pageID < 1 {
		render.Status(r, http.StatusBadRequest)
		render.Render(w, r, core.NewFailedResponse(http.StatusBadRequest, core.FAILURE, "invalid pageId", ""))
		return 0, false
	}
	ownerID, err := uuid.Parse(user.AId)
	if err != nil || !validateUserPagePermission(pageIDString, ownerID, permission) {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "no permission for this whiteboard asset", ""))
		return 0, false
	}
	return pageID, true
}

func getWhiteboardAsset(w http.ResponseWriter, r *http.Request) {
	pageID, ok := authorizedPageID(w, r, "view")
	if !ok {
		return
	}
	contentHash := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "hash")))
	record, err := media.GetWhiteboardAsset(r.Context(), pageID, contentHash)
	if err != nil {
		core.Logger.Error("whiteboard asset metadata lookup: " + err.Error())
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, "failed to load whiteboard asset", ""))
		return
	}
	if record == nil {
		render.Status(r, http.StatusNotFound)
		render.Render(w, r, core.NewFailedResponse(http.StatusNotFound, core.FAILURE, "whiteboard asset not found", ""))
		return
	}
	reader, meta, err := media.OpenWhiteboardAsset(r.Context(), record.StorageKey)
	if err != nil {
		render.Status(r, http.StatusNotFound)
		render.Render(w, r, core.NewFailedResponse(http.StatusNotFound, core.FAILURE, "whiteboard asset not found", ""))
		return
	}
	defer reader.Close()

	contentLength := record.FileSize
	if contentLength <= 0 {
		contentLength = meta.Size
	}
	applyWhiteboardAssetHeaders(w.Header(), record, contentLength)
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, reader); err != nil {
		core.Logger.Error("whiteboard asset stream: " + err.Error())
	}
}

func saveWhiteboardAsset(w http.ResponseWriter, r *http.Request) {
	pageID, ok := authorizedPageID(w, r, "edit")
	if !ok {
		return
	}
	user, _ := getUserInfoForMedia(r.Context())
	contentHash := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "hash")))
	if r.ContentLength > media.MaxWhiteboardAssetBytes {
		render.Status(r, http.StatusRequestEntityTooLarge)
		render.Render(w, r, core.NewFailedResponse(http.StatusRequestEntityTooLarge, core.FAILURE, "whiteboard asset exceeds encoded byte limit", ""))
		return
	}
	reader := http.MaxBytesReader(w, r.Body, media.MaxWhiteboardAssetBytes+1)
	data, err := io.ReadAll(reader)
	if err != nil || len(data) > media.MaxWhiteboardAssetBytes {
		render.Status(r, http.StatusRequestEntityTooLarge)
		render.Render(w, r, core.NewFailedResponse(http.StatusRequestEntityTooLarge, core.FAILURE, "whiteboard asset exceeds encoded byte limit", ""))
		return
	}
	inspected, err := media.InspectWhiteboardRaster(data, r.Header.Get("Content-Type"), contentHash)
	if err != nil {
		render.Status(r, http.StatusUnsupportedMediaType)
		render.Render(w, r, core.NewFailedResponse(http.StatusUnsupportedMediaType, core.FAILURE, err.Error(), ""))
		return
	}
	if existing, lookupErr := media.GetWhiteboardAsset(r.Context(), pageID, contentHash); lookupErr != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, "asset lookup failed", ""))
		return
	} else if existing != nil {
		render.Status(r, http.StatusOK)
		render.Render(w, r, core.NewSucessResponse(core.SUCCESS, whiteboardAssetResponse{
			Hash: existing.ContentHash, MimeType: existing.MimeType, Width: existing.Width,
			Height: existing.Height, Bytes: existing.FileSize,
		}))
		return
	}

	reservation, err := quota.ReserveUploadCapacity(
		r.Context(), pageID, inspected.FileSize, "whiteboard_asset", inspected.ContentHash,
		map[string]any{"actorUserId": user.AId, "contentHash": inspected.ContentHash},
	)
	if err != nil {
		status := http.StatusInternalServerError
		if err == quota.ErrAccountStorageLimitExceeded {
			status = http.StatusForbidden
		}
		render.Status(r, status)
		render.Render(w, r, core.NewFailedResponse(status, core.FAILURE, err.Error(), ""))
		return
	}
	record, created, err := media.SaveWhiteboardAsset(
		r.Context(), reservation, pageID, user.AId, inspected, data,
	)
	if err != nil {
		_ = quota.ReleaseUploadReservation(r.Context(), reservation)
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, "whiteboard asset upload failed", ""))
		return
	}
	if !created {
		_ = quota.ReleaseUploadReservation(r.Context(), reservation)
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	render.Status(r, status)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, whiteboardAssetResponse{
		Hash: record.ContentHash, MimeType: record.MimeType, Width: record.Width,
		Height: record.Height, Bytes: record.FileSize,
	}))
}

func getImage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "unauthorized", ""))
		return
	}

	imageId := chi.URLParam(r, "imageid")
	record, err := media.GetImageAssetByPublicName(ctx, imageId)
	if err != nil {
		core.Logger.Error("image metadata lookup: " + err.Error())
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(http.StatusInternalServerError, core.FAILURE, "failed to load image", ""))
		return
	}
	if record == nil {
		render.Status(r, http.StatusNotFound)
		render.Render(w, r, core.NewFailedResponse(http.StatusNotFound, core.FAILURE, "image not found", ""))
		return
	}

	ownerID, err := uuid.Parse(user.AId)
	if err != nil {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "unauthorized", ""))
		return
	}
	if !core.ValidateUserPagePermission(strconv.FormatInt(record.PageID, 10), ownerID, "view") {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "no permission to view this image", ""))
		return
	}

	reader, meta, err := media.OpenImage(ctx, record.StorageKey)
	if err != nil {
		core.Logger.Error("image read: " + err.Error())
		render.Status(r, http.StatusNotFound)
		render.Render(w, r, core.NewFailedResponse(http.StatusNotFound, core.FAILURE, "image not found", ""))
		return
	}
	defer reader.Close()

	contentType := record.MimeType
	if contentType == "" {
		contentType = meta.ContentType
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	contentLength := record.FileSize
	if contentLength <= 0 {
		contentLength = meta.Size
	}

	if record.OriginalFileName != "" {
		w.Header().Set("Content-Disposition", `inline; filename="`+sanitizeInlineFilename(record.OriginalFileName)+`"`)
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if contentType == "image/svg+xml" {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
	}
	if contentLength > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(contentLength, 10))
	}
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, reader); err != nil {
		core.Logger.Error("image stream: " + err.Error())
	}
}

func saveImage(w http.ResponseWriter, r *http.Request) {
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
		render.Render(w, r, core.NewFailedResponse(http.StatusBadRequest, core.FAILURE, "pageId is required", ""))
		return
	}
	pageID, err := strconv.ParseInt(pageIDStr, 10, 64)
	if err != nil || pageID < 1 {
		render.Status(r, http.StatusBadRequest)
		render.Render(w, r, core.NewFailedResponse(http.StatusBadRequest, core.FAILURE, "invalid pageId", ""))
		return
	}

	ownerID, err := uuid.Parse(user.AId)
	if err != nil {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "unauthorized", ""))
		return
	}
	if !core.ValidateUserPagePermission(pageIDStr, ownerID, "edit") {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "no permission to upload for this page", ""))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		core.Logger.Error("Error retrieving file: " + err.Error())
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(500, core.FAILURE, err.Error(), ""))
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		core.Logger.Error("image upload read: " + err.Error())
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(500, core.FAILURE, "failed to read image", ""))
		return
	}

	reservation, err := quota.ReserveUploadCapacity(ctx, pageID, int64(len(data)), "image", header.Filename, map[string]any{
		"actorUserId": ownerID.String(),
		"fileName":    header.Filename,
	})
	if err != nil {
		if err == quota.ErrAccountStorageLimitExceeded {
			render.Status(r, http.StatusForbidden)
			render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, err.Error(), ""))
			return
		}
		core.Logger.Error("image reserve: " + err.Error())
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(500, core.FAILURE, "upload failed", ""))
		return
	}

	image, err := media.SaveImageAsset(ctx, reservation, pageID, user.AId, header.Filename, data)
	if err != nil {
		if releaseErr := quota.ReleaseUploadReservation(ctx, reservation); releaseErr != nil {
			core.Logger.Error("image release reservation: " + releaseErr.Error())
		}
		core.Logger.Error("image upload save: " + err.Error())
		status := http.StatusInternalServerError
		message := "upload failed"
		if strings.Contains(err.Error(), "supported image type") || strings.Contains(err.Error(), "decode image") {
			status = http.StatusUnsupportedMediaType
			message = err.Error()
		}
		render.Status(r, status)
		render.Render(w, r, core.NewFailedResponse(status, core.FAILURE, message, ""))
		return
	}

	response := fileNameType{
		Name: image.PublicName,
	}
	render.Status(r, http.StatusCreated)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, response))
}

func sanitizeInlineFilename(name string) string {
	safe := strings.Map(func(r rune) rune {
		if r < 32 || r > 126 {
			return '_'
		}
		switch r {
		case '"', '\\', '/':
			return '_'
		default:
			return r
		}
	}, name)
	if strings.TrimSpace(safe) == "" {
		return "image"
	}
	return safe
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/image/{imageid}", getImage)
	r.Post("/upload", saveImage)
	r.Get("/whiteboard-asset/{pageId}/{hash}", getWhiteboardAsset)
	r.Post("/whiteboard-asset/{pageId}/{hash}", saveWhiteboardAsset)
	return r
}
