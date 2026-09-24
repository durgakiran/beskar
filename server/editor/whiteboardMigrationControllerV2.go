package editor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"unicode/utf8"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const whiteboardMigrationMaxBody = 49 * 1024 * 1024 // 32 MiB state + 4 MiB PNG, base64 encoded.
type whiteboardMigrator interface {
	GetMigrationSource(context.Context, whiteboardDraftInput) (whiteboardMigrationSource, error)
	MigrateWhiteboard(context.Context, whiteboardMigrationInput) (whiteboardMigrationResult, error)
}
type whiteboardMigrationControllerV2 struct {
	identity whiteboardPublishControllerV2
	service  whiteboardMigrator
}

func (d whiteboardMigrationControllerV2) register(r chi.Router) {
	r.Get("/space/{spaceId}/whiteboard/{pageId}/migration-source", d.source)
	r.Post("/space/{spaceId}/whiteboard/{pageId}/migrate", d.migrate)
}
func migrationHTTPError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errWhiteboardMigrationAssets):
		whiteboardV2Error(w, r, 409, "MIGRATION_ASSETS_UNSUPPORTED", err.Error())
	case errors.Is(err, errWhiteboardMigrationAssetMismatch):
		whiteboardV2Error(w, r, 422, "MIGRATION_ASSET_MISMATCH", err.Error())
	case errors.Is(err, errWhiteboardAssetUnavailable):
		logWhiteboardV2Error("whiteboard migration asset unavailable", err)
		w.Header().Set("Retry-After", "1")
		whiteboardV2Error(w, r, 503, "MIGRATION_ASSET_UNAVAILABLE", "Unable to copy a legacy image. Retry migration once its original bytes are available.")
	case errors.Is(err, errWhiteboardAssetNotFound), errors.Is(err, errWhiteboardAssetInvalid), errors.Is(err, errWhiteboardAssetTooLarge), errors.Is(err, errWhiteboardAssetUnsupported), errors.Is(err, errWhiteboardAssetBusy), errors.Is(err, quota.ErrAccountStorageLimitExceeded):
		whiteboardAssetHTTPError(w, r, err)
	case errors.Is(err, errWhiteboardMigrationFormat):
		whiteboardV2Error(w, r, 422, "MIGRATION_FORMAT_UNSUPPORTED", err.Error())
	case errors.Is(err, errWhiteboardMigrationSource):
		whiteboardV2Error(w, r, 409, "SOURCE_CHANGED", err.Error())
	case errors.Is(err, errWhiteboardMigrated):
		whiteboardV2Error(w, r, 409, "WHITEBOARD_MIGRATED", err.Error())
	default:
		publishHTTPError(w, r, err)
	}
}
func legacyMigrationHTTPError(w http.ResponseWriter, r *http.Request, err error) bool {
	if !errors.Is(err, errWhiteboardMigrated) {
		return false
	}
	migrationHTTPError(w, r, err)
	return true
}
func (d whiteboardMigrationControllerV2) source(w http.ResponseWriter, r *http.Request) {
	in, ok := d.identity.identity(w, r, "edit")
	if !ok {
		return
	}
	out, err := d.service.GetMigrationSource(r.Context(), in)
	if err != nil {
		migrationHTTPError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, 200, out)
}
func (d whiteboardMigrationControllerV2) migrate(w http.ResponseWriter, r *http.Request) {
	identity, ok := d.identity.identity(w, r, "edit")
	if !ok {
		return
	}
	keys := r.Header.Values("Idempotency-Key")
	if len(keys) != 1 {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "One UUID Idempotency-Key is required.")
		return
	}
	key, err := uuid.Parse(keys[0])
	if err != nil || key == uuid.Nil {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "One UUID Idempotency-Key is required.")
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		whiteboardV2Error(w, r, 415, "UNSUPPORTED_MEDIA_TYPE", "Use application/json.")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, whiteboardMigrationMaxBody))
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			whiteboardV2Error(w, r, 413, "REQUEST_TOO_LARGE", "Migration exceeds 49 MiB.")
		} else {
			whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Unable to read migration.")
		}
		return
	}
	var body whiteboardMigrationBody
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if !utf8.Valid(data) || decoder.Decode(&body) != nil || decoder.Decode(new(any)) != io.EOF {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Invalid migration JSON.")
		return
	}
	out, err := d.service.MigrateWhiteboard(r.Context(), whiteboardMigrationInput{whiteboardDraftInput: identity, whiteboardMigrationBody: body, IdempotencyKey: key})
	if err != nil {
		migrationHTTPError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, 200, out)
}
