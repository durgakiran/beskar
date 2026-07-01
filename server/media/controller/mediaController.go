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
	return r
}
