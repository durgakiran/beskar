package editor

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

var errWhiteboardTitleInvalid = errors.New("title must be a string containing 1–255 characters and no null character")

func parseWhiteboardTitle(data []byte) (*string, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	raw, exists := fields["title"]
	if !exists {
		return nil, nil
	}
	var title string
	if string(raw) == "null" || json.Unmarshal(raw, &title) != nil {
		return nil, errWhiteboardTitleInvalid
	}
	return normalizeWhiteboardTitle(title)
}

func normalizeWhiteboardTitle(title string) (*string, error) {
	title = strings.TrimSpace(title)
	if !utf8.ValidString(title) || utf8.RuneCountInString(title) < 1 || utf8.RuneCountInString(title) > 255 || strings.ContainsRune(title, 0) {
		return nil, errWhiteboardTitleInvalid
	}
	return &title, nil
}

const whiteboardV2InsertTitle = `INSERT INTO whiteboard.whiteboard_title_update(page_id,sequence,title) VALUES($1,$2,$3)`
const whiteboardV2TitleAtSequence = `SELECT COALESCE(
 (SELECT title FROM whiteboard.whiteboard_title_update WHERE page_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY sequence DESC LIMIT 1),$4::text)`
