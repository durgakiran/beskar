package editor

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type whiteboardCheckpointerV2 interface {
	CheckpointWhiteboard(context.Context, whiteboardCheckpointV2Input) (whiteboardCheckpointV2Result, error)
}
type whiteboardCheckpointControllerV2 struct {
	user    func(context.Context) (core.UserInfo, error)
	canEdit func(string, uuid.UUID, string) bool
	service whiteboardCheckpointerV2
}

func (deps whiteboardCheckpointControllerV2) handleCheckpoint(w http.ResponseWriter, r *http.Request) {
	user, err := deps.user(r.Context())
	actor, actorErr := uuid.Parse(user.AId)
	if err != nil || user.Id == "" || actorErr != nil || actor == uuid.Nil {
		whiteboardV2Error(w, r, 401, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	space, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	page, pageErr := strconv.ParseInt(chi.URLParam(r, "pageId"), 10, 64)
	if err != nil || space == uuid.Nil || pageErr != nil || page <= 0 || page > 9007199254740991 {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Valid space and page IDs are required.")
		return
	}
	keys := r.Header.Values("Idempotency-Key")
	var key uuid.UUID
	if len(keys) == 1 {
		key, err = uuid.Parse(keys[0])
	}
	if len(keys) != 1 || err != nil || key == uuid.Nil {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "One UUID Idempotency-Key header is required.")
		return
	}
	if !deps.canEdit(strconv.FormatInt(page, 10), actor, "edit") {
		whiteboardV2Error(w, r, 403, "CHECKPOINT_FORBIDDEN", "You cannot edit this whiteboard.")
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		whiteboardV2Error(w, r, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, whiteboardCheckpointV2MaxBody))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			whiteboardV2Error(w, r, 413, "REQUEST_TOO_LARGE", "Checkpoint request exceeds 1.5 MiB.")
		} else {
			whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Unable to read the request.")
		}
		return
	}
	encoding, update, err := validateWhiteboardCheckpointV2(data)
	if err != nil {
		if errors.Is(err, errWhiteboardV2UpdateTooLarge) {
			whiteboardV2Error(w, r, 413, "REQUEST_TOO_LARGE", err.Error())
		} else {
			whiteboardV2Error(w, r, 400, "INVALID_REQUEST", err.Error())
		}
		return
	}
	title, _ := parseWhiteboardTitle(data)
	generation, _ := checkpointGeneration(data)
	result, err := deps.service.CheckpointWhiteboard(r.Context(), whiteboardCheckpointV2Input{
		RestoreGeneration: generation, Title: title, PageID: page, SpaceID: space, ActorID: actor, IdempotencyKey: key, UpdateEncoding: encoding, UpdateBytes: update,
	})
	if err != nil {
		switch {
		case errors.Is(err, errWhiteboardTitleInvalid):
			whiteboardV2Error(w, r, 400, "INVALID_REQUEST", err.Error())
		case errors.Is(err, errWhiteboardV2KeyReuse):
			whiteboardV2Error(w, r, 409, "IDEMPOTENCY_KEY_REUSED", errWhiteboardV2KeyReuse.Error())
		case errors.Is(err, errWhiteboardV2BoardNotFound):
			whiteboardV2Error(w, r, 404, "WHITEBOARD_NOT_FOUND", "Whiteboard not found in this space.")
		case errors.Is(err, errWhiteboardRestored):
			whiteboardV2Error(w, r, 409, "WHITEBOARD_RESTORED", err.Error())
		case errors.Is(err, errWhiteboardV2Archived):
			whiteboardV2Error(w, r, 409, "SPACE_ARCHIVED", errWhiteboardV2Archived.Error())
		case errors.Is(err, errWhiteboardV2LockTimeout):
			w.Header().Set("Retry-After", "1")
			whiteboardV2Error(w, r, 503, "WHITEBOARD_CHECKPOINT_BUSY", "Checkpoint is busy. Retry the same batch and Idempotency-Key.")
		default:
			logWhiteboardV2Error("whiteboard v2 checkpoint failed", err)
			whiteboardV2Error(w, r, 500, "WHITEBOARD_CHECKPOINT_FAILED", "Save could not be confirmed. Retry the same batch and Idempotency-Key.")
		}
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}
