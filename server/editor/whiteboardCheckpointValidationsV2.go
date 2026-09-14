package editor

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"unicode/utf8"
)

var errWhiteboardV2UpdateTooLarge = errors.New("Decoded checkpoint exceeds 1 MiB.")

func validateWhiteboardCheckpointV2(data []byte) (string, []byte, error) {
	invalid := errors.New("Expected updateEncoding and a base64-encoded Yjs v1 update.")
	if !utf8.Valid(data) {
		return "", nil, invalid
	}
	var body whiteboardCheckpointV2Body
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		return "", nil, invalid
	}
	if decoder.Decode(new(any)) != io.EOF || body.UpdateEncoding != whiteboardUpdateEncodingV1 || body.Update == "" {
		return "", nil, invalid
	}
	if _, err := parseWhiteboardTitle(data); err != nil {
		return "", nil, err
	}
	if _, err := checkpointGeneration(data); err != nil {
		return "", nil, err
	}
	update, err := base64.StdEncoding.Strict().DecodeString(body.Update)
	if err != nil {
		return "", nil, invalid
	}
	if len(update) > whiteboardCheckpointV2MaxUpdate {
		return "", nil, errWhiteboardV2UpdateTooLarge
	}
	if err := validateYjsUpdateV1(update); err != nil {
		return "", nil, errors.New("Invalid Yjs v1 update or nesting exceeds 64 levels.")
	}
	return body.UpdateEncoding, update, nil
}

func checkpointGeneration(data []byte) (int64, error) {
	var body whiteboardCheckpointV2Body
	if err := json.Unmarshal(data, &body); err != nil {
		return 0, err
	}
	if body.RestoreGeneration == "" {
		return 0, nil
	}
	n, err := strconv.ParseInt(body.RestoreGeneration, 10, 64)
	if err != nil || n < 0 || strconv.FormatInt(n, 10) != body.RestoreGeneration {
		return 0, errors.New("restoreGeneration must be a nonnegative decimal string")
	}
	return n, nil
}
