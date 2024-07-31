package editor

import (
	"encoding/json"
	"errors"

	"github.com/google/uuid"
)

func ValidateNewDoc(data []byte) (InputDocument, error) {
	var inputDoc InputDocument
	err := json.Unmarshal(data, &inputDoc)
	if err != nil {
		return InputDocument{}, err
	}

	if inputDoc.Title == "" {
		return InputDocument{}, errors.New("invalid document: No title present")
	}

	if inputDoc.SpaceId == uuid.Nil {
		return InputDocument{}, errors.New("invalid document: Invalid space id")
	}

	return inputDoc, nil
}

func ValidateUserSpacePermissions(spaceId uuid.UUID, userId uuid.UUID) bool {
	space := GetSpace(spaceId)
	return space.UserId == userId
}
