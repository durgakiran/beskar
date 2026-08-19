package media

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	media "github.com/durgakiran/beskar/media/services"
	"github.com/durgakiran/beskar/quota"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/google/uuid"
)

const whiteboardAssetIDPrefix = "asset:sha256:"

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
	retainWhiteboardAssets     = media.RetainWhiteboardAssetReferences
	rollbackWhiteboardAsset    = media.RollbackWhiteboardAsset
	prepareWhiteboardStaging   = media.PrepareWhiteboardAssetStaging
	stageWhiteboardAsset       = media.StageWhiteboardAsset
	commitWhiteboardStaging    = media.CommitWhiteboardAssetStaging
	cancelWhiteboardStaging    = media.CancelWhiteboardAssetStaging
)

func cleanupFailedWhiteboardStaging(token uuid.UUID, pageID int64, hash, actorID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := cancelWhiteboardStaging(ctx, token, pageID, hash, actorID); err != nil {
		core.Logger.Error("whiteboard staging compensation failed: " + err.Error())
	}
}

type whiteboardAssetStagingResponse struct {
	Token string `json:"token"`
}

func whiteboardStagingParams(w http.ResponseWriter, r *http.Request) (int64, string, uuid.UUID, core.UserInfo, bool) {
	pageID, user, ok := authorizedPage(w, r, "edit")
	if !ok {
		return 0, "", uuid.Nil, core.UserInfo{}, false
	}
	hash := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "hash")))
	if _, valid := parseCanonicalWhiteboardAssetID(whiteboardAssetIDPrefix + hash); !valid {
		http.Error(w, "invalid whiteboard asset hash", http.StatusBadRequest)
		return 0, "", uuid.Nil, core.UserInfo{}, false
	}
	token := uuid.Nil
	if value := chi.URLParam(r, "token"); value != "" {
		var err error
		token, err = uuid.Parse(value)
		if err != nil {
			http.Error(w, "invalid whiteboard staging token", http.StatusBadRequest)
			return 0, "", uuid.Nil, core.UserInfo{}, false
		}
	}
	return pageID, hash, token, user, true
}

func renderWhiteboardStagingError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, media.ErrWhiteboardAssetNotFound):
		status = http.StatusNotFound
	case errors.Is(err, media.ErrWhiteboardAssetNotOwner):
		status = http.StatusForbidden
	case errors.Is(err, media.ErrWhiteboardAssetCompensated):
		status = http.StatusConflict
	case errors.Is(err, quota.ErrAccountStorageLimitExceeded):
		status = http.StatusInsufficientStorage
	case strings.Contains(err.Error(), "does not match"), strings.Contains(err.Error(), "transaction is"):
		status = http.StatusConflict
	}
	http.Error(w, err.Error(), status)
}

func prepareWhiteboardAssetUpload(w http.ResponseWriter, r *http.Request) {
	pageID, hash, _, user, ok := whiteboardStagingParams(w, r)
	if !ok {
		return
	}
	record, err := prepareWhiteboardStaging(r.Context(), pageID, hash, user.AId)
	if err != nil {
		renderWhiteboardStagingError(w, err)
		return
	}
	render.Status(r, http.StatusCreated)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, whiteboardAssetStagingResponse{Token: record.Token.String()}))
}

func stageWhiteboardAssetUpload(w http.ResponseWriter, r *http.Request) {
	pageID, hash, token, user, ok := whiteboardStagingParams(w, r)
	if !ok {
		return
	}
	if r.ContentLength > media.MaxWhiteboardAssetBytes {
		http.Error(w, "whiteboard asset exceeds encoded byte limit", http.StatusRequestEntityTooLarge)
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, media.MaxWhiteboardAssetBytes+1))
	if err != nil || len(data) > media.MaxWhiteboardAssetBytes {
		http.Error(w, "whiteboard asset exceeds encoded byte limit", http.StatusRequestEntityTooLarge)
		return
	}
	inspected, err := media.InspectWhiteboardRaster(data, r.Header.Get("Content-Type"), hash)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnsupportedMediaType)
		return
	}
	if _, err = stageWhiteboardAsset(r.Context(), token, pageID, hash, user.AId, inspected, data); err != nil {
		cleanupFailedWhiteboardStaging(token, pageID, hash, user.AId)
		renderWhiteboardStagingError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func commitWhiteboardAssetUpload(w http.ResponseWriter, r *http.Request) {
	pageID, hash, token, user, ok := whiteboardStagingParams(w, r)
	if !ok {
		return
	}
	record, created, err := commitWhiteboardStaging(r.Context(), token, pageID, hash, user.AId)
	if err != nil {
		renderWhiteboardStagingError(w, err)
		return
	}
	if record == nil {
		renderWhiteboardStagingError(w, media.ErrWhiteboardAssetCompensated)
		return
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

func cancelWhiteboardAssetUpload(w http.ResponseWriter, r *http.Request) {
	pageID, hash, token, user, ok := whiteboardStagingParams(w, r)
	if !ok {
		return
	}
	if err := cancelWhiteboardStaging(r.Context(), token, pageID, hash, user.AId); err != nil {
		renderWhiteboardStagingError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type retainWhiteboardAssetsRequest struct {
	AssetIDs []string `json:"assetIds"`
	Context  struct {
		DocumentID string `json:"documentId"`
	} `json:"context"`
}

func parseCanonicalWhiteboardAssetID(id string) (string, bool) {
	if !strings.HasPrefix(id, whiteboardAssetIDPrefix) {
		return "", false
	}
	hash := strings.TrimPrefix(id, whiteboardAssetIDPrefix)
	if len(hash) != 64 || hash != strings.ToLower(hash) {
		return "", false
	}
	if _, err := hex.DecodeString(hash); err != nil {
		return "", false
	}
	return hash, true
}

func retainWhiteboardAssetReferences(w http.ResponseWriter, r *http.Request) {
	pageID, ok := authorizedPageID(w, r, "edit")
	if !ok {
		return
	}
	var request retainWhiteboardAssetsRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || len(request.AssetIDs) > 1000 {
		http.Error(w, "invalid whiteboard asset retention request", http.StatusBadRequest)
		return
	}
	docID, err := strconv.ParseInt(request.Context.DocumentID, 10, 64)
	if err != nil || docID < 1 {
		http.Error(w, "invalid documentId", http.StatusBadRequest)
		return
	}
	hashes := make([]string, 0, len(request.AssetIDs))
	for _, id := range request.AssetIDs {
		hash, valid := parseCanonicalWhiteboardAssetID(id)
		if !valid {
			http.Error(w, "invalid asset id", http.StatusBadRequest)
			return
		}
		hashes = append(hashes, hash)
	}
	if err := retainWhiteboardAssets(r.Context(), pageID, docID, hashes); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, media.ErrWhiteboardAssetNotFound) {
			status = http.StatusNotFound
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func deleteWhiteboardAsset(w http.ResponseWriter, r *http.Request) {
	pageID, user, ok := authorizedPage(w, r, "edit")
	if !ok {
		return
	}
	hash := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "hash")))
	if err := rollbackWhiteboardAsset(r.Context(), pageID, hash, user.AId); err != nil {
		status := http.StatusInternalServerError
		switch {
		case errors.Is(err, media.ErrWhiteboardAssetNotFound):
			status = http.StatusNotFound
		case errors.Is(err, media.ErrWhiteboardAssetReferenced):
			status = http.StatusConflict
		case errors.Is(err, media.ErrWhiteboardAssetNotOwner):
			status = http.StatusForbidden
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

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

func authorizedPage(w http.ResponseWriter, r *http.Request, permission string) (int64, core.UserInfo, bool) {
	user, err := getUserInfoForMedia(r.Context())
	if err != nil || user.Id == "" {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "unauthorized", ""))
		return 0, core.UserInfo{}, false
	}
	pageIDString := chi.URLParam(r, "pageId")
	pageID, err := strconv.ParseInt(pageIDString, 10, 64)
	if err != nil || pageID < 1 {
		render.Status(r, http.StatusBadRequest)
		render.Render(w, r, core.NewFailedResponse(http.StatusBadRequest, core.FAILURE, "invalid pageId", ""))
		return 0, core.UserInfo{}, false
	}
	ownerID, err := uuid.Parse(user.AId)
	if err != nil || !validateUserPagePermission(pageIDString, ownerID, permission) {
		render.Status(r, http.StatusForbidden)
		render.Render(w, r, core.NewFailedResponse(http.StatusForbidden, core.FAILURE, "no permission for this whiteboard asset", ""))
		return 0, core.UserInfo{}, false
	}
	return pageID, user, true
}

func authorizedPageID(w http.ResponseWriter, r *http.Request, permission string) (int64, bool) {
	pageID, _, ok := authorizedPage(w, r, permission)
	return pageID, ok
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
	pageID, user, ok := authorizedPage(w, r, "edit")
	if !ok {
		return
	}
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
	r.Post("/whiteboard-asset/{pageId}/{hash}/staging", prepareWhiteboardAssetUpload)
	r.Put("/whiteboard-asset/{pageId}/{hash}/staging/{token}", stageWhiteboardAssetUpload)
	r.Post("/whiteboard-asset/{pageId}/{hash}/staging/{token}/commit", commitWhiteboardAssetUpload)
	r.Delete("/whiteboard-asset/{pageId}/{hash}/staging/{token}", cancelWhiteboardAssetUpload)
	r.Post("/whiteboard-asset/{pageId}/retain", retainWhiteboardAssetReferences)
	r.Delete("/whiteboard-asset/{pageId}/{hash}", deleteWhiteboardAsset)
	return r
}
