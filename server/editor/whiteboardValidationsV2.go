package editor

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"unicode/utf8"
)

func validateWhiteboardCreateV2(data []byte) (whiteboardCreateV2Body, error) {
	var body whiteboardCreateV2Body
	if !utf8.Valid(data) {
		return body, errors.New("Request must contain valid UTF-8.")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		return body, errors.New("Expected a JSON object containing title and optional parentId.")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return body, errors.New("Request must contain exactly one JSON object.")
	}
	body.Title = strings.TrimSpace(body.Title)
	if size := utf8.RuneCountInString(body.Title); size < 1 || size > 255 || strings.ContainsRune(body.Title, '\x00') {
		return body, errors.New("Title must contain 1–255 characters and no null character.")
	}
	if body.ParentID != nil && (*body.ParentID <= 0 || *body.ParentID > 9007199254740991) {
		return body, errors.New("parentId must be a positive JavaScript-safe integer or null.")
	}
	return body, nil
}
