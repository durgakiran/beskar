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
	"github.com/go-chi/render"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const whiteboardCreateV2MaxBody = 16 * 1024

type whiteboardCreatorV2 interface {
	CreateWhiteboard(context.Context, whiteboardCreateV2Input) (whiteboardCreateV2Result, error)
}

type whiteboardControllerV2 struct {
	user      func(context.Context) (core.UserInfo, error)
	canCreate func(uuid.UUID, uuid.UUID, string) bool
	canEdit   func(string, uuid.UUID, string) bool
	service   whiteboardCreatorV2
}

// RouterV2 exposes whiteboard creation, checkpoints, draft retrieval and publication.
// Existing v1 routes continue to use core.whiteboard_data.
func RouterV2() *chi.Mux {
	service := newWhiteboardServiceV2()
	r := whiteboardRouterV2(whiteboardControllerV2{
		user:      core.GetUserInfo,
		canCreate: core.ValidateUserSpacePermissions,
		canEdit:   core.ValidateUserPagePermission,
		service:   service,
	})
	checkpoint := whiteboardCheckpointControllerV2{user: core.GetUserInfo, canEdit: core.ValidateUserPagePermission, service: service}
	r.Post("/space/{spaceId}/whiteboard/{pageId}/checkpoint", checkpoint.handleCheckpoint)
	draft := whiteboardDraftControllerV2{user: core.GetUserInfo, canEdit: core.ValidateUserPagePermission, service: service}
	draft.register(r)
	publication := whiteboardPublishControllerV2{user: core.GetUserInfo, permission: core.ValidateUserPagePermission, service: service}
	publication.register(r)
	history := whiteboardHistoryControllerV2{identity: publication, service: service}
	history.register(r)
	return r
}

func whiteboardRouterV2(deps whiteboardControllerV2) *chi.Mux {
	r := chi.NewRouter()
	r.Post("/space/{spaceId}/whiteboard/create", deps.handleCreate)
	return r
}

func (deps whiteboardControllerV2) handleCreate(w http.ResponseWriter, r *http.Request) {
	user, err := deps.user(r.Context())
	actorID, actorErr := uuid.Parse(user.AId)
	if err != nil || user.Id == "" || actorErr != nil || actorID == uuid.Nil {
		whiteboardV2Error(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Authentication is required.")
		return
	}
	spaceID, err := uuid.Parse(chi.URLParam(r, "spaceId"))
	if err != nil || spaceID == uuid.Nil {
		whiteboardV2Error(w, r, http.StatusBadRequest, "INVALID_REQUEST", "A valid space UUID is required.")
		return
	}
	keys := r.Header.Values("Idempotency-Key")
	var key uuid.UUID
	if len(keys) == 1 {
		key, err = uuid.Parse(keys[0])
	}
	if len(keys) != 1 || err != nil || key == uuid.Nil {
		whiteboardV2Error(w, r, http.StatusBadRequest, "INVALID_REQUEST", "One UUID Idempotency-Key header is required.")
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		whiteboardV2Error(w, r, http.StatusUnsupportedMediaType, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, whiteboardCreateV2MaxBody))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			whiteboardV2Error(w, r, http.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE", "Creation request exceeds 16 KiB.")
		} else {
			whiteboardV2Error(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Unable to read the request.")
		}
		return
	}
	body, err := validateWhiteboardCreateV2(data)
	if err != nil {
		whiteboardV2Error(w, r, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !deps.canCreate(spaceID, actorID, "edit_page") ||
		(body.ParentID != nil && !deps.canEdit(strconv.FormatInt(*body.ParentID, 10), actorID, "edit")) {
		whiteboardV2Error(w, r, http.StatusForbidden, "CREATE_WHITEBOARD_FORBIDDEN", "You cannot create a whiteboard here.")
		return
	}
	result, err := deps.service.CreateWhiteboard(r.Context(), whiteboardCreateV2Input{
		whiteboardCreateV2Body: body, SpaceID: spaceID, ActorID: actorID, IdempotencyKey: key,
	})
	if err != nil {
		switch {
		case errors.Is(err, errWhiteboardV2KeyReuse):
			whiteboardV2Error(w, r, http.StatusConflict, "IDEMPOTENCY_KEY_REUSED", err.Error())
		case errors.Is(err, errWhiteboardV2NotFound):
			whiteboardV2Error(w, r, http.StatusNotFound, "SPACE_OR_PARENT_NOT_FOUND", err.Error())
		case errors.Is(err, errWhiteboardV2Archived):
			whiteboardV2Error(w, r, http.StatusConflict, "SPACE_ARCHIVED", err.Error())
		case errors.Is(err, errWhiteboardV2LockTimeout):
			w.Header().Set("Retry-After", "1")
			whiteboardV2Error(w, r, http.StatusServiceUnavailable, "WHITEBOARD_CREATE_BUSY", "Whiteboard creation is busy. Retry with the same Idempotency-Key.")
		case errors.Is(err, errWhiteboardV2PermissionsPending):
			logWhiteboardV2Error("whiteboard v2 permission provisioning failed", err)
			w.Header().Set("Retry-After", "1")
			whiteboardV2Error(w, r, http.StatusServiceUnavailable, "WHITEBOARD_PERMISSIONS_PENDING", "Whiteboard creation is recorded. Retry with the same Idempotency-Key to finish permission setup.")
		default:
			logWhiteboardV2Error("whiteboard v2 creation failed", err)
			whiteboardV2Error(w, r, http.StatusInternalServerError, "WHITEBOARD_CREATE_FAILED", "Creation could not be confirmed. Retry with the same Idempotency-Key.")
		}
		return
	}

	// The response preserves the stable creation receipt contract. Clients use
	// these IDs with the v2 draft manifest; v1 readers use a different schema.
	core.SendSuccessResponse(w, r, http.StatusCreated, result)
}

func whiteboardV2Error(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	render.Status(r, status)
	render.JSON(w, r, map[string]any{
		"status": core.FAILURE,
		"error":  map[string]string{"code": code, "message": message},
	})
}

func logWhiteboardV2Error(message string, err error) {
	if core.Logger != nil {
		core.Logger.Error(message, zap.Error(err))
	}
}
