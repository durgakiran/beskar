package editor

import (
	"context"
	"encoding/hex"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type whiteboardCheckpointUploaderV2 interface {
	CheckpointUpload(context.Context, whiteboardCheckpointUploadInput) (whiteboardCheckpointUploadResult, error)
}

type whiteboardCheckpointUploadControllerV2 struct {
	identity whiteboardPublishControllerV2
	service  whiteboardCheckpointUploaderV2
}

func (d whiteboardCheckpointUploadControllerV2) handleUpload(w http.ResponseWriter, r *http.Request) {
	board, ok := d.identity.boardIdentity(w, r, "edit")
	if !ok {
		return
	}
	key, keyErr := uuid.Parse(chi.URLParam(r, "uploadId"))
	query := r.URL.Query()
	size, sizeErr := strconv.Atoi(query.Get("size"))
	generation, generationErr := strconv.ParseInt(query.Get("generation"), 10, 64)
	digest := query.Get("digest")
	digestHex, hasPrefix := strings.CutPrefix(digest, "sha256:")
	hash, digestErr := hex.DecodeString(digestHex)
	parameters := 3
	if r.Method == http.MethodPut {
		parameters++
	}
	if keyErr != nil || key == uuid.Nil || sizeErr != nil || generationErr != nil || generation < 0 ||
		!hasPrefix || digestErr != nil || len(hash) != 32 || hex.EncodeToString(hash) != digestHex ||
		len(query) != parameters || len(query["size"]) != 1 || len(query["generation"]) != 1 || len(query["digest"]) != 1 {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "A valid upload ID, size, restore generation and SHA-256 digest are required.")
		return
	}
	if size > whiteboardCheckpointV2MaxAssembled {
		whiteboardV2Error(w, r, 413, "REQUEST_TOO_LARGE", "The assembled checkpoint cannot exceed 4 MiB.")
		return
	}
	if size <= whiteboardCheckpointV2MaxUpdate {
		whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "Use the normal checkpoint endpoint for updates up to 1 MiB.")
		return
	}

	in := whiteboardCheckpointUploadInput{
		checkpoint: whiteboardCheckpointV2Input{
			PageID: board.PageID, SpaceID: board.SpaceID, ActorID: board.ActorID, IdempotencyKey: key,
			RestoreGeneration: generation, UpdateEncoding: whiteboardUpdateEncodingV1,
		},
		size: size, digest: digest,
	}
	if r.Method == http.MethodPut {
		offset, err := strconv.Atoi(query.Get("offset"))
		if err != nil || len(query["offset"]) != 1 || offset < 0 || offset >= size || offset%checkpointUploadChunkSize != 0 {
			whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "A valid chunk offset is required.")
			return
		}
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/octet-stream" {
			whiteboardV2Error(w, r, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/octet-stream.")
			return
		}
		expected := min(checkpointUploadChunkSize, size-offset)
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, int64(expected)))
		var tooLarge *http.MaxBytesError
		switch {
		case errors.As(err, &tooLarge):
			whiteboardV2Error(w, r, 413, "REQUEST_TOO_LARGE", "The chunk exceeds its declared size.")
			return
		case err != nil || len(data) != expected:
			whiteboardV2Error(w, r, 400, "INVALID_REQUEST", "The chunk does not match its declared size.")
			return
		}
		in.offset, in.chunk = offset, data
	}

	result, err := d.service.CheckpointUpload(r.Context(), in)
	if err != nil {
		writeCheckpointV2Error(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, http.StatusOK, result)
}
